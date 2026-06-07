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

Scans `state.lockSchedules` for the nearest upcoming unlocked row **for the active draw** (`ls.draw_id === d.db_id`). Pre-lock state also checks for an `original_picks` row and appends its countdown before the early return.

Sub-hour shows minutes; sub-day shows hours. Countdown label pulses accent color until all affected picks are filled. Match cards in the upcoming lock's range glow purple if no active pick.

## Scheduled Locks List (Backup Picks)

Lives in Lock Managing → Backup Pick Locks. Lists pending (not-yet-fired) backup locks for the active draw, soonest first. Actions: Cancel (deletes row), Reschedule (reuses `lock-sched-modal`). Helpers: `pendingBackupLocks`, `lockRangeLabel`, `renderScheduledLocksList`, `handleCancelScheduledLock`, `openRescheduleModal`, `updateScheduledLock`, `toLocalInputValue`. Wired via event delegation on `#lock-sched-list`.

## Lock Architecture Summary (quick ref)

- `lock_type = 'original_picks'` — global per draw; `scheduled_at` set when pending, deleted when fired
- `lock_type = 'backup_picks'` — covers `(round_index, match_index_start, match_index_end)`; `locked_at` set when fired
- `fire_scheduled_locks()` SQL function: for `original_picks` → snapshot `match_pick → original_pick`, set `draws.original_picks_locked = true`, delete row; for `backup_picks` → set `locked_at = now()`
- Runs every minute via pg_cron: `cron.schedule('fire-scheduled-locks', '* * * * *', 'select fire_scheduled_locks()')`
