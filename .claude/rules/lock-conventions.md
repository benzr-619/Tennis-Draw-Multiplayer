# Lock Conventions Detail

Read this when working on locks, lock schedules, or the lock countdown UI.

## Draw-Scoping — All Lock Functions

Every lock check filters by `ls.draw_id`. A lock on one draw (e.g. the other M/W draw, or a past slam) must never block picks on another.

Functions that must always filter by `ls.draw_id === d.db_id`:
- `isMatchLocked()` (lock.js) — used by player bracket + `bracket.js`; filters `ls.draw_id === activeDraw().db_id`
- `getOrigPicksSchedule()`, `isMatchBackupLocked()`, `getMatchScheduledLock()` (commissioner-locks files) — filter by `ls.draw_id === d.db_id`

`handleBackupLock()` deletes overlapping `lock_schedules` rows before inserting (prevents schedule-vs-lock-now conflicts).

`renderLockBracket()` shows `—` for slots with no confirmed feeder winner.

## Lock Countdown in `renderStats()`

`buildCountdownEl()` (stats.js) picks the draw's next upcoming unlocked row via `nextScheduledLock(d.db_id)` (lock.js) — **pure chronological order, draw-scoped, no reordering**. A prior version sorted "has unfilled picks" ahead of soonest-scheduled as a cross-gender-awareness workaround; that broke pre-scheduling — a future round with undetermined players (TBD vs TBD) got permanently pulled to the front regardless of its actual time, burying the real next lock. Reverted 2026-07-02; cross-gender awareness is now handled by linked-lock detection (below), which doesn't require reordering.

Sub-hour shows minutes; sub-day shows hours.

## Backup-Pick Urgency (glow + tag + count) — reworked 2026-07-02

Shared "missing pick, in range" logic lives in **lock.js**, used by both the bracket card painter and the countdown — never duplicated:
- `matchNeedsPick(m)` — `!m.matchPick && !m.winner`
- `isMatchInLockRange(ls, ri, mi)` — round/match-index membership test
- `missingPicksForLock(ls)` / `lockMissingPickCount(ls)` — walk a lock's own draw/round/range
- `nextScheduledLock(drawId)` — draw-scoped, chronological "next lock"
- `findLinkedLock(ls)` — display-layer-only MS/WS pairing (see below)
- `combinedMissingCount(ls)` — `ls`'s own missing count + its linked counterpart's, if any

