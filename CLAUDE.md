# CLAUDE.md — Slam Bracket Multiplayer

Source of truth for this codebase. Read before touching any code.

---

## 0. Repo Hygiene (established 2026-06-01, Refactor Step 1)

- `.gitignore` covers `node_modules/`, `dist/`, `.env.local`, `*.timestamp-*.mjs`, `_archive/`, `.DS_Store`. These are never committed.
- `node_modules/`, `dist/`, and `.env.local` were removed from git tracking (working copies on disk untouched).
- **ACTION STILL REQUIRED BY BEN:** `.env.local` was committed earlier, so the Supabase anon key is in git history. Rotate the anon key in the Supabase dashboard.
- One-off SQL data dumps (RG 2026 seed/restore files, `add_is_active.sql`) moved to `_archive/` — kept locally, ignored by git, never loaded into context.
- Build-session scratch notes (chat*-prompt.md, context.md, project-instructions.md) deleted; CLAUDE.md is the sole source of truth.
- Do NOT read `reference/index.html`, `_archive/`, `dist/`, `node_modules/`, or any `*.sql` data dump unless explicitly told to — they are archives, not working code.

### Refactor Step 2 (2026-06-01) — complexity-wall parts C & E

- **C done:** extracted shared bracket geometry into `bracket-layout.js`; removed three verbatim copies from `bracket.js`, `viewer-bracket.js`, `commissioner-results.js`. Verified via `vite build`.
- **E done:** split the ~1000-line `commissioner.js` into `commissioner.js` (orchestrator + Draw Management) + `commissioner-results.js` + `commissioner-locks.js` + `commissioner-shared.js`. No behavior change.
### Refactor Step 3 (2026-06-01) — complexity-wall parts A, B & D (DONE)

The data-model rewrite. All three parts complete; behavior verified against a Node render-facts golden (`test-harness/`, see below).

- **A done — explicit derived model.** New `src/draw-view.js` / `buildDrawView(d)` is the SINGLE pure derivation of all non-authoritative bracket state. `data.js` no longer reconstructs `p1`/`p2` inline or replays elimination at load; it loads raw rows and calls `buildDrawView`. The function is idempotent (rebuilds round-2+ slots from scratch each call) so it runs on every state change instead of incremental mutation.
- **B done — collapsed the forward-walkers.** The six overlapping walkers are gone. All slot/elim/label derivation now lives in `buildDrawView`. `picks.js` keeps only two tiny raw-field writers — `cascadeMatchPickForward` / `clearMatchPickForward` — to keep stored backup picks byte-identical (Option 1, no DB change), plus `withdrawalClearForward` / `updatePlayerNameForward` which now touch only authoritative fields (matchPick/originalPick/editedAfterLock), not slots. `markLoserForward`/`unmarkLoserForward`/`placePickAllRounds`/`clearPickForward`/`placePickInNextRound` deleted.
- **D done — deleted the displaced-label hack.** `bracket.js` no longer does Case-1/Case-2 feeder lookups. `buildDrawView` computes `m.elimLabels = [{name,pos}]`; `placeCard` just paints them.
- **Behavior note (approved by Ben):** the pure rebuild removed a latent "stale-until-reload" bug — three render spots (a pre-lock pick change leaving a ghost slot; a withdrawal repick leaving a stale/blank slot) now show the correct, reload-consistent state live. New live output == old post-refresh output. Everything else is byte-identical.
- **No DB migration.** Schema and stored data unchanged; the same pick rows are written as before.
- **Regression harness:** `test-harness/` drives the REAL `picks.js` + `data.js` + `bracket.js placeCard` in Node (Supabase + DOM stubbed) and snapshots state + render-facts (card/row classes, names, elim labels, stats) to `GOLDEN.frozen.txt`. Run: `cd test-harness && node --import ./register.mjs ./harness.mjs` then diff against the golden. Throwaway but kept — re-run it before/after any future bracket-state change.

---

## 1. App Overview

Slam Bracket Multiplayer is a shared pick pool app for Grand Slam tennis. A commissioner (single admin user) uploads TNNS Live draw PDFs, edits player names, and manages lock windows. Players log in, make picks before locks, confirm their own match results mid-tournament, and make backup picks when their original picks are eliminated. A leaderboard shows scores and stats for all players across draws.

This is a small private app — one pool, ~20 players, friends and family. There are no multiple pools, no public signup, no email notifications. The commissioner manages accounts directly in Supabase if needed.

The single-player reference implementation lives in `reference/index.html`. Port logic, CSS tokens, scoring functions, and the bracket renderer from there rather than rewriting from scratch.

---

## 2. Tech Stack

