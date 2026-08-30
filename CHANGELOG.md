# CHANGELOG — Slam Bracket Multiplayer

Historical record of build steps, refactors, and fixed bugs. **Not loaded into context each session** — this is an archive, not the source of truth. Current state lives in `CLAUDE.md`. Read this only when you specifically need the history of *why* something changed; git is the fuller record.

---

## 2026-08-30 — Two-draws-at-once fixes: qualifier ack keying + missed live alerts

Both roster-withdrawal and qualifiers-placed player notifications were written
assuming one draw checked once at bracket-screen entry — broke down now that MS and
WS run as two simultaneous active draws with independent realtime channels. Two
bugs, fixed together:

1. `profiles.qualifiers_ack_key` stored a single `draw_id@timestamp` value across
   ALL draws — acking one draw's qualifiers-placed popup silently clobbered the ack
   for the other, so a player checking both draws got stuck re-seeing whichever
   popup's ack lost the race, indefinitely. Replaced with `qualifiers_ack_keys`
   (jsonb, one key per draw id), backfilled from the old column via migration
   `qualifiers_ack_keys_per_draw` before dropping it.
2. `showRosterAlerts`/`showQualifiersPlacedModal` were only ever called from
   `showBracketScreen()` — neither re-ran on flipping the M/W segmented control
   (`switchTab`) nor on a realtime rebuild landing while the bracket screen was
   already open (`_realtimeRebuild`). This is almost certainly what ate a live
   lucky-loser withdrawal notification: the bracket silently repainted with the new
   player, no popup fired. Both functions are now also called from `switchTab()`
   and `_realtimeRebuild()`, reusing their existing ack mechanisms (safe to call
   more often — no duplicate-suppression needed beyond what already existed).
   Deliberately NOT wired into the realtime patch tier (`patchMatchScore`), which
   fires far more often (score ticks) than actual roster/qualifier events — see
   `.claude/rules/qualifiers.md` "Two-draws-at-once alert bugs" for the full
   writeup, including the known accepted gap (no live push for the *other*,
   non-selected draw until the player actually switches to it).

## 2026-08-28 — Slam Index v3: Monte Carlo σ replaces the closed-form estimate

v2's `calcChalkBaselines` computed σ_DY/σ_MY with a closed-form independent-Bernoulli
sum, which drops the positive covariance a real bracket has (a busted round-1 pick
kills every later round it fed) — this understated σ_DY by 30-50% and by a
*different* amount per draw, undermining v2's whole "same index at every slam"
premise. New module `src/slam-index-sim.js` (`simulateChalkSigma`, 40,000 seeded
full-bracket Monte Carlo runs) replaces just the two denominators — realized
`chalkDY`/`chalkMY` are unchanged. Never run inline on a render: a new
commissioner-triggered action (`renderSlamIndexSimSection`/
`handleRecomputeSlamIndexSim` in `commissioner-results.js`, `#comm-sim-wrap` on the
Results tab) computes and persists the result to seven new `draws` columns
(`sigma_dy`, `sigma_my`, `chalk_dy`, `chalk_my`, `sim_seed`, `sim_runs`,
`sim_computed_at`), bumping `slam_index_version` to 3. `chalkBaselinesForVersion()`
in `scoring.js` is the new single dispatch point every v2/v3 call site
(`leaderboard.js`, `leaderboard-slams.js`, `leaderboard-slams-combined.js`,
`stats.js`) now goes through, falling back to the (still fully intact) v2 closed
form wherever no persisted snapshot applies (movement-arrow as-of-round baselines,
or a v3 draw before its first recompute). Also fixed a real, pre-existing bug found
while wiring this: `data.js`'s `reloadActiveDraw()` rebuilds its `drawRow` from
local flags rather than a fresh fetch, and was silently missing
`slam_index_version` — every post-commissioner-action reload was resetting it to
the `?? 1` default. Computed and persisted for both Wimbledon 2026 draws against
real production data (σ_DY: 41.1→61.85 MS, 43.8→56.85 WS); `slam_index_version`
bumped to 3 on all six existing draws, matching v2's unconditional-backfill
precedent. Full derivation, the corrected (previously backwards) covariance-direction
writeup, and the K re-estimation note: `.claude/rules/slam-index.md` "v3".

---

## 2026-08-28 — ELO sync disabled once a draw completes

Guarded the commissioner Odds tab's "Sync ELO" button against overwriting
frozen ratings once a tournament's champion is decided. `matches.elo_p1/elo_p2`
feed `calcChalkBaselines()`'s `chalkDY`/`σ_DY`, which in turn feed every
player's Slam Index for that draw (`.claude/rules/slam-index.md`) — those
ratings become historical data the moment the draw finishes, and ELO drifts as
other tournaments are played afterward, so re-syncing post-completion would
silently rewrite a finished draw's standings. `src/commissioner-odds.js`:
computed `isComplete` from the Final match's `winner`, disabled the button and
showed a short explanatory line in the existing `#elo-status-msg` slot when
true, and added an early-return guard in the click handler itself. No change
to `_matchEloData()`, the ELO data model, or a force-override path — sync
stays fully available for the whole live tournament, including after a
mid-draw Lucky Loser swap, only locking once the Final has a winner.

