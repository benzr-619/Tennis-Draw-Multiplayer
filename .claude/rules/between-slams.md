# Between-Slams "Getting Ready" Screen

Read this when working on the between-slams state, app_settings, or the commissioner Getting Ready Mode form.

## app_settings Table

Singleton Supabase table — always exactly one row with `id = 1`.

| Column | Type | Purpose |
|---|---|---|
| `id` | int PK (always 1) | Singleton enforced by PK |
| `next_slam_label` | text nullable | Displayed as the title on the getting-ready page (e.g. "Wimbledon 2026") |
| `next_slam_starts_at` | timestamptz nullable | When matches begin; drives the countdown |

**RLS:** all authenticated users can SELECT; only commissioners can UPDATE/INSERT (mirrors lock_schedules pattern).

**Upsert pattern:** always `{ id: 1, ... }` — Supabase uses the PK for conflict resolution, so this always updates the existing row after the initial seed.

## hasActiveDraw() vs state.draws.length === 0

`hasActiveDraw()` (`src/state.js`) returns `state.draws.some(d => d.is_active)`.

The between-slams state is triggered by `!hasActiveDraw()`, which covers two cases:
- **Zero draws in DB** (first-ever launch, empty account)
- **All draws have `is_active = false`** (commissioner has ended the current slam but not yet uploaded the next one)

Before this feature, only the zero-draws case was handled — the fallback in `loadAllDraws` (data.js ~line 34) would pick the last-indexed draw when none was active, showing a stale finished bracket.

## Chrome-Hiding in showBracketScreen() (main.js)

When `!hasActiveDraw()`, `showBracketScreen()`:
1. Hides `#search-wrap` (style.display = 'none')
2. Hides `.hdr-row2` on `#screen-bracket` (style.display = 'none') — covers both M/W seg and stats strip
3. Sets `#print-btn` hidden = true
4. Hides `#mobile-bottom-bar` (style.display = 'none') — covers mobile M/W seg and mobile search

When `hasActiveDraw()` becomes true again, all four are restored with `style.display = ''` / `hidden = false`. Setting `style.display = ''` defers back to CSS — mobile-bottom-bar has `display:none` at desktop and `display:flex` at ≤768px, so this correctly re-enables it on mobile only.

Page-level nav (`#nav-bracket`, `#nav-leaderboard`) and the account chip remain visible — leaderboard stays fully functional without an active draw.

## renderGettingReady() (main.js)

Async function, called in the `!hasActiveDraw()` branch of `showBracketScreen()`. Fetches `app_settings` id=1 with `.maybeSingle()`, then:
- If no `next_slam_label`: returns plain "No draw uploaded yet." fallback HTML
- If label set: returns slam name in `.bracket-empty-title` (Playfair Display, existing class) + optional countdown in `.bracket-empty-sub` (DM Mono via inline style)

Countdown format: "Matches start in N day(s)" when ≥1 day remaining; "Matches start in Xh MMm" for sub-day. No countdown shown if start time has already passed or is not set.

HTML is written directly to `$('bracket-body').innerHTML` — does not go through `renderBracketLayout()`.

## Commissioner Getting Ready Mode Form

### HTML IDs (in `#comm-pane-draw` → `#comm-getting-ready-wrap`)

| ID | Element | Purpose |
|---|---|---|
| `comm-getting-ready-wrap` | `<div class="comm-section">` | Container, populated by `renderGettingReadySection()` |
| `comm-next-slam-label` | `<input type="text">` | Next slam display name |
| `comm-next-slam-starts-at` | `<input type="datetime-local">` | Start date/time (local time) |
| `comm-save-next-slam-btn` | `<button>` | Upserts app_settings only — does NOT deactivate draws |
| `comm-switch-getting-ready-btn` | `<button class="comm-btn-danger">` | Upserts app_settings AND deactivates all draws |
| `comm-getting-ready-msg` | `<div class="comm-msg">` | Success/error feedback |

### Key Functions (src/commissioner.js)

- `fetchAppSettings()` — reads app_settings id=1 row
- `renderGettingReadySection()` — async, populates `#comm-getting-ready-wrap`, wires button handlers
- `_readNextSlamForm()` — reads form inputs, converts datetime-local to UTC ISO
- `handleSaveNextSlam()` — upserts app_settings without touching draws
- `handleSwitchToGettingReady()` — confirm → upsert app_settings → `draws.update({is_active:false}).neq('id','none')` → loadAllDraws → re-render

`renderGettingReadySection()` is called fire-and-forget from `initCommissioner()` (after `renderExistingDraws()`). It is also re-called by `handleSwitchToGettingReady()` to refresh the form after the mode switch.

### datetime-local ↔ UTC Conversion

`<input type="datetime-local">` yields a local-time string without TZ (e.g. `"2026-07-01T12:00"`). `new Date(str).toISOString()` converts to UTC using the browser's locale — correct behavior (commissioner sets local time; players see countdown computed from UTC). When reading back from DB for the form, use `d.getHours()` (local), NOT `d.getUTCHours()`.