- **Vite** — build tool. No framework. Vanilla JS with ES modules.
- **Multi-file structure** — separate JS modules for auth, state, bracket, scoring, leaderboard, commissioner. Single `index.html` entry point with screen-based navigation (no client-side router).
- **Supabase JS client (`@supabase/supabase-js`)** — auth (email/password) + Postgres database + realtime (optional future use).
- **Google Fonts** — Playfair Display (ital,wght 400/600), DM Mono (400/500), DM Sans (300/400/500/600). Same as reference app.
- **No other runtime dependencies.** No React, no Vue, no component library.
- **PWA:** `manifest.json` + icons (port from reference).
- **Print target:** A3 portrait, same as reference — `buildPrintHTML()` generates a standalone document.

---

## 3. Screen Map

All screens live in `index.html` as `<div id="screen-*">` elements. `showScreen(id)` activates one and hides others. Screens:

| ID | Who sees it | Purpose |
|---|---|---|
| `screen-auth` | Everyone (logged out) | Login + signup |
| `screen-bracket` | Players only | Active draw view, pick-making |
| `screen-commissioner` | Commissioner only | Full app home for commissioner: draw upload, player editing, lock managing, result confirmation |
| `screen-leaderboard` | Players only | Stats comparison across all players |
| `screen-viewer` | Players only | Read-only original-picks viewer — completely separate from screen-bracket; navigated to from leaderboard |

Navigation: after login → commissioner lands on `screen-commissioner` and never sees any other screen. Players land on `screen-bracket` for the current live slam. No slam dropdown anywhere — there is exactly one live slam at a time; the header shows the slam name as static text (e.g. "Roland Garros 2026"). M/W segmented control remains on both player bracket and commissioner screens. Between slams, the most recently active slam stays visible (no empty state needed). Past slams are accessible only via leaderboard → Your Draws tab.

---

## 4. Module Map

```
src/
  main.js          — DOMContentLoaded, init, screen wiring
  supabase.js      — Supabase client init (reads env vars)
  auth.js          — login, signup, logout, session management
  state.js         — local state cache, activeDraw(), applyTheme()
  bracket-layout.js — renderBracketLayout(): SHARED bracket geometry (card positions, connectors, separators, section/round labels, champion box). Knows nothing about pick state/colors/clicks. Used by bracket.js, viewer-bracket.js, commissioner-results.js.
  draw-view.js     — buildDrawView(): SINGLE pure, idempotent derivation of round-2+ slot occupants, elim flags, and displaced-pick labels (m.elimLabels) from authoritative fields. The only place slot/elim/label state is computed. (Refactor Step 3, parts A/B/D.)
  bracket.js       — renderBracket() (calls renderBracketLayout), placeCard() — live bracket card painting only; paints m.elimLabels, no derivation
  picks.js         — handlePickClick(), applyWinner()/undoWinner() (call buildDrawView), cascadeMatchPickForward()/clearMatchPickForward() (raw matchPick writers), withdrawalClearForward()/updatePlayerNameForward()
  scoring.js       — calcMatchScore(), calcStats(), calcChalkScore() (ported)
  stats.js         — renderStats(), stats bar pills (ported)
  lock.js          — lock/unlock logic, applyWinner(), undoWinner() (ported)
  commissioner.js          — orchestrator + Draw Management tab (upload/parse/confirm) + commissioner header; re-exports renderResults/renderLockManaging
  commissioner-shared.js   — $c(), escHtml() shared by the commissioner modules
  commissioner-results.js  — Results tab: renderResults(), winner confirm/undo, results search
  commissioner-locks.js    — Lock Managing tab: renderLockManaging(), original-picks + backup-pick lock scheduling
  leaderboard.js   — renderLeaderboard(), stats aggregation
  viewer-bracket.js — renderViewerBracket() (calls renderBracketLayout), placeViewerCard() — read-only card painting for screen-viewer; no live-bracket logic
  print.js         — buildPrintHTML() (ported verbatim)
  parser.js        — extractPdfText(), parseTnnsText(), buildInitialRounds() (ported)
index.html
vite.config.js
.env.local         — VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

---

## 5. Data Model

### Local state (in-memory cache, not persisted to localStorage)

```js
state = {
  draws:     Draw[],      // fetched from Supabase on load
  activeTab: number,
  currentUser: Profile | null
}
```

Draw, Round, Match, Player shapes are identical to the reference app. See `reference/index.html` section 4 (Data Model) for full definitions.

**Authoritative (raw) vs. derived state (Refactor Step 3, 2026-06-01).** Each match carries only a small set of *authoritative* fields that come straight from the DB and are the source of truth: round-0 `p1`/`p2` (the actual draw), `winner`/`score`, and per-user `matchPick`, `originalPick`, `originalPickResult`, `matchPickResult`, `highConfidence`, `editedAfterLock`, `notes`. **Everything else is DERIVED** by `buildDrawView(d)` in `src/draw-view.js`: the `p1`/`p2` occupants for rounds 2+, each slot's `elim` flag, and the `m.elimLabels` array (displaced eliminated-pick labels). `buildDrawView` is the ONE place this derivation happens; it is pure and idempotent (round-2+ slots are rebuilt from scratch every call). Renderers, scoring, and stats consume the derived fields and contain zero derivation logic. Never reconstruct slots or replay eliminations anywhere else — call `buildDrawView` after any authoritative change.

Slot occupancy is derived from the feeder matches via `winner || originalPick || matchPick` (actual advancer first, then the user's projected pick). Elimination flags + dead-backup clearing replay forward from every confirmed winner. Displaced-pick label sides are resolved from the feeders' `originalPick`.

Additional fields vs. reference:
```js
Match {
  // all reference fields, plus:
  db_id: string  // Supabase matches.id — needed for pick upserts
}

