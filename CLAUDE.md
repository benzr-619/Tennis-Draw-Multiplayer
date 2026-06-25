# CLAUDE.md — Slam Bracket Multiplayer

Source of truth: describes **how the code works now**. Read before touching any code. History lives in `CHANGELOG.md` (not loaded each session).

## [AUTOMATIC MAINTENANCE]

New area-specific detail is appended directly to a targeted `.claude/rules/<area>.md` with a one-line pointer here — no rewrite of this file. Changing behavior already documented here requires confirmation first.

**After every session where a bug was fixed, a schema fact was discovered, or a gotcha was identified: update the relevant `.claude/rules/<area>.md` file immediately — do not wait to be asked.** If no rules file fits, create a new one under `.claude/rules/`. This is mandatory, not optional.

---

## Automatic Maintenance Rule

When a chat introduces detailed, area-specific conventions (rendering rules, lock behavior, leaderboard internals, UI layout, etc.), offload them directly into `.claude/rules/<area>.md` and add a one-line reference here — do NOT accumulate them in §12. Append dated narrative to `CHANGELOG.md`; update this file only when *current behavior* changes.

Current rules files:
- `.claude/rules/ui-detail.md` — full header/segment layout details
- `.claude/rules/bracket-rendering.md` — elim slot rendering, viewer card painting, `buildDrawView` projectFromPick mode
- `.claude/rules/lock-conventions.md` — lock scoping function names, countdown details, scheduled locks list
- `.claude/rules/leaderboard-detail.md` — SLAM_COLORS, grid values, tab internals, viewer entry point
- `.claude/rules/supabase-mcp.md` — Supabase MCP connector: project ID, table schemas, how to run migrations/SQL without manual dashboard work
- `.claude/rules/betting.md` — Match Yield betting layer: scoring formula, odds lifecycle, sport keys, name matching, DB objects, first-slam troubleshooting
- `.claude/rules/between-slams.md` — app_settings table, hasActiveDraw(), getting-ready screen, commissioner form

---

## 0. Repo Hygiene

- `.gitignore` covers `node_modules/`, `dist/`, `.env.local`, `*.timestamp-*.mjs`, `_archive/`, `.DS_Store` — never committed.
- **Do NOT read** `reference/index.html`, `_archive/`, `dist/`, `node_modules/`, or any `*.sql` data dump unless explicitly told to.
- `.env.local` holds a publishable key (`sb_publishable_…`) in `VITE_SUPABASE_ANON_KEY`. Publishable keys ship to browsers by design — **RLS is the security boundary, not key secrecy.**
- **REMAINING BEN ACTION:** disable the legacy `anon` key in Supabase dashboard (kills the one in git history). Optional: migrate JWT secret for asymmetric signing.
- **RLS confirmed (2026-06-07):** all five tables (`profiles`, `draws`, `matches`, `picks`, `lock_schedules`) have RLS enabled.
- **Supabase MCP connected** — use it for schema changes and SQL queries instead of the dashboard. See `.claude/rules/supabase-mcp.md`.
- **Regression harness:** `test-harness/` drives real `picks.js` + `data.js` + `bracket.js placeCard` in Node. Run before/after any bracket-state change: `cd test-harness && node --import ./register.mjs ./harness.mjs`, diff against `GOLDEN.frozen.txt`.

---

## 1. App Overview

Shared pick pool for Grand Slam tennis. ~20 players (friends and family), one pool, no public signup. Commissioner uploads TNNS Live draw PDFs, edits player names, manages lock windows. Players make picks before locks and backup picks when their originals are eliminated. Leaderboard shows scores and stats across draws.

Reference implementation: `reference/index.html`. Port logic, CSS tokens, scoring, and bracket renderer from there rather than rewriting.

---

## 2. Tech Stack

- **Vite** — build tool. Vanilla JS, ES modules. No framework, no client-side router.
- **Supabase JS client (`@supabase/supabase-js`)** — auth (email/password) + Postgres.
- **Google Fonts** — Playfair Display (ital,wght 400/600), DM Mono (400/500), DM Sans (300/400/500/600).
- **No other runtime deps.** No React, no Vue, no component library.
- **PWA:** `manifest.json` + icons. **Print:** A3 portrait — `buildPrintHTML()` generates a standalone document.

---

## 3. Screen Map

| ID | Who | Purpose |
|---|---|---|
| `screen-auth` | Everyone (logged out) | Login + signup |
| `screen-bracket` | Players | Active draw view, pick-making |
| `screen-commissioner` | Commissioner | Draw upload, player editing, lock managing, result confirmation |
| `screen-leaderboard` | Players | Stats comparison across all players |
| `screen-viewer` | Players | Read-only original-picks viewer; separate from screen-bracket |

