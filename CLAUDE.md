# CLAUDE.md — Slam Bracket Multiplayer

Source of truth: describes **how the code works now**. Read before touching any code. History lives in `CHANGELOG.md` (not loaded each session).

## [AUTOMATIC MAINTENANCE]

New area-specific detail is appended directly to a targeted `.claude/rules/<area>.md` with a one-line pointer here — no rewrite of this file. Changing behavior already documented here requires confirmation first.

**After every session where a bug was fixed, a schema fact was discovered, or a gotcha was identified: update the relevant `.claude/rules/<area>.md` file immediately — do not wait to be asked.** If no rules file fits, create a new one under `.claude/rules/`. This is mandatory, not optional.

---

## Automatic Maintenance Rule

When a chat introduces detailed, area-specific conventions (rendering rules, lock behavior, leaderboard internals, UI layout, etc.), offload them directly into `.claude/rules/<area>.md` and add a one-line reference here — do NOT accumulate them in §12. Append dated narrative to `CHANGELOG.md`; update this file only when *current behavior* changes.

Current rules files:
- `.claude/rules/ui-detail.md` — full header/segment layout details
- `.claude/rules/bracket-rendering.md` — elim slot rendering, viewer card painting, `buildDrawView` projectFromPick mode
- `.claude/rules/lock-conventions.md` — lock scoping function names, countdown details, scheduled locks list
- `.claude/rules/leaderboard-detail.md` — SLAM_COLORS, grid values, tab internals, viewer entry point, pool eligibility minimum-participation gate
- `.claude/rules/supabase-mcp.md` — Supabase MCP connector: project ID, table schemas, how to run migrations/SQL without manual dashboard work
- `.claude/rules/betting.md` — Match Yield betting layer: scoring formula, odds lifecycle, sport keys, name matching, DB objects, first-slam troubleshooting
- `.claude/rules/between-slams.md` — app_settings table, hasActiveDraw(), getting-ready screen, commissioner form
- `.claude/rules/print.md` — print layout conventions: card geometry, elbow connector approach, champion box placement, column widths
- `.claude/rules/flags.md` — player country flags: parser capture, IOC→ISO2 table location, per-draw name→country map, always-rendered .pr-flag gutter, renderers touched
- `.claude/rules/data-fetching.md` — PostgREST 1,000-row cap: fetchAllRows paginator, snapshot_original_picks + pick_completion RPCs, canonical cross-user query sites
- `.claude/rules/roster-changes.md` — replaced_name column, always-stamp-on-swap, unified rosterAlerts detection (pre/post-lock), alert modal
- `.claude/rules/health-bands.md` — stage-calibrated health hue: winner_confirmed_at + health_bands/health_band_samples tables, calcHealthAtMatchSet, healthHue(pct,n,bands), src/health-bands.js compute/store/live-update functions, commissioner Health Bands + Getting Ready wiring
- `.claude/rules/scores-feed.md` — ESPN live score feed: fetch_espn_scores() SQL poller, real JSON shape, name matching + unmatched-names triage, abnormal finishes, heartbeat alerting, auto-confirm (scores_autoconfirm_enabled) + undo-suppression guard
- `.claude/rules/realtime.md` — live updates: Supabase postgres_changes over Broadcast, patch-vs-rebuild tiers, stage 1 (bracket screen) + stage 3 (commissioner Results tab) built, kill-switch behavior, realtime.js/bracket.js/main.js/commissioner.js wiring
- `.claude/rules/tutorial.md` — new-player onboarding tutorial design: scope (mechanics only, not scoring), entry point, sandbox data source, reuse-the-real-renderer approach, lock-teaching approach, mobile note
- `.claude/rules/scoring-redesign.md` — post-Wimbledon-2026 scoring redesign, IMPLEMENTED 2026-07-17, made RETROACTIVE 2026-07-18: `draws.scoring_version` column, every existing draw now `= 2` (v1 kept fully working as a rollback lever only) — strict-doubling Draw Yield, no upset bonus, flat 10-point Match Yield stake, fixed stale-pick auto-favourite fallback; `SCORING_CONFIGS`/`getScoringConfig()` in `scoring.js`; `health_bands`/`health_band_samples` wiped and rebuilt uniformly under v2 across all draws (no more v1/v2 split to reconcile)
- `.claude/rules/leaderboard-records-redesign.md` — Records tab redesign (design finalized 2026-07-18, not yet implemented): shrinkage-adjusted Slam Index standings replace the old averaged podium, Draw Yield/Match Yield personal-best tables with a raw/vs.-chalk toggle, Slams-tab-only click-to-reveal Combined M/W card
- `.claude/rules/slam-index.md` — Slam Index v2 (2026-08-24), v3 (2026-08-28, superseded), and v4 (2026-08-30, current): `draws.slam_index_version`, `calcChalkBaselines()` (ELO-favourite Draw Yield baseline + flat-stake odds-favourite Match Yield baseline), why no tuning constant, v1 pool-relative fallback (2026-08-30: `slam_index_version` alone now decides displayed copy — French Open 2026 is explicitly `=1`, not inferred from `chalk.valid`; a v2/v4 draw with no valid chalk yet shows "—", never a silent v1 number), all call sites — v4 recomputes chalk's realized score and σ_MY live on every call (`calcSigmaMYLive()`, exact closed form, no simulation), and keeps only σ_DY's Monte Carlo evidence persisted, as a full per-draw outcome matrix (`draws.dy_sim_matrix`, `src/slam-index-sim.js`) masked to the currently-decided set on every winner confirm/undo (`updateSlamIndexSigmaDY()` in `commissioner-results.js`, triggered from `picks.js`) rather than re-simulated; Records-tab career aggregates now only include completed draws (`isDrawComplete()` in `scoring.js`)
- `.claude/rules/qualifiers.md` — QUALIFIER/BYE parser handling (2026-08-27): `Qualifier <position>` placeholder naming (`src/player-names.js` `isPlaceholderName`/`displayName`, identity vs. display split), the two parser bugs found live (dropped QUALIFIER entries, flat-array match-shift corruption), `validateParsedDraw` 64/128 gate, re-upload/diff flow (`commissioner-qualifiers.js`) with its two buckets + three safety gates, `place_qualifiers` RPC, pre-lock-only assumption; **updated 2026-08-30** — per-draw `profiles.qualifiers_ack_keys` (fixes the single-column ack being clobbered across concurrent MS/WS draws) and `showRosterAlerts`/`showQualifiersPlacedModal` now also re-checked on M/W tab switch + realtime rebuild, not just bracket-screen entry