Pick {           // per-user per-match, fetched separately
  match_id: string,
  matchPick: string | null,              // JS field; DB column: match_pick
                                         // Active pick at match time. Pre-lock = original intent.
                                         // Post-lock = backup pick (or still original if unchanged).
  original_pick: string | null,          // Snapshotted at lock; never mutated after lock except withdrawal
  originalPickResult: 'correct'|'wrong'|null,  // Was original_pick correct? Drives scoring + draw accuracy.
  matchPickResult: 'correct'|'wrong'|null,     // Was matchPick correct? Drives match accuracy.
  high_confidence: boolean,
  edited_after_lock: boolean
}
```

### Supabase schema

See `migrations.sql` for full table definitions. Summary:

- `profiles` — extends `auth.users`; adds `display_name`, `is_commissioner`
- `draws` — one row per slam+draw_type+year; `is_active boolean` flags the current live slam. Only one slam (both its MS+WS draws) is active at a time. Uploading and confirming a new slam auto-sets `is_active = false` on all existing draws and `is_active = true` on the new ones.
- `matches` — 127 rows per draw (rounds 0–6); shared across all users; winner/score set by commissioner
- `picks` — one row per user×match; upserted on every pick change
- `lock_schedules` — commissioner-defined lock windows; `locked_at` set when manually triggered

### Key Supabase access patterns

- **Load a draw:** fetch `draws` row → fetch all `matches` for that draw → fetch all `picks` for current user + that draw → assemble into local state
- **Save a pick:** upsert into `picks` (user_id, match_id, match_pick, original_pick, original_pick_result, match_pick_result, high_confidence, edited_after_lock)
- **Confirm result (commissioner):** `applyWinner()` sets both `original_pick_result` and `match_pick_result` independently for every pick row on that match. One winner click → two comparisons → two result columns.
- **Lock original picks:** update `draws.original_picks_locked` = true; snapshot `picks.original_pick = picks.match_pick` for all users in that draw
- **Lock backup picks (per schedule):** update `lock_schedules.locked_at`; mark affected matches as backup-locked

---

## 6. Auth & Roles

- Supabase email/password auth. Display name captured at signup and stored in `profiles.display_name`.
- `profiles.is_commissioner = true` on exactly one account (set manually in Supabase dashboard).
- After login, fetch `profiles` row for current user to determine role. Store in `state.currentUser`.
- Commissioner-only UI (upload button, confirm result buttons, lock controls) rendered conditionally based on `state.currentUser.is_commissioner`.
- No forgot-password UI — commissioner handles via Supabase dashboard.

---

## 7. Pick Semantics (identical to reference app)

Pick semantics are unchanged from the reference app; only the *implementation* changed in Refactor Step 3 — slot occupancy is now derived by `buildDrawView`, not mutated by forward-walk functions.

**Pre-lock:** a click just records `matchPick` on that match; the candidate slots for later rounds are derived. Changing a pick clears any now-orphaned forward `matchPick` via `clearMatchPickForward()`; slots re-derive automatically.

**Post-lock (normal):** picks are backup — purple styling, no slot change. The active backup is propagated forward through eliminated slots via `cascadeMatchPickForward()` and persisted (`saveCascadeToSupabase` — keeps stored picks identical to the old behavior). Only available when the match has no result yet.

**Post-lock (`edited_after_lock: true`):** withdrawal repick — re-records `matchPick`, re-snapshots `original_pick`, clears `edited_after_lock`, cascades the new pick forward.

`original_pick` is sacred post-lock. Never mutate it except via the withdrawal flow.

After any authoritative change, handlers call `buildDrawView(d)` then render. (The commissioner edit/withdrawal path in `bracket.js` mutates authoritative fields and renders; slots re-derive on the next `buildDrawView`.)

---

## 8. Lock Architecture

Locks are per-draw or per-match-range, commissioner-controlled:

- **Original picks lock:** global per draw. Set by commissioner via datetime picker or "lock now" button. Snapshots `original_pick` for all users.
- **Backup pick locks:** per `lock_schedules` row. Each row covers a `(round_index, match_index_start, match_index_end)` range and a `lock_type = 'backup_picks'`. Commissioner sets `scheduled_at` in advance; triggers manually (or scheduled_at auto-fires via a Supabase Edge Function in the future). Can be unlocked and rescheduled.
- Lock state is read from Supabase on draw load. Match cards check their round/index against active lock schedules to determine if picks are still allowed.

---

## 9. Scoring (identical to reference app)

`ROUND_CONFIG[ri].base` → `[1, 2, 3, 6, 10, 18, 32]` for ri 0–6. Upset bonus = `numericSeed(winner) - numericSeed(loser)`, floored at 0. Unseeded/Q/WC/LL/PR = seed 33. Unseeded vs. unseeded = 0.5 flat. Only correct original picks score; backup picks track accuracy only.

Draw Health = `reachableHealthPts / maxHealthPts`. Useful both during active slams (how busted is my bracket?) and after (what % of theoretical max did I capture?).

No chalk comparison on the leaderboard — only Score, Draw Accuracy, Match Accuracy, Draw Health per player.

---

## 10. Leaderboard Stats

**Per-slam view:** Score, Draw Accuracy %, Match Accuracy %, Draw Health % for each player. Separate rows for MS and WS draws. Sortable by any column.

**Year-to-date / all-time view:** Average score per draw, overall Draw Accuracy %, overall Match Accuracy % across all draws in the sample. Count of draws in sample shown per player. Not split by MS/WS.

---

## 11. Lock Countdown & Backup Pick Highlighting

When a lock is upcoming and not yet triggered:
- Stats bar right end: countdown clock to next lock (e.g. "picks lock in 14h")
- Match cards without an active pick that fall within the upcoming lock's match range glow purple (same purple as backup pick styling)
- Countdown label is highlighted (accent color or pulse) until all affected picks are filled

This applies to both original pick locks (pre-tournament) and backup pick locks (mid-tournament).

---

## 12. Commissioner Screen

The commissioner screen is the commissioner's entire app — they never see the player bracket, leaderboard, or viewer. The M/W switcher and static slam name live in the commissioner header exactly as they do in the player header.

Tabs or sections:
1. **Draw management** — upload PDF → parse → review/edit R1 matches → confirm draw (replaces existing if same slam+draw+year; auto-deactivates previous slam)
2. **Player editing** — edit any player name/seed post-upload (same modal as reference app)
3. **Results** — match-by-match result confirmation. Shows matches grouped by round; each match displays the two actual player names and a button to select the winner. No pick colors, no scoring UI. Commissioner clicks the winner; `applyWinner()` fires. Undo available on confirmed matches.
4. **Lock managing** — visual bracket-style view of the draw where the commissioner selects which match cards to lock or unlock. Two levels of control:
   - **Original picks lock** — a single toggle that locks/unlocks the entire draw for original pick-making. Can be scheduled with a datetime or triggered immediately.
   - **Backup pick locks** — commissioner clicks individual match cards (or selects groups) to mark them as locked for backup picks. A selected group can be given a scheduled datetime or locked immediately. Locks can be undone individually. Because tournament scheduling is unpredictable (rain delays, order-of-play changes), all locking is manual-trigger with optional scheduling — no automatic firing.

---

## 13. Rules & Conventions

**No localStorage.** All persistence goes through Supabase. No autosave fallback.

**State mutation protocol.** After any state change: call `savePickToSupabase()` (async), then `renderStats()`, then `renderBracket()` — in that order. Await the save before rendering to avoid stale UI on error.

**`$()` shorthand.** Same as reference: `function $(id){return document.getElementById(id)}`. Never redefine or shadow it.

**CSS variables for colors.** All colors use `var(--token)`. Slam theme tokens overridden per-slam on `body.theme-AO` etc. Same token names as reference app — port the full `:root` block verbatim.

**Typography contract.** Playfair Display for player names/headings. DM Mono for seeds/labels/stats. DM Sans for body/buttons/chrome. Same as reference — do not substitute.

**`renderBracket()` is destructive.** Clears and rebuilds from scratch. Never cache DOM references to bracket cards across renders.

**Viewer mode.** The bracket viewer (`screen-viewer`) is a completely separate screen from the live bracket (`screen-bracket`). `renderViewerBracket(draw)` in `viewer-bracket.js` handles all viewer rendering. The viewer assembles its own draw object via `assembleDrawForUserOriginalPicks()` and does NOT write into `state.draws`, so returning from the viewer requires no data restoration.

**Shared geometry, separate painting (updated 2026-06-01, audit part C).** The old rule "viewer-bracket.js never shares code with bracket.js" is REPLACED. Bracket *geometry* (positions, connectors, labels, champion box) lives once in `bracket-layout.js` / `renderBracketLayout()` and is shared by the live bracket, the viewer, and the commissioner results view. Each renderer still owns its own `placeCard`/`placeViewerCard`/`_placeResultCard` callback for card *painting* (pick state, colors, clicks). Rule going forward: never duplicate geometry; never share card-painting/state logic between live and viewer. `state.viewingUser` is no longer used. Back button on `screen-viewer` simply calls `showScreen('screen-leaderboard')` + `renderLeaderboard()`.

**Commissioner-only UI.** Wrap all commissioner controls in `if (state.currentUser?.is_commissioner)` checks. Never rely on UI hiding alone — check role before any write operation.

**migrateState() equivalent.** When assembling draw data from Supabase, apply defensive defaults for any fields that may be null (e.g. `pick ?? null`, `edited_after_lock ?? false`). Do this in the assembly function, not scattered through render code.

**Print is standalone.** `buildPrintHTML()` is ported verbatim from reference. It must not reference Supabase or any async data — receive the assembled `Draw` object as argument.

---

## 14. Feature Status

**Build order:**
1. ✅ Foundation — Chat 1 complete
2. ✅ Commissioner screen — Chat 2 complete
3. ✅ Leaderboard — Chat 3 complete
4. ✅ Polish — Chat 4 complete

**Chat 1 built:**
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
- `vite.config.js`, `package.json`, `public/manifest.json`
- `.env.local` — placeholder (fill in Supabase credentials before running)

**Chat 2 built:**
- `src/commissioner.js` — full implementation: `initCommissioner()`, `renderLockManaging()`
  - Draw Management tab: drop zone, PDF parse → editable R1 table, confirm draw (upsert draws row + 127 matches)
  - Lock Managing tab: original picks lock (with snapshot), backup pick locks (lock-bracket card selector, contiguous-range insert into lock_schedules, unlock via locked_at = null)
- `src/picks.js` — `applyWinner()` / `undoWinner()` now write to DB: updates `matches.winner/score`, batch-updates `picks.result` for all users on the match
- `src/main.js` — wired `initCommissioner()` on both commissioner nav links; `hdr-user-comm` rendered in header; `draw-uploaded` event refreshes header after upload
- `index.html` — commissioner screen replaced with two-tab layout (Draw Management / Lock Managing); CSS added for `.comm-*`, `.drop-zone`, `.lock-*`, `.match-edit-row`

**Chat 3 built:**
- `src/leaderboard.js` — full implementation: `loadAllProfiles()`, `loadDrawStatsForAllUsers()`, `loadViewerPicks()`, `renderLeaderboard()`
  - Per-slam view: MS + WS sections, Score / Draw Acc / Match Acc / Draw Health columns, sortable
  - All-time view: Draws played / Avg score / Draw Acc / Match Acc per player
  - Viewer mode: clicking a player name loads their picks into the active draw and switches to bracket screen with viewer banner
  - Stats cache (`statsCache` Map keyed by drawDbId) invalidated on each `renderLeaderboard()` call
- `src/main.js` — wired `renderLeaderboard()` on all leaderboard nav links; viewer back button: clears `state.viewingUser`, calls `reloadActiveDraw()`, returns to leaderboard
- `index.html` — full `.lb-*` CSS: toolbar, toggle, table, sortable headers, player links, self-row highlight

**Chat 4 built:**
- `src/stats.js` — lock countdown pill appended after health pill; shows "picks lock in Xh/Xm" or "backup picks lock in Xh/Xm"; pulses accent color when affected picks are unfilled
- `src/bracket.js` — `placeCard()` adds `needs-backup-pick` class for cards in upcoming backup lock range with no pick/winner; `renderBracket()` renders informative empty state when no draws exist
- `src/main.js` — `setInterval` refreshes `renderStats()` every 60s when bracket screen is active (for countdown clock)
- `index.html` — Refresh button in bracket `#hdr-right`; CSS for `.needs-backup-pick`, `.countdown-urgent` pulse, `.bracket-empty`; mobile fixes (commissioner nav hidden ≤480px, stats-strip scrollable)

