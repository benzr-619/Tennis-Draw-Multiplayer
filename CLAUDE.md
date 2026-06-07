# CLAUDE.md — Slam Bracket Multiplayer

Source of truth for this codebase. Describes **how the code works now**. Read before touching any code.

History (refactor steps, per-chat build logs, fixed-bug narratives) lives in `CHANGELOG.md` — not loaded each session; consult it only when you need the *why* behind a past change.

**Maintenance rule:** this file describes only *how the code works now*. When a chat changes something, append the dated narrative ("what we did and why") to `CHANGELOG.md`, and update the relevant reference section here only if the *current behavior* changed. Never paste per-chat build logs or fixed-bug stories into this file — that is what regrew the clutter before.

---

## 0. Repo Hygiene

- `.gitignore` covers `node_modules/`, `dist/`, `.env.local`, `*.timestamp-*.mjs`, `_archive/`, `.DS_Store`. These are never committed. `node_modules/`, `dist/`, `.env.local` are untracked (working copies on disk only).
- **Do NOT read** `reference/index.html`, `_archive/`, `dist/`, `node_modules/`, or any `*.sql` data dump unless explicitly told to — they are archives, not working code.
- The Supabase key shipped in `.env.local` is a new-style **publishable** key (`sb_publishable_…`), stored in `VITE_SUPABASE_ANON_KEY` (var name kept so `supabase.js` is unchanged). Publishable keys ship to browsers by design — **RLS, not key secrecy, is the security boundary.**
- **REMAINING BEN ACTION:** in the Supabase dashboard, disable the legacy `anon` key (kills the one still in git history) and confirm RLS is enabled on all tables (`profiles`, `draws`, `matches`, `picks`, `lock_schedules`). Optional: "Migrate JWT secret" for asymmetric signing.
- **Regression harness:** `test-harness/` drives the REAL `picks.js` + `data.js` + `bracket.js placeCard` in Node (Supabase + DOM stubbed) and snapshots state + render-facts to `GOLDEN.frozen.txt`. Run before/after any bracket-state change: `cd test-harness && node --import ./register.mjs ./harness.mjs`, then diff against the golden.

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
| `screen-commissioner` | Commissioner only | Draw upload, player editing, lock managing, result confirmation |
| `screen-leaderboard` | Players only | Stats comparison across all players |
| `screen-viewer` | Players only | Read-only original-picks viewer — completely separate from screen-bracket; navigated to from leaderboard |

Navigation: after login → **everyone** (including the commissioner) lands on `screen-bracket` for the current live slam and uses the normal player UI. The commissioner role is a *capability layered on top of a normal player account* — a commissioner-capable user also makes picks and appears on the leaderboard. `routeAfterAuth()` reveals the `.commish-nav` account-menu entries (`#commish-btn` on bracket, `#commish-btn-lb` on leaderboard, hidden by default) when `state.currentUser.is_commissioner`. Clicking one runs `enterCommissioner()` → `initCommissioner()` (idempotent) + `showScreen('screen-commissioner')`. The commissioner header's account menu has a `#exit-commish-btn` ("Back to draw") that returns to `showBracketScreen()`. **Cmd/Ctrl+E** toggles between the two views (commissioner-capable users only): on `screen-commissioner` it returns to the draw, otherwise it enters commissioner. Wired as a global keydown in main.js; gated on `is_commissioner`. There is no longer a commissioner-only account that cannot play. Commissioner *write* powers remain gated by `is_commissioner` checks (§6); only the routing changed. No slam dropdown anywhere — there is exactly one live slam at a time; the header shows the slam name as static text (e.g. "Roland Garros 2026"). Between slams, the most recently active slam stays visible (no empty state needed). Past slams are accessible only via leaderboard → Your Draws tab.

**Header navigation grammar.** Two distinct visual voices: (1) **page-level tabs** (`.hdr-nav-link`: DM Sans 14px, accent underline when active) for switching screens — Draw / Leaderboard; (2) **in-page view-switch segments** (rounded `var(--surface2)` track, active pill = `var(--surface)` bg + accent text, labels in uppercase DM Mono 11px) for the M/W toggle (`.seg-btn`) and the leaderboard Slams/Records/Your Draws tabs (`.lb-tab`), which share identical styling. Rule: page navigation = Sans underline tabs; view-switching within a page = uppercase Mono segments (matching the stats-label voice).

