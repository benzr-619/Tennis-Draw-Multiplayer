# Print Layout Conventions

Read this when working on `src/print.js`.

## Overview

`buildPrintHTML(d)` returns a complete, standalone HTML document (two A3 portrait pages). No async, no Supabase — receives an assembled Draw object. Imports only `isBackupPick` from `scoring.js`.

## Page & Column Geometry

| Constant | Value | Notes |
|---|---|---|
| `FINALS_H` | 13 mm | Finals bar height (12 mm bar + 1 mm margin) subtracted from BODY_H |
| `BODY_H` | 368 mm | `381 - FINALS_H` — usable bracket height per page |
| `R1_PER_PAGE` | 32 | R1 matches per page |
| `PAIR_GAP` | 1.6 mm | Gap between consecutive match pairs |
| `unit` | ≈ 9.92 mm | `(368 - 31×1.6) / 32` — height per R1 slot |
| `rowH` | ≈ 4.96 mm | `unit/2` — one player row |
| `colW` | `[40, 40, 40, 40, 40, 40]` | Uniform 40 mm per column, ri=0–5 (R64→SF) |
| `gapW` | 3 mm | Gap between columns |
| Used width | 255 mm | 6×40mm cols + 5×3mm gaps |
| Usable width | 257 mm | 277mm page − 20mm padding |

The Final (round 6) is **not** a printed column — it appears in the Finals bar.  
`drawRounds = rounds.length - 1` controls the column loop (ri = 0..5).

## Match Card

Every match (both player rows) is wrapped in a card:
- `height: unit mm; box-sizing: border-box` — border included in height, no expansion
- `border: 0.4pt solid #d4d0c8; background: #f9f8f6; border-radius: 0.6mm; overflow: hidden`
- Pick-state color semantics are encoded in `nameLineHTML()` per-row (not at the card level)

**R1 cards have a two-layer structure** (needed for connector stubs):
```
outer container: height:unit; position:relative; overflow:visible   ← rightStub lives here
  inner card:    height:unit; box-sizing:border-box; overflow:hidden ← player rows live here
```
The outer container must be `overflow:visible` so the right stub can extend into the adjacent gap. The inner card is `overflow:hidden` to clip player-row text. Do NOT merge them — the rightStub will be clipped.

**R2+ cards** live inside a slot div (also `position:relative; overflow:visible`) which handles both centering and connector stubs.

## Elbow Connectors

Three-piece elbows connect each feeder card to its target:

1. **Right stub** — horizontal, from feeder card right edge into the gap (`width: gapW/2 = 1.5mm`, `right: -1.5mm`)
2. **Vertical arm** — from card center to PAIR_GAP midpoint past the slot boundary (`±0.8mm = PAIR_GAP/2`)
   - Even i (top feeder): `top:50%; bottom:-0.8mm` — arm descends
   - Odd i (bottom feeder): `top:-0.8mm; bottom:50%` — arm ascends
3. **Left stub** — horizontal, into target card from the left gap (`ri ≥ 2` only; R1 has no left stub)

All connector elements: `position:absolute; background:#bbb; height or width: 0.5pt`. The slot div (or R1 outer container) must be `position:relative; overflow:visible`.

The **SF column (ri=5, isLast=true)** gets a special right stub only on `isTopHalf`:
- Width: full `gapW = 3mm` (reaches champion box left edge)
- No vertical arm or left stub on the last column

## Finals Bar

A compact horizontal strip shown on **both pages**, positioned between the header and the round labels. It replaces the old champion column that lived in the bracket body.

- **Height:** fixed `12mm` (`height:12mm;flex-shrink:0`) + `1mm margin-bottom` = `FINALS_H = 13mm` total
- **Layout:** flex row, three sections:
  1. **"FINAL" label tab** — DM Mono 5pt uppercase, muted #999, right border separating it from finalists
  2. **Finalists section** — `flex:1`, two `nameLineHTML()` rows centered vertically; pick-state colors apply (green ✓ correct, red ✗ wrong, etc.)
  3. **Champion section** — right-aligned, left border in `accent` color, white background; "CHAMPION" label (DM Mono 4.5pt) + winner name (Playfair 9pt 600, accent)
- **Source:** `finMatch = rounds[rounds.length-1].matches[0]` (Final, ri=6); `champName = finMatch.winner || finMatch.matchPick || '—'`
- **Both pages:** intentional — the Final is the featured match for the whole tournament, not just one half
- The SF column (`isLast=true`) no longer needs a right stub to reach a champion box — connectors stop at the SF column

## Typography

- Player names: `'Playfair Display', Georgia, serif` — `font-size: 7.5pt`
- Seeds and labels: `'DM Mono', monospace` — `font-size: 5pt` (seeds), `5.5pt` (round headers), `7pt` (meta)
- Round header labels: DM Mono uppercase, `letter-spacing: 0.1em`, `color: #999`

## Section Dividers in R1

At quarterfinal boundaries (`g === q` or `g === half + q`), an extra 1.5mm gap with a dashed line replaces the standard PAIR_GAP. This creates a visible separation between QF sections. These boundaries exist only in the R1 column — later-round columns use uniform PAIR_GAP throughout.

## Accent Colors

```js
{ AO: '#1048a0', RG: '#8b2615', WIM: '#1a5c2a', USO: '#1048a0' }
```
