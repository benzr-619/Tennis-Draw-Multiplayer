// Lock logic — read lock_schedules, expose isMatchLocked()
// Lock triggering is built in Chat 2 (commissioner screen)

import { state, activeDraw } from './state.js'

/**
 * Returns true if this match is covered by a triggered (locked_at != null) lock schedule.
 * @param {number} ri - round_index
 * @param {number} mi - match_index
 * @param {string} lockType - 'original_picks' | 'backup_picks'
 */
export function isMatchLocked(ri, mi, lockType = 'backup_picks') {
  const schedules = state.lockSchedules || []
  const d = activeDraw()
  return schedules.some(ls => {
    if (ls.draw_id !== d?.db_id) return false  // only this draw's locks
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

// ── SHARED "MISSING PICK, IN RANGE" LOGIC ──
// Single source of truth for backup-pick urgency: card glow/tag (bracket.js),
// countdown "N NO PICKS" label + click-navigate (stats.js), and MS/WS linking
// (this file). Never re-derive this walk elsewhere.

/** True when a match still needs a pick before it can lock (no live pick, no result yet). */
export function matchNeedsPick(m) {
  return !m.matchPick && !m.winner
}

/** True when (ri, mi) falls inside the round/match-index coverage of a lock schedule row. */
export function isMatchInLockRange(ls, ri, mi) {
  if (!ls) return false
  if (ls.lock_type === 'original_picks') return ri === 0
  if (ls.lock_type === 'backup_picks') {
    if (ls.round_index !== ri) return false
    const start = ls.match_index_start ?? 0
    const end = ls.match_index_end ?? 999
    return mi >= start && mi <= end
  }
  return false
}

/** Match indices within ls's own draw/round/range that still need a pick. */
export function missingPicksForLock(ls) {
  const draw = state.draws.find(dr => dr.db_id === ls.draw_id)
  if (!draw) return []
  const ri = ls.lock_type === 'original_picks' ? 0 : ls.round_index
  if (ri == null || !draw.rounds[ri]) return []
  return draw.rounds[ri].matches
    .map((m, mi) => mi)
    .filter(mi => isMatchInLockRange(ls, ri, mi) && matchNeedsPick(draw.rounds[ri].matches[mi]))
}

export function lockMissingPickCount(ls) {
  return missingPicksForLock(ls).length
}

/**
 * Next not-yet-fired lock schedule for a specific draw, pure chronological order.
 * Draw-scoped — never mixes locks across draws.
 */
export function nextScheduledLock(drawId) {
  return (state.lockSchedules || [])
    .filter(ls => ls.draw_id === drawId && !ls.locked_at && ls.scheduled_at && new Date(ls.scheduled_at) > new Date())
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0] || null
}

/**
 * Display-layer-only "linked" counterpart: same scheduled_at + lock_type, opposite-gender
 * draw. No schema/data change, no merging of the underlying rows — actual lock enforcement
 * stays fully per-row and draw-scoped everywhere else.
 */
export function findLinkedLock(ls) {
  if (!ls?.scheduled_at) return null
  const draw = state.draws.find(dr => dr.db_id === ls.draw_id)
  if (!draw) return null
  const ts = new Date(ls.scheduled_at).getTime()
  return (state.lockSchedules || []).find(other => {
    if (other === ls || other.draw_id === ls.draw_id || other.lock_type !== ls.lock_type) return false
    if (!other.scheduled_at || new Date(other.scheduled_at).getTime() !== ts) return false
    const otherDraw = state.draws.find(dr => dr.db_id === other.draw_id)
    return otherDraw && otherDraw.draw !== draw.draw
  }) || null
}

/** Missing-pick count for ls plus its linked counterpart (if any) — one combined deadline. */
export function combinedMissingCount(ls) {
  if (!ls) return 0
  const linked = findLinkedLock(ls)
  return lockMissingPickCount(ls) + (linked ? lockMissingPickCount(linked) : 0)
}