**Navigation:** after login → everyone lands on `screen-bracket`. Commissioner role is a *capability layered on top of a normal player account*. `routeAfterAuth()` reveals `.commish-nav` entries when `state.currentUser.is_commissioner`. Entering: `enterCommissioner()` → `initCommissioner()` (idempotent) + `showScreen('screen-commissioner')`. `#exit-commish-btn` returns to `showBracketScreen()`. **Cmd/Ctrl+E** toggles (gated on `is_commissioner`), wired as global keydown in main.js.

No slam dropdown — one live slam at a time, static text in header. Past slams via leaderboard → Your Draws tab only.

**Header grammar:** page-level tabs (`.hdr-nav-link`, DM Sans 14px, accent underline) for screen switching; in-page view-switching uses segmented controls (rounded track, uppercase DM Mono 11px, `animateSegThumb()` sliding-pill animation). See `.claude/rules/ui-detail.md` for full layout.

---

## 4. Module Map

```
src/
  main.js — DOMContentLoaded, init, screen wiring
  supabase.js — Supabase client init
  auth.js — login, signup, logout, session management
  state.js — local state cache, activeDraw(), applyTheme()
  bracket-layout.js — renderBracketLayout(): SHARED geometry (positions, connectors, labels, champion
    box). No pick state. Shared by bracket.js, viewer-bracket.js, commissioner-results.js.
  draw-view.js — buildDrawView(): SINGLE pure derivation of round-2+ slots, elim flags, m.elimLabels.
    THE only place slot/elim/label state is computed.
  bracket.js — renderBracket() + placeCard(): live bracket card painting only
  picks.js — handlePickClick(), cascadeMatchPickForward(), clearMatchPickForward(),
    withdrawalClearForward(), updatePlayerNameForward()
  scoring.js — calcMatchScore(), calcStats(), calcHealthPts()
  stats.js — renderStats(), stats bar pills
  lock.js — isMatchLocked() + lock/unlock helpers
  commissioner.js — orchestrator + Draw Management tab + commissioner header
  commissioner-shared.js — $c(), escHtml()
  commissioner-results.js — Results tab: renderResults(), winner confirm/undo
  commissioner-locks.js — Lock Managing tab orchestrator: renderLockManaging()
  commissioner-locks-orig.js — Original Picks lock controls
  commissioner-locks-backup.js — Backup Pick locks + Scheduled Locks list
  leaderboard.js — renderLeaderboard(), stats aggregation
  viewer-bracket.js — renderViewerBracket() + placeViewerCard(): read-only viewer painting
  print.js — buildPrintHTML() (ported verbatim)
  parser.js — extractPdfText(), parseTnnsText(), buildInitialRounds()
  seg-thumb.js — animateSegThumb(container, oldIdx, newIdx)
index.html / vite.config.js / .env.local (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
```

---

## 5. Data Model

**Local state** (in-memory, no localStorage):
```js
state = { draws: Draw[], activeTab: number, currentUser: Profile | null }
```

Draw, Round, Match, Player shapes match the reference app (see `reference/index.html` §4).

### Authoritative vs. derived state

**Authoritative fields** (from DB, source of truth): round-0 `p1`/`p2`, `winner`/`score`, and per-user `matchPick`, `originalPick`, `originalPickResult`, `matchPickResult`, `highConfidence`, `editedAfterLock`, `notes`.

**Everything else is DERIVED** by `buildDrawView(d)` (`src/draw-view.js`) — the ONE place slot/elim/label state is computed. Pure and idempotent. **Never reconstruct slots or replay eliminations anywhere else. Call `buildDrawView` after any authoritative change.**

`buildDrawView` step order:
1. Build round-2+ slots from feeders via `winner || originalPick || matchPick`
2. Build `eliminated` Set = losers of every decided match
3. Flag `elim` on every undecided slot whose occupant is eliminated; null any dead backup `matchPick`
4. Emit `m.elimLabels` (displaced-pick labels), side resolved from feeders' `originalPick`

Viewer mode: `buildDrawView(d, { projectFromPick: true })` — pick-first slots, eliminated set from `actualP1`/`actualP2`, no displaced-label pass. Only `assembleDrawForUserOriginalPicks` passes this flag. See `.claude/rules/bracket-rendering.md`.

Additional fields vs. reference:
```js
Match { db_id: string }  // Supabase matches.id — needed for pick upserts

Pick {
  match_id: string,
  matchPick: string | null,                      // DB col: match_pick. Pre-lock = original intent;
                                                 //   post-lock = backup pick (or original if unchanged).
  original_pick: string | null,                  // Snapshotted at lock. Sacred post-lock.
  originalPickResult: 'correct'|'wrong'|null,    // Drives scoring + draw accuracy
  matchPickResult: 'correct'|'wrong'|null,       // Drives match accuracy
  high_confidence: boolean,
  edited_after_lock: boolean
}
```

