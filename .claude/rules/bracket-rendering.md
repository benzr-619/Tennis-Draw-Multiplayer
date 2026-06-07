# Bracket Rendering Detail

Read this when working on bracket card painting, the viewer, or `buildDrawView`.

## Live Bracket — Elim Slot Rendering

Elim slots (`p.elim === true`):
- The eliminated original pick stays **inside** the card, painted red + crossed-out (`pr s-orig-wrong`)
- **No click handler** on elim rows
- **No floating label** — until a confirmed winner from the feeder displaces it

Displaced `originalPick` label (`.mc-orig-elim-top` / `.mc-orig-elim-bot`, 11px):
- **Case 1** (slot projects the eliminated pick, no confirmed winner yet): name renders in-slot, no floating label
- **Case 2** (real confirmed winner now occupies the slot): original pick floats outside as the displaced label. Side resolved from feeder `originalPick` (`rounds[ri-1].matches[mi*2]` → top, `*2+1` → bot)

`buildDrawView` emits `m.elimLabels = [{name, pos}]`. `placeCard` just paints them — no derivation in the renderer.

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

## `placeCard` Callback Signature

`(draw, match, ri, mi, x, y, wrap)` — used by `bracket.js`, `viewer-bracket.js`, `commissioner-results.js`. Each renderer owns its own implementation for card painting only. Geometry never duplicated.

## Commissioner Results — Slot Occupancy

`_resultOccupant()` (commissioner-results.js) reads the feeder's `winner` directly — **not** `buildDrawView`-derived `m.p1`/`m.p2`. This prevents the commissioner's own predictions from leaking into empty slots and prevents confirming a winner on a projected matchup. Round 0 always shows the real draw.