**Sliding-thumb animation.** All three segmented controls (player M/W, commissioner M/W, leaderboard tabs) use an absolutely-positioned `.seg-thumb` div injected by `animateSegThumb()` (`src/seg-thumb.js`). The thumb glides between options via a CSS `left`/`width` transition (0.22s ease). The container has `position:relative`; buttons have `position:relative;z-index:1` so text sits above the thumb (`z-index:0`). Module variables `_segPrevIdx` (main.js), `_commSegPrevIdx` (commissioner.js), and `_lbTabPrevIdx` (leaderboard.js) track the previous index so the thumb starts at the old position each rebuild. On first render (prev = −1) the thumb is placed directly at the new position with no animation.

**Player header layout (bracket + leaderboard screens).** Row 1 left = slam name → nav tabs (`.hdr-nav` with `#nav-bracket` "Draw" / `#nav-leaderboard` "Leaderboard"). Row 1 center = search (bracket only for now — leaderboard search is a planned user-search feature, not yet built). Row 1 right = borderless refresh `.icon-btn` + `.acct-chip` whose dropdown (`.acct-menu`) holds Print (`#print-btn` on bracket only; **not** on leaderboard) and Sign out (`.acct-mi-danger`). The **M/W segmented control lives in row 2** inside `.row2-seg`, left of the stats strip (`.stats-strip` is `flex:1`).

**Commissioner header layout (screen-commissioner).** Mirrors the player header grammar. Row 1 left = slam name (`#comm-slam-name`) → three `.hdr-nav-link` underline tabs inside `#comm-hdr-nav` ("Draw Management" / "Results" / "Lock Managing"; `data-tab` attribute drives pane switching). Row 1 center = search bar (always visible; cross-tab search navigation is a future feature). Row 1 right = borderless refresh `.icon-btn` (`#api-sync-btn-cmsr`) + `.acct-chip` (`#acct-chip-cmsr`) whose dropdown (`#acct-menu-cmsr`) holds Sign out only. **Row 2** = `.hdr-row2` with M/W `.seg-btn` toggle (`#comm-seg-control`) with `animateSegThumb` animation (`_commSegPrevIdx` in commissioner.js). No stats strip in commissioner row 2. All helpers (`wireAcctMenu`, `closeAcctMenus`, `doRefresh`) are shared from `main.js`; `renderResults`/`renderLockManaging` imported into main.js for the refresh callback.

Leaderboard header mirrors the bracket header (slam title + nav + refresh + account dropdown; **no Print**). Its three tabs (Slams/Records/Your Draws) render inside `.lb-tabseg`. `renderHeader` sets both slam-name labels and both `hdr-user*` names. **Planned (separate build): leaderboard user-search** — searches users on Slams/Records to jump to a person's row, hidden on Your Draws.

---

## 4. Module Map

