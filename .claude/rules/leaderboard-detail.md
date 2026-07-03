# Leaderboard Detail

Read this when working on the leaderboard, viewer, or slam color theming.

## Pool Eligibility — Minimum Participation Gate (decided 2026-07-02)

**Rule:** a player counts toward a draw's leaderboard ranking and Slam Index z-score
population only if they have `original_pick IS NOT NULL` on at least 50%
(`POOL_ELIGIBILITY_THRESHOLD` in `scoring.js`) of that draw's total matches (127 → 65).
Measured against the whole draw, not just Round 1.

**Why:** a player with very few original picks still had every unpicked match scored
via the existing ELO auto-assign fallback (`isAutoAssign`, see `.claude/rules/betting.md`
"Auto-Pick Favourite — Draw Yield / Health (ELO)"). Auto-assign exists so a handful of
missed/withdrawn picks don't zero out an otherwise-real bracket — it was never meant to
carry a near-empty bracket to a competitive ranking. Confirmed against live data
2026-07-02: a player with only 18/127 original picks filled was sitting 2nd on the
men's leaderboard and combined leaderboard purely off auto-assigned scoring on the
other ~109 matches.

**Scope:** pool membership only — the auto-assign scoring mechanism itself is
unchanged; a player who clears the threshold is still auto-scored on any remaining
gaps exactly as before. **Your Draws tab is explicitly exempt** — a player can always
view their own bracket via `openViewerOriginalPicks` regardless of completion; that
tab doesn't read `hasAnyPicks`/`poolEligible` at all (it queries `picks` directly).

**Implementation:** `isPoolEligible(d)` (scoring.js) — one shared helper, no duplicated
threshold logic. Takes an assembled draw (`d.rounds[].matches[].originalPick`) and
returns `total > 0 && picked/total >= POOL_ELIGIBILITY_THRESHOLD`. Two call patterns:
- **Via `loadDrawStatsForAllUsers`** (leaderboard.js): computed once per user per draw
  as `poolEligible` on the per-user result object, alongside the pre-existing
  `hasAnyPicks` (`s.filled > 0`, which counts `matchPick` not `originalPick` — kept
  separate since they answer different questions). Every downstream consumer of that
  result object (Slams tab summary cards/podium/past-slam top3 in
  `leaderboard-slams.js`, draw detail table in `leaderboard.js`, Records tab
  `buildAllTimeAgg`/`buildAllBrackets`/`buildPoolBestUpset` in `leaderboard-records.js`)
  filters on `hasAnyPicks && poolEligible` (or reads the already-gated `hasAnyPicks`
  field the Records aggregates themselves expose downstream).
- **Via direct call** in `_loadBaseline` (leaderboard-slams.js) — this function computes
  its own stats independently of `loadDrawStatsForAllUsers` (for the round-R-1 baseline
  used by movement arrows), so it calls `isPoolEligible(ud)` directly on the assembled
  draw it builds.

**Retroactive by design:** this is a render-time filter over existing `original_pick`
counts — no backfill migration, applies automatically to all historical draws on next
render.

**Gap found and fixed 2026-07-03:** the Slams tab storyline chips (`_buildChipsRow`
in leaderboard-slams.js — "Biggest Upset" and "Best Match Pick Value") built their
entries directly from `s.bestUpset`/`s.flatYield` per prof per draw with no
`poolEligible` check at all, unlike every other consumer of
`loadDrawStatsForAllUsers`'s output. A pool-ineligible player (e.g. one with only a
handful of picks that happened to hit good locked odds) could still win "Best Match
Pick Value" or "Biggest Upset" even though excluded from every ranked table on the
same screen. Fixed by gating both chips' entry-collection loops on `s.poolEligible`,
same as every other call site. **Any new Slams-tab chip/list that reads per-user
per-draw stats must gate on `poolEligible` explicitly — it is never implied by
`bestUpset`/`flatYield` being present.**

## Sort Direction Bug — inverted comparator (fixed 2026-07-03)