---

## 0. Repo Hygiene

- `.gitignore` covers `node_modules/`, `dist/`, `.env.local`, `*.timestamp-*.mjs`, `_archive/`, `.DS_Store` — never committed.
- **Do NOT read** `reference/index.html`, `_archive/`, `dist/`, `node_modules/`, or any `*.sql` data dump unless explicitly told to.
- `.env.local` holds a publishable key (`sb_publishable_…`) in `VITE_SUPABASE_ANON_KEY`. Publishable keys ship to browsers by design — **RLS is the security boundary, not key secrecy.**
- **REMAINING BEN ACTION:** disable the legacy `anon` key in Supabase dashboard (kills the one in git history). Optional: migrate JWT secret for asymmetric signing.
- **RLS confirmed (2026-06-07):** all five tables (`profiles`, `draws`, `matches`, `picks`, `lock_schedules`) have RLS enabled.
- **Supabase MCP connected** — use it for schema changes and SQL queries instead of the dashboard. See `.claude/rules/supabase-mcp.md`.
- **Regression harness:** `test-harness/` drives real `picks.js` + `data.js` + `bracket.js placeCard` in Node. Run before/after any bracket-state change: `cd test-harness && node --import ./register.mjs ./harness.mjs`, diff against `GOLDEN.frozen.txt`.

---

## 1. App Overview

Shared pick pool for Grand Slam tennis. ~20 players (friends and family), one pool, no public signup. Commissioner uploads TNNS Live draw PDFs, edits player names, manages lock windows. Players make picks before locks and backup picks when their originals are eliminated. Leaderboard shows scores and stats across draws.

Reference implementation: `reference/index.html`. Port logic, CSS tokens, scoring, and bracket renderer from there rather than rewriting.

---

## 2. Tech Stack