```
src/
  main.js          — DOMContentLoaded, init, screen wiring
  supabase.js      — Supabase client init (reads env vars)
  auth.js          — login, signup, logout, session management
  state.js         — local state cache, activeDraw(), applyTheme()
  bracket-layout.js — renderBracketLayout(): SHARED bracket geometry (card positions, connectors, separators, section/round labels, champion box). Knows nothing about pick state/colors/clicks. Used by bracket.js, viewer-bracket.js, commissioner-results.js.
  draw-view.js     — buildDrawView(): SINGLE pure, idempotent derivation of round-2+ slot occupants, elim flags, and displaced-pick labels (m.elimLabels) from authoritative fields. The only place slot/elim/label state is computed.
  bracket.js       — renderBracket() (calls renderBracketLayout), placeCard() — live bracket card painting only; paints m.elimLabels, no derivation
  picks.js         — handlePickClick() (with showPickConfirm modal + unlock-next-round cascade), applyWinner()/undoWinner() (call buildDrawView), cascadeMatchPickForward()/clearMatchPickForward() (raw matchPick writers), withdrawalClearForward()/updatePlayerNameForward()
  scoring.js       — calcMatchScore(), calcStats(), calcChalkScore(), calcHealthPts() (ported)
  stats.js         — renderStats(), stats bar pills (ported)
  lock.js          — lock/unlock logic, applyWinner(), undoWinner() (ported)
  commissioner.js          — orchestrator + Draw Management tab (upload/parse/confirm) + commissioner header; re-exports renderResults/renderLockManaging
  commissioner-shared.js   — $c(), escHtml() shared by the commissioner modules
  commissioner-results.js  — Results tab: renderResults(), winner confirm/undo, results search
  commissioner-locks.js    — Lock Managing tab ORCHESTRATOR: renderLockManaging() (tab shell + wiring) + shared setLockOrigMsg/setLockBackupMsg/resetModalTitles helpers
  commissioner-locks-orig.js   — Original Picks lock: controls, lock-now/schedule/cancel/unlock handlers
  commissioner-locks-backup.js — Backup Pick locks: bracket card selector (drag-select), schedule/lock-now modal, insert/unlock, + Scheduled Locks list (cancel/reschedule)
  leaderboard.js   — renderLeaderboard(), stats aggregation
  viewer-bracket.js — renderViewerBracket() (calls renderBracketLayout), placeViewerCard() — read-only card painting for screen-viewer; no live-bracket logic
  print.js         — buildPrintHTML() (ported verbatim)
  parser.js        — extractPdfText(), parseTnnsText(), buildInitialRounds() (ported)
  seg-thumb.js     — animateSegThumb(container, oldIdx, newIdx): shared sliding-pill helper for .seg-control and .lb-tabseg
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

**Authoritative (raw) vs. derived state.** Each match carries only a small set of *authoritative* fields that come straight from the DB and are the source of truth: round-0 `p1`/`p2` (the actual draw), `winner`/`score`, and per-user `matchPick`, `originalPick`, `originalPickResult`, `matchPickResult`, `highConfidence`, `editedAfterLock`, `notes`. **Everything else is DERIVED** by `buildDrawView(d)` in `src/draw-view.js`: the `p1`/`p2` occupants for rounds 2+, each slot's `elim` flag, and the `m.elimLabels` array (displaced eliminated-pick labels). `buildDrawView` is the ONE place this derivation happens; it is pure and idempotent (round-2+ slots are rebuilt from scratch every call). Renderers, scoring, and stats consume the derived fields and contain zero derivation logic. **Never reconstruct slots or replay eliminations anywhere else — call `buildDrawView` after any authoritative change.**

`buildDrawView` step order: (1) build round-2+ slots from feeders via `winner || originalPick || matchPick` (actual advancer first, then the user's projected pick); (2) build one `eliminated` Set = losers of every decided match; (3) flag `elim` on every still-undecided slot whose occupant is in the set, and null any dead backup `matchPick` pointing at an eliminated player; (4) emit displaced-pick labels (`m.elimLabels`), side resolved from the feeders' `originalPick`.

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
- `draws` — one row per slam+draw_type+year; `is_active boolean` flags the current live slam. Only one slam (both its MS+WS draws) is active at a time. Confirming a new slam auto-sets `is_active = false` on all existing draws and `is_active = true` on the new ones.
- `matches` — 127 rows per draw (rounds 0–6); shared across all users; winner/score set by commissioner
- `picks` — one row per user×match; upserted on every pick change
- `lock_schedules` — commissioner-defined lock windows; `locked_at` set when fired

### Key Supabase access patterns

- **Load a draw:** fetch `draws` row → fetch all `matches` for that draw → fetch all `picks` for current user + that draw → assemble into local state
- **Save a pick:** upsert into `picks` (user_id, match_id, match_pick, original_pick, original_pick_result, match_pick_result, high_confidence, edited_after_lock, notes)
- **Confirm result (commissioner):** `applyWinner()` sets both `original_pick_result` and `match_pick_result` independently for every pick row on that match. One winner click → two comparisons → two result columns.
- **Lock original picks:** update `draws.original_picks_locked` = true; snapshot `picks.original_pick = picks.match_pick` for all users in that draw
- **Lock backup picks (per schedule):** update `lock_schedules.locked_at`

---

## 6. Auth & Roles

- Supabase email/password auth. Display name captured at signup and stored in `profiles.display_name`.
- `profiles.is_commissioner = true` on exactly one account (set manually in Supabase dashboard).
- After login, fetch `profiles` row for current user to determine role. Store in `state.currentUser`.
- Commissioner-only UI (upload button, confirm result buttons, lock controls) rendered conditionally based on `state.currentUser.is_commissioner`.
- No forgot-password UI — commissioner handles via Supabase dashboard.

---

## 7. Pick Semantics

**Pre-lock:** a click just records `matchPick` on that match; the candidate slots for later rounds are derived. Changing a pick clears any now-orphaned forward `matchPick` via `clearMatchPickForward()`; slots re-derive automatically.

**Post-lock (normal):** picks are backup — purple styling, no slot change. The active backup is propagated forward through eliminated slots via `cascadeMatchPickForward()` and persisted (`saveCascadeToSupabase` — keeps stored picks identical to old behavior). Only available when the match has no result yet.

**Post-lock (`edited_after_lock: true`) — draw-change repick:** when the commissioner replaces a player after lock, only the edited match is flagged (`editedAfterLock = true`, `originalPick = null`, `matchPick = null`). Future rounds are NOT touched; their picks stand as original picks.

When the player clicks a row on a flagged match a **confirmation modal** (`#pick-confirm-modal`) appears: "Set [Name] as your original pick?" Cancelling leaves `editedAfterLock = true` so they can pick differently. On confirm: `matchPick = originalPick = p.name`, `editedAfterLock = false`. No `cascadeMatchPickForward` — future slots derive from `originalPick` via `buildDrawView`.

