# Real-Time Updates

Read this before touching live/realtime updates, `src/realtime.js`, `bracket.js`'s
`patchMatchScore`, or the commissioner Results-tab wiring in `commissioner.js`. Stages 1
(bracket screen) and 3 (commissioner Results tab) are built and tested (2026-07-03); see
**Implementation** at the bottom. The decision-record sections below predate the code.

Before stage 1: every screen was manual-refresh only (the header's `.icon-btn`) — no
client-side polling existed anywhere, including for the ESPN score feed (server-side
`pg_cron` writes every minute; clients only saw it on their next manual refresh or data
load). Stage 2 (leaderboard) is still manual-refresh only — not yet built.

## Decision: Supabase `postgres_changes`, not Broadcast from Database

Supabase now recommends "Broadcast from Database" over `postgres_changes` for
high-scale realtime (RLS re-checked per row per subscriber is a scaling cliff at
thousands of connections). At ~20 players this cliff never applies — `postgres_changes`
is simpler to wire (no separate broadcast-trigger setup) and matches this project's
"simplest thing that works for ~20 users" default (CLAUDE.md §"No new abstractions").
Do not introduce Broadcast/triggers unless player count grows by orders of magnitude.

## Scope & Rollout Order (Ben's call, 2026-07-03)

Driven by: there is an active live tournament in progress — safety against breaking
anything already working takes priority over full coverage. Build and ship in this
order, confirming each stage works before moving to the next:

1. **Bracket screen** — live scores, winner confirms, lock countdown. Ship this first,
   in isolation.
2. **Leaderboard** — refresh stats when a result lands elsewhere. The leaderboard's
   stats recompute is heavier (`loadDrawStatsForAllUsers`), so this needs its own
   debounce tuning (~2-3s trailing), not a copy-paste of the bracket wiring. Only
   recompute while the leaderboard screen is actually visible.
3. **Commissioner screen (Results tab)** — IN SCOPE, not skipped (refined 2026-07-03).
   Purpose: when the commissioner has the Results tab open, they should see the ESPN
   feed's detected winner/score land in realtime so they can manually confirm faster,
   without waiting for a manual refresh. This is a bridge feature — its value shrinks
   once `scores_autoconfirm_enabled` is turned on (see `.claude/rules/scores-feed.md`),
   since auto-confirm writes `matches.winner` itself without the commissioner needing to
   act at all. Still worth building: autoconfirm is off by default and may stay off for
   retirements/walkovers indefinitely (v1 explicitly excludes those from auto-confirm).
   No concurrent-edit scenario to solve for (exactly one `is_commissioner=true` account
   per CLAUDE.md §6) — this stage is purely about faster visibility, not conflict
   resolution.

## Tables in Scope

Only shared/public tables get realtime subscriptions — never `picks`:
- `matches` — winner, score, espn_state changes
- `lock_schedules` — lock fired / scheduled / cancelled
- `draws` — `original_picks_locked`, `is_active` flips
- `app_settings` — between-slams state changes

**Never subscribe to other users' `picks` rows.** No player needs to watch someone
else's picks live, it adds privacy surface, and RLS would be re-checked per row per
subscriber for no real benefit. A player's own pick selections live in local browser
state before being saved — there is no window where an incoming realtime message could
overwrite an unsaved in-progress pick.

## Two-Tier Update Model (the "don't clobber the user" mechanism)

1. **Patch tier** (high-frequency, low-stakes — e.g. ESPN score/espn_state ticking
   every minute): update only the affected match card's score footer DOM node directly.
   No `buildDrawView` recompute, no `renderBracket()` rebuild.
2. **Rebuild tier** (real state changes — winner confirmed, lock fired,
   `original_picks_locked` flips): requires a full `buildDrawView` recompute since
   derived slots/eliminations change downstream. Must be:
   - **Debounced** — batch bursts of incoming events, re-render at most ~once/second
     (bracket screen) or ~once/2-3s (leaderboard), not once per message.
   - **Scroll-safe** — capture scroll position before `renderBracket()` (which
     CLAUDE.md §12 already documents as destructive — clears and rebuilds from scratch)
     and restore it after.

## Kill Switch Requirement

Because this ships alongside an active live tournament, the realtime layer must be
buildable/removable as a clean bolt-on: if the subscription fails to connect or errors,
the app must fall back to exactly today's manual-refresh behavior, not break. Prefer an
easy toggle (env var or a single early-return) over threading conditionals through
existing render functions.

## Future Consideration — Not Decided, Not Being Built (noted 2026-07-03)

Ben floated a future direction: using ESPN match-start signals (rather than only
commissioner-scheduled `lock_schedules` rows) to auto-trigger backup-pick locks — e.g.
lock the next round the moment ESPN shows those matches have started. Explicitly
**not being built now** and called out as "not that important" even as a future item.
Noted here only so the `lock_schedules` realtime subscription (stage 1) isn't later
seen as redundant/removable — it may become the foundation for this kind of
match-start-triggered locking down the line. No design decisions have been made about
how that would work (it would be a bigger change: today locks are purely time-based
and commissioner-scheduled, never state-triggered).

## Not Decided Yet

- Exact debounce interval for stage 2 (leaderboard), whenever it's built (~2-3s guess).
- Whether stage 3 needs anything beyond visibility on the Results tab (e.g. a toast/
  highlight on newly-finished matches) — not specified yet, decide when building it.

## Implementation

### DB changes

`matches`, `lock_schedules`, `draws`, `app_settings` added to the `supabase_realtime`
publication (migration `enable_realtime_bracket_stage1`). `matches` also set to
`REPLICA IDENTITY FULL` — without it, a `postgres_changes` UPDATE payload's `old` only
carries the primary key, and the client can't tell a pure ESPN score tick apart from a
winner confirmation (needs `old.winner` to diff against `new.winner`). The other three
tables don't need full replica identity since every change on them goes straight to the
rebuild tier regardless of which column changed.

### `src/realtime.js`

One module, two independent subscription pairs (separate channel/debounce state each,
can run concurrently — e.g. a player on the bracket screen and the commissioner on
Results, in different sessions):

**Stage 1** — `startBracketRealtime(drawId, { patchScore, rebuild })` /
`stopBracketRealtime()`. Opens `bracket-rt-${drawId}`, subscribed to `matches` (filtered
`draw_id=eq.${drawId}`), `lock_schedules` (same filter), `draws` (filtered
`id=eq.${drawId}`), `app_settings` (unfiltered singleton). Tier classification happens
once, in `realtime.js`, not per-caller: a `matches` UPDATE where `old.winner !==
new.winner` always goes to the debounced `rebuild()` callback (~1s via `setTimeout`,
coalesces bursts). Everything else on `matches` goes to `patchScore(id, {score,
espn_state})`; if that returns falsy (match not found in the currently loaded draw),
`realtime.js` falls back to scheduling a rebuild itself. Any event on `lock_schedules`,
`draws`, or `app_settings` always schedules a rebuild.

**Stage 3** — `startResultsRealtime(drawId, onChange)` / `stopResultsRealtime()`. Opens
`results-rt-${drawId}`, subscribed only to `matches` (filtered `draw_id=eq.${drawId}`).
No patch tier — this is pure visibility on the commissioner Results tab, not painted
per-card. `_handleResultsMatchChange` diffs `winner`/`score`/`espn_state` between
`old`/`new` and only calls the debounced `onChange()` if at least one changed — `matches`
also gets odds/ELO writes every few hours (see `.claude/rules/betting.md`) that are
irrelevant to confirming a result and would otherwise spam a re-render. Verified this
filter directly: a score-only, an espn_state-only, and a winner-only change each notify;
an odds-field-only change does not.

**Kill switch (both)**: the `.subscribe(status => ...)` callback calls the matching
`stop*Realtime()` on `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`. Both start functions are also
wrapped in `try/catch` — nothing in this module throws out to the caller. There is no
realtime-specific UI state (no "connecting…" banner, no error toast), so falling back is
literally a no-op: the app just behaves exactly like it did before this file existed.

### `bracket.js`: stage 1 patch tier

`patchMatchScore(matchDbId, {score, espn_state})` finds the match by `db_id` in
`activeDraw()`, updates the in-memory `m.score`/`m.espn_state` fields (so the data is
correct whenever the next real rebuild happens, even if no DOM card is currently
mounted), then — if a live `.mc[data-ri][data-mi]` card exists — removes and rebuilds
just that card's `.mc-footer` via `buildScoreFooterEl()`, the same helper `placeCard`
itself uses. No `buildDrawView`, no `renderBracketLayout`/`renderBracketList` pass.
Returns `false` only when the match isn't in the active draw at all.

### `main.js`: stage 1 rebuild tier + lifecycle

**Bug found and fixed while building stage 3** (2026-07-03): the rebuild-tier callback
originally just called `renderStats()` + `renderBracketDisplay()` on whatever was already
in `activeDraw()` — it never actually pulled the new `winner`/pick-cascade state from
Supabase first, so a winner-confirmed event would trigger a visible re-render that showed
*stale* data. `_realtimeRebuild()` now `await reloadActiveDraw()`s before re-rendering,
same as every other caller of `reloadActiveDraw` (e.g. the post-undo-winner path). Scroll
position on `#bracket-body` is still captured/restored around the destructive
`renderBracket()` call (CLAUDE.md §12).

`_startRealtimeForActiveDraw()` is the single entry point that (re)subscribes for
whatever `activeDraw()` currently is. Called from `showBracketScreen()` (both branches
call `stopBracketRealtime()` up front; only the active-draw branch re-starts it) and
`switchTab()` (the M/W toggle). Stopped in `_openLeaderboard()`, `enterCommissioner()`,
and `doLogout()`.

### `commissioner.js`: stage 3 wiring

`_onResultsRealtimeChange()` — `await reloadActiveDraw(); renderResults()`. Same
reload-before-render discipline as stage 1, for the same reason. `_isResultsTabActive()`
checks the nav link's `.active` class (desktop or mobile nav). Started from three call
sites — the same three places `renderEspnScoreFeedSection()` is already called from:
`initCommissioner()` (guarded on `_isResultsTabActive()`, since Results is the default
pane but init doesn't know that without checking), the tab-switch click handler (calls
`stopResultsRealtime()` unconditionally first, then starts only if the newly-active tab
is `'results'`), and the M/W toggle's results branch (re-scopes to the newly selected
draw). Stopped in `main.js`'s `exitCommissioner()` and `doLogout()`.

### Testing performed

No service-role key is available to this session, and `matches` RLS requires
`auth.role() = 'authenticated'` for SELECT — an unauthenticated anon client never
receives these events (correctly; this matches production). Verified with throwaway
signed-up test accounts (created via the app's own public signup, deleted afterward —
zero orphaned rows) subscribing exactly like `realtime.js` does, then triggering real
`UPDATE`s via SQL against live Wimbledon 2026 matches and a real `lock_schedules` row.
Stage 1: score-only → patch classification; winner change → rebuild classification;
`lock_schedules` change → delivered. Stage 3: score-only, espn_state-only, and
winner-only changes each notify; an odds-field-only change does not. All test writes
were reverted immediately after observing delivery; no production data or scoring was
affected.
