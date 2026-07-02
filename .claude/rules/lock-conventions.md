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

## MS/WS Linked Locks (display-layer only)

`findLinkedLock(ls)` treats an MS `lock_schedules` row and a WS row as one event when they share the same `scheduled_at` **and** `lock_type` — no schema change, no merging of the underlying rows, and every actual lock-enforcement check (`isMatchLocked`, `fire_scheduled_locks`, etc.) stays fully per-row and draw-scoped exactly as before. Linking only affects:
- The "N NO PICKS" count — combines both draws' missing counts into one number (it's functionally one deadline).
- Countdown click-navigation — `_urgency()` picks whichever side (own draw or linked draw) still has outstanding picks as the click target, so clicking jumps to wherever the work actually is. Unlinked locks always navigate to their own draw as before.

## Scheduled Locks List (Backup Picks)

Lives in Lock Managing → Backup Pick Locks. Lists pending (not-yet-fired) backup locks for the active draw, soonest first. Actions: Cancel (deletes row), Reschedule (reuses `lock-sched-modal`). Helpers: `pendingBackupLocks`, `lockRangeLabel`, `renderScheduledLocksList`, `handleCancelScheduledLock`, `openRescheduleModal`, `updateScheduledLock`, `toLocalInputValue`. Wired via event delegation on `#lock-sched-list`.

## Lock Architecture Summary (quick ref)

- `lock_type = 'original_picks'` — global per draw; `scheduled_at` set when pending, deleted when fired
- `lock_type = 'backup_picks'` — covers `(round_index, match_index_start, match_index_end)`; `locked_at` set when fired
- `fire_scheduled_locks()` SQL function: for `original_picks` → snapshot `match_pick → original_pick`, set `draws.original_picks_locked = true`, delete row; for `backup_picks` → set `locked_at = now()`
- Runs every minute via pg_cron: `cron.schedule('fire-scheduled-locks', '* * * * *', 'select fire_scheduled_locks()')`