- **Vite** — build tool. Vanilla JS, ES modules. No framework, no client-side router.
- **Supabase JS client (`@supabase/supabase-js`)** — auth (email/password) + Postgres.
- **Google Fonts** — Playfair Display (ital,wght 400/600), DM Mono (400/500), DM Sans (300/400/500/600).
- **No other runtime deps.** No React, no Vue, no component library.
- **PWA:** `manifest.json` + icons. **Print:** A3 portrait — `buildPrintHTML()` generates a standalone document.

---

## 3. Screen Map

| ID | Who | Purpose |
|---|---|---|
| `screen-auth` | Everyone (logged out) | Login + signup |
| `screen-bracket` | Players | Active draw view, pick-making |
| `screen-commissioner` | Commissioner | Draw upload, player editing, lock managing, result confirmation |
| `screen-leaderboard` | Players | Stats comparison across all players |
| `screen-viewer` | Players | Read-only original-picks viewer; separate from screen-bracket |

**Navigation:** after login → everyone lands on `screen-bracket`. Commissioner role is a *capability layered on top of a normal player account*. `routeAfterAuth()` reveals `.commish-nav` entries when `state.currentUser.is_commissioner`. Entering: `enterCommissioner()` → `initCommissioner()` (idempotent) + `showScreen('screen-commissioner')`. `#exit-commish-btn` returns to `showBracketScreen()`. **Cmd/Ctrl+E** toggles (gated on `is_commissioner`), wired as global keydown in main.js.

No slam dropdown — one live slam at a time, static text in header. Past slams via leaderboard → Your Draws tab only.

**Header grammar:** page-level tabs (`.hdr-nav-link`, DM Sans 14px, accent underline) for screen switching; in-page view-switching uses segmented controls (rounded track, uppercase DM Mono 11px, `animateSegThumb()` sliding-pill animation). See `.claude/rules/ui-detail.md` for full layout.

---

## 4. Module Map

```
src/
  main.js — DOMContentLoaded, init, screen wiring
  supabase.js — Supabase client init
  auth.js — login, signup, logout, session management
  state.js — local state cache, activeDraw(), applyTheme()
  bracket-layout.js — renderBracketLayout(): SHARED geometry (positions, connectors, labels, champion
    box). No pick state. Shared by bracket.js, viewer-bracket.js, commissioner-results.js.
  draw-view.js — buildDrawView(): SINGLE pure derivation of round-2+ slots, elim flags, m.elimLabels.
    THE only place slot/elim/label state is computed.
  bracket.js — renderBracket() + placeCard(): live bracket card painting only. Also
    patchMatchScore(): realtime score-only DOM patch (see realtime.js)
  bracket-shared.js — appendScoreWithServeDot(): shared score-footer serve-dot rendering
  realtime.js — startBracketRealtime()/stopBracketRealtime() (stage 1, bracket screen) +
    startResultsRealtime()/stopResultsRealtime() (stage 3, commissioner Results tab)
    — see .claude/rules/realtime.md
  picks.js — handlePickClick(), cascadeMatchPickForward(), clearMatchPickForward(),
    withdrawalClearForward(), updatePlayerNameForward()
  scoring.js — calcMatchScore(), calcStats(), calcHealthPts()
  stats.js — renderStats(), stats bar pills
  lock.js — isMatchLocked() + lock/unlock helpers
  commissioner.js — orchestrator + Draw Management tab + commissioner header
  commissioner-shared.js — $c(), escHtml()
  commissioner-results.js — Results tab: renderResults(), winner confirm/undo, applyPlayerSwap()
  commissioner-locks.js — Lock Managing tab orchestrator: renderLockManaging()
  commissioner-locks-orig.js — Original Picks lock controls
  commissioner-locks-backup.js — Backup Pick locks + Scheduled Locks list
  commissioner-qualifiers.js — Re-upload draw PDF: diff stored draw vs. re-parsed PDF,
    qualifier-placement + roster-change buckets — see .claude/rules/qualifiers.md
  leaderboard.js — renderLeaderboard(), stats aggregation, shared helpers (formatStat, loadDrawStatsForAllUsers)
  leaderboard-slams.js — Slams tab: live slam cards, sortable M/W table, past slams, storyline chips
  leaderboard-records.js — Records tab: all-time/per-year standings, podium, honor chips
  leaderboard-yourdraws.js — Your Draws tab: sortable table of user's own draws with stats
  viewer-bracket.js — renderViewerBracket() + placeViewerCard(): read-only viewer painting
  print.js — buildPrintHTML() (ported verbatim)
  parser.js — extractPdfText(), parseTnnsText(), validateParsedDraw(), buildInitialRounds()
  player-names.js — isPlaceholderName(), displayName() — see .claude/rules/qualifiers.md
  seg-thumb.js — animateSegThumb(container, oldIdx, newIdx)
index.html / vite.config.js / .env.local (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
```

