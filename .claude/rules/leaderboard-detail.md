# Leaderboard Detail

Read this when working on the leaderboard, viewer, or slam color theming.

## Slam Colors

```js
SLAM_COLORS = {
  AO:  '#2d7ab8',
  RG:  '#BD5627',
  WIM: '#275F3D',
  USO: '#071C63'
}
```
Applied via `--lb-slam-color` CSS custom property. Records tab is neutral (no slam colors); header uses `var(--text)`.

## Tab Structure

Three tabs tracked in `lbTab` (default `slams`):
- `slams` — per-slam cards; Slams cards grid: `1fr 72px 72px`
- `records` — year-to-date / all-time; neutral colors
- `yourdraws` — logged-in user's brackets only

`lbDetailDraw` set → renders draw detail view instead of tab content. Detail table grid: `1fr 72px 68px 68px 72px 72px 80px`.

`renderLeaderboard()` clears `statsCache` each call.

## Records Year Dividers

Current calendar year shows "This Year"; older years show the year number.

## Your Draws Tab

One card per slam+year with M/W buttons. Button disabled + greyed if the user has no picks in that draw. Clicking opens `openViewerOriginalPicks(state.currentUser, draw)`.

## Viewer Entry Point

`openViewerOriginalPicks(prof, draw)` (leaderboard.js):
- Assembles a viewer draw via `assembleDrawForUserOriginalPicks()` — does NOT write into `state.draws`
- Calls `renderViewerBracket(draw)`
- Switches to `screen-viewer`

Returning: `viewer-back-btn-v` calls `showScreen('screen-leaderboard')` + `renderLeaderboard()` — no state restoration needed.

## Leaderboard Stats Columns

- **Per-slam (summary card):** Score, Draw Health only — fully clickable → detail view.
- **Per-slam (detail view, "All stats →"):** Score, Base Pts, Upset Pts, Draw %, Health, Match %. All sortable. `baseScore` = `Math.round(s.baseScore)`; `upsetScore` = `parseFloat(s.skillBonus.toFixed(1))` (displayed with one decimal only when non-integer).
- **Year-to-date / all-time:** Average score per draw, overall Draw Accuracy %, overall Match Accuracy %. Count of draws in sample shown per player. Not split by MS/WS.

No chalk comparison — only the stats above.