After confirming, the code checks the next round's slot occupant. If it changed, that next match also gets `originalPick = null`, `editedAfterLock = true`, and its pick row is saved to DB. The player then sees that next match flagged, and the cycle repeats when they click it.

If a player never repicks a flagged match: it scores zero for that round and has no `originalPick`, but all forward matches retain their existing `originalPick` values.

`original_pick` is sacred post-lock. Never mutate it except via the draw-change repick flow above.

After any authoritative change, handlers call `buildDrawView(d)` then render.

---

## 8. Lock Architecture

Locks are per-draw or per-match-range, commissioner-controlled. **Mental model: scheduling = committing.** Commissioner schedules → one confirmation in the UI → done. No confirm dialog at fire time. Unlocking is a rare/testing operation.

- **Original picks lock:** global per draw. Commissioner schedules a datetime (`lock-sched-modal` → inserts a `lock_schedules` row with `lock_type='original_picks'`) or clicks "Lock now" (`_doLockOriginalPicks(d)` directly client-side). `getOrigPicksSchedule(d)` returns the pending row.
- **Backup pick locks:** per `lock_schedules` row. Each row covers a `(round_index, match_index_start, match_index_end)` range with `lock_type = 'backup_picks'`. Commissioner selects match cards, then schedules (`scheduled_at` set, `locked_at` null) or locks immediately ("Lock now" writes `locked_at = now`). Unlock: scheduled rows are deleted entirely; already-locked rows get `locked_at = null`.
- Lock state is read from Supabase on draw load. Match cards check their round/index against active lock schedules to determine if picks are still allowed.
- **SQL function + pg_cron:** Lock firing runs entirely in the database — no Edge Function, no HTTP calls. A `fire_scheduled_locks()` PL/pgSQL function handles both lock types: for `original_picks` it snapshots `match_pick → original_pick` for all picks in the draw, sets `draws.original_picks_locked = true`, and deletes the schedule row; for `backup_picks` it sets `locked_at = now()`. Scheduled every minute via `cron.schedule('fire-scheduled-locks', '* * * * *', 'select fire_scheduled_locks()')`. pg_cron and pg_net extensions must be enabled in Supabase Dashboard → Database → Extensions.

---

## 9. Scoring

`ROUND_CONFIG[ri].base` → `[1, 2, 3, 6, 10, 18, 32]` for ri 0–6. Upset bonus = `numericSeed(winner) - numericSeed(loser)`, floored at 0. Unseeded/Q/WC/LL/PR = seed 33. Unseeded vs. unseeded = 0.5 flat. Only correct original picks score; backup picks track accuracy only.