---

## 5. Data Model

**Local state** (in-memory, no localStorage):
```js
state = { draws: Draw[], activeTab: number, currentUser: Profile | null }
```

Draw, Round, Match, Player shapes match the reference app (see `reference/index.html` §4).

### Authoritative vs. derived state

**Authoritative fields** (from DB, source of truth): round-0 `p1`/`p2`, `winner`/`score`, and per-user `matchPick`, `originalPick`, `originalPickResult`, `matchPickResult`, `highConfidence`, `editedAfterLock`.

**Everything else is DERIVED** by `buildDrawView(d)` (`src/draw-view.js`) — the ONE place slot/elim/label state is computed. Pure and idempotent. **Never reconstruct slots or replay eliminations anywhere else. Call `buildDrawView` after any authoritative change.**

`buildDrawView` step order:
1. Build round-2+ slots from feeders via `winner || originalPick || matchPick`
2. Build `eliminated` Set = losers of every decided match
3. Flag `elim` on every undecided slot whose occupant is eliminated; null any dead backup `matchPick`
4. Emit `m.elimLabels` (displaced-pick labels), side resolved from feeders' `originalPick`

Viewer mode: `buildDrawView(d, { projectFromPick: true })` — pick-first slots, eliminated set from `actualP1`/`actualP2`, no displaced-label pass. Only `assembleDrawForUserOriginalPicks` passes this flag. See `.claude/rules/bracket-rendering.md`.

Additional fields vs. reference:
```js
Match { db_id: string }  // Supabase matches.id — needed for pick upserts

Pick {
  match_id: string,
  matchPick: string | null,                      // DB col: match_pick. Pre-lock = original intent;
                                                 //   post-lock = backup pick (or original if unchanged).
  original_pick: string | null,                  // Snapshotted at lock. Sacred post-lock.
  originalPickResult: 'correct'|'wrong'|null,    // Drives scoring + draw accuracy
  matchPickResult: 'correct'|'wrong'|null,       // Drives match accuracy
  high_confidence: boolean,
  edited_after_lock: boolean
}
```

### Supabase schema (see `migrations.sql` for full definitions)

- `profiles` — extends `auth.users`; `display_name`, `is_commissioner`
- `draws` — one row per slam+draw_type+year; `is_active` flags current slam. Confirming new slam sets all existing to false.
- `matches` — 127 rows per draw (rounds 0–6); shared across users; winner/score set by commissioner
- `picks` — one row per user×match; upserted on every pick change
- `lock_schedules` — commissioner-defined lock windows; `locked_at` set when fired

### Key Supabase access patterns

- **Load draw:** `draws` → `matches` → `picks` for current user → assemble
- **Save pick:** upsert `picks` (all Pick fields)
- **Confirm result:** `applyWinner()` sets `originalPickResult` and `matchPickResult` independently per pick row
- **Lock original picks:** `draws.original_picks_locked = true`; snapshot `picks.original_pick = picks.match_pick` for all users
- **Lock backup picks:** `lock_schedules.locked_at = now()`

---

## 6. Auth & Roles

- Supabase email/password. Display name stored in `profiles.display_name`.
- `profiles.is_commissioner = true` on exactly one account (set manually in dashboard).
- After login, fetch `profiles` row; store in `state.currentUser`.
- Commissioner UI gated on `state.currentUser.is_commissioner`. **Always check role before write operations — never rely on UI hiding alone.**
- No forgot-password UI — commissioner handles via dashboard.

---

## 7. Pick Semantics

**Pre-lock:** click records `matchPick`; later slots derive via `buildDrawView`. Changing a pick clears orphaned forward picks via `clearMatchPickForward()`.

