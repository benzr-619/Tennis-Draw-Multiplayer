# Bracket Rendering Detail

Read this when working on bracket card painting, the viewer, or `buildDrawView`.

## Live Bracket — Elim Slot Rendering

Elim slots (`p.elim === true`):
- The eliminated original pick stays **inside** the card, painted red + crossed-out (`pr s-orig-wrong`)
- **No click handler** on elim rows
- **No floating label** — until a confirmed winner from the feeder displaces it

Displaced `originalPick` label (`.mc-orig-elim-top` / `.mc-orig-elim-bot`, 11px):
- **Case 1** (slot projects the eliminated pick, no confirmed winner yet): name renders in-slot, no floating label — `feeder.originalPick === m.p?.name` so no label is emitted
- **Case 2** (feeder's originalPick is not the same as who occupies the slot): pick floats outside as the displaced label. **Generated for both decided AND undecided matches, and for both slots independently** — each slot checks its own feeder's `originalPick` against the slot occupant. A Final card can show a displaced pick ABOVE (from the top-SF feeder) AND BELOW (from the bottom-SF feeder) simultaneously.

`buildDrawView` emits `m.elimLabels = [{name, pos}]`. `placeCard` just paints them — no derivation in the renderer.

### `buildDrawView` step 4 logic (2026-06-10 rewrite)

Step 4 now uses a **feeder-based** approach instead of checking `m.originalPick`:
```js
if (ri > 0) {
  const feeder1 = rounds[ri - 1].matches[mi * 2]
  const feeder2 = rounds[ri - 1].matches[mi * 2 + 1]
  const op1 = feeder1?.originalPick
  const op2 = feeder2?.originalPick
  if (op1 && op1 !== m.p1?.name) m.elimLabels.push({ name: op1, pos: 'top' })
  if (op2 && op2 !== m.p2?.name) m.elimLabels.push({ name: op2, pos: 'bot' })
}
```
Each slot is independent. Case 1 (pick in slot with `elim` flag) is naturally handled: `feeder.originalPick === m.p?.name` → condition false → no label.

## Backup Pick Cascade

`cascadeMatchPickForward` (post-lock):
- Sets `nm.matchPick` on future matches only — **never touches `p1`/`p2`**
- Passes through elim'd slots, breaks at real confirmed players
- Persisted via `saveCascadeToSupabase` (stored picks identical to pre-refactor — no DB change)

`applyWinner` / `undoWinner`: set authoritative winner/result fields, then call `buildDrawView(d)`. No manual next-slot placement. After `undoWinner`, commissioner calls `reloadActiveDraw()` so backup-pick cascades re-derive from stored picks.

## `buildDrawView` — Viewer Mode (`projectFromPick: true`)

Only `assembleDrawForUserOriginalPicks` passes this flag. Default callers are byte-identical.

In `projectFromPick` mode:
- Round-2+ slots fill from `originalPick || matchPick || winner` (pick-first)
- Eliminated-players set built from `actualP1`/`actualP2` (real results; slots hold picks, not real players)
- Displaced-label (`elimLabels`) pass is skipped — viewer floats the actual occupant instead

## Viewer Card Painting (`placeViewerCard`)

The card always shows the viewed friend's **original pick**, color-coded:
- `s-orig-ok` green — correct pick
- `s-orig-wrong` red + crossed — wrong, OR `predictedMissed` (real occupant differs OR picked player carries `p.elim` from the projectFromPick pass — so future-round dead picks go red, not blue)
- `s-orig` blue — picked, still undecided

The actual player who reached each slot (`m.actualP1`/`m.actualP2` from `assembleDrawForUserOriginalPicks`) floats outside via `.mc-actual-top`/`-bot` — **only** when it differs from the friend's predicted occupant AND the slot is decided. This float is neutral (`var(--text3)`, no ✓, no won/lost split) — historical record only. No in-card checkmarks in the viewer.

Contrast with live bracket: there the *displaced eliminated pick* (`.mc-orig-elim`) floats red+crossed and the real winner sits in-slot.

## Champion Box Rendering (`renderChampion` callback)

`renderBracketLayout` accepts an optional `renderChampion(finMatch, x, y, wrap)` callback that replaces the default champion box. When provided, the caller builds the entire box DOM; `bracket-layout.js` still draws the connector line. If omitted (e.g. `commissioner-results.js`), the default box shows `f.winner || '—'`.

**Live bracket (`bracket.js`):**
- Correct pick (`winner === originalPick||matchPick`): green champ-name + `champ-correct` border
- Wrong pick: `champ-wrong` border; real champion name in `.champ-name`; wrong pick floats above as `.mc-champ-elim` (red + line-through)
- Undecided with pick: pick name in box, accent color
- No pick: winner or '—'

**Viewer original mode (`viewer-bracket.js`):**
- Correct: `champ-correct` border; originalPick in box, green color
- Wrong: `champ-wrong` border; originalPick in box (red + line-through); actual winner floats above as `.mc-champ-actual` (neutral `var(--text3)`)
- Undecided with pick: pick in box, accent color
- Match Picks mode: plain box, `matchPick || winner || '—'`

**CSS classes (index.html):**
- `.mc-champ-elim` — `position:absolute; top:-16px; width:100%; text-align:center` — red line-through, mono 11px
- `.mc-champ-actual` — same positioning — neutral `var(--text3)`, mono 11px
- Both rely on `.champ-box` having `position:absolute` (which makes it a positioned ancestor for child absolute elements).

## Card Geometry Constants (bracket-layout.js)

`CW = 205, CH = 62, GAP = 20, COL = 225` — set 2026-06-26. CW was 180; increased to 205 to prevent name truncation at normal lengths (e.g. "Stefanos Tsitsipas"). COL = CW + GAP always. Round label widths in bracket-layout.js reference `${CW}px` — not hardcoded. `.mc { width: 205px }` in index.html must stay in sync with CW. Print (src/print.js) uses separate geometry — do NOT change it here.

Row padding restored to original `padding:4px 7px; gap:5px` (the extra card width handles the space).

**Name hover-peek** (`@media(hover:hover)` only): on `.pr:hover`, `.pr-name` gets `overflow:visible; position:relative; z-index:2; background:inherit; padding-right:6px`. The full name renders in place, overlaying the odds element rightward, clipped at the card edge by `rowsWrap`'s `overflow:hidden` (which cannot be removed — it clips colored state backgrounds to the card's rounded corners). Touch devices unaffected. Viewer rows have `pointer-events:none`, so hover never fires there.