**Draw Health** answers "how intact is my draw?" — the share of my bracket's full point value still in play. Denominator (`maxHealthPts`) = base points of ALL my original picks, constant across rounds (the bracket's theoretical max). Numerator (`reachableHealthPts`) = base points of original picks still *reachable*: already confirmed correct, OR the picked player still occupies its projected slot and isn't flagged `elim`. Reachability is read off `buildDrawView`'s slot/`elim` flags — the single source of truth — never a parallel elimination list. The round picker **rewinds** health like score/draw-accuracy: `calcHealthPts(d, filterRi)` clones the draw, nulls any `winner` confirmed in rounds *after* `filterRi`, re-runs `buildDrawView`, and reads the flags. When `filterRi` covers every confirmed result, this equals the live ("All Results") number exactly.

No chalk comparison on the leaderboard — only Score, Draw Accuracy, Match Accuracy, Draw Health per player.

---

## 10. Leaderboard Stats

**Per-slam view:** Score, Draw Accuracy %, Match Accuracy %, Draw Health % for each player. Separate rows for MS and WS draws. Sortable by any column.

**Year-to-date / all-time view:** Average score per draw, overall Draw Accuracy %, overall Match Accuracy % across all draws in the sample. Count of draws in sample shown per player. Not split by MS/WS.

---

## 11. Lock Countdown & Backup Pick Highlighting

When a lock is upcoming and not yet triggered:
- Stats bar right end: countdown clock to next lock (e.g. "picks lock in 14h"); sub-hour shows minutes
- Match cards without an active pick that fall within the upcoming lock's match range glow purple (same purple as backup pick styling)
- Countdown label is highlighted (accent color or pulse) until all affected picks are filled

Applies to both original pick locks (pre-tournament) and backup pick locks (mid-tournament). Suppressed in viewer mode.

---

## 12. Commissioner Screen

The commissioner screen holds the commissioner-only tools. It is reached from the player UI via the account-menu "Commissioner" entry and exited via "Back to draw" (see §3) — a commissioner is also a normal player and uses the bracket, leaderboard, and viewer like everyone else. The M/W switcher and static slam name live in the commissioner header exactly as they do in the player header.

1. **Draw management** — upload PDF → parse → review/edit R1 matches → confirm draw (replaces existing if same slam+draw+year; auto-deactivates previous slam)
2. **Player editing** — edit any player name/seed post-upload (same modal as reference app)
3. **Results** — match-by-match result confirmation. Matches grouped by round; each shows the two actual player names + a winner button. No pick colors, no scoring UI. Commissioner clicks winner; `applyWinner()` fires. Undo available on confirmed matches. **A future-round slot shows a player ONLY when its feeder match has a confirmed winner** — never a projected pick. `_resultOccupant()` (commissioner-results.js) reads the feeder's `winner` directly instead of the `buildDrawView`-derived `m.p1`/`m.p2` (which fill from `winner || originalPick || matchPick` and would otherwise leak the commissioner's own predictions into empty slots, and let a winner be confirmed on a predicted matchup). Round 0 always shows the real draw.
4. **Lock managing** — visual bracket-style view; commissioner selects match cards to lock/unlock. Original picks lock (single toggle, schedule or immediate) + backup pick locks (select cards, schedule or "Lock now", cancel/reschedule individually). See §8.

---

## 13. Rules & Conventions

**No localStorage.** All persistence goes through Supabase. No autosave fallback.

**State mutation protocol.** After any state change: call `savePickToSupabase()` (async), then `renderStats()`, then `renderBracket()` — in that order. Await the save before rendering to avoid stale UI on error.

**`$()` shorthand.** `function $(id){return document.getElementById(id)}`. Never redefine or shadow it.

**CSS variables for colors.** All colors use `var(--token)`. Slam theme tokens overridden per-slam on `body.theme-AO` etc. Same token names as reference — port the full `:root` block verbatim.

**Typography contract.** Playfair Display for player names/headings. DM Mono for seeds/labels/stats. DM Sans for body/buttons/chrome. Do not substitute.

**`renderBracket()` is destructive.** Clears and rebuilds from scratch. Never cache DOM references to bracket cards across renders.

