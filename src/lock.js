// Lock logic — read lock_schedules, expose isMatchLocked()
// Lock triggering is built in Chat 2 (commissioner screen)

import { state } from './state.js'

/**
 * Returns true if this match is covered by a triggered (locked_at != null) lock schedule.
 * @param {number} ri - round_index
 * @param {number} mi - match_index
 * @param {string} lockType - 'original_picks' | 'backup_picks'
 */
export function isMatchLocked(ri, mi, lockType = 'backup_picks') {
  const schedules = state.lockSchedules || []
  return schedules.some(ls => {
    if (ls.lock_type !== lockType) return false
    if (!ls.locked_at) return false  // not yet triggered
    if (ls.round_index !== ri) return false
    // null start/end = whole round
    const start = ls.match_index_start ?? 0
    const end = ls.match_index_end ?? 999
    return mi >= start && mi <= end
  })
}

/**
 * Returns true if the draw's original picks are locked
 * (either draws.original_picks_locked = true OR a triggered 'original_picks' lock schedule exists)
 */
export function isDrawOriginalPicksLocked(d) {
  if (!d) return false
  return !!d.locked
}
