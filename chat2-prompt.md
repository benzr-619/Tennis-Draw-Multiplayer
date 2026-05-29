# Chat 2 — Commissioner Screen

## Context

Foundation is built (Chat 1). This is a Vite + vanilla JS + Supabase app. Read `CLAUDE.md` in full before touching any code.

---

## Module map (as built in Chat 1)

| File | Key exports |
|---|---|
| `src/supabase.js` | `supabase` client |
| `src/state.js` | `state`, `activeDraw()`, `applyTheme()` |
| `src/auth.js` | `login()`, `signup()`, `logout()`, `restoreSession()`, `fetchProfile()` |
| `src/data.js` | `loadAllDraws()`, `loadDraw(drawRow)`, `loadLockSchedules()`, `reloadActiveDraw()`, `SLAM_CONFIG`, `slamKey()`, `slamLabel()`, `drawLabel()`, `uniqueSlams()` |
| `src/scoring.js` | `ROUND_CONFIG`, `calcStats()`, `calcStatsAsOf()`, `calcChalkScore()`, `calcMatchScore()`, `isBackupPick()`, `numericSeed()` |
| `src/picks.js` | `handlePickClick()`, `placePickAllRounds()`, `clearPickForward()`, `savePickToSupabase()`, `applyWinner()`, `undoWinner()`, `markLoserForward()`, `unmarkLoserForward()`, `withdrawalClearForward()`, `updatePlayerNameForward()`, `findSeed()`, `getNextSlot()` |
| `src/lock.js` | `isMatchLocked(ri, mi, lockType)`, `isDrawOriginalPicksLocked(d)` |
| `src/stats.js` | `renderStats()`, `resetStatsFilter()` |
| `src/bracket.js` | `renderBracket()`, `placeCard()`, `openEditPlayerModal()`, `confirmEditPlayer()`, `closeModal()` |
| `src/print.js` | `buildPrintHTML(d)` |
| `src/parser.js` | `extractPdfText()`, `parseTnnsText()`, `buildInitialRounds()` |
| `src/commissioner.js` | stub — replace in this chat |
| `src/leaderboard.js` | stub — Chat 3 |
| `src/main.js` | `showScreen()`, auth form, slam dropdown, search, print, logout, nav wiring |

## State shape

```js
state = {
  draws: Draw[],
  activeTab: number,
  currentUser: { id, display_name, is_commissioner } | null,
  viewingUser: null,  // Chat 3
  lockSchedules: LockSchedule[],  // lock_schedules rows for active draw
}

Draw = {
  db_id: string,        // draws.id
  slam: 'AO'|'RG'|'WIM'|'USO',
  draw: 'MS'|'WS',
  year: string,
  locked: boolean,      // mirrors draws.original_picks_locked
  rounds: Round[],
}

Round = { label: string, matches: Match[] }

Match = {
  db_id: string,        // matches.id
  p1: { name, seed },
  p2: { name, seed },
  pick: string|null,
  originalPick: string|null,
  result: 'correct'|'wrong'|null,
  highConfidence: boolean,
  editedAfterLock: boolean,
  winner: string|null,
  score: string,
}
```

---

## What to build in Chat 2

### 1. Commissioner screen (`screen-commissioner`)

The div exists in `index.html` with a `.comm-placeholder`. Replace the placeholder with real content.

Use a tab layout: **Draw Management** | **Lock Managing**

(Player editing is already handled inline on the bracket screen via the edit player modal — `openEditPlayerModal()` / `confirmEditPlayer()` in `bracket.js`. No separate player editing tab needed.)

---

### 2. Draw Management tab

Full draw upload → parse → review → confirm flow.

**UI to build:**
- PDF drop zone (same CSS classes as reference app: `.drop-zone`, `.drop-icon`, `.drop-label`, `.drop-hint`)
- Slam / draw type / year selectors
- "Parse draw" button
- Editable R1 match table (same `.match-edit-row` grid as reference app)
- "Confirm draw" button

**Logic:**
```
PDF file selected
  → parseTnnsText() → show editable R1 matches table
  → "Confirm draw" click:
      1. Check if draw already exists (same slam+draw_type+year):
           if exists: delete existing matches, update draws row
           if not: insert new draws row
      2. Insert 127 matches rows (all 7 rounds) — R1 from parsed data, R2–F as empty slots
      3. await loadAllDraws()
      4. Switch activeTab to the new/updated draw
      5. Navigate to screen-bracket
```

