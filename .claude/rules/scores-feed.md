# ESPN Score Feed

Read this when working on live scores, the ESPN poller, auto-confirm, or the
commissioner Results-tab score feed card.

## Architecture Deviation From Original Spec

The original build prompt called for a Deno edge function invoked by pg_cron via
pg_net. Built instead as a single plpgsql function (`fetch_espn_scores()`), mirroring
the existing `fetch_all_active_odds()` pattern (`.claude/rules/betting.md`) — calls
`extensions.http_get` directly from SQL, scheduled with plain `cron.schedule`. No
pg_net, no vault-stored project URL, no edge function deploy. Simpler and consistent
with the only other scheduled external-API poller in this codebase. Cadence is every
**1 minute** (`* * * * *`, matching `fire-scheduled-locks`/`fetch-odds` conventions),
not the originally-requested 30 seconds — sub-minute pg_cron scheduling isn't used
anywhere else in this codebase and isn't worth the added risk for a cosmetic feed.

## ESPN Endpoints & Real JSON Shape

- `https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard` (MS)
- `https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard` (WS)

**The shape is NOT a flat list of matches.** `events[]` = tournaments (usually one —
"Wimbledon"). Each event has `groupings[]`, one per draw type
(`mens-singles`/`womens-singles`/`mens-doubles`/`womens-doubles`/`mixed-doubles`).
Each grouping has `competitions[]` = actual individual matches, each with its own
`status`, `competitors[]`, `round.displayName`. **One fetch returns the entire
tournament's data across every round** (qualifying through Final) — no `?dates=`
param needed, no per-day polling.

The poller filters to `grouping.slug = 'mens-singles'` (MS) or `'womens-singles'`
(WS) and ignores everything else (doubles/mixed have `competitors[].type = 'team'`
with a `roster.athletes[]`, not a single `athlete` — guarded against defensively but
excluded by the grouping filter regardless).

Per competitor: `athlete.displayName`, `winner` (bool), `linescores[]` (one entry per
set played, `{value, winner}`), `homeAway`. Competitor array order does **not**
reliably follow `home`/`away`/`order` — matching is always by normalised name pairing
against our draw, never by array position.

## Occupant Resolution & Score Writing

`matches.score` (verified dead field — see Prompt 1 history) is written directly by
the feed, plus three metadata columns: `espn_state`, `espn_winner`, `espn_updated_at`.
Round-2+ occupants resolved via the same `eff_p1`/`eff_p2` effective-occupant subquery
as the odds poller (plain subquery joined on `em.id = m.id`, not LATERAL — see
`.claude/rules/betting.md`). A round's pairing is only resolvable once **both**
feeders have a `matches.winner` set in our own authoritative data — ESPN being ahead
of our commissioner's confirmations is expected and just means that round's score
write waits.

