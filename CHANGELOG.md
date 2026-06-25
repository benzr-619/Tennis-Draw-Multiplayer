# CHANGELOG — Slam Bracket Multiplayer

Historical record of build steps, refactors, and fixed bugs. **Not loaded into context each session** — this is an archive, not the source of truth. Current state lives in `CLAUDE.md`. Read this only when you specifically need the history of *why* something changed; git is the fuller record.

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
