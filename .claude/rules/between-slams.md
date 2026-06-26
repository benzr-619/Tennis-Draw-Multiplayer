# Between-Slams "Getting Ready" Screen

Read this when working on the between-slams state, app_settings, or the commissioner Getting Ready Mode form.

## app_settings Table

Singleton Supabase table — always exactly one row with `id = 1`.

| Column | Type | Purpose |
|---|---|---|
| `id` | int PK (always 1) | Singleton enforced by PK |
| `next_slam_label` | text nullable | Displayed as the title on the overlay (e.g. "Wimbledon 2026") |
| `next_slam_starts_at` | timestamptz nullable | When matches begin; drives the countdown |

**RLS:** all authenticated users can SELECT; only commissioners can UPDATE/INSERT (mirrors lock_schedules pattern).

**Upsert pattern:** always `{ id: 1, ... }` — Supabase uses the PK for conflict resolution, so this always updates the existing row after the initial seed.

## hasActiveDraw() vs state.draws.length === 0

`hasActiveDraw()` (`src/state.js`) returns `state.draws.some(d => d.is_active)`.

The between-slams state is triggered by `!hasActiveDraw()`, which covers two cases:
- **Zero draws in DB** (first-ever launch, empty account)
- **All draws have `is_active = false`** (commissioner has ended the current slam but not yet uploaded the next one)

Before this feature, only the zero-draws case was handled — the fallback in `loadAllDraws` (data.js ~line 34) would pick the last-indexed draw when none was active, showing a stale finished bracket.

## Overlay Approach in showBracketScreen() (main.js)

**No chrome is hidden.** The full bracket renders normally in the background; a fixed-position overlay floats on top covering the full viewport.

When `!hasActiveDraw()`, `showBracketScreen()`:
1. Calls `applyTheme(d.slam)` on the last inactive draw (if any), then `renderHeader()`, `renderStats()`, `renderBracketDisplay()` — the last slam renders in full behind the overlay
2. Appends a `.getting-ready-overlay` div to `#bracket-area`
3. Sets `overlay.innerHTML = await renderGettingReady()` — the logo + title + countdown card
4. Wires `overlay.addEventListener('click', () => overlay.remove())` — tap/click anywhere dismisses the overlay and lets users browse the last draw

When `hasActiveDraw()` becomes true (new slam uploaded), the active-draw path removes any lingering overlay: `$('bracket-area')?.querySelector('.getting-ready-overlay')?.remove()`.

Page-level nav (Draw/Leaderboard tabs) and all chrome remain fully interactive — the overlay is CSS `position:fixed; z-index:100` covering only what's rendered, not the entire DOM.

## #bracket-area Wrapper (index.html)

`#bracket-body` is wrapped in `<div id="bracket-area">`:
```html
<div id="bracket-area">
  <div class="bracket-body" id="bracket-body"></div>
</div>
```

CSS: `#bracket-area { flex:1; position:relative; overflow:hidden; display:flex; flex-direction:column }` — takes the `flex:1` role that `#bracket-body` previously had in `#screen-bracket`'s column. `#bracket-body` keeps its own `flex:1` to fill `#bracket-area`.

The overlay is appended to `#bracket-area` (DOM parent) even though it's `position:fixed` — the parent doesn't affect fixed positioning, but keeps the overlay easy to find via `$('bracket-area').querySelector('.getting-ready-overlay')`.

## .getting-ready-overlay CSS (index.html)

```css
.getting-ready-overlay { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px); }
.getting-ready-overlay::before { content:''; position:absolute; inset:0; background:var(--bg); opacity:0.70; z-index:-1; }
```

`position:fixed` covers the full viewport including header and stats row. `::before` provides the tinted frost (70% bg opacity). Content (logo + text) floats above via stacking context.

## renderGettingReady() (main.js)

Async function that returns an HTML string. Fetches `app_settings` id=1 with `.maybeSingle()`, then:
- **Logo:** `<img src="/icons/icon-192.png" border-radius:50%>` — circle clip removes the icon's cream square corners, showing just the green tennis ball motif
- If no `next_slam_label`: returns fallback with logo + "No draw uploaded yet."
- If label set: logo + slam name (Playfair 28px, `.bracket-empty-title`) + optional countdown (DM Mono 16px) + "tap anywhere to browse the last draw" hint (13px, 0.7 opacity)

Countdown format: "Matches start in N day(s)" when ≥1 day remaining; "Matches start in Xh MMm" for sub-day. No countdown if start time is in the past or not set.

The HTML is set as `overlay.innerHTML` — no card background, no separate DOM structure. Content sizes are large enough to read against the frosted overlay without a card.

## /?signup URL Param (main.js init)

Invite page links to `/?signup`. In `init()`, when no session exists, the code checks:
```js
if (new URLSearchParams(window.location.search).has('signup')) setAuthMode('signup')
```
This opens the auth screen in signup mode (display name field visible, button says "Sign up"). Visiting `/` directly defaults to login mode.

## Commissioner Getting Ready Mode Form

### HTML IDs (in `#comm-pane-draw` → `#comm-getting-ready-wrap`)

| ID | Element | Purpose |
|---|---|---|
| `comm-getting-ready-wrap` | `<div class="comm-section">` | Container, populated by `renderGettingReadySection()` |
| `comm-next-slam-label` | `<input type="text">` | Next slam display name |
| `comm-next-slam-starts-at` | `<input type="datetime-local">` | Start date/time (local time) |
| `comm-switch-getting-ready-btn` | `<button class="comm-btn-danger">` | "Go Live with Getting Ready Screen" — upserts app_settings AND deactivates all draws |
| `comm-getting-ready-msg` | `<div class="comm-msg">` | Success/error feedback |

### Key Functions (src/commissioner.js)

- `fetchAppSettings()` — reads app_settings id=1 row
- `renderGettingReadySection()` — async, populates `#comm-getting-ready-wrap`, wires the single button handler
- `_readNextSlamForm()` — reads form inputs, converts datetime-local to UTC ISO
- `handleSwitchToGettingReady()` — confirm → upsert app_settings → `draws.update({is_active:false}).neq('id','none')` → loadAllDraws → re-render

Single-button design: there is no separate "Save" button. The one button ("Go Live with Getting Ready Screen") does both — saves app_settings AND deactivates all draws.

`renderGettingReadySection()` is called fire-and-forget from `initCommissioner()` (after `renderExistingDraws()`). It is also re-called by `handleSwitchToGettingReady()` and `handleReactivateDraw()` to refresh the form after state changes.

### datetime-local ↔ UTC Conversion

`<input type="datetime-local">` yields a local-time string without TZ (e.g. `"2026-07-01T12:00"`). `new Date(str).toISOString()` converts to UTC using the browser's locale — correct behavior (commissioner sets local time; players see countdown computed from UTC). When reading back from DB for the form, use `d.getHours()` (local), NOT `d.getUTCHours()`.