### Supabase schema (see `migrations.sql` for full definitions)

- `profiles` — extends `auth.users`; `display_name`, `is_commissioner`
- `draws` — one row per slam+draw_type+year; `is_active` flags current slam. Confirming new slam sets all existing to false.
- `matches` — 127 rows per draw (rounds 0–6); shared across users; winner/score set by commissioner
- `picks` — one row per user×match; upserted on every pick change
- `lock_schedules` — commissioner-defined lock windows; `locked_at` set when fired

### Key Supabase access patterns

- **Load draw:** `draws` → `matches` → `picks` for current user → assemble
- **Save pick:** upsert `picks` (all Pick fields)
- **Confirm result:** `applyWinner()` sets `originalPickResult` and `matchPickResult` independently per pick row
- **Lock original picks:** `draws.original_picks_locked = true`; snapshot `picks.original_pick = picks.match_pick` for all users
- **Lock backup picks:** `lock_schedules.locked_at = now()`

---

## 6. Auth & Roles

- Supabase email/password. Display name stored in `profiles.display_name`.
- `profiles.is_commissioner = true` on exactly one account (set manually in dashboard).
- After login, fetch `profiles` row; store in `state.currentUser`.
- Commissioner UI gated on `state.currentUser.is_commissioner`. **Always check role before write operations — never rely on UI hiding alone.**
- No forgot-password UI — commissioner handles via dashboard.

---

## 7. Pick Semantics

**Pre-lock:** click records `matchPick`; later slots derive via `buildDrawView`. Changing a pick clears orphaned forward picks via `clearMatchPickForward()`.

**Post-lock (normal backup pick):** purple styling, no slot change. `cascadeMatchPickForward()` sets `nm.matchPick` only — never touches `p1`/`p2`. Passes through elim'd slots, breaks at confirmed winners. Persisted via `saveCascadeToSupabase`. Only available when match has no result yet.

**Post-lock draw-change repick (`editedAfterLock: true`):** commissioner replaces a player after lock → only that match flagged (`editedAfterLock = true`, `originalPick = null`, `matchPick = null`). Forward rounds untouched.

Player clicks a flagged match → **confirmation modal** (`#pick-confirm-modal`; `showPickConfirm(playerName)` → `Promise<bool>` in picks.js). On confirm: `matchPick = originalPick = p.name`, `editedAfterLock = false`. No cascade. Code checks the next round's slot; if changed, that slot also gets `editedAfterLock = true`, propagating one round at a time.

`original_pick` is sacred post-lock. Never mutate it except via draw-change repick.

---

## 8. Lock Architecture

**Mental model: scheduling = committing.** No confirm dialog at fire time. Unlocking is rare/testing only.

- **Original picks lock:** global per draw. Schedules a `lock_schedules` row (`lock_type='original_picks'`) or "Lock now" calls `_doLockOriginalPicks(d)` directly.
- **Backup pick locks:** per `lock_schedules` row, covering `(round_index, match_index_start, match_index_end)` (`lock_type='backup_picks'`). Commissioner selects cards → schedules or "Lock now". Unlock: scheduled rows deleted; locked rows get `locked_at = null`.
- Lock state read from Supabase on draw load.
- **All lock checks are draw-scoped** — filter `ls.draw_id === d.db_id` everywhere. A lock on one draw must never block picks on another. See `.claude/rules/lock-conventions.md` for function list.
- **SQL + pg_cron:** `fire_scheduled_locks()` PL/pgSQL runs every minute. For `original_picks`: snapshot `match_pick → original_pick`, set `draws.original_picks_locked = true`, delete row. For `backup_picks`: set `locked_at = now()`. Requires pg_cron + pg_net in Supabase Dashboard → Extensions.

---

## 9. Scoring

`ROUND_CONFIG[ri].base` → `[1, 2, 3, 6, 10, 18, 32]` for ri 0–6. Upset bonus = `numericSeed(winner) - numericSeed(loser)`, floored at 0. Unseeded/Q/WC/LL/PR = seed 33. Unseeded vs. unseeded = 0.5 flat. Only correct original picks score; backup picks track accuracy only.

**Draw Health:** share of bracket's full point value still in play. `maxHealthPts` = base points of ALL original picks (constant). `reachableHealthPts` = picks confirmed correct OR still in slot and not `elim` (per `buildDrawView` flags). `calcHealthPts(d, filterRi)` clones draw, nulls winners after `filterRi`, re-runs `buildDrawView`. Leaderboard stats: Score, Draw Accuracy, Match Accuracy, Draw Health — no chalk comparison.