Score string: sets joined `"6-3, 4-2"`, winner's games first per set once a winner is
known. **Live/undecided matches** (no winner yet) order by **card slot, not ESPN's raw
competitor order** — top card slot (`p1`/`eff_p1`) first, bottom slot second — using the
same `p1_is_c1` flag already computed for occupant matching. Fixed 2026-07-03: the
original live-score branch used ESPN's raw `c1`/`c2` array order regardless of which
competitor mapped to our card's top vs. bottom slot, so a live score like "2-3" could
read backwards against the card (e.g. showing the bottom-slot player's count first).
Confirmed against a real live match (Safiullin/Fonseca) before and after the fix.

**Serving indicator (added 2026-07-03):** ESPN exposes `competitors[].possession`
(bool) while a match is live — confirmed on a real live match. When `espn_state='in'`
and one side has `possession=true`, a `*` is appended to that player's game count in
the **current** set only, e.g. `"5*-3"`. No new column — the star is baked directly
into `matches.score`, so no client changes were needed. Handles the brief gap right
after a set ends (before ESPN's `linescores` array grows to include the new set's 0-0
entry) by comparing `status.period` (current set number) against the linescores count
and synthesizing a `0-0` set when period is ahead — e.g. `"6-3, 0-0*"` instead of
incorrectly starring the just-finished set. Completed matches never get a star
(gated on `ev_state='in'`).

**Known gap:** ESPN doesn't include `possession` on every live competitor object —
confirmed by direct inspection (2026-07-03) of a live match with no dot showing: its
`competitors[]` entries had no `possession` key at all (not `false`, simply absent),
while a concurrent live match on a different court had it on both sides. Appears to
be a per-court/per-feed live-tracking tier on ESPN's end, not something we control.
`coalesce((c->>'possession')::boolean, false)` already treats a missing key the same
as `false`, so the correct behavior (no dot) falls out automatically — nothing to fix
here, just don't be surprised when some live matches never show a serve dot.

## Name Matching & the Unmatched-Names Triage List

`espn_name_mappings` (espn_name PK → draw_player_name) works exactly like
`name_mappings` for odds, applied before normalisation. Real mismatches found on
first live run (Wimbledon 2026): CJK/family-name-first ordering (`"Wu Yibing"` ESPN
vs `"Yibing Wu"` our DB, `"Wang Xinyu"` vs `"Xinyu Wang"`), and suffix differences
(`"Martin Damm"` vs `"Martin Damm Jr"`).

**Only Round 1 misses populate the commissioner's "Unmatched ESPN Names" list**
(`score_feed_status.unmatched_names`, overwritten each successful run — no raw-events
table exists, so this is the only place the info can live). This was a deliberate fix
after the first live test: a naive "add every unresolved pairing" approach produced
~250 noisy entries, because most round-2+ misses are just "our feeder isn't confirmed
yet" (expected, not a mismatch) — not a real name-format issue. Round 1 pairings are
unambiguous: both entrants are known upfront on both sides, so any miss there is
guaranteed to be a genuine name-format issue, and since ESPN uses the same display
name for a player every round, any real mismatch already surfaces at Round 1. No need
to also flag it (redundantly, noisily) at every later round that player reaches.

## Abnormal Finishes

Confirmed exact live wording (2026-07-02, queried directly from a real retirement and
a real walkover in the Wimbledon 2026 draw) — matched on `status.type.name`, not
fuzzy text matching on `description`/`detail`:

| `status.type.name` | Score suffix |
|---|---|
| `STATUS_FINAL` | (none — normal) |
| `STATUS_RETIRED` | `" Ret."` appended to the partial score |
| `STATUS_WALKOVER` | `"Walkover"` (replaces the score entirely, no sets) |

Any other abnormal `status.type.name` at a `completed=true` state logs a
`RAISE WARNING` with the full raw `status_type` object (visible via Supabase MCP
`get_logs` → `postgres`) — not a table — so a real occurrence can be read and mapped
with a one-line fix later.

## Heartbeat & Alerting

`score_feed_status` (singleton, `id=1`): `last_ok`, `last_attempt`,
`consecutive_failures`, `last_error`, `last_alerted_at`, `unmatched_names`. A run only
counts as a failure on HTTP/JSON errors, or zero events **when the draw still has
undecided matches** (a genuinely empty response for a finished draw is not an error).

`check_and_alert_score_feed()` — cron every 5 min (`score-feed-heartbeat`). Alerts
(Resend, via `get_resend_api_key()` vault helper, called directly with
`extensions.http(...)` — same SQL-only pattern, no edge function) only when a draw is
active AND (`consecutive_failures >= 5` OR `last_ok` older than 15 min OR never
succeeded). Debounced via `last_alerted_at`: set on send, cleared automatically once
the feed recovers, so exactly one email per outage.

## Commissioner UI (Results tab)

`src/commissioner-scores.js` — `renderEspnScoreFeedSection()`, mounted at
`#comm-espn-wrap` inside `#comm-pane-results` (index.html), mirrors
`commissioner-odds.js`'s status/refresh/triage/saved-mappings structure. Wired from
`commissioner.js` alongside every `renderResults()` call (init, tab switch, M/W seg
switch) — not the odds tab's refresh callback, since scores live on Results, not
Odds. `refresh_espn_scores_now()` RPC mirrors `refresh_odds_now()` (commissioner-only
check, `PERFORM`/return `fetch_espn_scores()`).

**"ESPN says X won" per-match badge (added 2026-07-03):** the always-on score/LIVE line
(bracket.js) only ever rendered on the player bracket screen — `commissioner-results.js`
has its own separate card renderer (`_placeResultCard`, via `renderBracketLayout`, not
`bracket.js`'s `placeCard`) and never read `espn_winner`/`espn_state` at all, so there was
no visibility into ESPN's detected result on the Results tab pre-confirmation. This was a
real gap, not a display bug — `espn_winner` wasn't even selected in `data.js`'s `matches`
query (only `score`/`espn_state` were). Fixed by adding `espn_winner` to the query +
assembled match object (`data.js`), and a `.pr-espn-pick` "ESPN ✓" badge on whichever
row's name matches `m.espn_winner`, shown only pre-confirmation (`!hasResult`) so it
disappears the moment the commissioner clicks to confirm (or auto-confirm fires). This is
the manual safety-net UI Ben is using to sanity-check ESPN's detected winners against
several real results before turning on `scores_autoconfirm_enabled`.

## Frontend Display (always on, no flag)

`data.js` `loadDraw()` selects and assembles `score`/`espn_state` onto each match
object (defensive defaults: `score: mr.score ?? ''`, `espn_state: mr.espn_state ??
null`) — `buildDrawView` doesn't touch either field (round-level, not slot-level), and
the leaderboard viewer's three assembly functions (`assembleDrawForUser*` in
leaderboard.js) all spread `...m`, so they pass through automatically with zero extra
wiring.

Rendered as a `.mc-score-line` row inside `.mc-footer` (`bracket.js` `placeCard`,
`viewer-bracket.js` `placeViewerCard` via a shared `appendScoreFooter()` closure) —
this **replaced** the old per-user notes input entirely (removed 2026-07-03: the
`.mc-notes` input, `picks.notes` DB column, and all `notes`/`m.notes` read/write sites
in `data.js`/`picks.js`). `espn_state === 'in'` adds a `.mc-live-tag` "LIVE" badge.

## Auto-Confirm (`scores_autoconfirm_enabled`, default OFF)

`auto_confirm_match(p_match_id, p_winner)` — internal-only SQL function (`REVOKE ALL
... FROM PUBLIC`, never exposed as a client RPC; only called from inside
`fetch_espn_scores()`'s own SECURITY DEFINER context). Mirrors `applyWinner`'s DB
writes exactly (`matches.winner`, `winner_confirmed_at`, per-pick
`original_pick_result`/`match_pick_result`) — deliberately does **not** touch
`matches.score` (already owned by the feed) and does not duplicate any scoring logic.
No-ops (returns `false`) if `matches.winner` is already set OR
`matches.auto_confirm_suppressed` is true.

**Undo-vs-reconfirm guard ("manual action wins"):** `matches.auto_confirm_suppressed`
(boolean, default false). `undoWinner` (picks.js) sets it `true` on every undo —
manual or auto-confirmed alike, no provenance tracking needed. Only `applyWinner`
(a manual confirm) clears it back to `false`. Net effect: once a commissioner
undoes a result, that match is permanently exempt from auto-confirm until they
manually confirm it again — the poller will keep writing `score`/`espn_state` but
will never silently re-set `winner`.

`fetch_espn_scores()` calls `auto_confirm_match` only when: `scores_autoconfirm_enabled`
is true (read once per run from `app_settings`), the competition is `completed=true`
AND `status.type.name` is one of `STATUS_FINAL` / `STATUS_RETIRED` / `STATUS_WALKOVER`
(broadened 2026-07-03 — all three give an unambiguous ESPN-reported winner, so there's
no reason to hold retirements/walkovers back from auto-confirm; the score string still
carries the `" Ret."`/`"Walkover"` marker either way, human-visible on the bracket card
regardless of who confirmed it), and a winner name resolved. Verified end-to-end
(including the suppression/no-op guards) via a transaction that was rolled back
afterward — never actually flipped the flag or touched live production picks during
development. **Enabled in production 2026-07-03** after 3 real match results came
through correctly via the manual "ESPN ✓" badge sanity-check.

**Suspension/interruption suffix (added 2026-07-03, unverified against a real live
occurrence):** when `completed=false` and `status.type.name` is anything other than
`STATUS_SCHEDULED`/`STATUS_IN_PROGRESS`, the poller appends a suffix to the live score
the same way `Ret.`/`Walkover` work for completed matches — `STATUS_DELAYED` →
`" Delayed"`, `STATUS_SUSPENDED` → `" Susp."`, `STATUS_RAIN_DELAY` → `" Rain Delay"`,
`STATUS_POSTPONED` → `" Postponed"`. These exact enum names are a best guess — none
has been confirmed live yet (unlike `STATUS_RETIRED`/`STATUS_WALKOVER`, which were
queried directly off real matches). Any other unrecognised non-final status.type.name
is intentionally treated as a no-op — the live score just renders with no suffix,
which is an acceptable fallback per Ben (2026-07-03) — and logs a `RAISE WARNING` with
the full raw `status_type` (via `get_logs` → `postgres`) so the real name can be added
once one is actually observed, mirroring how the abnormal-finish branch already
handles unrecognised completed statuses.

**Fixed 2026-07-03 (previously a known gap):** a server-side auto-confirm didn't fire
the client-side live health-band recompute (`refreshHealthBands`, née `_refreshBands`,
in picks.js only ran from the commissioner's own browser session via
`applyWinner`/`undoWinner`). Two layers now cover this — see
`.claude/rules/health-bands.md`:
1. A client-side bridge (Results-tab/bracket-screen realtime handlers detect a
   newly-appeared `winner` and call the same recompute path) — fast when a
   commissioner tab happens to be open, but not reliable during a live tournament
   when the commissioner workflow is front-loaded pre-tournament.
2. **The actual fix**: `fetch_espn_scores()` calls a Supabase Edge Function
   (`recompute-health-bands`) directly after every successful auto-confirm, with zero
   browser dependency — see health-bands.md's "Serverless Auto-Confirm Path" for the
   full architecture (why an Edge Function over plpgsql, the verbatim-copy approach
   for Deno-incompatible imports, and the Vault-secret + `verify_jwt=true` auth).