**Post-lock (normal backup pick):** purple styling, no slot change. `cascadeMatchPickForward()` sets `nm.matchPick` only — never touches `p1`/`p2`. Passes through elim'd slots, breaks at confirmed winners. Persisted via `saveCascadeToSupabase`. Only available when match has no result yet.

**Post-lock draw-change repick (`editedAfterLock: true`):** commissioner replaces a player after lock → only that match flagged (`editedAfterLock = true`, `originalPick = null`, `matchPick = null`). Forward rounds untouched.

Player clicks a flagged match → **confirmation modal** (`#pick-confirm-modal`; `showPickConfirm(playerName)` → `Promise<bool>` in picks.js). On confirm: `matchPick = originalPick = p.name`, `editedAfterLock = false`. No cascade. Code checks the next round's slot; if changed, that slot also gets `editedAfterLock = true`, propagating one round at a time.

`original_pick` is sacred post-lock. Never mutate it except via draw-change repick.

---

## 8. Lock Architecture

**Mental model: scheduling = committing.** No confirm dialog at fire time. Unlocking is rare/testing only.

- **Original picks lock:** global per draw. Schedules a `lock_schedules` row (`lock_type='original_picks'`) or "Lock now" calls `_doLockOriginalPicks(d)` directly.
- **Backup pick locks:** per `lock_schedules` row, covering `(round_index, match_index_start, match_index_end)` (`lock_type='backup_picks'`). Commissioner selects cards → schedules or "Lock now". Unlock: scheduled rows deleted; locked rows get `locked_at = null`.
- Lock state read from Supabase on draw load.
- **All lock checks are draw-scoped** — filter `ls.draw_id === d.db_id` everywhere. A lock on one draw must never block picks on another. See `.claude/rules/lock-conventions.md` for function list.
- **SQL + pg_cron:** `fire_scheduled_locks()` PL/pgSQL runs every minute. For `original_picks`: snapshot `match_pick → original_pick`, set `draws.original_picks_locked = true`, delete row. For `backup_picks`: set `locked_at = now()`. Requires pg_cron + pg_net in Supabase Dashboard → Extensions.

---

## 9. Scoring

**Scoring is version-aware since 2026-07-17, and v2 applies retroactively since
2026-07-18** (post-Wimbledon-2026 redesign — see `.claude/rules/scoring-redesign.md`
for full rationale/history, including the reversal). Every draw carries
`scoring_version` (int); `getScoringConfig(version)` in `scoring.js` resolves round
base points, the upset bonus, and the Match Yield stake for that draw. **Every
existing draw — including Wimbledon 2026 and French Open 2026 — is now on
`scoring_version = 2`.** v1 was originally meant to stay frozen on every
pre-redesign draw forever; Ben reversed that 2026-07-18 after confirming under v2
that the #1 spot in both Wimbledon draws was unchanged (Carson Bodnarek MS, Vibes
Architect WS), so the risk that motivated the freeze never materialized. **v1's
code path is kept fully intact regardless** — both formulas still work, so
reverting any draw to v1 is a one-row `scoring_version` update, not a rebuild. New
draws default to `scoring_version = 2` (hardcoded in `commissioner.js`'s
draw-confirm flow — no commissioner-facing version picker).

| | v1 (rollback lever only — no draw currently uses it) | v2 (current formula for every draw) |
|---|---|---|
| Round base points | `[1, 2, 3, 6, 10, 18, 32]` (ri 0–6) | `[1, 2, 4, 8, 16, 32, 64]` — every round contributes equal aggregate pool value |
| Upset bonus | `numericSeed(winner) - numericSeed(loser)`, floored at 0; unseeded/Q/WC/LL/PR = seed 33; unseeded-vs-unseeded = 0.5 flat | **none** — Draw Yield is pure coverage, no seed-based bonus |
| Match Yield stake | `[10, 10, 20, 20, 30, 40, 50]` (round-escalating) | flat 10-point stake every match (points, not dollars — display copy must not use a `$` sign) |
| Stale-pick-in-Match-Yield handling | a pick naming neither current occupant is silently excluded (a bug, not a designed penalty — see scoring-redesign.md §"Verified formulas and gotchas") | treated like a blank pick — auto-scored on the odds favourite |

Only correct original picks score Draw Yield; backup picks track accuracy only.
Auto-pick-favourite fallbacks (ELO for Draw Yield/Health, odds for Match Yield)
are unaffected by version beyond the table above.

