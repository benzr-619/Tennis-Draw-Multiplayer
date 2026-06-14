# UI Detail — Headers, Segmented Controls, Navigation

Read this when working on headers, navigation, or segmented controls.

## Header Layout — Player Screens (bracket + leaderboard)

- **Row 1 left:** slam name → `.hdr-nav` tabs (`#nav-bracket` "Draw" / `#nav-leaderboard` "Leaderboard"; `.hdr-nav-link`, DM Sans 14px, accent underline when active)
- **Row 1 center:** search bar (bracket only; leaderboard user-search is not yet built)
- **Row 1 right:** borderless refresh `.icon-btn` + `.acct-chip` → dropdown `.acct-menu` holds Print (`#print-btn`, bracket only — **not** on leaderboard) and Sign out (`.acct-mi-danger`)
- **Row 2:** `.row2-seg` with M/W `.seg-btn` toggle, then `.stats-strip` (`flex:1`)

## Header Layout — Commissioner Screen

- **Row 1 left:** slam name (`#comm-slam-name`) → `#comm-hdr-nav` with three `.hdr-nav-link` tabs: "Draw Management" / "Results" / "Lock Managing" (`data-tab` drives pane switching)
- **Row 1 center:** search bar (always visible; cross-tab search is a future feature)
- **Row 1 right:** borderless refresh `.icon-btn` (`#api-sync-btn-cmsr`) + `.acct-chip` (`#acct-chip-cmsr`) → `#acct-menu-cmsr` holds Sign out only
- **Row 2:** `.hdr-row2` with M/W `.seg-btn` toggle (`#comm-seg-control`). No stats strip.
- Shared helpers from `main.js`: `wireAcctMenu`, `closeAcctMenus`, `doRefresh`. `renderResults`/`renderLockManaging` imported into main.js for the refresh callback.

## Header Layout — Leaderboard Screen

Mirrors bracket header (slam title + nav + refresh + account; **no Print**). Three tabs (Slams/Records/Your Draws) render inside `.lb-tabseg`. `renderHeader` sets both slam-name labels and both `hdr-user*` names.

## Segmented Control / Sliding-Thumb Animation

All three segmented controls (player M/W, commissioner M/W, leaderboard tabs) use `animateSegThumb(container, oldIdx, newIdx)` from `src/seg-thumb.js`. An absolutely-positioned `.seg-thumb` div glides between options via `left`/`width` CSS transition (0.22s ease). Container: `position:relative`; buttons: `position:relative; z-index:1`; thumb: `z-index:0`.

Module-level prev-index trackers:
- `_segPrevIdx` — main.js (player M/W)
- `_commSegPrevIdx` — commissioner.js (commissioner M/W)
- `_lbTabPrevIdx` — leaderboard.js (leaderboard tabs)

On first render (prev = −1): thumb placed directly at new position, no animation.

## Navigation Grammar Rule

- **Page-level tabs** (`.hdr-nav-link`): DM Sans 14px, accent underline when active — for switching between screens (Draw / Leaderboard)
- **In-page view-switching** (`.seg-btn`, `.lb-tab`): rounded `var(--surface2)` track, active pill = `var(--surface)` bg + accent text, uppercase DM Mono 11px labels — for M/W toggle and leaderboard tab switching

## Stats Bar — Post-lock Layout (56px strip)

`hdr-row2` height is **56px** (12px taller than other row-2 bars) to accommodate the health underline at the bottom. The drawer (`#stats-drawer`) is `position:absolute;top:100%` below the strip. No hover tooltips on bar stats — definitions live only in the drawer.

### Bar anatomy (left → right)

1. **Round filter** (desktop only) — small pill buttons, `padding:0 10px 18px 14px` to reserve space above the health underline.
2. **`.sc-hero`** — Slam Index hero: Playfair Display 28px 600 value + DM Mono 10px uppercase accent label beside it. `padding:9px 16px 18px`. Right border `var(--border2)`.
3. **`.sc-yields`** — flex container of two **`.sc-yield-cell`** divs side by side, each `padding:9px 14px 18px`: Draw Yield on left, Match Yield on right. Each cell: `.sc-yield-lbl` (DM Mono 9px uppercase accent) stacked above `.sc-yield-val` (DM Mono 15px weight-500). `.sc-yield-val.sc-dim` = `var(--text3)` when no resolved match yield.
4. **Flex spacer** — `flex:1`.
4b. **`.sc-guide-btn`** — inline "STATS GUIDE" pill, immediately after the yields and before the spacer. DM Mono 9px uppercase `var(--text3)`, letter-spacing .08em, 1px solid `var(--border2)`, border-radius 13px, padding 4px 10px, transparent bg. Contains text + `.sc-guide-chevron` (▾ 12px, `var(--text3)`), gap 5px. `align-self:center` so it sits vertically centered with the stat values. Hover + open state: bg `var(--surface2)`, text/chevron `var(--text2)`. `:focus-visible` → border `var(--accent)`. No default outline. Chevron rotates 180° (0.2s) when `.open`. `aria-expanded` reflects drawer state. Hidden on mobile (`display:none!important`). Toggles `_drawerOpen` and `.open` on `#stats-drawer`.
5. **`.sc-countdown`** (desktop only, compact) — inline lock SVG + `.sc-countdown-txt` (DM Mono 11px accent). `.countdown-clickable` adds `cursor:pointer` and hover `background:var(--accent-dim)`; the text gets an underline that appears on hover. Wraps `_countdownClickHandler` click exactly as before.

### "—" gating

Until `d.rounds.some(r => r.matches.some(m => m.winner))` is true, Slam Index, Draw Yield, and Match Yield all display "—". No explanatory note.

### Health underline

Full-width **5px** colored bar at `bottom:0` of `#stats-strip` (`position:relative`). Created lazily in JS (`_getOrCreateHealthEl`) and re-appended each `renderStats()` call (since `strip.innerHTML = ''` destroys it).

Above the bar: a 13px label row with the % value (DM Mono 9px, hue-matched darkened color) positioned at `left: clamp(3%,pct%,97%); transform:translateX(-50%)`, and "Draw Health" right-aligned faint label.

**Hue formula:** Remap raw pct to effective range before computing hue — `eff = clamp((pct − 25) × 100 / 65, 0, 100)`, then `hue = 4 + eff × 1.4`. So 25% health → full red, 90%+ → full green, linear between. Rationale: realistic floor is ~25% (many picks already lost) and ceiling ~90% (332-pt base scoring means perfect health is rare). Label color: `hsl(h, 65%, 34%)`. Bar fill: `hsl(h, 75%, 48%)`. The displayed % value and bar position always use the true `pct`, never `eff`.

Total underline height: 18px (13px label row + 5px bar). Bar element bottom padding is 18px to clear it. Hidden on mobile (`display:none!important`).

### Details drawer (`#stats-drawer`)

Six rows (grid: `130px 56px 1fr 22px`):

| Row | Has ⓘ |
|---|---|
| Slam Index | ✓ |
| Draw Yield | ✓ |
| Match Yield | ✓ |
| Draw Accuracy | — (fraction in def) |
| Match Accuracy | — (fraction in def) |
| Draw Health | ✓ (hue-colored value) |

`.sd-math` sections expand below their row with `max-height` transition. Only one open at a time (`_drawerMathOpen` tracks id). State (`_drawerOpen`, `_drawerMathOpen`) persists across `renderStats()` re-renders; resets when `d.db_id` changes.

Drawer hidden on mobile (`display:none!important`).

**Pre-lock:** standard "picks filled" / "complete" pills (unchanged). Health underline and drawer do not render.