Two sortable tables had an inverted click-sort comparator:
`buildDetailTable` in leaderboard.js (`lbSort`) and the card click-reorder handler
in leaderboard-slams.js (`slamSort`) used `(va < vb ? -1 : 1) * dir * -1`. The
trailing `* -1` inverted the actual sort vs. what the `↓`/`↑` arrow displayed —
clicking a column showed lowest-first while the arrow implied descending. The
correct formula (matching the already-correct `recSort` comparator in
leaderboard-records.js) is `(va < vb ? -1 : 1) * dir`, with no trailing negation.
`leaderboard-slams.js`'s per-render `sortedProfs` sort (used on every full
re-render, not just the DOM-patch click path) was also hardcoded to always sort
descending regardless of `slamSort.dir` — fixed to respect `dir` too, so a
re-render doesn't silently revert an ascending sort back to descending.

## Movement Arrows — added magnitude (2026-07-03)

The Slams tab rank-change arrow (▲/▼ next to `#N`) only showed direction, not how
far a player moved. Now appends `Math.abs(old - cur)` to the arrow text (e.g. `▲2`),
computed in the same `baseline`/`old`/`cur` block in `_buildCard`. The underlying
"since when" semantics were already correct and unchanged: `baseline` = rank as of
`calcStatsAsOf(ud, R-1)` where `R` = deepest round with any confirmed winner — i.e.
rank right before the first result of the current round landed.

## ASI Gotcha — leading `[` after an unterminated statement (fixed 2026-06-26)

`src/leaderboard-records.js` uses semicolon-free style. Any statement immediately followed by a line that begins with `[` (an array literal you intend as a new statement) will be mis-parsed as index access on the previous expression. `buildPodium` crashed with `Cannot read properties of undefined (reading 'forEach')` because `wrap.className = 'rec-podium'` (no semicolon) chained into `[[top3...]].forEach` → `'rec-podium'[...].forEach`. Fix: prefix the array-literal statement with a leading `;` (idiom already used at the `;['all', ..._recYears]` line). Same applies to lines starting with `(`.

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
- `slams` — per-slam cards; then "All stats →" → draw detail view
- `records` — all-time / per-year aggregate cards; neutral colors
- `yourdraws` — logged-in user's brackets only

`lbDetailDraw` set → renders draw detail view instead of tab content.

`renderLeaderboard()` clears `statsCache` each call.

## Slam Index — Formula & Guards

`SlamIndex = round(100 + 15 × (z_draw + z_match) / 2)`

- `z_draw` = population z-score of Draw Yield; `z_match` = same for Match Yield (null → 0)
- **Guards:** pool size < 2 OR stddev = 0 → that z = 0 for everyone (index = 100 baseline)
- Pure function `calcSlamIndex(entries)` in `scoring.js`; no DB changes
- Computed inside `loadDrawStatsForAllUsers` after all per-player scores are known; stored as `slamIndex` in the statsMap entry
- Aggregated as plain average of per-draw values → `avgSlamIndex`. **Never re-pool raw scores across draws**
- `fetchPoolSlamIndex(draw, userId)` in `stats.js`: fire-and-forget on draw load/refresh, re-calls `renderStats()` on completion

## CSS Grid Templates

- **Slams card row** (`.lb-row-card`): `1fr 72px 72px 72px` — Player | Draw Yld | Match Yld | Index
- **Detail table row** (`.lb-row-detail`): `1fr 72px 68px 68px 72px 72px 72px 72px 72px` — Player | Draw Yld | Base Pts | Upset Pts | Match Yld | Draw % | Match % | Health | Index
- All `.lb-row` have `column-gap:12px` for visual separation between stats.
- All `.lb-cell` default `text-align:right`; `.lb-cell-name` overrides to left.
- `.lb-header-row .lb-cell` has `white-space:nowrap` — labels must never wrap.

## Column Header Abbreviations (canonical)

Use these exact labels everywhere in leaderboard tables — never the full names as column headers, as they don't fit at 72px:

| Stat | Column Label |
|---|---|
| Draw Yield (score) | **Draw Yld** |
| Match Yield (betting) | **Match Yld** |
| Slam Index (composite) | **Index** |
| Base Points | Base Pts |
| Upset Points | Upset Pts |
| Draw Accuracy | Draw % |
| Match Accuracy | Match % |
| Draw Health | Health |
| Average | Avg |
| Total | Total |

