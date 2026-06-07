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