**Slam Index:** pool-adjusted composite — `100 + 15 × avg(z_DrawYield, z_MatchYield)`. Population z-scores within players with ≥1 pick for that draw. Pool < 2 or stddev = 0 → z = 0 (index = 100). Pure function `calcSlamIndex(entries)` in `scoring.js`. On draw load/refresh, `fetchPoolSlamIndex()` in `stats.js` fetches all picks via `loadDrawStatsForAllUsers`, extracts current user's value, and re-renders the stats bar.

---

## 10. Leaderboard

**Per-slam view:** Score, Draw Accuracy %, Match Accuracy %, Draw Health %, Slam Index per player. Separate MS/WS rows. Sortable.
**Year-to-date / all-time:** Average score, overall Draw/Match Accuracy, avg Slam Index. Not split by MS/WS.
Three tabs: `slams`, `records`, `yourdraws`. Records tab has four cards per period: Avg Score | Match Yield | Slam Index | Top Draws. See `.claude/rules/leaderboard-detail.md` for SLAM_COLORS, grid values, tab internals, and viewer entry point.

---

## 11. Commissioner Screen

Reached via account-menu "Commissioner" entry (`enterCommissioner()`); exited via "Back to draw" (`#exit-commish-btn`). Commissioner is also a normal player.

1. **Draw management** — PDF upload → parse → review/edit R1 → confirm (replaces existing same slam+draw+year; auto-deactivates previous slam)
2. **Player editing** — edit name/seed post-upload
3. **Results** — match-by-match winner confirmation. `_resultOccupant()` reads feeder `winner` directly (not `buildDrawView` p1/p2) — never shows projected picks in empty slots. Round 0 always shows real draw.
4. **Lock managing** — visual bracket; original picks lock + backup pick locks. See §8.

---

## 12. Rules & Conventions

**No localStorage.** All persistence through Supabase.

**State mutation order:** `savePickToSupabase()` (async, await) → `renderStats()` → `renderBracket()`.

**`$()` shorthand:** `function $(id){return document.getElementById(id)}`. Never redefine or shadow it.

**CSS:** all colors via `var(--token)`. Slam theme tokens on `body.theme-AO` etc. Port the full `:root` block from reference verbatim.

**Typography:** Playfair Display for player names/headings. DM Mono for seeds/labels/stats. DM Sans for body/buttons/chrome. Do not substitute.

**`renderBracket()` is destructive** — clears and rebuilds from scratch. Never cache DOM references to bracket cards across renders.

**Shared geometry, separate painting.** `renderBracketLayout()` in `bracket-layout.js` owns all geometry; each renderer owns its own `placeCard(draw, match, ri, mi, x, y, wrap)` callback for painting only. Never duplicate geometry; never share painting logic between live and viewer.

**Print is standalone.** `buildPrintHTML()` receives the assembled `Draw` object; must not reference Supabase or async data.

**Defensive defaults.** Apply defaults for nullable fields in the assembly function, not in render code.

**Key signatures:**
- `state.draws[i].draw` = `'MS'`|`'WS'`; `state.draws[i].db_id` = Supabase `draws.id`; `match.db_id` = Supabase `matches.id`
- `handlePickClick(ri, mi, p, { renderStats, renderBracket })` and `applyWinner(d, ri, mi, winnerName, { renderStats, renderBracket })` — callbacks passed in to avoid circular imports

**Elim slot rendering:** eliminated original pick stays in-card, red + crossed-out (`pr s-orig-wrong`), no click handler. No floating label until a confirmed feeder winner displaces it. See `.claude/rules/bracket-rendering.md` for Case 1/2 detail and viewer card painting.

---

## 13. Feature Status

**Built:** foundation, commissioner screen, leaderboard, polish, viewer, lock architecture (incl. scheduled-locks list), post-lock backup-pick cascade, `buildDrawView` derived-state model, Match Yield betting layer (odds polling, name matching, commissioner Odds tab, bracket card odds display), Records tab trophy-room redesign, Slams tab live-board redesign (stage 3: live slam header + sortable M/W cards + movement arrows + health underlines + storyline chips + past-slam compact/expand + generic list modal), draw notification email (Supabase Edge Function `send-draw-notification` + Resend; `draws.notified_at` column; `get_resend_api_key()` vault helper; standalone HTML email template in `Multiplayer/wimbledon-2026-email.html`).

**Naming note:** "Score" is labelled **Draw Yield** everywhere in the UI (stats bar, leaderboard). Internal key remains `score` in JS stats objects. Chalk display removed from UI; code retained in `scoring.js` / `stats.js` (commented out) for future re-enable.

**Not yet built:**
- Commissioner "Notify Players" button (Edge Function is deployed; button in commissioner screen not yet wired — see Claude Code prompt in session notes)
- Automated tests (`test-harness/` golden exists; see §0)
- Mobile layout (desktop-only; mobile version is a future phase)