---

## 2026-08-25 — Records tab simplified: podium + three unadjusted Top 10 tables

Same-day follow-up to the shrinkage fix below. Ben questioned whether the full
standings table was overcomplicating the page now that Slam Index is
cross-slam comparable — the shrinkage machinery answers "who's best over a
whole career," which needs statistics, but the rest of the page (Draw
Yield/Match Yield Top 10s) just answers "what was the best single moment
ever," no statistics needed. Resolution: keep the podium (career, shrinkage-
adjusted, unchanged — none of the K/anchor work below was wasted), drop the
full standings table in favour of a Top 10 Slam Index table using the same
`buildTopTenTable` helper the other two Top 10 tables already use, and delete
the now-redundant "Best Slam Index Ever" click-to-expand card outright (same
data, now permanently visible instead of behind a click). Page reads: podium →
three parallel, unadjusted Top 10 tables — a "pinball high score machine"
below a "career standings" podium. Dead CSS removed alongside
(`.rec-standings-wrap`, `.lb-row-standings` + its mobile overrides,
`.lb-cell-srank`, `.lb-cell-draws`, `.rec-best-ever-card`). Full detail in
`.claude/rules/leaderboard-records-redesign.md` "Podium-plus-top-10
simplification". `leaderboard-records.js`: 370 → 302 lines.

## 2026-08-25 — Shrinkage anchor bug fix, K made recomputable, docs correction