**Chat 5 built:**
- `index.html` — Updated slam accent colors to real brand colors (AO `#2d7ab8`, RG `#BD5627`, WIM `#275F3D`, USO `#071C63`). USO gets its own distinct bg/border tokens (blue-tinted). Leaderboard header title now uses `var(--text)` (neutral) instead of `var(--accent)` since leaderboard spans all slams.
- `src/leaderboard.js` — Full redesign: two-tab structure (Slams / Records). Slams tab: draws grouped by slam+year newest-first, M/W draw cards side-by-side, score+health only, fixed sort by score; clicking a card → draw detail view (full-width sortable 4-col table); clicking a player name → original-picks bracket viewer. Records tab: All-Time + per-calendar-year sections, 3 cards each (Avg Score, Match Accuracy, Top Brackets); avg score and match acc show drawsPlayed sample size per row; top brackets rows are clickable → original-picks bracket viewer. `lbDetailDraw` module var tracks draw detail navigation state. `assembleDrawForUserOriginalPicks()` reconstructs p1/p2 for ri 1+ from previous round's originalPick, saves actual tournament players as `m.actualP1`/`m.actualP2`.
- `src/bracket.js` — In original-picks viewer mode (`isViewerOrigPicks = isReadOnly && m.actualP1 !== undefined`): any predicted player whose `actualP` differs gets `s-orig-wrong` styling (crossed out red) regardless of pick status. For ri >= 1, `.mc-actual-top`/`.mc-actual-bot` labels (11px mono, absolutely positioned outside card bounds) show actual player when they differ from predicted — `.mc-actual-won` (text2, ✓ prefix) if they won the match, `.mc-actual-lost` (text3) if they lost. All `.mc` cards in viewer mode get `.mc-viewer` class; `.pr` pointer-events suppressed. Non-pick winner gets a small green ✓ icon.
- `index.html` — Dedicated `.viewer-hdr` replaces `.viewer-banner`. Shows player name (serif 17px) + draw context (mono 11px text3) + back button. `hdr-row1` and `hdr-row2` are hidden in viewer mode and restored on back. CSS for `.mc-actual-*`, `.mc-viewer`, `.viewer-hdr-*`.

