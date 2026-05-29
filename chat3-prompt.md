# Chat 3 — Leaderboard

## Context

Foundation (Chat 1) and Commissioner screen (Chat 2) are built. Read `CLAUDE.md` in full before touching any code.

See `chat2-prompt.md` for the full module map and state shape — those are prerequisites for this chat.

---

## What to build in Chat 3

### 1. Leaderboard screen (`screen-leaderboard`)

The div exists in `index.html` with a `.lb-placeholder`. Replace with the full leaderboard.

**Per-slam view:**
- Toggle/tabs: per active slam (respects slam dropdown selection) vs. All-time
- Per-slam rows: one row per player, columns: Score, Draw Accuracy %, Match Accuracy %, Draw Health %
- MS and WS shown as separate sections (or toggle) within the per-slam view
- Sortable columns (click header to sort asc/desc)
- Clicking a player name opens their bracket in read-only viewer mode (see section 3)

**All-time / YTD view:**
- Rows: one per player
- Columns: Draws played, Avg score/draw, Draw Accuracy %, Match Accuracy %
- Not split by MS/WS

**Data loading:**
- Fetch all users from `profiles`
- For each user, fetch their `picks` for the relevant draws
- Assemble stats using `calcStats(d)` — but applied to each user's draw (need to build a Draw object per user per draw)
- Reuse `calcStatsAsOf()` from `src/scoring.js`

**Key insight:** To render stats for another user, you need to assemble their draw (same match data, but their picks). Write a `loadDrawForUser(drawRow, userId)` function (similar to `loadDraw()` in `data.js` but with a different userId).

---

### 2. Leaderboard data module (`src/leaderboard.js`)

Replace the stub. Key functions:

```js
// Fetch all profiles
export async function loadAllProfiles()

// Load stats for all users on a specific draw
export async function loadDrawStatsForAllUsers(drawDbId)

// Returns { userId: { score, drawAcc, matchAcc, drawHealth } }

// Render the leaderboard into #screen-leaderboard
export function renderLeaderboard()
```

Cache profiles in module-level state to avoid re-fetching on every render.

---

### 3. Viewer mode (read-only bracket)

`state.viewingUser` is already wired into `placeCard()` in `bracket.js` — when set, no pick clicks, no ✓/✗ buttons, no edit buttons.

What Chat 3 needs to add:
- When clicking a player name on the leaderboard: set `state.viewingUser = profile`, load that user's picks for the active draw into `state.draws[activeTab]`, then call `renderBracket()` and `showScreen('screen-bracket')`
- The viewer banner (`#viewer-banner`) is already in `index.html` — show it, set `#viewer-banner-text` to "Viewing [display_name]'s bracket"
- "← Back" button (`#viewer-back-btn`) clears `state.viewingUser`, reloads the current user's own picks, then goes back to leaderboard
- After returning, restore `state.draws[activeTab]` to the current user's picks

**Viewer pick loading:**
```js
async function loadViewerPicks(userId) {
  // Replace picks in state.draws[activeTab] with target user's picks
  // Same assembly as loadDraw() but for a different userId
  // Does NOT overwrite match/winner data — only pick fields
}
```

---

### 4. Navigation wiring

- `#nav-leaderboard` (on bracket screen header) → `showScreen('screen-leaderboard')` + `renderLeaderboard()`
- `#nav-bracket-from-lb` → back to bracket screen (already wired in main.js)
- Leaderboard header should show the same slam dropdown / segmented control context so the user knows which slam they're viewing stats for

---

## Files to modify / create

- `src/leaderboard.js` — full implementation
- `src/main.js` — wire leaderboard init and viewer back button
- `index.html` — leaderboard screen div (may be built dynamically)

## What NOT to build
- Lock countdown (Chat 4)
- Backup pick glow (Chat 4)
- API sync (Chat 4)