Three fixes to the Records-tab shrinkage standings, following directly from the
2026-08-24 Slam Index v2 work below. Full detail in
`.claude/rules/slam-index.md` ("The anchor bug", "The K recomputation
procedure", "Single-draw noise", "draw_gap_max").

**1. Bug: shrinkage was anchored to a hardcoded 100.** Correct under v1
(z-scoring pins the pool mean to exactly 100), silently wrong under v2 (100
means "matched chalk," which the real pool averages ~88 points below).
Consequence on live data: a newcomer's single 70-point draw shrank to 95.0 and
outranked two veterans — the shrinkage estimator was rewarding not playing,
the exact bias it was built to prevent. Fixed by threading a real `anchor`
parameter through `shrinkSlamIndex` (scoring.js) and computing it fresh each
render via `computePoolMeanIndex(brackets)` (leaderboard-records-data.js, no
new query — reuses `buildAllBrackets`'s existing flat list, v2 entries only).
Deliberately NOT frozen — a per-draw Slam Index is permanent, but this anchor
is expected to drift as more draws land.

**2. K is now a stored, recomputable value instead of a hardcoded constant.**
New `shrinkage_k` singleton table (`k_active`, `k_suggested`,
`sigma_within`, `sigma_between`, `n_players`, `n_draws`, `draw_gap_max`,
`computed_at`, `last_error`; RLS mirrors `health_bands` — authenticated
SELECT, commissioner-only writes). New pure function `computeShrinkageK`
(leaderboard-records-data.js): restricts to v2-only entries from players with
≥2 draws, draw-centres to isolate player consistency from draw-level effects,
then estimates `sigma_within`/`sigma_between`/K via a standard
method-of-moments random-effects approach. K is never auto-applied —
recompute only ever writes `k_suggested`; promoting it to `k_active` needs an
explicit commissioner "Apply" click. Wired to run automatically (fire-and-
forget, own try/catch) from the existing `handleSwitchToGettingReady` between-
slams flow alongside the health-bands recompute, plus a manual "Recompute K"
button and a persisted status card in the commissioner Results tab
(`renderShrinkageKSection`, commissioner-results.js) — mirrors
`renderHealthBandsStatusSection` exactly, same pattern, same tab.

**Verified against real data** (Wimbledon 2026 MS+WS, 9 players who played
both): `computeShrinkageK` produced `sigma_within≈13.1`, `sigma_between≈5.8`,
`K≈5.15`, matching an independent hand-derivation. With only 2 draws on
record, the `n_draws<3` guard correctly trips (`k_suggested` stays null,
Apply disabled) — confirmed as the correct outcome, not loosened. K=5 stays
the active value; it is explicitly *not* validated by this estimate, and every
known bias in the pipeline argues for shrinking harder (higher K), not softer.

**3. `draw_gap_max` normalisation instrument.** Same status card surfaces the
largest mean-index gap between any two draws (flagged above 10) as a read-only
health check on whether the chalk-baseline normalisation is actually making
draws comparable. Currently ~12.7–12.9 between Wimbledon MS and WS — flagged,
not acted on; likely explained by `sigmaDY`'s known chain-correlation
understatement biting harder in a chalkier draw. Display only, changes
nothing.

**4. Copy drafted, not wired.** New Records-tab explainer text ("Index
(Adjusted)" / pulled toward "the pool's typical score" rather than "the pool
baseline (100)") — the old copy was wrong twice under v2 (100 isn't the
baseline, and the baseline isn't 100). Same copy-review discipline as every
other feature here — not live yet.

**5. Docs correction (more important than the rest of this entry).**
`.claude/rules/leaderboard-records-redesign.md` claimed the original K=5
sanity check ran "across all 12 pool-eligible players in the pool's 4
completed draws (French Open 2026 + Wimbledon 2026, MS+WS)." Verified directly
against the database: French Open 2026 MS and WS have picks from exactly one
player and zero locked-odds rows in either draw — neither draw could have
produced a Slam Index at all, then or now. The real evidence base was two
draws and nine players. Corrected in place rather than silently deleted, so
the record shows what actually happened.

Regression harness clean before/after (this is Records-tab aggregation only —
zero Draw Yield/Match Yield/chalk-baseline code path touched).

## 2026-08-24 — Slam Index v2: absolute, cross-slam chalk baseline

Made Slam Index comparable across different slams instead of only within the pool
that entered one specific draw. Full design/rationale in
`.claude/rules/slam-index.md`.

**Problem:** `calcSlamIndex` z-scored a player's Draw Yield/Match Yield against
whoever else entered that draw, which pins the pool mean to exactly 100 every time —
a 115 at one slam and a 115 at another measure "distance above a different, unstated
population," not the same thing.

**Fix — same formula shape, new reference point.** Still
`100 + 15 × avg(edgeDY, edgeMY)`. Each edge is now measured against a fixed,
player-independent **chalk baseline** computed once per draw
(`calcChalkBaselines(d)`, scoring.js): an ELO-favourite bracket for Draw Yield (own
theoretical standard deviation via each chalk matchup's Elo win probability,
`p×(1-p)` as a coin-flippiness weight) and a flat-10-stake odds-favourite bettor for
Match Yield (standard deviation via the closed-form variance of a fair-odds bet,
`10×sqrt(Σ(favOdds-1))`). No tuning constant anywhere — three fitted-constant
alternatives were tried and rejected (see the rules file) before landing on this
derive-it-from-first-principles approach. Verified `calcChalkBaselines` against
independently-computed SQL reference values for both Wimbledon 2026 draws — exact
match on all four numbers (chalkDY, chalkMY, sigmaDY, sigmaMY).

**Versioning:** new `draws.slam_index_version` column (int, default 2), separate
from `scoring_version` — backfilled to 2 on every existing draw, same
retroactive-by-default posture as the 2026-07-17→18 scoring redesign reversal. v1's
pool-relative code path is kept fully intact as a one-row rollback lever.
`calcSlamIndex(entries, {version, chalk})` branches; every v2 call site checks
`chalk.valid` first and falls back to v1 when a draw lacks enough ELO/odds data to
trust the baseline (currently French Open 2026 MS/WS, pre-dating the betting layer's
odds — both stay on the v1 fallback, unaffected by this change).

**Downstream:** `leaderboard.js` (`loadDrawStatsForAllUsers`), `leaderboard-slams.js`
(`_loadBaseline`, the movement-arrow baseline — needed a `filterRi` param added to
`calcChalkBaselines` so the chalk reference stays "as of round R-1" in sync with the
entries it ranks), `leaderboard-slams-combined.js` (new `combineChalkBaselines`
helper — sums chalk totals, adds variances since the two draws are independent) all
updated to pass the draw's chalk baseline through. `stats.js`'s `fetchPoolSlamIndex`
was the headline win: v2 needs no other players' data at all, so it now computes the
stats-bar hero stat **synchronously and locally** off the already-loaded draw instead
of firing a cross-user picks fetch — falls through to the old fetch only on the v1
fallback path.

**Verification against real data (Wimbledon 2026, both draws):** recomputed the
shrinkage-standings K=3/5/8 comparison end-to-end against real profiles/picks/odds/
ELO pulled via the Supabase MCP connector and run through the actual `scoring.js`/
`leaderboard.js` functions in Node (test-harness's existing supabase stub). Vibes
Architect's WS-only v2 index came out 121 — an exact match to the pre-implementation
hand-estimate. Carson Bodnarek's MS v2 index came out 99, essentially tied with
Tacoma Elk/Sam Rosenberg at 98 — the three-way near-tie the redesign predicted
(Bodnarek no longer runs away with #1 purely on Match Yield), though not an exact
match to the ~96.5/rises-to-#1 pre-implementation estimate, which was itself a rough
hand-reconstruction. Effective Draw Yield / Match Yield influence on the blended
index measured close to 50/50 across both draws, matching the documented decision
with no fitting required to get there. French Open 2026 (no odds data) correctly
fell back to v1 and was unaffected. `test-harness/` golden diff clean — this is a
Slam Index-only change, zero Draw Yield/Match Yield code path touched.

Copy describing Slam Index as "vs the pool" / "100 = pool average" (the stats-bar
drawer in `stats.js`, the Records-tab shrinkage hint in `leaderboard-records.js`) is
now inaccurate for v2 draws and was flagged but deliberately **not rewritten** —
new copy needs Ben's sign-off first, same discipline as the tutorial and Records
redesign's copy-review requirement.

## 2026-07-18 — Onboarding tutorial shipped, then redesigned same week

Built the new-player coach-mark tutorial (design from 2026-07-06 — see
`.claude/rules/tutorial.md`): a throwaway sandbox draw sliced from a real completed
slam, walked through by `src/tutorial.js`/`tutorial-sandbox.js`/`tutorial-overlay.js`,
manual entry only via an account-menu "Tutorial" item. Auto-show on first login
deferred pending a column-name decision.

First shipped version (12 steps) tried to demonstrate every mechanic live against the
sandbox — reveal Round 1 with a held-back sibling match to freeze an intermediate
"elim, no winner yet" state, spotlight/dim the target card, etc. A round of screenshot
-driven testing found real bugs this way (a stale function-rename left the lock never
actually firing; the "No Pick" card-finder was stricter than the real trigger
condition and missed visibly-glowing cards; a gate for the practice step missed picks
made during earlier "watch" steps; a seeded demo score never got cleared). Cut to 10
steps after a UX pass (merged two steps that split an abstract concept from its
concrete example; cut a step that was pure FYI with nothing to act on).

A second pass, driven by Ben actually using it, found the demo was targeting the wrong
round entirely: in a 3-round bracket, the SF's own feeder IS the R1 match that just
decided a bust, so there's no round where "still shows the busted pick, crossed out,
no winner yet" can appear at the SF level — that state only exists one round further
out, at the Final. Also found: Match Yield never scored (no odds existed in the
sandbox), the arrow on the free-play step pointed at the geometric center of the whole
stats bar (meaningless — the copy references two things on opposite ends of it), Back
didn't actually reverse a fired lock, and the tutorial had scope-crept toward a
stats/scoring tour despite the original brief explicitly excluding that. Retargeting
the demo to the Final (by writing the busted pick onto the SF match's own fields,
mirroring what a thorough player clicking all the way through would do) fixed the
mechanics; a real per-step state-snapshot/restore mechanism fixed Back; the
stats/scoring references were cut back out.

A third pass then rejected the whole "force the live sandbox to demonstrate a specific
mechanic on cue" approach as fundamentally fighting the sandbox instead of working
with it, and split the tutorial into two clean phases instead: mechanics (make
original picks, watch the lock fire, then **static example cards** — placeholder
names, real CSS classes, zero live-draw dependency — showing what card states look
like) followed by gameplay (the real small draw actually plays out round by round,
completely un-forced). This deleted most of the demo-pairing/Final-injection
complexity outright. Also fixed in this pass: fake odds were showing on Round 2/Final
matches that don't exist yet in a real draw — now seeded for Round 1 only. Landed at
9 steps. Full detail of the final shipped architecture is in
`.claude/rules/tutorial.md`'s "Implementation" section — this entry is the narrative
of how it got there, not the current state.

---

## 2026-06-25 — Getting-ready overlay + invite page fixes

**Getting-ready overlay (revised from original approach):** Between-slams state now renders the last finished bracket dimmed behind a fixed-position frosted overlay rather than replacing the bracket with a blank page. `#bracket-body` was wrapped in a new `#bracket-area` div (`flex:1; position:relative`). The `.getting-ready-overlay` uses `position:fixed; inset:0; z-index:100` with `backdrop-filter:blur(2px)` and a `::before` tint at 70% bg opacity — covers full viewport including header and stats row. Clicking/tapping anywhere on the overlay dismisses it so users can browse the last draw. Logo uses `border-radius:50%` to show just the green tennis ball circle from the app icon (clips the cream square corners). Chrome (M/W seg, search, print, mobile bar) is no longer hidden — all stays interactive; leaderboard nav fully accessible behind/above the overlay.

**Original getting-ready screen (2026-06-25):** New `app_settings` Supabase table (singleton row id=1) stores `next_slam_label` and `next_slam_starts_at`. `hasActiveDraw()` added to `state.js`. Commissioner → Draw Management → Getting Ready Mode section: "Save next slam info" (upserts settings only) and "Switch to getting-ready mode" (upserts + deactivates all draws).

**Invite page:** `public/invite.html` added — standalone shareable page at `/invite` (Netlify `_redirects` rewrite). "Sign Up Now" button links to `/?signup`; `init()` in `main.js` detects the `?signup` param and opens the auth screen in signup mode via `setAuthMode('signup')`.

---

## 2026-06-11 — Slam Index composite metric

Added a pool-adjusted composite score that merges Draw Yield and Match Yield into a single normalised value.

**Formula:** `SlamIndex = round(100 + 15 × avg(z_DrawYield, z_MatchYield))`. Population z-scores within the draw's pool of players with ≥1 pick. Guard: pool < 2 or stddev = 0 → z = 0 → index = 100.

**`scoring.js`:** new pure export `calcSlamIndex(entries)` — takes `[{score, matchYield}]`, returns integer index array in same order.

**`leaderboard.js`:**
- `loadDrawStatsForAllUsers`: computes `slamIndex` per player after pool is assembled; stores in statsMap
- `buildAllTimeAgg`: aggregates as `avgSlamIndex` (plain avg of per-draw values — never re-pooled)
- `buildAllBrackets`: includes `slamIndex` per bracket entry
- Slams card: Health column replaced by Index column
- Detail view: Index added as 9th stat column (after Health)
- Records tab: now **four cards** per period — Avg Score | Match Yield | Slam Index | Top Draws
- New `buildSlamIndexCard`: mirrors Avg Score card, ranked by `avgSlamIndex`, subtitle "DRAW + MATCH · POOL-ADJUSTED"
- Top Draws card: Index column added; grid updated to `18px 1fr 68px 68px 68px`

**`stats.js`:** imports `loadDrawStatsForAllUsers` from leaderboard.js; adds `fetchPoolSlamIndex(draw, userId)` (fire-and-forget, re-renders stats bar on completion); post-lock Draw Yield + Match Yield pills replaced by single `sc-composite` cell with stacked rows + bracket-elbow SVG + tinted Index block.

**`main.js`:** `fetchPoolSlamIndex` called fire-and-forget in `showBracketScreen()`, `switchTab()`, and bracket refresh callback.

**`index.html` CSS:** composite cell classes (`.sc-composite` et al.); `.lb-row-detail` gains 9th column; `.lb-records-cards` updated to `repeat(4,1fr)`; `.lb-rec-td-row` gains 3rd stat col; mobile detail table min-width updated to 714px.

---

## 2026-06-09 — Match Yield betting layer

Added an odds-based Match Yield scoring system layered on top of the existing draw-prediction game.

**DB (via Supabase MCP migrations):**
- Enabled `http` (synchronous HTTP from PL/pgSQL) and `unaccent` extensions
- New `odds_raw` table — raw API event rows (home/away names, consensus decimals, bookmaker count)
- New `name_mappings` table — persists API name → draw player name across slams; RLS commissioner-write
- New columns on `matches`: `odds_p1_live`, `odds_p2_live`, `odds_fetched_at`, `odds_p1_locked`, `odds_p2_locked`, `odds_locked_at`
- New `fetch_all_active_odds()` PL/pgSQL function (SECURITY DEFINER): reads ODDS_API_KEY from Vault, calls The Odds API h2h for each active draw, upserts `odds_raw`, pushes matched consensus to match rows via `name_mappings` join
- New `refresh_odds_now()` RPC: commissioner-only on-demand refresh
- New `normalise_player_name(text)` SQL helper (mirrors JS `normaliseName()`)
- New pg_cron job `fetch-odds`: `0 */3 * * *`
- Extended `fire_scheduled_locks()`: when a `backup_picks` lock fires, snapshots `odds_p*_live → odds_p*_locked` for affected matches
- ODDS_API_KEY stored in Supabase Vault

**JS:**
- New `src/odds.js`: `STAKE_BY_ROUND`, `normaliseName`, `decimalToAmerican`, `formatAmerican`, `formatYield`, `pickedLockedOdds`, data access functions
- `scoring.js`: added `STAKE_BY_ROUND` export, `matchYield`/`matchYieldResolved` to `calcStatsAsOf`
- `data.js`: odds columns added to match SELECT query and `emptyMatch()` defaults
- `stats.js`: reordered pills (Draw Yield → Match Yield → Draw Accuracy → Match Accuracy → Draw Health); "Score" renamed "Draw Yield"; chalk line removed from UI (code kept)
- `leaderboard.js`: slam card gains Match Yield column; detail view column order matches stats bar + adds Match Yield; records tab Match Accuracy card replaced by sortable Match Yield card (Avg/Draw vs Best Ever toggle); `formatStat` handles `matchYield`/`avgMatchYield`
- `bracket.js`: odds/yield footer on match cards (American odds pre-result, earned yield post-result)
- New `src/commissioner-odds.js`: Odds tab with fetch status, force-refresh button, unmatched name triage UI, saved mappings list
- `commissioner.js`: wired Odds tab
- `index.html`: Odds tab button + pane; `.mc-odds` CSS; `.lb-cell-matchYield` CSS
- Fixed stale "Edge Function" comments in `commissioner-locks.js` / `commissioner-locks-backup.js` → pg_cron/PL/pgSQL
- Test harness golden: zero diff confirmed

---

## Refactor (2026-06-01 → 2026-06-02)

### Step 1 — repo hygiene (2026-06-01)
- `.gitignore` set to cover `node_modules/`, `dist/`, `.env.local`, `*.timestamp-*.mjs`, `_archive/`, `.DS_Store`.
- `node_modules/`, `dist/`, and `.env.local` removed from git tracking (working copies on disk untouched).
- Supabase key: `.env.local` had been committed earlier, exposing the legacy `anon` key in git history. Legacy anon keys can no longer be rotated (Supabase deprecated them). Resolved by migrating to a new-style **publishable** key (`sb_publishable_…`) stored in `.env.local`'s `VITE_SUPABASE_ANON_KEY` (var name kept so `supabase.js` is unchanged).
- One-off SQL data dumps (RG 2026 seed/restore files, `add_is_active.sql`) moved to `_archive/`.
- Build-session scratch notes (chat*-prompt.md, context.md, project-instructions.md) deleted.

### Step 2 — complexity-wall parts C & E (2026-06-01)
- **C:** extracted shared bracket geometry into `bracket-layout.js`; removed three verbatim copies from `bracket.js`, `viewer-bracket.js`, `commissioner-results.js`. Verified via `vite build`.
- **E:** split the ~1000-line `commissioner.js` into `commissioner.js` (orchestrator + Draw Management) + `commissioner-results.js` + `commissioner-locks.js` + `commissioner-shared.js`. No behavior change.

### Step 3 — data-model rewrite, parts A, B & D (2026-06-01)
Behavior verified against a Node render-facts golden (`test-harness/`).

- **A — explicit derived model.** New `src/draw-view.js` / `buildDrawView(d)` is the SINGLE pure derivation of all non-authoritative bracket state. `data.js` no longer reconstructs `p1`/`p2` inline or replays elimination at load; it loads raw rows and calls `buildDrawView`. Idempotent (rebuilds round-2+ slots from scratch each call).
- **B — collapsed the forward-walkers.** Six overlapping walkers removed. All slot/elim/label derivation now lives in `buildDrawView`. `picks.js` keeps only two raw-field writers — `cascadeMatchPickForward` / `clearMatchPickForward` (Option 1, no DB change) — plus `withdrawalClearForward` / `updatePlayerNameForward` (authoritative fields only). Deleted: `markLoserForward`, `unmarkLoserForward`, `placePickAllRounds`, `clearPickForward`, `placePickInNextRound`.
- **D — deleted the displaced-label hack.** `bracket.js` no longer does Case-1/Case-2 feeder lookups. `buildDrawView` computes `m.elimLabels = [{name,pos}]`; `placeCard` just paints them.
- **Behavior note (approved by Ben):** the pure rebuild removed a latent "stale-until-reload" bug — three render spots now show the correct, reload-consistent state live. New live output == old post-refresh output. Everything else byte-identical.
- **No DB migration.** Schema and stored data unchanged.

### Leaderboard dedup (2026-06-02)
`assembleDrawForUser` and `assembleDrawForUserOriginalPicks` in `leaderboard.js` previously hand-rolled their own slot/elim derivation. Both now call `buildDrawView` after stamping pick fields. `assembleDrawForUserOriginalPicks` retains Pass 1 for viewer-specific `actualP1`/`actualP2` fields; its manual Pass 2 slot reconstruction loop was deleted. Verified via harness + `vite build`.

### Harness repair + golden refresh (2026-06-02)
The DOM stub (`dom-stub.mjs`) gained `removeEventListener` and a minimal stub for the pick-confirm modal IDs (`pick-confirm-modal`/`pcm-name`/`pcm-confirm`/`pcm-cancel`); `#pcm-confirm` auto-fires its click so `showPickConfirm()` resolves true. All other IDs still return null. The harness had been throwing before any output (the stub predated the pick-confirm modal). `GOLDEN.frozen.txt` re-frozen against current code (Ben confirmed the post-golden backup-pick-cascade behavior is intentional) and verified deterministic.

---

## 2026-06-11 — Mobile layout phase 2 (bracket list + leaderboard)

### Mobile bracket list (`src/bracket-list.js`)
New module: renders one round's matches as a vertical scrollable list using the same `placeCard` callback as the desktop renderer (identical card painting). Key features:
- **Pair connectors:** consecutive match pairs wrapped in `.mc-pair`; a `.mc-pair-connector` arm is positioned via `requestAnimationFrame` using `getBoundingClientRect` midpoints after layout
- **Section dividers:** mirrors desktop Q1/Q2/Q3/Q4 separators — Bottom Half divider for rounds ≥16, Q2/Q4 dashed dividers added for rounds ≥32 (`_buildSectionDividers(total)`)
- Uniform 42px inter-card gaps (intra-pair and inter-pair match)

### Mobile leaderboard
- **Tab bar to bottom:** `.lb-tabbar` reordered below `.lb-content` via CSS `order:2` on `.lb-root{display:flex;flex-direction:column}` — no JS changes to `leaderboard.js`
- **Draw/Leaderboard nav row:** `.lb-hdr-nav` hidden on mobile; new `#lb-mobile-hdr-row2` bar mirrors the bracket/commissioner mobile nav pattern
- **"All stats" detail table horizontally scrollable:** fixed a CSS cascade bug where `.lb-detail-table-wrap{overflow:hidden}` (line ~545) silently overrode the mobile `overflow-x:auto` rule (line ~220) because base rules at higher line numbers win over earlier media-query rules with equal specificity. Fix: mobile scroll override added in a late block just before `@media print`
- **Sticky player column backgrounds:** each row type needs its own background — header row: `var(--surface2)`, alt row: `var(--surface2)`, self row: `var(--accent-dim)`, normal row: `var(--surface)`. See `.claude/rules/leaderboard-detail.md` for the full mapping.
- **Mobile search fix:** added `transform:none!important` to `.mobile-search-row .search-results` to override the base `transform:translateX(-50%)` that caused results to render off-screen left

---

## Chat log

### Chat 1 — foundation
- `src/supabase.js`, `src/state.js`, `src/auth.js`
- `src/data.js` — `loadAllDraws()`, `loadDraw()`, `loadLockSchedules()`, `reloadActiveDraw()`
- `src/scoring.js` — full scoring logic ported
- `src/picks.js` — pick cascade + `savePickToSupabase()` + `applyWinner()`/`undoWinner()`
- `src/lock.js` — `isMatchLocked()` read-only helper
- `src/stats.js` — `renderStats()` ported
- `src/bracket.js` — `renderBracket()`, `placeCard()`, edit player modal
- `src/print.js` — `buildPrintHTML()` ported verbatim
- `src/parser.js` — `extractPdfText()`, `parseTnnsText()`, `buildInitialRounds()` ported
- `src/main.js` — full orchestration: auth, slam nav, search, print, logout
- `index.html` — full CSS design system + all 5 screen divs
- `vite.config.js`, `package.json`, `public/manifest.json`, `.env.local` (placeholder)

### Chat 2 — commissioner screen
- `src/commissioner.js` — `initCommissioner()`, `renderLockManaging()`; Draw Management tab (drop zone, PDF parse → editable R1 table, confirm draw = upsert draws row + 127 matches); Lock Managing tab (original picks lock with snapshot, backup pick locks via lock-bracket card selector, contiguous-range insert into lock_schedules, unlock via locked_at = null)
- `src/picks.js` — `applyWinner()` / `undoWinner()` write to DB
- `src/main.js` — wired `initCommissioner()`; `hdr-user-comm` in header; `draw-uploaded` event refreshes header
- `index.html` — commissioner two-tab layout; CSS for `.comm-*`, `.drop-zone`, `.lock-*`, `.match-edit-row`

### Chat 3 — leaderboard
- `src/leaderboard.js` — `loadAllProfiles()`, `loadDrawStatsForAllUsers()`, `loadViewerPicks()`, `renderLeaderboard()`; per-slam view (MS+WS, sortable), all-time view, viewer mode, statsCache invalidated each render
- `src/main.js` — wired `renderLeaderboard()`; viewer back button
- `index.html` — `.lb-*` CSS

### Chat 4 — polish
- `src/stats.js` — lock countdown pill; pulses accent when affected picks unfilled
- `src/bracket.js` — `needs-backup-pick` class; informative empty state
- `src/main.js` — `setInterval` refreshes `renderStats()` every 60s on bracket screen
- `index.html` — Refresh button; CSS for `.needs-backup-pick`, `.countdown-urgent`, `.bracket-empty`; mobile fixes

### Chat 5 — leaderboard redesign + brand colors
- `index.html` — real slam accent colors (AO `#2d7ab8`, RG `#BD5627`, WIM `#275F3D`, USO `#071C63`); USO distinct bg/border; leaderboard title uses `var(--text)`
- `src/leaderboard.js` — two-tab structure (Slams / Records); draw detail view; original-picks viewer entry; `lbDetailDraw` nav state; `assembleDrawForUserOriginalPicks()` reconstructs p1/p2 for ri 1+, saves `actualP1`/`actualP2`
- `src/bracket.js` — original-picks viewer mode styling (now removed in Chat 6)
- `index.html` — `.viewer-hdr`; CSS for `.mc-actual-*`, `.mc-viewer`, `.viewer-hdr-*`

### Chat 6 — viewer split into its own renderer
- `src/viewer-bracket.js` — new file; `renderViewerBracket(draw)` + `placeViewerCard()`, fully independent read-only renderer
- `src/bracket.js` — stripped of all viewer logic; live-bracket only
- `src/leaderboard.js` — `openViewerOriginalPicks()` assembles viewer draw without touching `state.draws`
- `src/main.js` — viewer back button simplified
- `index.html` — `screen-viewer` fleshed out with own header/labels/body; dead viewer elements removed from `screen-bracket`

### Chat 7 — commissioner lock bug fixes
- `src/commissioner.js` — `getOrigPicksSchedule()`, `isMatchBackupLocked()`, `getMatchScheduledLock()` now filter by `ls.draw_id === d.db_id` (fixes MS/WS lock bleed)
- `handleBackupLock()` deletes overlapping lock_schedules rows before inserting (fixes schedule-vs-lock-now conflict)
- `renderLockBracket()` checks feeder match winner before showing names (slots without winner show `—`); inserts horizontal divider between top/bottom halves

### Chat 8 — notes field, remove player result UI
- `src/bracket.js` — removed ✓/✗ result buttons + score input from `placeCard()`; added per-user notes input (`.mc-notes`) on locked matches with a pick; removed `openWinnerPicker()` and `applyWinner`/`undoWinner` imports
- `src/picks.js` — `savePickToSupabase()` includes `notes`; removed non-commissioner path from `applyWinner`/`undoWinner`
- `src/data.js` — picks SELECT + assembly + `emptyMatch()` include `notes`
- `src/main.js` — api-sync toggle replaced with real Refresh button
- `src/state.js` — removed `apiSyncEnabled`
- `index.html` — sync→Refresh; removed sync CSS; simplified `.mc-footer` + `.mc-notes`
- `migrations.sql` — added `notes text` to picks

### Chat 9 — pick/result field rename
- `migrations.sql` — rename `pick`→`match_pick`, `result`→`original_pick_result`, add `match_pick_result`
- `src/data.js`, `src/picks.js`, `src/scoring.js`, `src/bracket.js`, `src/stats.js`, `src/leaderboard.js`, `src/viewer-bracket.js`, `src/print.js`, `src/commissioner.js` — all updated to new field names; `applyWinner()` sets `originalPickResult` and `matchPickResult` independently per pick row; `undoWinner()` clears both

### Chat 10 — post-lock backup-pick cascade
- `src/picks.js` — `placePickAllRounds()` split into pre-lock (slot cascade) and post-lock (matchPick-only cascade); post-lock cascades `matchPick` forward without touching `p1`/`p2`, through elim'd slots; `clearPickForward()` post-lock clears only `matchPick`; `handlePickClick()` locked path cascades + `saveCascadeToSupabase()`; `markLoserForward()` clears `matchPick` for backup cascade
- `src/bracket.js` — elim slots render backup matchPick (purple) or empty; eliminated player as floating label; correct backup gets `✓` (`pr-backup-ok-icon`); floating labels for case 1 + case 2; `findSeed` imported from picks.js
- `src/commissioner.js` — undo handler calls `reloadActiveDraw()` after `undoWinner`
- `index.html` — CSS for `.mc-orig-elim*`, `.pr-backup-ok-icon`
- *(Note: parts of Chat 10's slot/label behavior were later superseded by Refactor Step 3's `buildDrawView` and the Chat 12 elim fix. See current CLAUDE.md for live behavior.)*

### Chat 11 — lock countdown draw-scope fix + scheduled-locks list (2026-06-02)
- `src/stats.js` — backup-pick lock countdown `upcoming` filter was missing `ls.draw_id === d.db_id`, letting a lock on one M/W draw drive the other draw's countdown. Added the draw filter (one line).
- `src/commissioner-locks.js` — new "Scheduled Locks" list in Lock Managing → Backup Pick Locks: lists pending (not-yet-fired) backup locks for the active draw, soonest first, with Cancel (deletes row) and Reschedule (reuses `lock-sched-modal`). Helpers: `pendingBackupLocks`, `lockRangeLabel`, `renderScheduledLocksList`, `handleCancelScheduledLock`, `openRescheduleModal`, `updateScheduledLock`, `toLocalInputValue`. Wired via event delegation on `#lock-sched-list`.
- **File-size split:** `commissioner-locks.js` (~700 lines) split into `commissioner-locks.js` (~100, orchestrator + shared msg/modal helpers), `commissioner-locks-orig.js` (~190, original-picks lock), `commissioner-locks-backup.js` (~445, backup-pick locks + scheduled-locks list). Imports form an intentional runtime cycle, safe because nothing runs at module-load time. Verified via `vite build`.

### Chat 12 — eliminated pick not crossed out in later rounds (FIX, 2026-06-02)
- **Bug:** an eliminated original pick showed un-crossed in rounds *beyond* a match that already had a confirmed winner. Cause: the old `markLoserForward` walked the loser forward one path at a time and broke at the first downstream match holding a `winner` (`if (nm.winner) break`). The loser's `originalPick` re-emerges via slot reconstruction in still-undecided matches past that winner, and those slots were never flagged `elim`.
- **Fix:** deleted `markLoserForward`. Elimination is now derived from one global fact — **a player is eliminated if they lost any confirmed match.** `buildDrawView` builds one `eliminated` Set from the losers of every decided match, then flags `elim` on every still-undecided slot whose occupant is in the set (and nulls any dead backup `matchPick`). No early break, no single-path walk. Step order in the function: (1) slots, (2) eliminated set, (3) flag/clear, (4) displaced labels.
- No DB/schema change. `vite build` clean; `test-harness` byte-identical to golden.