**Chat 7 fixes (commissioner lock bugs):**
- `src/commissioner.js` — `getOrigPicksSchedule()`, `isMatchBackupLocked()`, `getMatchScheduledLock()` all now filter by `ls.draw_id === d.db_id`; fixes MS/WS draws bleeding lock state into each other
- `src/commissioner.js` — `handleBackupLock()` now deletes any existing overlapping lock_schedules rows (locked or scheduled) before inserting a new one; fixes schedule-vs-lock-now conflict
- `src/commissioner.js` — `renderLockBracket()` now checks feeder match winner before displaying player names on lock cards; slots with no confirmed winner show `—`; fixes mix of pick-projected vs actual players
- `src/commissioner.js` — `renderLockBracket()` inserts a horizontal divider between the top and bottom halves of each round column

**Chat 6 built:**
- `src/viewer-bracket.js` — new file; `renderViewerBracket(draw)` + `placeViewerCard()` — fully independent read-only renderer for `screen-viewer`; no live-bracket logic whatsoever
- `src/bracket.js` — stripped of all viewer logic (`isReadOnly`, `isViewerOrigPicks`, `actualP1/P2` labels, `mc-viewer` class, `predictedMissed`); now live-bracket only
- `src/leaderboard.js` — `openViewerOriginalPicks()` rewritten: assembles viewer draw without touching `state.draws`, calls `renderViewerBracket()`, switches to `screen-viewer`
- `src/main.js` — viewer back button simplified: just `showScreen('screen-leaderboard')` + `renderLeaderboard()`; no data restoration or header swapping
- `index.html` — `screen-viewer` fully fleshed out with its own header (`viewer-hdr-v`), round labels (`viewer-round-labels-inner`), and bracket body (`viewer-bracket-body`); old dead viewer-header elements removed from `screen-bracket`