Full names ("Draw Yield", "Match Yield", "Slam Index") are used in card titles, stats bar pills, and section headers — not in table column headers.

## Slams Tab — Live Slam Board (`src/leaderboard-slams.js`)

Slams tab is a separate module. `renderSlamsTab(container, profs)` is the export; `leaderboard.js` imports it. Circular import safe (all function calls, no top-level init). `resetSlamSort()` exported — called on tab switch to reset sort state.

**Module state:** `slamSort = { col: 'slamIndex', dir: -1 }`, `_expandedKeys` (Set of past-slam keys), `_picksCache` (Map of drawDbId → pick rows for baseline).

### Slam Header

`.lb-slam-section` → `.lb-slam-header` row: slam name (Playfair 22px 600), year (DM Mono 11px muted), `.lb-status-pill` (DM Mono 9px, `--lb-slam-color` text + border). Pill text: "FINAL" for past slams, "LIVE" when R<0 (no results yet), "LIVE · ROUND_NAME" when R≥0. Round name from `STATUS_NAMES[R]` (R = deepest round_index with any winner from `_deepestR(draws)`).

### Summary Cards (`.lb-row-card` grid: `1fr 72px 72px 72px`)

Column order: Player | Draw Yld | Match Yld | **Index**. Index is default sort (desc), rightmost column. Header cells have `.lb-sortable` class for cursor and hover.

**Sorting:** `slamSort = { col, dir }` module-level. Sort click re-sorts BOTH M/W cards together (one click handler wired across all cards). Active sort header gets slam color + ↓/↑. Unsorted columns show ↕. FLIP animation on sort: capture `.getBoundingClientRect()` before reorder, `requestAnimationFrame` + `void el.offsetWidth` reflow to animate rows 0.22s ease. **No arrows under yield sorts** — movement arrows only when `slamSort.col === 'slamIndex'`.

**Movement arrows** (`.lb-arrow-up` green / `.lb-arrow-dn` red, DM Mono 9px): rank change since previous round. Baseline = rank by slamIndex from `calcStatsAsOf(draw, R-1)`. Computed via `_loadBaseline()` which caches picks in `_picksCache`. No arrows when R===0, no arrows on completed slams (`isActive=false`).

**Draw Health underline** (`.lb-health-bar`): `position:absolute; left:0; bottom:0; height:3px`. Width = health% of row width. Hue from `healthHue(pct)` (imported from scoring.js). Transition 0.3s ease. Hidden pre-lock (null/undefined drawHealth). No % label on bar.

**Detail view** (`lbDetailDraw` set): click "All stats →" calls `setLbDetail(draw)` + `renderLeaderboard()`. Returns to Slams tab via "← Slams" back button. All 9 stat columns (Draw Yld / Base Pts / Upset Pts / Match Yld / Draw % / Match % / Health / Index), sortable. Sort state in `lbSort` (in leaderboard.js).

### Storyline Chips (`.lb-chip-row`, 2-col grid below cards)

**BEST CALL SO FAR** — largest single-match yield win at locked odds. Scans all profs × draws in the slam group via `statsMap[p.id].bestUpset`. Collapsed body: `${player} · ${pickedName} ${formatAmerican(odds)}`. Click → `openListModal('Best Call So Far', rows)` where rows = all players sorted by bestUpset.yld.

**HEALTHIEST DRAW** — highest drawHealth among players with picks. Collapsed: `${player} · ${pct}% · ${draw.draw}` with health hue color on %. Click → `openListModal('Healthiest Draw', rows)`.

Shows `—` (`.lb-chip-empty`) when no qualifying data.

### Generic List Modal (`openListModal(title, rows)`)

Exported from `leaderboard-slams.js`. Used by both Slams chips and Records "Biggest Upset Call" chip. Appended to `document.body`. ESC + overlay-click close. Row shape: `{ name, sub?, val, valClass?, valStyle? }`. `.lb-modal-val-pos` = green (`#4c9968`). Overlay fades in via `.open` class + CSS transition.