**Draw Health:** share of bracket's full point value still in play. `maxHealthPts` = base points of ALL original picks (constant, using the draw's own version's round-base table). `reachableHealthPts` = picks confirmed correct OR still in slot and not `elim` (per `buildDrawView` flags). `calcHealthPts(d, filterRi)` clones draw, nulls winners after `filterRi`, re-runs `buildDrawView`. Leaderboard stats: Score, Draw Accuracy, Match Accuracy, Draw Health — no chalk comparison. Health-band calibration (`health_band_samples`) is separately version-aware — see `.claude/rules/health-bands.md`.

**Slam Index:** composite — `100 + 15 × avg(edge_DrawYield, edge_MatchYield)`. Version-aware since 2026-08-24 via `draws.slam_index_version` (independent of `scoring_version` — see `.claude/rules/slam-index.md`). Every edge is measured in standard deviations above a fixed, player-independent **chalk baseline** for that draw — an ELO-favourite bracket for Draw Yield, a flat-stake odds-favourite bettor for Match Yield. No other players' data needed at all, which is the point: a 115 means the same thing at every slam, not just "typical distance above whoever else entered this one." **v3 (current, 2026-08-28):** realized `chalkDY`/`chalkMY` are unchanged closed-form values, but the two standard deviations are a **persisted Monte Carlo estimate** (`src/slam-index-sim.js`, 40,000 full-bracket simulated runs, commissioner-triggered and cached on the `draws` row — never computed inline on a render) rather than the v2 closed form, which dropped bracket-path covariance and understated σ_DY by 20-50%. **v2 (rollback lever, superseded by v3):** the same chalk baseline with σ_DY/σ_MY computed by the closed-form independent-Bernoulli-sum formula (`calcChalkBaselines(d)` in `scoring.js`) — still fully intact, used as v3's interim/no-simulation-yet fallback. **v1 (rollback lever only):** the original pool-relative z-score — population z-scores within players with ≥1 pick for that draw; pool < 2 or stddev = 0 → z = 0 (index = 100). A draw without enough ELO/odds data to trust a chalk baseline falls back to v1 automatically (currently French Open 2026 MS/WS, which predate the betting layer's odds data). `calcSlamIndex(entries, {version, chalk})` in `scoring.js` branches on this; all three code paths stay fully intact. On draw load/refresh, `fetchPoolSlamIndex()` in `stats.js` computes the v2/v3 index locally (no fetch) or falls back to the v1 cross-user fetch via `loadDrawStatsForAllUsers`.

---

## 10. Leaderboard

**Per-slam view:** Score, Draw Accuracy %, Match Accuracy %, Draw Health %, Slam Index per player. Separate MS/WS rows. Sortable.
**Year-to-date / all-time:** Average score, overall Draw/Match Accuracy, avg Slam Index. Not split by MS/WS.
Three tabs: `slams`, `records`, `yourdraws`. Records tab has four cards per period: Avg Score | Match Yield | Slam Index | Top Draws. See `.claude/rules/leaderboard-detail.md` for SLAM_COLORS, grid values, tab internals, and viewer entry point.

---

## 11. Commissioner Screen

Reached via account-menu "Commissioner" entry (`enterCommissioner()`); exited via "Back to draw" (`#exit-commish-btn`). Commissioner is also a normal player.

1. **Draw management** — PDF upload → parse → review/edit R1 → confirm (replaces existing same slam+draw+year; auto-deactivates previous slam)
2. **Player editing** — edit name/seed post-upload
3. **Results** — match-by-match winner confirmation. `_resultOccupant()` reads feeder `winner` directly (not `buildDrawView` p1/p2) — never shows projected picks in empty slots. Round 0 always shows real draw.
4. **Lock managing** — visual bracket; original picks lock + backup pick locks. See §8.

---

## 12. Rules & Conventions

**No localStorage.** All persistence through Supabase.

**State mutation order:** `savePickToSupabase()` (async, await) → `renderStats()` → `renderBracket()`.

**`$()` shorthand:** `function $(id){return document.getElementById(id)}`. Never redefine or shadow it.

**CSS:** all colors via `var(--token)`. Slam theme tokens on `body.theme-AO` etc. Port the full `:root` block from reference verbatim.

**Typography:** Playfair Display for player names/headings. DM Mono for seeds/labels/stats. DM Sans for body/buttons/chrome. Do not substitute.

**`renderBracket()` is destructive** — clears and rebuilds from scratch. Never cache DOM references to bracket cards across renders.

**Shared geometry, separate painting.** `renderBracketLayout()` in `bracket-layout.js` owns all geometry; each renderer owns its own `placeCard(draw, match, ri, mi, x, y, wrap)` callback for painting only. Never duplicate geometry; never share painting logic between live and viewer.

**Print is standalone.** `buildPrintHTML()` receives the assembled `Draw` object; must not reference Supabase or async data.

**Defensive defaults.** Apply defaults for nullable fields in the assembly function, not in render code.

**Key signatures:**
- `state.draws[i].draw` = `'MS'`|`'WS'`; `state.draws[i].db_id` = Supabase `draws.id`; `match.db_id` = Supabase `matches.id`
- `handlePickClick(ri, mi, p, { renderStats, renderBracket })` and `applyWinner(d, ri, mi, winnerName, { renderStats, renderBracket })` — callbacks passed in to avoid circular imports

**Elim slot rendering:** eliminated original pick stays in-card, red + crossed-out (`pr s-orig-wrong`), no click handler. No floating label until a confirmed feeder winner displaces it. See `.claude/rules/bracket-rendering.md` for Case 1/2 detail and viewer card painting.

---

## 13. Feature Status

**Built:** foundation, commissioner screen, leaderboard, polish, viewer, lock architecture (incl. scheduled-locks list), post-lock backup-pick cascade, `buildDrawView` derived-state model, Match Yield betting layer (odds polling, name matching, commissioner Odds tab, bracket card odds display), Records tab trophy-room redesign, Slams tab live-board redesign (stage 3: live slam header + sortable M/W cards + movement arrows + health underlines + storyline chips + past-slam compact/expand + generic list modal), draw notification email (Supabase Edge Function `send-draw-notification` + Resend; `draws.notified_at` column; `get_resend_api_key()` vault helper; standalone HTML email template in `Multiplayer/wimbledon-2026-email.html`), commissioner Draw Management improvements: Pick Completion table (per-player round-0 fill count + status chip), Manage Draws collapsed section with Re-activate button (sets `draws.is_active`, clears `app_settings` Getting Ready state), Getting Ready single-button flow, Odds tab Unmatched API Names nested inside Odds Status card, ESPN live score feed (`fetch_espn_scores()` SQL poller + pg_cron, always-on bracket card score display, commissioner Results-tab status/unmatched-names triage card, heartbeat email alerting, auto-confirm behind `scores_autoconfirm_enabled` — see `.claude/rules/scores-feed.md`), ESPN match-start auto-lock (`fetch_espn_scores()` inserts a single-match `lock_schedules` row the instant a match's `espn_state` moves off `'pre'`, indistinguishable from a manual "Lock now"; applies to every round including Round 1) + its "Match picks set for X/Y upcoming matches" post-lock countdown replacement (`backupPickFraction()` in `lock.js`, shares feeder-occupant resolution with commissioner-results.js's `_resultOccupant()` — see `.claude/rules/lock-conventions.md`), version-aware scoring engine (`draws.scoring_version`, `SCORING_CONFIGS`/`getScoringConfig()` in `scoring.js` — v2 is now the actual formula for every draw, including retroactively for Wimbledon 2026 and French Open 2026; v1 kept fully working as a one-row rollback lever only — see §9 and `.claude/rules/scoring-redesign.md`).

**Naming note:** "Score" is labelled **Draw Yield** everywhere in the UI (stats bar, leaderboard). Internal key remains `score` in JS stats objects. Chalk display removed from UI; code retained in `scoring.js` / `stats.js` (commented out) for future re-enable.

**Not yet built:**
- Commissioner "Notify Players" button (Edge Function is deployed; button in commissioner screen not yet wired — see Claude Code prompt in session notes)
- Commissioner **Email** tab (design decided 2026-08-28, not implemented): port `Multiplayer/email-generator.html` (standalone tool, currently run outside the app) into a 5th commissioner tab, following the exact Odds-tab pattern (`commissioner-odds.js` is the model) — new nav button (`data-tab="email"`), new `comm-pane-email` pane, new `commissioner-email.js` module rendered via `renderEmailTab()`. Keeps the tool's existing behavior: slam-colored HTML invite/reminder email preview (headline, optional deadline line, optional heading, multi-paragraph body, button text, all live-rendered), "Select email" (select-all for ⌘C-paste into Gmail), "Copy emails" (BCC list via the `get_slam_participant_emails(slam, year)` Supabase RPC). **Stays copy-paste-into-Gmail, same as today — no in-app "Send" button** (see the send-draw-notification finding below for why). Decisions locked in:
  - The tab keeps its **own independent slam + year picker**, decoupled from the commissioner page's main slam/M-W selector — composing an email doesn't require switching the active draw view.
  - The four per-slam logo images are **already sitting in `tennislogos/`** as real PNG files and map directly by color — no extraction needed, just reference by path: `Slam Bracket Logo.png` = WIM (green), `Slam_Bracket_Logo_brick_red.png` = RG, `Slam_Bracket_Logo_light_blue.png` = AO, `Slam_Bracket_Logo_navy_blue.png` = USO.
  - The email RPC call switches from the standalone tool's hardcoded Supabase URL/anon key to the **app's shared `supabase.js` client**, matching every other commissioner module.
  - **Gmail-clipping bug found and root-caused (2026-08-29):** the standalone tool embeds each per-slam logo as an inline base64 `data:` URI (900KB–1.25MB of text per logo, baked in via the `<img id="logo-WIM">` etc. elements at the top of `email-generator.html`), so every generated email is 1MB+ before Gmail's 102KB clip threshold even comes into play — that's the actual cause, not general HTML bloat. `Multiplayer/wimbledon-2026-email.html` already sidesteps this by pointing at a hosted icon URL (`https://bracketslam.netlify.app/icons/icon-192.png`) instead. Fix is the same one already planned above: swap the standalone tool's base64 `LOGOS` object for the four hosted logo URLs (the PNGs already live in `public/` and ship with every Netlify deploy) so emails stay a few KB. Do this on the standalone tool now, independent of the Email-tab port, since Ben is sending from it today.

  **Why not real sending (investigated 2026-08-28):** the deployed `send-draw-notification` Edge Function (Resend-based, used for the draw-confirm notification — see the Built list above) sends `from: 'Slam Bracket <onboarding@resend.dev>'`. That's Resend's sandbox sender, which Resend restricts to delivering only to the Resend account's own signup email — it cannot reach the ~20 pool participants. Fixing this requires verifying a real sending domain in Resend (DNS setup, not a code change), which needs Ben to own a domain. Ben doesn't have one and doesn't want to pay for one just for this. So real in-app sending is on hold indefinitely for both the Email tab and (implicitly) the existing `send-draw-notification` function — copy-paste-into-Gmail remains the actual delivery path for pool emails. Revisit only if Ben acquires a domain.
- Automated tests (`test-harness/` golden exists; see §0)
- Mobile layout (desktop-only; mobile version is a future phase)
- New-player onboarding tutorial auto-show on first login (design decided 2026-07-06; the walkthrough itself shipped 2026-07-18 — manual "Tutorial" account-menu entry only, coach-mark overlay + throwaway sandbox draw sliced from a real completed slam). Auto-show still needs a persisted "seen" flag and login-flow wiring — both deferred pending Ben's sign-off on the exact column name/trigger point. Full design + implementation notes in `.claude/rules/tutorial.md`.
- Leaderboard Records/Slams redesign (design finalized 2026-07-18, not implemented): shrinkage-adjusted Slam Index standings, Draw Yield/Match Yield personal-best tables with raw/vs.-chalk toggle, Slams-tab click-to-reveal Combined M/W card. Full design in `.claude/rules/leaderboard-records-redesign.md`.
- Real-time updates: **stage 1 (bracket screen) + stage 3 (commissioner Results tab) built** 2026-07-03 — `src/realtime.js`, patch-tier score ticks + debounced rebuild-tier for winner/lock/draw changes on the bracket screen, pure-visibility winner/score/espn_state notifications on the commissioner Results tab, kill-switch on disconnect. See `.claude/rules/realtime.md`. Leaderboard (stage 2) still manual-refresh only.