**Chat 8 built:**
- `src/bracket.js` — removed ✓/✗ result confirmation buttons and score input from `placeCard()`; replaced with a per-user notes input (`.mc-notes`) shown on locked matches that have a pick; saves to `picks.notes` via `savePickToSupabase()`; removed `openWinnerPicker()` (dead code); removed `applyWinner`/`undoWinner` imports
- `src/picks.js` — `savePickToSupabase()` now includes `notes` field in upsert; removed the non-commissioner `else` path from `applyWinner()` and `undoWinner()` (players no longer call those)
- `src/data.js` — picks SELECT query now includes `notes`; `notes` field added to match assembly with default `''`; `emptyMatch()` includes `notes: ''`
- `src/main.js` — replaced api-sync toggle handler with a real refresh button: calls `reloadActiveDraw()` + `renderStats()` + `renderBracket()`; removed unused `supabase` import
- `src/state.js` — removed `apiSyncEnabled` field
- `index.html` — sync button label changed to "Refresh"; removed `.btn-sync-active`, `.sync-toast` CSS; replaced `.mc-footer`/`.mc-score`/`.mc-acts`/`.mc-btn` CSS with simplified `.mc-footer` + `.mc-notes`
- `migrations.sql` — added `notes text` to picks table definition; added migration comment at bottom