### Past Slams

Below active slam: "PAST SLAMS" label + compact card per slam. Compact card (`.lb-past-card`): 3px left border in slam color (not top border), slam name (Playfair 16px), year, top-3 by combined slamIndex (avg MS+WS), "VIEW →" / "HIDE ↑". Click toggles `_expandedKeys`; when expanded, `_renderFull(..., false)` appended below card (no arrows, "FINAL" pill).

**Detail view** (`lbDetailDraw` set): All 9 stat columns (Draw Yld / Base Pts / Upset Pts / Match Yld / Draw % / Match % / Health / Index), sortable. Sort state in `lbSort`. Back button returns to Slams tab.

**Deferred:** "Biggest Mover" chip (rank change leader across full slam) — not built. Would require per-round rank history beyond what `_loadBaseline` provides for a single round.

## Records Tab — Trophy Room (leaderboard-records.js)

Records tab is a separate module (`src/leaderboard-records.js`). `renderRecordsTab` is the export; `leaderboard.js` imports it. Circular import is safe (all function calls, no top-level init).

**Module state:** `recPeriod` ('all'|year), `recSort` ({col, dir}), `recMyToggle` ('avg'|'total'), `recTdSort`, `_topDrawsExpanded`. Re-render helpers: `_rerenderAll()` (rebuilds period picker + content), `_rerenderContent()` (rebuilds content only). Period changes call `_rerenderAll`; sort/toggle changes call `_rerenderContent`.

### Period Picker

`.rec-period-row` — pill row at top: **ALL TIME** + one pill per year with data. `recPeriod` tracks active selection. DM Mono uppercase pills styled like stats-bar round filter (`.rec-period-pill`, `.rec-period-pill.active` → accent). Switching resets `_topDrawsExpanded`.

### Podium

Renders only when `eligible.length >= 3` (players with data for active sort stat in the period). Center = rank 1 (taller block `.rec-pod-top`), left = rank 2, right = rank 3. Playfair Display names (`.rec-pod-name`), DM Mono sub-label (`${STAT} ${value} · N DRAW(S)`). Active sort stat label: `avgScore` → "SCORE", `avgMatchYield` → "MATCH YLD", `avgSlamIndex` → "INDEX".

**FLIP animation**: `renderPeriodContent` captures `.rec-pod-name[data-id]` rects BEFORE `content.innerHTML = ''`, then after DOM rebuild uses `requestAnimationFrame` + `void el.offsetWidth` reflow to animate names from old to new positions. `will-change:transform` on `.rec-pod-name`.

### Standings Table

`.rec-standings-wrap` wraps `.lb-table.rec-standings-table`. Grid `.lb-row-standings`: `22px 1fr 44px 72px 72px 72px`. Columns: rank (`.lb-cell-srank`) | Player + YOU badge | Draws (`.lb-cell-draws`) | Draw Yld | Match Yld | Index. Sortable on Draw Yld/Match Yld/Index only. Sort clicks call `_rerenderContent()`. **YOU badge**: `.rec-you-badge` (DM Mono 9px, accent color, accent-dim bg, 1px border, margin-left 7px).

Data from `buildAllTimeAgg` — aggregate keys: `avgScore`, `avgMatchYield`, `avgSlamIndex`, `drawsPlayed`. Sort col → agg key map: `score` → `avgScore`, `matchYield` → `avgMatchYield`, `slamIndex` → `avgSlamIndex` (constant `AGG_KEY`).

### Honors Row

`.rec-honors-row`: CSS grid, 3 equal columns. Three chips reuse `.lb-rec-card` for card shell.

**BEST SINGLE DRAW** — Best single-draw Draw Yld (from `buildAllBrackets` sorted by score). Collapsed: `${player} · ${slam} ${year} ${draw} · ${score}`. "See all →" / "Hide ↑" toggles `_topDrawsExpanded`. Expanded: full `buildTopDrawsTable` using `.lb-rec-td-row` grid (`18px 1fr 68px 68px 68px`), sortable on Draw Yld/Match Yld/Index, `recTdSort` state. Row click opens `openViewerOriginalPicks`.