`buildInitialRounds()` in `parser.js` returns a flat R1 array. For DB insertion, you need to build all 7 rounds (R1 with real players, R2–F with empty names). Use this pattern:
```js
const ROUND_SIZES = [64, 32, 16, 8, 4, 2, 1]
const ROUND_LABELS = ['R1','R2','R3','R4','QF','SF','F']
// Insert matches[round_index][match_index] = {p1_name, p1_seed, p2_name, p2_seed}
// R1: from parsed data; R2–F: empty strings
```

---

### 3. Winner persistence (modify `src/picks.js`)

`applyWinner()` and `undoWinner()` currently update local state only. Add DB persistence:

In `applyWinner()`, after updating local state:
```js
if (state.currentUser?.is_commissioner && m.db_id) {
  // Update match winner
  await supabase.from('matches')
    .update({ winner: winnerName, score: m.score || null })
    .eq('id', m.db_id)
  
  // Update picks.result for ALL users on this match
  const { data: matchPicks } = await supabase
    .from('picks').select('id, user_id, pick').eq('match_id', m.db_id)
  // batch update: correct if pick === winnerName, wrong otherwise
  for (const pk of (matchPicks || [])) {
    const result = pk.pick === winnerName ? 'correct' : (pk.pick ? 'wrong' : null)
    if (result !== null) {
      await supabase.from('picks').update({ result }).eq('id', pk.id)
    }
  }
}
```

In `undoWinner()`:
```js
if (state.currentUser?.is_commissioner && m.db_id) {
  await supabase.from('matches').update({ winner: null, score: null }).eq('id', m.db_id)
  await supabase.from('picks').update({ result: null }).eq('match_id', m.db_id)
}
```

---

### 4. Original picks lock

When commissioner locks original picks:
```js
// 1. Set draws.original_picks_locked = true
await supabase.from('draws').update({ original_picks_locked: true }).eq('id', d.db_id)

// 2. Snapshot original_pick = pick for all users on this draw
const { data: allPicks } = await supabase
  .from('picks').select('id, pick').eq('draw_id', d.db_id)
for (const pk of (allPicks || [])) {
  await supabase.from('picks').update({ original_pick: pk.pick }).eq('id', pk.id)
}

// 3. Update local state
d.locked = true
d.rounds.forEach(r => r.matches.forEach(m => { m.originalPick = m.pick }))

// 4. Re-render
renderStats(); renderBracket()
```

Lock UI: a button "Lock original picks" with a confirmation dialog. Show current lock status. Also show a datetime picker for scheduled lock (store `scheduled_at` in `lock_schedules` with `lock_type = 'original_picks'`; manual trigger still required — no auto-fire).

---

### 5. Backup pick locks (Lock Managing tab)

Render a simplified bracket view (same geometry as `renderBracket()` but cards are for selecting ranges, not picking). Cards show:
- Whether they're currently locked (padlock icon, red tint)
- Whether they're selected for a pending lock action (blue highlight)

UX flow:
- Click individual cards to toggle selection
- "Lock selected" button + optional datetime input
- On confirm: insert a `lock_schedules` row with `locked_at = now()`, `round_index`, `match_index_start`, `match_index_end` derived from selection
- "Unlock" on an existing lock: update `locked_at = null`
- After any lock change: call `loadLockSchedules()` then `renderBracket()`

`lock_schedules` schema:
```
id, draw_id, round_index, match_index_start, match_index_end,
lock_type ('backup_picks'), label, scheduled_at, locked_at
```

Group selected cards by round for efficient insertion (one lock schedule row per contiguous range per round). A single card click creates a range of size 1.

---

## Files to modify / create

- `src/commissioner.js` — full implementation
- `src/picks.js` — add DB persistence to `applyWinner()` / `undoWinner()`
- `src/main.js` — wire commissioner screen init call
- `index.html` — commissioner screen div (may be built dynamically in commissioner.js)

## What NOT to build
- Leaderboard (Chat 3)
- Lock countdown on stats bar (Chat 4)
- Backup pick glow (Chat 4)