**Chat 9 built:**
- `migrations.sql` — documented DB migration: rename `pick`→`match_pick`, rename `result`→`original_pick_result`, add `match_pick_result` column; run in Supabase SQL editor
- `src/data.js` — SELECT query, match assembly, `emptyMatch()`, p1/p2 fallback chain all updated to new field names
- `src/picks.js` — `m.pick`→`m.matchPick` throughout all cascade functions; `savePickToSupabase()` uses new column names; `applyWinner()` sets `originalPickResult` and `matchPickResult` independently for every pick row; `undoWinner()` clears both result columns
- `src/scoring.js` — `isBackupPick()` uses `m.matchPick`; `calcStatsAsOf()` uses `m.originalPickResult` for scoring/draw accuracy and `m.matchPickResult` for backup pick accuracy
- `src/bracket.js` — `placeCard()` card styling and row styling use `m.originalPickResult`; `m.matchPick` used for live pick detection, notes footer trigger, backup glow, champion box
- `src/stats.js` — backup lock allFilled check uses `m.matchPick`
- `src/leaderboard.js` — `loadAllPicksForDraw()` SELECT and both assembly functions use new field names
- `src/viewer-bracket.js` — `placeViewerCard()` uses `m.originalPickResult` for card/row styling; champion box uses `m.matchPick`
- `src/print.js` — `nameLineHTML()` uses `m.matchPick`, `m.originalPickResult`; champion box uses `m.matchPick`
- `src/commissioner.js` — original picks lock snapshot now reads `match_pick` column and writes `original_pick` correctly

**Chat 10 built:**
- `src/picks.js` — `placePickAllRounds()` split into pre-lock (slot cascade) and post-lock (matchPick-only cascade); post-lock path cascades `matchPick` into future matches without touching `p1`/`p2` slots, passing through elim'd slots; `clearPickForward()` post-lock path only clears `matchPick`, stops when it no longer matches; `handlePickClick()` locked path now cascades + calls `saveCascadeToSupabase()` to persist all future affected matches; `markLoserForward()` also clears `matchPick` when the loser was a backup pick cascade; `saveCascadeToSupabase()` helper saves all future unconfirmed matches after a backup pick cascade
- `src/bracket.js` — `placeCard()` / `makeRow()`: elim slots (`p.elim === true`) now render the backup matchPick (purple) or empty instead of the eliminated player; eliminated player appears as floating label outside the card; `isBroken` path removed; correct backup picks get a `✓` checkmark (`pr-backup-ok-icon`); floating labels added for both case 1 (elim flag in slot) and case 2 (originalPick displaced by applyWinner in next round, determined via feeder match lookup); `findSeed` imported from picks.js
- `src/commissioner.js` — undo handler calls `reloadActiveDraw()` after `undoWinner` to restore backup pick cascade state from DB; imports `reloadActiveDraw` from data.js
- `index.html` — CSS for `.mc-orig-elim`, `.mc-orig-elim-top`, `.mc-orig-elim-bot` (floating displaced-pick labels: red, line-through, 9.5px mono, positioned ±13px outside card); `.pr-backup-ok-icon` (green ✓ for correct backup)

**Not yet built:**
- Push/email notifications (not planned for v1)
- Automated tests