## High-Confidence — Seed-Gutter Star + Left-Edge Dot (2026-06-26)

**Control (`.pr-star` in `.pr-seed-gutter`):** The star lives inside a `div.pr-seed-gutter` wrapper (same `min-width:16px` slot as the old `span.pr-seed`). It is `position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); opacity:0` at rest — the seed text shows normally. On desktop hover (`@media(hover:hover)`), `.pr.pr-has-star:hover .pr-seed{opacity:0}` and `.pr.pr-has-star:hover .pr-star{opacity:1}` fade the seed out and the star in within the same gutter — **no layout shift**. Click toggles `highConfidence` as before. On touch (`@media(hover:none)`), seed is hidden and star is always visible in the gutter.

The `pr-has-star` class is added to the `.pr` row in JS when the star is rendered (only for `isLivePick && bothConfirmed && !m.winner`). Elim rows and rows without a live pick never get `pr-has-star` — their seeds never fade.

**Status marker (`.pr-hc-dot`):** When `isLivePick && m.highConfidence`, a `span.pr-hc-dot` is appended to the row (absolutely positioned): `left:4px; top:50%; transform:translateY(-50%); width:4px; height:4px; border-radius:50%; background:#c9a227`. Sits in the 7px left padding buffer between the card border and the seed gutter. Persistent at rest — visible without hovering.

**Old right-edge star removed.** No star is ever appended after `.pr-name` or `.pr-odds`. The `.pr-star.is-high{position:static}` rule is gone. Golden file updated to include `pr-has-star` in class lists.

## `placeCard` Callback Signature

`(draw, match, ri, mi, x, y, wrap)` — used by `bracket.js`, `viewer-bracket.js`, `commissioner-results.js`. Each renderer owns its own implementation for card painting only. Geometry never duplicated.

## Commissioner Results — Slot Occupancy

`_resultOccupant()` (commissioner-results.js) reads the feeder's `winner` directly — **not** `buildDrawView`-derived `m.p1`/`m.p2`. This prevents the commissioner's own predictions from leaking into empty slots and prevents confirming a winner on a projected matchup. Round 0 always shows the real draw.