**SHARPEST BETTOR** — Flat-stake ROI: each resolved matchPick with locked odds treated as $1 bet. Win = `+(oddsDecimal − 1)`, lose = `−1`. `flatROI = totalFlatYield / totalFlatBets` across all resolved bets in the period. Normalises out round stakes — a big Final win doesn't dominate. Chip header shows "FLAT-STAKE ROI" sub-label. Rows show player, N bets sub-label, ROI as `+45%` / `−12%`. Computed in `loadDrawStatsForAllUsers` (`flatYield` + `flatYieldResolved` per draw), aggregated in `buildAllTimeAgg` (`flatROI`, `totalFlatBets`). No toggle needed — already per-bet.

**BIGGEST UPSET CALL** — From `buildPoolBestUpset(profs, draws, statsMaps)`: iterates per-user `bestUpset` field. `bestUpset` = `{ yld, ri, pickedName, opponent, decimalOdds, prof, draw }`. Collapsed: `${player} · ${pickedName} ${formatAmerican(decimalOdds)}`. Click → `openListModal('Biggest Upset Call', [{ name, sub, val, valClass }])` (single row: pool's best). Modal imported from `leaderboard-slams.js`. Shows "—" when no locked odds in period.

### Data Helpers (in leaderboard-records.js)

- `buildAllTimeAgg(profs, draws, statsMaps)` — per-player aggregates: `avgScore`, `avgMatchYield`, `totalMatchYield`, `avgSlamIndex`, `drawsPlayed`, `hasAnyPicks`. Note: does NOT include `matchAcc` (leaderboard.js version did — this is intentional, records tab doesn't need it).
- `buildAllBrackets(profs, draws, statsMaps)` — flat array of `{prof, draw, score, matchYield, slamIndex}`.
- `buildPoolBestUpset(profs, draws, statsMaps)` — pool-level best upset: iterates all profs/draws, returns `{yld, ri, pickedName, opponent, decimalOdds, prof, draw}` or null.

### bestUpset in loadDrawStatsForAllUsers (leaderboard.js)

Extended to compute `bestUpset` per user per draw: iterates assembled draw's matches, finds `matchPickResult === 'correct'` with locked odds, tracks best by `yld = round(STAKE_BY_ROUND[ri] * (decimal - 1))`. Stored as `result[prof.id].bestUpset`. Requires `STAKE_BY_ROUND` import from odds.js.

## Your Draws Tab

One card per slam+year with M/W buttons. Button disabled + greyed if the user has no picks in that draw. Clicking opens `openViewerOriginalPicks(state.currentUser, draw)`.

## Viewer Entry Point

`openViewerOriginalPicks(prof, draw)` (leaderboard.js):
- Assembles **two** viewer draws upfront (no extra DB calls on toggle):
  - `_viewerOrigDraw` via `assembleDrawForUserOriginalPicks()` — `projectFromPick: true`, `originalPick` from DB
  - `_viewerMatchDraw` via `assembleDrawForUserMatchPicks()` — `projectFromPick: true`, `originalPick: null` (critical — clears it so `buildDrawView` projects from `matchPick`)
- Stats computed separately via `assembleDrawForUser()` (standard mapping, no `projectFromPick`)
- Does NOT write into `state.draws`
- Wires the `#viewer-seg-control` toggle
- Calls `renderViewerBracket(draw, mode)` + `renderViewerStats(stats, mode)`
- Switches to `screen-viewer`

Returning: `viewer-back-btn-v` calls `showScreen('screen-leaderboard')` + `renderLeaderboard()` — no state restoration needed.

## Viewer Toggle (`#viewer-seg-control`)

HTML: two `.seg-btn` in `#viewer-seg-control` (`.viewer-row2`), `data-mode="original"` and `data-mode="match"`. **No static `.seg-thumb` div** — `animateSegThumb` creates it dynamically.

Module-level state: `viewerMode` (`'original'` | `'match'`), `_viewerSegPrevIdx`, `_viewerOrigDraw`, `_viewerMatchDraw`.

Toggle handler:
1. Remove old `.seg-thumb` divs before calling `animateSegThumb` (prevents accumulation on repeated clicks)
2. Call `renderViewerStats(stats, newMode)` — stats strip is mode-aware
3. Swap draw and call `renderViewerBracket(d, newMode)`

Initial thumb placement: `requestAnimationFrame(() => animateSegThumb(seg, -1, 0))` AFTER `screen-viewer` gains `.active` class — button widths are 0 when screen is hidden.

Dynamic import of `renderViewerBracket` must happen **before** toggle handler wiring so the function is in closure scope. Use `Promise.all` upfront.

## Viewer Stats Strip (`#viewer-stats-strip`) — Mode-Aware

Shows the **viewed user's** stats for that specific draw (not the logged-in user's stats, not the live draw).

- **Original Draw mode:** Draw Yld | Draw % | Health
- **Match Picks mode:** Match Yld | Match %

Pills rendered as `.viewer-stat-pill` with `.vslbl` (DM Mono 9px uppercase) + `.vsval` (DM Mono 13px).

## Viewer Bracket Modes (`renderViewerBracket(draw, mode)`)

**Original Draw** (`mode = 'original'`): user's original picks fill the slots via `projectFromPick: true`. Card border green/red by `originalPickResult`. When the actual player who reached a round differs from the projected pick, the actual player floats outside via `.mc-actual-top`/`.mc-actual-bot` (neutral). Champion box uses `renderChampion` callback: originalPick in box (green/red+crossed), actual winner floats above as `.mc-champ-actual` when wrong. See `.claude/rules/bracket-rendering.md` for champion box detail. `assembleDrawForUserOriginalPicks` attaches `actualP1`/`actualP2` (real feeder winners) per match, sets `matchPick = original_pick ?? match_pick`, calls `buildDrawView` with `projectFromPick: true`.

**Match Picks** (`mode = 'match'`): real players who played each match (`actualP1`/`actualP2`, falling back to `m.p1`/`m.p2` when pending). Card border neutral. Odds inline. Per-row logic:
- Pick + won → `.s-backup` + `.pr-check` (purple ✓, only on pick winners)
- Pick + lost → `.s-backup-wrong` (purple, crossed)
- Non-pick + lost → `.mp-loser` (muted, crossed)
- Non-pick + won → no class (neutral, no ✓)

Champion box uses `f.matchPick || f.winner || '—'`. `assembleDrawForUserMatchPicks` uses `projectFromPick: true` (fills slots from matchPick) with `originalPick: null`; `actualP1`/`actualP2` provide real players for card rendering.

## Stats Columns (canonical order)

**Stats bar (post-lock):** Draw Yield → Match Yield → Draw Accuracy → Match Accuracy → Draw Health

**Slam summary card:** Player / Draw Yld / Match Yld / Health

**Detail view:** Player / Draw Yld / Base Pts / Upset Pts / Match Yld / Draw % / Match % / Health

**Records Match Yield card:** Player (+ draws-played sub) / Avg / Total

**Records Top Draws card:** Rank / Player + Draw sub-label / Draw Yld / Match Yld

No chalk comparison anywhere — removed from UI (code retained in scoring.js/stats.js commented out).

## Mobile Layout (≤768px)

**Tab bar moves to bottom:** `.lb-tabbar` gets `order:2` inside `.lb-root{display:flex;flex-direction:column}` — pure CSS reorder, no JS change.

**Draw/Leaderboard nav:** hidden from `.hdr-row1` (`.lb-hdr-nav{display:none}`) and replaced by `#lb-mobile-hdr-row2` (a new `display:flex` bar below the header). Wired in `main.js` via `$('lb-mobile-nav-bracket')` and `$('lb-mobile-nav-leaderboard')` click handlers; `_setNavActive` toggles active state on all four nav buttons (including the two new ones).

**Detail table scroll — CSS cascade gotcha (2026-06-11):**
`.lb-detail-table-wrap{overflow:hidden}` is a BASE rule at ~line 545 in `index.html`. Any mobile `overflow-x:auto` rule placed BEFORE line 545 in the stylesheet is silently overridden by the base rule (equal specificity, later source order wins). The fix: add a dedicated mobile override block AFTER line 545, just before `@media print`:
```css
@media(max-width:768px){
  .lb-detail-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  /* sticky column backgrounds — must match each row type exactly */
  .lb-row-detail .lb-cell-name{background:var(--surface)}
  .lb-header-row.lb-row-detail .lb-cell-name{background:var(--surface2)}
  .lb-row-alt .lb-cell-name{background:var(--surface2)}
  .lb-row-self .lb-cell-name{background:var(--accent-dim)}
}
```
The early block at ~line 266 handles structural properties (`position:sticky;left:0;z-index`); this late block handles background overrides only.

**Sticky column background mapping:**
- Normal row: `var(--surface)` (table-wrap bg)
- Header row (`.lb-header-row`): `var(--surface2)` — matches `.lb-header-row{background:var(--surface2)}`
- Alt row (`.lb-row-alt`): `var(--surface2)` — matches `.lb-row-alt{background:var(--surface2)}`
- Self row (`.lb-row-self`): `var(--accent-dim)` — matches `.lb-row-self{background:var(--accent-dim)}`
Sticky cells must match the ROW background (not the table-wrap background) or they'll show as a white box when scrolled.

**Slams + Records mobile layout (added 2026-06-12) — all rules in the late `@media(max-width:768px)` block (same block as detail-table scroll fix, ~line 772):**

```css
.lb-content{padding:16px 12px}
.lb-row-card{grid-template-columns:1fr 56px 56px 56px;column-gap:8px}
.lb-chip-row{grid-template-columns:1fr}
.lb-past-card{flex-wrap:wrap;row-gap:6px}
.lb-past-top3{flex-basis:100%;order:3}
.rec-pod-block{width:auto;flex:1;min-width:0}
.rec-pod-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.lb-row-standings{grid-template-columns:18px 1fr 56px 56px 56px;column-gap:8px}
.lb-cell-draws{display:none}
.lb-rec-td-row{grid-template-columns:18px 1fr 56px 56px 56px;column-gap:8px}
```

Notes:
- `.lb-cell-draws` hides the Draws count column on both header and data rows (both use the same class).
- "MATCH YLD" text at 9px DM Mono is slightly wider than 56px and overflows visually with `overflow:visible` — not clipped, looks fine in practice. No letter-spacing fix needed.
- `.lb-chip-row{grid-template-columns:1fr}` stacks storyline chips to single column at ≤768px (side-by-side at desktop).
- `.lb-past-top3{order:3}` pins the top-3 names to a new second row while "VIEW →" (margin-left:auto) stays right on row 1.

**`.lb-cell-name` overflow with YOU badge — single-word display names (fixed 2026-07-03):**
`.lb-row-card`'s numeric columns appeared shifted/blank specifically on the current
user's own row on mobile. Root cause: `.lb-cell-name` is a flex row (rank + name +
optional `.rec-you-badge`) sitting in the grid's `1fr` name column. A flex item's
default `min-width:auto` floors its shrink at its *min-content* size — for a display
name with a space (`"Joseph Spector"`) that's just the widest word, so it wraps fine;
for an unbroken single-word name (`"VibesArchitect"`, `"ClutchMoves"`) there's no
break opportunity, so min-content is the *entire word*. Add the YOU badge's width on
top and the row's true minimum exceeds the narrow mobile `1fr` track, forcing the grid
to overflow and visually push the fixed-width stat columns rightward — only ever
visible on the one row carrying the badge (the logged-in user), which is why it looked
like a YOU-tag-specific bug rather than a name-length one. Fixed with `min-width:0` on
`.lb-cell-name` and `.lb-player-name` (lets the flex item shrink below min-content) plus
`overflow-wrap:anywhere` on `.lb-player-name` (lets an unbroken word wrap mid-word when
truly out of room) and `flex-shrink:0;white-space:nowrap` on `.rec-you-badge` +
`.lb-rank` (so the badge/rank never get crushed instead of the name).