**Shared geometry, separate painting.** Bracket *geometry* (positions, connectors, labels, champion box) lives once in `bracket-layout.js` / `renderBracketLayout({ draw, body, labelsInner, placeCard, championName, emptyHTML })` and is shared by the live bracket, the viewer, and commissioner results. Each renderer owns its own `placeCard`/`placeViewerCard`/`_placeResultCard` callback (signature `(draw, match, ri, mi, x, y, wrap)`) for card *painting* only. Never duplicate geometry; never share card-painting/state logic between live and viewer. `bracket.js`/`placeCard()` has zero viewer logic; `viewer-bracket.js`/`placeViewerCard()` has zero live-bracket logic.

**Viewer mode.** `screen-viewer` is completely separate from `screen-bracket`, with its own header (`viewer-hdr-v`), round labels (`viewer-round-labels-inner`), and body (`viewer-bracket-body`). `renderViewerBracket(draw)` handles all viewer rendering. The viewer assembles its own draw via `assembleDrawForUserOriginalPicks()` and does NOT write into `state.draws`, so returning requires no data restoration — back button (`viewer-back-btn-v`) just calls `showScreen('screen-leaderboard')` + `renderLeaderboard()`.

**Commissioner-only UI.** Wrap all commissioner controls in `if (state.currentUser?.is_commissioner)` checks. Never rely on UI hiding alone — check role before any write operation.

**Defensive defaults.** When assembling draw data from Supabase, apply defaults for nullable fields (e.g. `pick ?? null`, `edited_after_lock ?? false`) in the assembly function, not scattered through render code.

**Print is standalone.** `buildPrintHTML()` is ported verbatim from reference. It must not reference Supabase or any async data — receive the assembled `Draw` object as argument.

### Convention quick-reference