**Card treatment (`bracket.js` `placeCard`):** cards inside the draw's `nextScheduledLock`'s range with `matchNeedsPick(m)` true get `.needs-backup-pick` — an outer border/glow only (`border-color:var(--purple)` + `box-shadow`). Player rows inside render in their normal/true state, no background fill. A small muted `.mc-no-pick-tag` ("NO PICK", DM Mono 9px uppercase, `var(--text3)`) is appended to the card; it disappears the instant a pick is set (next render just won't add it).

**Countdown label override:** when `_urgency(lock)` (stats.js, wraps `combinedMissingCount`/`findLinkedLock`) finds ≥1 missing pick for the current player, the countdown label (`.sc-countdown-lbl` desktop compact / mirrored `#mobile-countdown-wrap` label) is replaced with `"N NO PICKS"` (singular `"1 NO PICK"`), overriding whatever would normally show (commissioner schedule label, or the generic "picks lock in"/"next lock" default). Reverts automatically once all of that player's picks in range are filled. Applies to both the pre-lock `original_picks` countdown and the post-lock `backup_picks` countdown.

**`original_picks` range fixed to span the whole draw, not just round 0 (2026-07-18).**
`isMatchInLockRange`/`missingPicksForLock` used to hardcode an `original_picks` lock's
range to round 0 only. That was wrong: players are meant to fill out a full
127-match bracket before the tournament starts — a real pick on every round, all the
way to champion — not just round 0. `buildDrawView`'s projection makes each round's
slots clickable in turn as its feeders get picked (round 0 is just the first round
that's *ever* clickable, since every later round starts blank until fed), so the
whole draw is genuinely reachable pre-lock, and the "N NO PICKS" count needs to track
that or it silently undercounts anyone who picks past round 0. Confirmed the count
now grows correctly as deeper rounds become pickable (via a live test: after filling
one match at a fed-in round, the count stayed flat rather than dropping — because
completing that match simultaneously made the *next* round's slot pickable via
projection, which is the intended dynamic, not a bug).

Found via the tutorial's compressed pre-lock window (long enough to explore several
rounds deep) making the undercount visible — in a real draw this rarely surfaces
because the original-picks lock is normally scheduled at tournament start, before any
round beyond 0 has real occupants to click. `_findUnpickedCard` (main.js, the
countdown's click-navigation target) already scanned every round for `original_picks`
locks before this fix — the count was the only piece that disagreed with it.

**`backup_picks` gated on confirmed occupants, not just projected ones.** The
opposite correction, same fix: `missingPicksForLock`'s `backup_picks` branch now also
requires `bothOccupantsResolved(draw, ri, mi)` (real feeder winners, not a
still-projected original pick) before counting a match as missing — mirrors
`backupPickFraction`'s existing gate. A match-pick lock should only ever count matches
whose real players are both confirmed; a still-undetermined future matchup isn't
pickable yet regardless of what a surviving original pick happens to be projecting
into that slot.

## MS/WS Linked Locks (display-layer only)

`findLinkedLock(ls)` treats an MS `lock_schedules` row and a WS row as one event when they share the same `scheduled_at` **and** `lock_type` — no schema change, no merging of the underlying rows, and every actual lock-enforcement check (`isMatchLocked`, `fire_scheduled_locks`, etc.) stays fully per-row and draw-scoped exactly as before. Linking only affects:
- The "N NO PICKS" count — combines both draws' missing counts into one number (it's functionally one deadline).
- Countdown click-navigation — `_urgency()` picks whichever side (own draw or linked draw) still has outstanding picks as the click target, so clicking jumps to wherever the work actually is. Unlinked locks always navigate to their own draw as before.

## Scheduled Locks List (Backup Picks)

Lives in Lock Managing → Backup Pick Locks. Lists pending (not-yet-fired) backup locks for the active draw, soonest first. Actions: Cancel (deletes row), Reschedule (reuses `lock-sched-modal`). Helpers: `pendingBackupLocks`, `lockRangeLabel`, `renderScheduledLocksList`, `handleCancelScheduledLock`, `openRescheduleModal`, `updateScheduledLock`, `toLocalInputValue`. Wired via event delegation on `#lock-sched-list`.

## ESPN Match-Start Auto-Lock — BUILT (2026-07-06)

**Real ESPN `espn_state` values (confirmed live 2026-07-06 via direct query against the
Wimbledon 2026 draw):** `'pre'` / `'in'` / `'post'`, plus `null` before a match is ever
matched/fetched. The pre-match state is `'pre'` (or `null`); auto-lock fires the instant
a match's `espn_state` moves off that.

**Trigger:** `fetch_espn_scores()` (in-function, not a separate job) `SELECT`s a match's
current `espn_state` into `old_espn_state` immediately before writing the new one, then —
right after the `UPDATE public.matches SET score=…, espn_state=ev_state, …` — checks:
`(old_espn_state IS NULL OR old_espn_state = 'pre') AND ev_state IS NOT NULL AND
ev_state <> 'pre'`. Since `fetch_espn_scores()` only ever resolves a match's occupants
(both feeders decided) before writing `espn_state` at all, a non-`'pre'` `espn_state`
already guarantees p1/p2 are known — no separate occupant check needed.

**Mechanism — reuses `lock_schedules`, no new column, no new UI.** On trigger, inserts
one row: `lock_type='backup_picks'`, `round_index=<the match's round>`,
`match_index_start=match_index_end=<the match's index>`, `locked_at=now()` — byte-for-byte
what the commissioner's own "Lock now" button does for a single match. Guarded against
duplicate inserts on every poller tick by checking for an existing covering
`lock_schedules` row first (`draw_id`/`lock_type='backup_picks'`/`round_index` match, and
`match_index_start/end` range contains the match). Consequence: **auto-lock is
indistinguishable from a manual lock everywhere** — `isMatchLocked()` needed zero
changes, the commissioner Lock Managing screen needed zero new badges/states, and
"unlock" is the exact same existing button (`locked_at = null`) that already unlocks any
fired backup-pick lock today.

**Applies to every round, including Round 1 — decoupled from the global original-picks
lock (2026-07-06, corrected same day).** Before this feature, R1 had no per-match lock
mechanism at all; the *only* enforcement was a hardcoded client-side rule in
`bracket.js`'s `placeCard` (`isR1PostLock`) that blanket-froze **every** R1 match the
instant the whole-draw `original_picks` lock fired, regardless of whether that specific
match had actually started. (Earlier text here incorrectly said R1 was "editable
unbounded" post-lock — the opposite was true: it was frozen too early and too broadly,
not left open too long.)

This blanket rule is now **removed**. R1 click-gating is unified with every other round:
`bracket.js`'s `backupPickLocked = !m.editedAfterLock && isMatchLocked(ri, mi,
'backup_picks')` — no longer gated on `d.locked` (the global original-picks lock) at
all, since a `backup_picks` lock (auto or manual) can now legitimately exist for R1
*before* the whole-draw original-picks lock has fired (R1 spans up to 3 days; ESPN can
report an early match started before the commissioner's scheduled original-picks lock
time). A R1 match is editable until its own `backup_picks` lock fires (auto via ESPN
match-start, or manual) or it gets a `winner` — exactly like R2+. `editedAfterLock`
(the roster-swap one-time-repick flow) still bypasses this, unchanged.

**Practical consequence:** a fully-decided historical round (e.g. this slam's current
R1, 100% confirmed results) will show **no** `lock_schedules` rows in the commissioner
Lock Managing screen for R1 — that's expected, not a bug. Those matches transitioned
off `'pre'` before this migration shipped (see "Known limitation" below), so they never
got an auto-lock row; editing is still correctly blocked by `!m.winner` alone, which
every click path checks regardless of any lock_schedules state.

**Commissioner Lock Managing screen fix (2026-07-06):** `renderLockBracket()`
(`commissioner-locks-backup.js`) used to hard-skip `ri === 0` entirely, since R1 never
had individually-lockable matches before. Now that it does (via auto-lock or manual),
R1 is rendered as a normal column — occupants resolved directly from `m.p1`/`m.p2`
(R1 is always the real draw, never feeder-derived) rather than the feeder-winner logic
used for R2+. `isMatchBackupLocked`/`getMatchScheduledLock`/selection/lock/unlock were
already round-agnostic (no ri>0 assumption), so this was purely a rendering gap.

**Verified 2026-07-06** via a rolled-back transaction against live production data:
forced one real match's `espn_state` back to `'pre'`, re-ran `fetch_espn_scores()`,
confirmed a fresh `lock_schedules` row was inserted for that exact match (round 0,
the forced match's index), then rolled back — no residue left in production.

**Known limitation (not a bug, not worth fixing):** matches whose `espn_state` had
already moved off `'pre'` *before* this migration shipped never get a retroactive
auto-lock — the transition already happened silently pre-deployment, so
`old_espn_state` reads as already `'in'`/`'post'` on the first post-deploy run and the
condition never fires for them. Those matches fall back to exactly pre-feature
behavior (editable backup pick until commissioner manually locks or the match
finishes). Confirmed live: of 254 matches, only the handful still `'pre'` at deploy
time benefit; the ~233 already-`'post'` and 3 already-`'in'` matches at deploy time do
not get backfilled, and don't need to be.

**Fallback (unchanged):** commissioner-scheduled backup-pick locks and manual "lock now"
continue to work exactly as today — the catch-all for any match ESPN misses (name
mismatch, feed gap, doubles not tracked).

## Countdown Replacement — "Match Picks Set for X/Y" — BUILT (2026-07-06)

The old `nextScheduledLock`-based countdown clock is replaced entirely (not hybrid) by a
live fraction in `buildCountdownEl()`'s post-lock branch (`src/stats.js`), since auto-lock
timing is no longer predictable/schedulable the way a single commissioner-set countdown
assumed.

**`backupPickFraction(d)` (src/lock.js)** is the single source of truth:
- **Y** = matches where `bothOccupantsResolved(d, ri, mi)` is true (both feeders'
  `winner` fields set — `ri === 0` always qualifies) AND `!isMatchLocked(ri, mi,
  'backup_picks')` AND `!m.winner`.
  **Critical: this is NOT the same test as "`m.p1`/`m.p2` are non-null."**
  `buildDrawView` fills round-2+ slots via `winner || originalPick || matchPick` (CLAUDE.md
  §5 step 1), so a slot can show a real-looking name purely because someone's original
  pick is still alive, well before that round has actually been played. `feederWinnerName(d,
  ri, mi, side)` (lock.js) reads the feeder's actual `winner` directly, same discipline
  `_resultOccupant()` in commissioner-results.js already used — **and now shares the same
  helper** (`_resultOccupant` calls `feederWinnerName` for the name, then looks up the
  seed itself; refactored 2026-07-06, no behavior change to the Results tab).
- **X** = of those Y, how many already have `matchPick` set.
- Walks round-major/match-minor and returns `nextUnmade: {ri, mi}` — the first Y-match
  with no `matchPick` — doubling as the click-to-navigate target.

**Click-to-navigate reuses `handleCountdownClick`/`_findUnpickedCard` in main.js
unchanged** — no changes needed there. `stats.js` builds a synthetic
`lock_schedules`-shaped object (`{ draw_id, lock_type: 'backup_picks', round_index:
nextUnmade.ri, match_index_start: match_index_end: nextUnmade.mi }`) from
`backupPickFraction`'s own `nextUnmade` result and passes it as the click target — this
lands in `_findUnpickedCard`'s existing `backup_picks` branch, which already does "first
`!matchPick && !winner` within this exact single-match range."

**Visual treatment:** `X < Y` keeps the `.countdown-urgent` styling (same classes as the
old "N NO PICKS" label — `.sc-countdown.countdown-urgent`/`.countdown-pill.countdown-urgent`,
no new CSS). `X === Y` uses the calm/neutral countdown styling. Rendered as "picks set
for" (label) / "X/Y matches" (value), with a `title` attribute carrying the full "Match
picks set for X of Y upcoming matches" string. Only the `compact` (desktop bar) and
`mobileIcon` (mobile stacked) branches of `buildCountdownEl` matter post-lock in
practice — the plain non-compact/non-mobile branch is only ever reached pre-lock, but
was updated too rather than left to silently diverge.

**Y=0 (decided 2026-07-06 with Ben):** widget hidden entirely (`buildCountdownEl`
returns `null`) — no fallback string. Distinct from the old "all caught up" case Ben
had already rejected for `X===Y`: Y=0 means nothing is currently pickable at all (e.g.
between rounds, everything resolvable already locked/decided), not "all picks made."

**Realtime wiring:** no new subscription code needed. A newly-inserted `lock_schedules`
row (from auto-lock) already fires the existing `lock_schedules` realtime handler in
`realtime.js` → debounced `_scheduleRebuild()` → `main.js`'s `_realtimeRebuild()` → awaits
`reloadActiveDraw()` (which already reloads `state.lockSchedules` via `loadLockSchedules()`)
→ `renderStats()`. Verified by reading the existing call chain — `state.lockSchedules` is
always read live by `lock.js` helpers with no separate cache to invalidate, so the whole
path was already correct before this feature; nothing to change in `realtime.js`/`main.js`.

**Explicitly not building (2026-07-06):** a "which section of the draw is likely to
auto-lock next" hint using ESPN's per-match scheduled date + round name. Ben's read:
draw halves mostly alternate by day except R1 (spread over 3 days) and the semis
(where gender alternates instead of draw-half) — accurate detection would need
schedule-order logic that varies by round, too much complexity/fragility risk for the
payoff. The X/Y fraction above is the agreed-on replacement for this idea.

## Lock Architecture Summary (quick ref)

- `lock_type = 'original_picks'` — global per draw; `scheduled_at` set when pending, deleted when fired
- `lock_type = 'backup_picks'` — covers `(round_index, match_index_start, match_index_end)`; `locked_at` set when fired
- `fire_scheduled_locks()` SQL function: for `original_picks` → snapshot `match_pick → original_pick`, set `draws.original_picks_locked = true`, delete row; for `backup_picks` → set `locked_at = now()`
- Runs every minute via pg_cron: `cron.schedule('fire-scheduled-locks', '* * * * *', 'select fire_scheduled_locks()')`
