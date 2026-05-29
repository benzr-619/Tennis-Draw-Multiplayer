# CLAUDE.md — Slam Bracket Multiplayer

Source of truth for this codebase. Read before touching any code.

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
| `screen-bracket` | Players + commissioner | Active draw view, pick-making |
| `screen-commissioner` | Commissioner only | Draw upload, player editing, lock managing |
| `screen-leaderboard` | Players + commissioner | Stats comparison across all players |
| `screen-viewer` | Players + commissioner | Read-only view of another player's bracket (accessed from leaderboard) |

Navigation: after login → `screen-bracket` for most recent active slam (or most recent if none active). Slam dropdown + M/W segmented control on the header (same pattern as reference app) for switching draws. Leaderboard and commissioner accessible via header nav links.

---

## 4. Module Map

```
src/
  main.js          — DOMContentLoaded, init, screen wiring
  supabase.js      — Supabase client init (reads env vars)
  auth.js          — login, signup, logout, session management
  state.js         — local state cache, activeDraw(), applyTheme()
  bracket.js       — renderBracket(), placeCard(), SVG connectors (ported)
  picks.js         — handlePickClick(), placePickAllRounds(), clearPickForward() (ported)
  scoring.js       — calcMatchScore(), calcStats(), calcChalkScore() (ported)
  stats.js         — renderStats(), stats bar pills (ported)
  lock.js          — lock/unlock logic, applyWinner(), undoWinner() (ported)
  commissioner.js  — draw upload/parse, player editing, result confirmation, lock scheduling
  leaderboard.js   — renderLeaderboard(), stats aggregation
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

Additional fields vs. reference:
```js
Match {
  // all reference fields, plus:
  db_id: string  // Supabase matches.id — needed for pick upserts
}

Pick {           // per-user per-match, fetched separately
  match_id: string,
  pick: string | null,
  original_pick: string | null,
  result: 'correct' | 'wrong' | null,
  high_confidence: boolean,
  edited_after_lock: boolean
}
```

### Supabase schema

See `migrations.sql` for full table definitions. Summary:

- `profiles` — extends `auth.users`; adds `display_name`, `is_commissioner`
- `draws` — one row per slam+draw_type+year
- `matches` — 127 rows per draw (rounds 0–6); shared across all users; winner/score set by commissioner
- `picks` — one row per user×match; upserted on every pick change
- `lock_schedules` — commissioner-defined lock windows; `locked_at` set when manually triggered

### Key Supabase access patterns

- **Load a draw:** fetch `draws` row → fetch all `matches` for that draw → fetch all `picks` for current user + that draw → assemble into local state
- **Save a pick:** upsert into `picks` (user_id, match_id, pick, high_confidence, edited_after_lock)
- **Confirm result (player):** each player confirms their own match results using ✓/✗ buttons on their bracket, identical to the single-player app. `picks.result` is written by the player for their own picks. Honor system for backup picks.
- **Lock original picks:** update `draws.original_picks_locked` = true; snapshot `picks.original_pick = picks.pick` for all users in that draw
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

**Pre-lock:** picks cascade forward via `placePickAllRounds()`. Changing a pick clears the old one forward via `clearPickForward()`.

**Post-lock (normal):** picks are backup — no cascade, purple styling. Only available when the match has no result yet.

**Post-lock (`edited_after_lock: true`):** withdrawal repick — cascades like pre-lock, re-snapshots `original_pick`, clears `edited_after_lock`.

`original_pick` is sacred post-lock. Never mutate it except via withdrawal flow.

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

Tabs or sections:
1. **Draw management** — upload PDF → parse → review/edit R1 matches → confirm draw (replaces existing if same slam+draw+year)
2. **Player editing** — edit any player name/seed post-upload (same modal as reference app)
3. **Lock managing** — visual bracket-style view of the draw where the commissioner selects which match cards to lock or unlock. Two levels of control:
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

**Viewer mode.** When `state.viewingUser` is set (not null), bracket renders in read-only mode: no pick clicks, no ✓/✗ buttons, no edit buttons. A banner shows whose bracket you're viewing with a back button that clears `state.viewingUser` and returns to the leaderboard.

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
- `src/main.js` — API sync toggle wired (shows toast "not yet connected", resets to off); `setInterval` refreshes `renderStats()` every 60s when bracket screen is active
- `src/state.js` — `apiSyncEnabled: false` field added
- `index.html` — API sync button in bracket `#hdr-right`; CSS for `.needs-backup-pick`, `.countdown-urgent` pulse, `.btn-sync-active`, `.bracket-empty`, `.sync-toast`; mobile fixes (commissioner nav hidden ≤480px, stats-strip scrollable)

**Not yet built:**
- Push/email notifications (not planned for v1)
- Automated tests
- Real API sync integration (toggle placeholder exists)

**Known conventions established:**
- `state.draws[i].draw` = `'MS'` or `'WS'` (draw_type from DB)
- `state.draws[i].db_id` = Supabase `draws.id`
- `match.db_id` = Supabase `matches.id`
- `handlePickClick(ri, mi, p, { renderStats, renderBracket })` — callbacks passed in to avoid circular imports
- `applyWinner(d, ri, mi, winnerName, { renderStats, renderBracket })` — same pattern
- No localStorage anywhere — all state is Supabase or in-memory
- `renderLeaderboard()` clears `statsCache` on every call to ensure fresh data
- Viewer open is initiated inside `leaderboard.js` (`openViewer(prof, draw)`), not main.js
- Viewer close (back button) is in `main.js`: clears `state.viewingUser`, calls `reloadActiveDraw()`, calls `renderLeaderboard()`
- `lb-row` grid is `1fr 90px 90px 90px 100px` (5 columns) — applies to both slam and all-time tables
- `state.apiSyncEnabled` — in-memory only, not persisted; API sync toggle resets to off on click (no real integration yet)
- Lock countdown in `renderStats()` scans `state.lockSchedules` for nearest upcoming unlocked row; shows sub-hour as minutes
- `needs-backup-pick` glow is suppressed in viewer mode (`isReadOnly`)
