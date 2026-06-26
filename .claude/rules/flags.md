# Player Country Flags

Read this when working on flag display, the IOC→ISO2 table, or country-code parsing.

## Overview

Each player row displays a small SVG flag between the seed and the name. The flag
gutter is **always rendered** (fixed width, `flex-shrink:0`) so names stay aligned
regardless of whether country data is available. Blocked nations (RUS/BLR) have no
code in the TNNS PDF and appear with a blank gutter — no broken-flag glyph.

## Parser Capture (`src/parser.js`)

Line 26 previously discarded the IOC country token. It now captures it first:

```js
const countryM = rest.match(/^([A-Z]{2,4})\s+/)
const country = countryM ? countryM[1] : ''
rest = rest.replace(/^[A-Z]{2,4}\s+/, '')
```

`parseTnnsText` returns `p1_country`/`p2_country` (3-letter IOC string, or `''`).
Codeless players (blocked nations) get `''` — no errors, no change to name/seed parsing.

## IOC→ISO2 Table (`src/flags.js`)

`IOC_TO_ISO2` maps 3-letter IOC codes to lowercase ISO 3166-1 alpha-2 codes used by
flag-icons. Notable non-obvious mappings:

| IOC | ISO2 | Country |
|-----|------|---------|
| ALG | dz | Algeria |
| BUL | bg | Bulgaria |
| CHI | cl | Chile |
| CRO | hr | Croatia |
| DEN | dk | Denmark |
| EST | ee | Estonia |
| GBR | gb | Great Britain |
| GER | de | Germany |
| INA | id | Indonesia |
| LAT | lv | Latvia |
| MAS | my | Malaysia |
| NED | nl | Netherlands |
| NGR | ng | Nigeria |
| POR | pt | Portugal |
| ROM | ro | Romania (legacy) |
| ROU | ro | Romania (TNNS PDF code — use this) |
| RSA | za | South Africa |
| SLO | si | Slovenia |
| SPA | es | Spain (legacy) |
| ESP | es | Spain (TNNS PDF code — use this) |
| TUR | tr | Turkey |
| SUI | ch | Switzerland |
| TPE | tw | Chinese Taipei |
| URU | uy | Uruguay |

`iocToIso2(ioc)` returns `null` for unknown codes (no broken-flag rendering).

## DB Schema

`matches.p1_country` and `matches.p2_country` — nullable TEXT, added 2026-06-26.
Only set on round-0 rows (inserted by the commissioner draw-upload path in
`src/commissioner.js`). All other rounds are NULL (countries are not cascaded).

## Per-Draw Country Map

`buildCountryMap(draw)` (in `flags.js`) is called in `src/data.js` `loadDraw`
immediately after rounds are assembled. It reads `p1.country` / `p2.country` from
round-0 match objects and returns `{ playerName → iocCode }`.

The map is attached as `d.countryMap` on the assembled draw object. It is NOT
cascaded through `buildDrawView` — the derived-state model doesn't touch it.

Renderers look up `d.countryMap?.[p.name]` to resolve a player's country in any
round, then pass the IOC code to `makeFlagEl`/`flagPrintHTML`.

## Always-Rendered Gutter (`.pr-flag`)

CSS (index.html):
```css
.pr-flag { min-width:18px; width:18px; height:11px; flex-shrink:0;
           display:inline-block; border-radius:1px; overflow:hidden;
           background-size:contain; background-position:50% 50%;
           background-repeat:no-repeat }
.pr-flag.fi { width:18px; height:11px; line-height:11px }
```

`makeFlagEl(iocCode)` creates the span and adds `fi fi-{iso2}` classes when a
valid mapping exists. When empty, the span still occupies its reserved width.

The `.pr-flag.fi` rule (specificity 0,2,0) overrides flag-icons' `.fi` rule
(specificity 0,1,0) which would otherwise set `width:1.333em; line-height:1em`.

## Renderers Touched

| File | Location |
|------|----------|
| `src/bracket.js` | Both `makeRow` paths (elim slot + normal slot) |
| `src/viewer-bracket.js` | Match-mode row builder + original-mode `makeOrigRow` |
| `src/print.js` | `nameLineHTML` closure (uses `flagPrintHTML` HTML-string helper) |

## Flag Library

flag-icons v7.2.3 via jsDelivr CDN:
- `index.html`: `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/css/flag-icons.min.css">`
- `src/print.js`: same link injected into the standalone print HTML `<head>`

Usage: `<span class="fi fi-{iso2}"></span>` — flag-icons applies the background-image.