- `state.draws[i].draw` = `'MS'` or `'WS'`; `state.draws[i].db_id` = Supabase `draws.id`; `match.db_id` = Supabase `matches.id`
- `handlePickClick(ri, mi, p, { renderStats, renderBracket })` and `applyWinner(d, ri, mi, winnerName, { renderStats, renderBracket })` — callbacks passed in to avoid circular imports
- **Slot occupancy / elim flags / displaced labels are DERIVED by `buildDrawView(d)` only** (§5). Renderers/handlers never reconstruct or mutate them. Call `buildDrawView` after any authoritative change, then render.
- Backup pick cascade (post-lock): `cascadeMatchPickForward` only sets `nm.matchPick` on future matches — never touches `p1`/`p2`. Passes through elim'd slots, breaks at real confirmed players. Persisted via `saveCascadeToSupabase` (stored picks identical to pre-refactor — no DB change).
- Elim slots (`p.elim === true`): the eliminated original pick stays INSIDE the card, painted red + crossed-out (`pr s-orig-wrong`), with NO floating label — until a confirmed winner from the feeder displaces it. No click handler on elim rows.
- Displaced originalPick label (floating `.mc-orig-elim-top`/`-bot`, 11px to match `.pr-name`): emitted by `buildDrawView` ONLY for Case 2 — a real confirmed winner now occupies the slot and pushes the original pick out. Case 1 (slot still merely projects the eliminated pick, no winner) emits NO label; the name renders in-slot. Side resolved via feeder `originalPick` (`rounds[ri-1].matches[mi*2]` → top, `*2+1` → bot).
- `applyWinner`/`undoWinner`: set authoritative winner/result fields, then call `buildDrawView(d)`. No manual next-slot placement. `undoWinner`: commissioner calls `reloadActiveDraw()` after undo so backup-pick cascades re-derive from stored picks.
- Draw-change repick (post-lock edit): `confirmEditPlayer` only touches the edited match's own pick row; `withdrawalClearForward` is NOT called. Forward rounds untouched until the player confirms a new pick, which propagates `editedAfterLock = true` one round at a time.
- `#pick-confirm-modal` / `showPickConfirm(playerName)` (picks.js): returns `Promise<bool>`; used only in the `isWithdrawalRepick` path of `handlePickClick`. `#pcm-name` receives the player name.
- Lock checks are **draw-scoped everywhere**. `isMatchLocked()` (lock.js, used by the player bracket + `bracket.js`) filters `ls.draw_id === activeDraw().db_id`, matching its commissioner twin. A lock on one draw (e.g. the other M/W draw or a past slam) must never block picks on another — without this filter a stray locked row blocks players globally while the draw-scoped commissioner page shows nothing.
- Commissioner-locks draw-scoping: `getOrigPicksSchedule()`, `isMatchBackupLocked()`, `getMatchScheduledLock()` all filter by `ls.draw_id === d.db_id`. `handleBackupLock()` deletes overlapping rows before inserting. `renderLockBracket()` shows `—` for slots with no confirmed feeder winner.
- Lock countdown in `renderStats()` scans `state.lockSchedules` for the nearest upcoming unlocked row **for the active draw** (`ls.draw_id === d.db_id`); pre-lock state also checks for an `original_picks` row and appends its countdown before the early return.
- Leaderboard: `renderLeaderboard()` clears `statsCache` each call. Three tabs (`slams`, `records`, `yourdraws`, tracked in `lbTab`; default `slams`). `lbDetailDraw` set → renders draw detail view instead of tab content. Slams cards grid `1fr 72px 72px`; detail table grid `1fr 72px 72px 72px 80px`. `SLAM_COLORS`: AO `#2d7ab8`, RG `#BD5627`, WIM `#275F3D`, USO `#071C63`; applied via `--lb-slam-color`. Records tab is neutral (no slam colors); header uses `var(--text)`.
- `openViewerOriginalPicks(prof, draw)` (in leaderboard.js) assembles a viewer draw via `assembleDrawForUserOriginalPicks()` (does NOT mutate `state.draws`), calls `renderViewerBracket()`, switches to `screen-viewer`.
- **`buildDrawView(d, { projectFromPick: true })` — VIEWER ONLY.** Default mode is unchanged (winner-first slots; eliminations read off the slots). In `projectFromPick` mode the round-2+ slots fill from `originalPick || matchPick || winner` (pick-first, so the friend's projected bracket shows through instead of the real winner), the eliminated-players set is built from the REAL results via each match's `actualP1`/`actualP2` (slots hold picks, not real players, so losers can't be read off them), and the displaced-label (`elimLabels`) pass is skipped (the viewer floats the actual occupant instead). Only `assembleDrawForUserOriginalPicks` passes this flag. Default callers are byte-identical (regression golden unchanged).
- **Viewer card painting (`placeViewerCard`) inverts the live draw's float.** The card always shows the viewed friend's *original pick*, color-coded for right/wrong/still-possible: `s-orig-ok` green (correct), `s-orig-wrong` red+crossed (wrong, OR the pick depends on someone already eliminated — `predictedMissed`, which is true when the real occupant differs OR the picked player carries `p.elim` from the projectFromPick pass, so future-round dead picks go red instead of staying blue), `s-orig` blue (picked, still undecided). The actual player who really reached each slot (the feeder's true winner, `m.actualP1/actualP2` from `assembleDrawForUserOriginalPicks`) floats *outside* the card via `.mc-actual-top`/`-bot` — but ONLY when it differs from the friend's predicted occupant (i.e. the friend was wrong about that slot) and the slot is decided. This float is **neutral** (`var(--text3)`, no ✓, no won/lost split) — purely a historical record of what happened; green/red is reserved for the pick. Contrast the live bracket, where the *displaced eliminated pick* (`.mc-orig-elim`) floats red+crossed and the real winner sits in-slot. No in-card checkmarks in the viewer.
- Your Draws tab shows only the logged-in user's brackets; one card per slam+year with M/W buttons; button disabled+greyed if the user has no picks in that draw; clicking opens `openViewerOriginalPicks` with `state.currentUser`.
- Records year dividers: current calendar year shows "This Year", older years show the number.
- `state.viewingUser` is no longer used and can be removed in a future cleanup.

---

## 14. Feature Status

**Built and working:** foundation, commissioner screen, leaderboard, polish, viewer, lock architecture (incl. scheduled-locks list), post-lock backup-pick cascade, the `buildDrawView` derived-state model. Per-chat detail is in `CHANGELOG.md`.

**Not yet built:**
- Push/email notifications (not planned for v1)
- Automated tests (a throwaway `test-harness/` golden exists; see §0)
