# Chat 4 — Polish

## Context

Foundation (Chat 1), Commissioner (Chat 2), and Leaderboard (Chat 3) are built. Read `CLAUDE.md` in full before touching any code.

---

## What to build in Chat 4

### 1. Lock countdown on stats bar

Location: right end of the `.stats-strip` (stats bar, `#stats-strip`), rendered in `renderStats()` in `src/stats.js`.

Show a countdown pill when a lock is upcoming and not yet triggered:
- Text: `"picks lock in 14h"` or `"backup picks lock in 6h"`
- Highlight/pulse the text color (accent color) until all affected picks are filled
- Logic: scan `state.lockSchedules` for rows where `locked_at` is null and `scheduled_at` is in the future
- Pick the nearest upcoming lock and compute time-to-lock

```js
// In renderStats(), after the health pill:
const upcoming = state.lockSchedules
  .filter(ls => !ls.locked_at && ls.scheduled_at && new Date(ls.scheduled_at) > new Date())
  .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0]

if (upcoming) {
  const msLeft = new Date(upcoming.scheduled_at) - Date.now()
  const hoursLeft = Math.round(msLeft / 3600000)
  const label = upcoming.lock_type === 'original_picks' ? 'picks lock' : 'backup picks lock'
  // render countdown pill
}
```

Refresh the countdown every minute: use `setInterval` in `main.js` to call `renderStats()` when the bracket screen is active.

---

### 2. Backup pick glow

Match cards without an active pick that fall within an upcoming (not yet triggered) lock schedule's range should glow purple — same as `.s-backup` styling.

In `placeCard()` in `src/bracket.js`, after building the card:
```js
// Check if this match falls in an upcoming lock range
const upcomingBackupLock = state.lockSchedules.find(ls =>
  ls.lock_type === 'backup_picks' &&
  !ls.locked_at &&
  ls.scheduled_at &&
  new Date(ls.scheduled_at) > Date.now() &&
  ls.round_index === ri &&
  (ls.match_index_start == null || mi >= ls.match_index_start) &&
  (ls.match_index_end == null || mi <= ls.match_index_end)
)
if (upcomingBackupLock && !m.pick && !m.winner) {
  card.classList.add('needs-backup-pick')
}
```

CSS to add to `index.html`:
```css
.mc.needs-backup-pick { border-color: var(--purple-border); border-width: 1.5px; }
.mc.needs-backup-pick .pr:not(.s-elim):not(.no-pick) { background: var(--purple-bg); }
```

---

### 3. API sync toggle (placeholder)

A toggle button on the bracket screen header (visible to all players) that when enabled, would pull match results from an external tennis API. For Chat 4, implement the UI toggle only — the actual API integration is TBD.

Add to `#hdr-right` in `index.html`:
```html
<button class="btn-secondary" id="api-sync-btn" title="Auto-sync results from tennis API">
  <span id="api-sync-label">Sync off</span>
</button>
```

Store sync preference in-memory (`state.apiSyncEnabled`). When toggled on, show a "Not yet connected" message. This is a placeholder for a future API integration — the toggle state is in memory only (not persisted to Supabase).

---

### 4. Mobile layout cleanup

The design is desktop/tablet first (see CLAUDE.md), but basic mobile usability should work:
- Header row 1 should not overflow on narrow screens — collapse nav links to a single menu or just hide commissioner link below 480px
- Stats bar should horizontally scroll on narrow screens
- Bracket body already scrolls — just verify it's usable

---

### 5. Empty state

When the commissioner hasn't uploaded any draws yet:
- Bracket screen shows an informative empty state: "No draws uploaded yet. The commissioner will upload the draw when it's available."
- Non-commissioner players see this instead of a broken bracket

Currently `renderBracket()` returns early if no draws — add a visible empty state message in `#bracket-body`.

---

## Files to modify

- `src/stats.js` — add countdown pill to `renderStats()`
- `src/bracket.js` — add backup glow in `placeCard()`
- `src/main.js` — setInterval for countdown refresh, API sync toggle wiring
- `index.html` — new CSS for glow + sync button + empty state styles

## What to verify / test

- Countdown ticks down correctly when a lock is scheduled
- Glow appears on correct cards, disappears once picks are filled
- No regressions on pick-making, lock behavior, or leaderboard
