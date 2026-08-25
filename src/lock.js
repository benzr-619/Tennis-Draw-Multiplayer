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

/**
 * True when (ri, mi) falls inside the round/match-index coverage of a lock schedule
 * row. original_picks locks cover the WHOLE draw — players are meant to fill out a
 * full 127-match bracket (a real pick on every round, all the way to champion) before
 * the tournament starts, not just round 0. buildDrawView's projection makes each
 * round's slots clickable in turn as its feeders get picked, so the whole draw is
 * reachable pre-lock; _findUnpickedCard (main.js) already scans every round for
 * original_picks locks, and this must agree with it (fixed 2026-07-18, found via the
 * tutorial's compressed pre-lock window making the round-0-only undercount visible —
 * see .claude/rules/tutorial.md).
 */
export function isMatchInLockRange(ls, ri, mi) {
  if (!ls) return false
  if (ls.lock_type === 'original_picks') return true
  if (ls.lock_type === 'backup_picks') {
    if (ls.round_index !== ri) return false
    const start = ls.match_index_start ?? 0
    const end = ls.match_index_end ?? 999
    return mi >= start && mi <= end
  }
  return false
}

/**
 * Matches within ls's own draw/range that still need a pick.
 * - original_picks (whole-draw range, see isMatchInLockRange): counts a match once it
 *   has at least one clickable occupant (buildDrawView's projected p1/p2 — pre-lock
 *   that's the only kind of occupant there is, real or otherwise) — a still-fully-
 *   blank future round isn't "missing a pick," there's nothing to click yet.
 * - backup_picks: gated on bothOccupantsResolved (real winners, not projected picks)
 *   — a match whose real players aren't both confirmed yet isn't pickable regardless
 *   of what a still-alive original pick might be projecting into the slot. Mirrors
 *   backupPickFraction's existing gate below; this was the missing half of Ben's
 *   correction (2026-07-18) — original_picks locks count every reachable match,
 *   match-pick locks only count matches with confirmed players.
 * Returns {ri, mi} pairs for original_picks (spans rounds) or plain mi numbers for
 * backup_picks (a single fixed round) — only .length is read by callers, so the shape
 * difference is never observed from outside this function.
 */
export function missingPicksForLock(ls) {
  const draw = state.draws.find(dr => dr.db_id === ls.draw_id)
  if (!draw) return []
  if (ls.lock_type === 'original_picks') {
    const missing = []
    draw.rounds.forEach((r, ri) => r.matches.forEach((m, mi) => {
      if ((m.p1?.name || m.p2?.name) && matchNeedsPick(m)) missing.push({ ri, mi })
    }))
    return missing
  }
  const ri = ls.round_index
  if (ri == null || !draw.rounds[ri]) return []
  return draw.rounds[ri].matches
    .map((m, mi) => mi)
    .filter(mi => isMatchInLockRange(ls, ri, mi) && bothOccupantsResolved(draw, ri, mi) && matchNeedsPick(draw.rounds[ri].matches[mi]))
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

// ── OCCUPANT RESOLUTION (shared with commissioner Results tab) ──
// A round-2+ slot's REAL occupant is only known once its own feeder match has a
// confirmed winner — never buildDrawView's projected m.p1/m.p2, which can show a name
// from a still-alive original pick before that round has actually been played. Round 0
// is always the real draw. Single source of truth for "what really occupies this slot,"
// shared by commissioner-results.js's _resultOccupant (adds seed for display) and the
// backup-pick fraction below (existence-only gating check).
export function feederWinnerName(d, ri, mi, side) {
  if (ri === 0) return d.rounds[0]?.matches[mi]?.[side]?.name || null
  const feeder = d.rounds[ri - 1]?.matches[mi * 2 + (side === 'p1' ? 0 : 1)]
  return feeder?.winner || null
}

/** True once both real occupants of (ri, mi) are confirmed — not projected picks. */
export function bothOccupantsResolved(d, ri, mi) {
  return !!feederWinnerName(d, ri, mi, 'p1') && !!feederWinnerName(d, ri, mi, 'p2')
}

// ── BACKUP-PICK "X/Y" FRACTION (post-lock countdown) ──
// Y = matches whose real occupants are both resolved and which aren't locked or decided
// yet. X = of those, how many already have a matchPick set. Walks round-major/match-minor
// so the first unmade candidate found doubles as a sensible "next unmade pick" nav target.
export function backupPickFraction(d) {
  let x = 0, y = 0
  let nextUnmade = null
  d.rounds.forEach((round, ri) => {
    round.matches.forEach((m, mi) => {
      if (m.winner) return
      if (!bothOccupantsResolved(d, ri, mi)) return
      if (isMatchLocked(ri, mi, 'backup_picks')) return
      y++
      if (m.matchPick) x++
      else if (!nextUnmade) nextUnmade = { ri, mi }
    })
  })
  return { x, y, nextUnmade }
}