**Known conventions established:**
- `state.draws[i].draw` = `'MS'` or `'WS'` (draw_type from DB)
- `state.draws[i].db_id` = Supabase `draws.id`
- `match.db_id` = Supabase `matches.id`
- `handlePickClick(ri, mi, p, { renderStats, renderBracket })` — callbacks passed in to avoid circular imports
- `applyWinner(d, ri, mi, winnerName, { renderStats, renderBracket })` — same pattern
- No localStorage anywhere — all state is Supabase or in-memory
- Slot occupancy / elim flags / displaced labels are DERIVED by `buildDrawView(d)` only (see Section 5). Renderers/handlers never reconstruct or mutate them directly. `buildDrawView` is idempotent — call it after any authoritative change, then render.
- Backup pick cascade (post-lock): `cascadeMatchPickForward` only sets `nm.matchPick` on future matches — never touches `p1`/`p2` (those are derived). Passes through elim'd slots, breaks at real confirmed players. Persisted via `saveCascadeToSupabase` (stored picks identical to pre-refactor — no DB change).
- Elim slots (`p.elim === true`, set by buildDrawView): floating label outside the card (`.mc-orig-elim-top`/`-bot`) comes from `m.elimLabels`; inside row shows backup matchPick (purple) or empty. No click handler on elim rows.
- Displaced originalPick label: computed in `buildDrawView` (formerly the bracket.js Case-1/Case-2 hack). Side resolved via feeder `originalPick` (`rounds[ri-1].matches[mi*2]` → top, `*2+1` → bot).
- `applyWinner`/`undoWinner`: set authoritative winner/result fields, then call `buildDrawView(d)` to re-derive advancers/elims/labels. No manual next-slot placement or markLoser/unmarkLoser anymore.
- `undoWinner`: commissioner still calls `reloadActiveDraw()` after undo so backup-pick cascades are re-derived from the authoritative stored picks.
- `renderLeaderboard()` clears `statsCache` on every call to ensure fresh data
- Viewer open is initiated inside `leaderboard.js` (`openViewer(prof, draw)`), not main.js
- Viewer close (back button) is in `main.js`: clears `state.viewingUser`, calls `reloadActiveDraw()`, calls `renderLeaderboard()`
- Leaderboard has three tabs: `slams`, `records`, `yourdraws` (tracked in `lbTab` module var); default is `slams`; tab order is Slams | Records | Your Draws
- `lbDetailDraw` in `leaderboard.js` — when set, renders draw detail view instead of tab content; cleared when user presses back or navigates away
- Slams tab draw cards: `.lb-row-card` grid is `1fr 72px 72px` (name + score + health)
- Draw detail table: `.lb-row-detail` grid is `1fr 72px 72px 72px 80px` (name + 4 stat cols)
- `SLAM_COLORS` in `leaderboard.js` maps slam keys to brand hex colors: AO `#2d7ab8`, RG `#BD5627`, WIM `#275F3D`, USO `#071C63`
- Draw cards use `--lb-slam-color` CSS custom property on `.lb-draw-card` for colored top border
- Records tab is neutral (no slam theme colors); leaderboard header uses `var(--text)` not `var(--accent)`
- `openViewerOriginalPicks(prof, draw)` — assembles a viewer draw via `assembleDrawForUserOriginalPicks()` (does NOT mutate `state.draws`), calls `renderViewerBracket(viewerDraw)`, switches to `screen-viewer`
- Viewer back button (`viewer-back-btn-v` on `screen-viewer`) calls `showScreen('screen-leaderboard')` + `renderLeaderboard()` — no data restoration needed
- `screen-viewer` has its own header (`viewer-hdr-v`), round labels (`viewer-round-labels-inner`), and bracket body (`viewer-bracket-body`) — all separate IDs from `screen-bracket`
- `bracket.js` / `placeCard()` contains zero viewer logic; `viewer-bracket.js` / `placeViewerCard()` contains zero live-bracket logic
- Bracket geometry is NOT duplicated: `bracket-layout.js` / `renderBracketLayout({ draw, body, labelsInner, placeCard, championName, emptyHTML })` is the single source. Live/viewer/results renderers pass their own `placeCard` callback (signature `(draw, match, ri, mi, x, y, wrap)`). Scroll-sync and empty-state markup stay with each caller.
- Commissioner screen is split (audit part E): `commissioner.js` (orchestrator + header + Draw Management), `commissioner-results.js` (Results tab), `commissioner-locks.js` (Lock Managing tab), `commissioner-shared.js` (`$c`/`escHtml`). `main.js` still imports only `initCommissioner` from `commissioner.js`. The Lock tab's drag-select `mouseup` listener is registered once at module load inside `commissioner-locks.js`.
- `state.viewingUser` is no longer used and can be removed in a future cleanup
- Lock countdown in `renderStats()` scans `state.lockSchedules` for nearest upcoming unlocked row; shows sub-hour as minutes; in pre-lock state also checks for `lock_type='original_picks'` row and appends countdown before the early return
- `needs-backup-pick` glow is suppressed in viewer mode (`isReadOnly`)
- Your Draws tab (`yourdraws`) shows only the logged-in user's own brackets; one card per slam+year with M and W buttons; button is disabled+greyed if user has no picks in that draw (checked via Supabase query); clicking opens `openViewerOriginalPicks` with `state.currentUser`
- Records tab year dividers: current calendar year shows "This Year" (`year === new Date().getFullYear()`), older years show the year number
- Original picks lock scheduling: commissioner can schedule via "Schedule…" button which opens the shared `lock-sched-modal`; inserts a `lock_schedules` row with `lock_type='original_picks'`; scheduled row is deleted when lock fires or is cancelled. `getOrigPicksSchedule(d)` returns the pending row. Modal title/subtitle are set dynamically via `id="lock-sched-title"` / `id="lock-sched-subtitle"` and reset on close via `resetModalTitles()`.
