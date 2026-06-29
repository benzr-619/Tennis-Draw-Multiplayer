// Scoring logic — ported verbatim from reference app

import { buildDrawView } from './draw-view.js'
import { eloMap } from './elo.js'
import { normaliseName } from './odds.js'

export const ROUND_CONFIG = Array.from({ length: 7 }, (_, i) => ({ base: Math.round(Math.pow(1.78, i)) }))

export const STAKE_BY_ROUND = [10, 10, 20, 20, 30, 40, 50]

export function numericSeed(seedStr) {
  const n = parseInt(seedStr)
  return (n >= 1 && n <= 32) ? n : 33
}

export function calcUpsetBonus(winnerSeedStr, loserSeedStr) {
  const ws = numericSeed(winnerSeedStr)
  const ls = numericSeed(loserSeedStr)
  if (ws === 33 && ls === 33) return 0.5
  return Math.max(0, ws - ls)
}

export function calcMatchScore(m, ri) {
  const cfg = ROUND_CONFIG[ri] || ROUND_CONFIG[0]
  const loser = m.winner === m.p1.name ? m.p2 : m.p1
  const winner = m.winner === m.p1.name ? m.p1 : m.p2
  const skillBonus = calcUpsetBonus(winner.seed, loser.seed)
  return { base: cfg.base, skill: skillBonus }
}

export function isBackupPick(m) {
  return !!m.originalPick && m.matchPick && m.matchPick !== m.originalPick
}

// ── ELO AUTO-ASSIGN HELPERS ──
// When a player's original pick is missing OR names a withdrawn player, Draw Yield
// and Draw Health are auto-scored on the ELO favourite of the actual matchup.
// Parallel to the Match Yield odds auto-pick; excluded from Draw Accuracy.

export function withdrawnNames(d) {
  return new Set((d.rounds[0]?.matches ?? []).map(m => m.replaced_name).filter(Boolean))
}

// Returns true when no valid original pick exists for this match slot.
// No pick at all → true. Pick is a current occupant → false (valid live pick).
// Pick is a withdrawn player → true (forward-cascaded stale pick).
// Pick is simply a loser (normal wrong prediction) → false.
export function isAutoAssign(m, withdrawnNm) {
  if (!m.originalPick) return true
  if (m.originalPick === m.p1?.name || m.originalPick === m.p2?.name) return false
  if (withdrawnNm.has(m.originalPick)) return true
  return false
}

// Returns the name of the ELO favourite (higher ELO = stronger), or null when
// ELO is unavailable for either occupant. Uses the draw-level ELO map (R0 only).
export function eloFavourite(m, eloLookup) {
  const e1 = m.p1?.name ? (eloLookup.get(normaliseName(m.p1.name)) ?? null) : null
  const e2 = m.p2?.name ? (eloLookup.get(normaliseName(m.p2.name)) ?? null) : null
  if (e1 === null || e2 === null) return null
  return e1 >= e2 ? m.p1.name : m.p2.name
}

// Draw Health numerator/denominator, "as of" round `filterRi` (Infinity = live).
//
// Single source of truth: reachability is read off buildDrawView's slot/elim
// flags — never a parallel, slot-blind elimination list. To rewind to a round,
// we clone the draw, forget any winner confirmed AFTER the cutoff, re-derive the
// view, and read the same flags. When filterRi covers every confirmed result,
// this returns exactly the live numbers (the two no longer drift apart).
//
// Definition: a pick is "reachable" if it's already confirmed correct, or its
// player still occupies its projected slot and hasn't been eliminated. Numerator
// = base points of reachable original picks; denominator = base points of ALL
// original picks (the bracket's full theoretical value, constant across rounds).
function calcHealthPts(d, filterRi) {
  let view = d
  if (filterRi !== Infinity) {
    view = structuredClone(d)
    view.rounds.forEach((r, ri) => {
      if (ri > filterRi) r.matches.forEach(m => { m.winner = null; m.score = null })
    })
    buildDrawView(view)
  }

  const withdrawnNm = withdrawnNames(view)
  const eloLookup = eloMap(view)

  let maxHealthPts = 0, reachableHealthPts = 0
  view.rounds.forEach((r, ri) => r.matches.forEach(m => {
    const pts = ROUND_CONFIG[ri] ? ROUND_CONFIG[ri].base : 0
    if (isAutoAssign(m, withdrawnNm)) {
      // ELO auto-assign: treat the ELO favourite as the pick for health purposes
      const fav = eloFavourite(m, eloLookup)
      if (!fav) return  // no ELO for this matchup → skip
      maxHealthPts += pts
      if (m.winner) {
        if (m.winner === fav) reachableHealthPts += pts
      } else {
        const favP = fav === m.p1.name ? m.p1 : fav === m.p2.name ? m.p2 : null
        if (favP && !favP.elim) reachableHealthPts += pts
      }
    } else {
      if (!m.originalPick) return
      maxHealthPts += pts
      if (m.winner) {
        if (m.winner === m.originalPick) reachableHealthPts += pts
      } else {
        const slot = m.originalPick === m.p1.name ? m.p1
          : m.originalPick === m.p2.name ? m.p2 : null
        if (slot && !slot.elim) reachableHealthPts += pts
      }
    }
  }))
  return { maxHealthPts, reachableHealthPts }
}

export function calcStatsAsOf(d, upToRi = null) {
  const isLive = upToRi === null
  const filterRi = isLive ? Infinity : upToRi
  let filled = 0, total = 0, cOrig = 0, wOrig = 0, cBackup = 0, wBackup = 0
  let baseScore = 0, skillBonus = 0
  let cDrawOrig = 0, wDrawOrig = 0
  let matchYield = 0, matchYieldResolved = 0

  const withdrawnNm = withdrawnNames(d)
  const eloLookup = eloMap(d)

  d.rounds.forEach((r, ri) => r.matches.forEach(m => {
    total++
    if (m.matchPick) filled++
    if (!m.p1.name && !m.p2.name) return

    if (ri <= filterRi && m.winner) {
      const backup = isBackupPick(m)
      // Draw Accuracy — based on original pick result only
      if (m.originalPickResult === 'correct') cDrawOrig++
      else if (m.originalPickResult === 'wrong') wDrawOrig++
      if (!backup) {
        // Scoring — original pick correct = points
        if (m.originalPickResult === 'correct') {
          cOrig++
          const sc = calcMatchScore(m, ri)
          baseScore += sc.base
          skillBonus += sc.skill
        } else if (m.originalPickResult === 'wrong') {
          wOrig++
        } else if (isAutoAssign(m, withdrawnNm)) {
          // ELO auto-assign: score if the ELO favourite won — excluded from accuracy
          const fav = eloFavourite(m, eloLookup)
          if (fav && m.winner === fav) {
            const sc = calcMatchScore(m, ri)
            baseScore += sc.base
            skillBonus += sc.skill
          }
        }
      } else {
        // Match Accuracy for backup picks — use matchPickResult
        if (m.matchPickResult === 'correct') cBackup++
        else if (m.matchPickResult === 'wrong') wBackup++
      }

      // Match Yield — all resolved matches with locked odds
      const pickName = m.matchPick || m.originalPick
      if (pickName && m.matchPickResult) {
        const lockedOdds = pickName === m.p1?.name ? m.odds_p1_locked
          : pickName === m.p2?.name ? m.odds_p2_locked : null
        if (lockedOdds) {
          const stake = STAKE_BY_ROUND[ri] ?? 10
          matchYield += m.matchPickResult === 'correct'
            ? Math.round(stake * (lockedOdds - 1))
            : -stake
          matchYieldResolved++
        }
      } else if (!pickName && m.odds_p1_locked && m.odds_p2_locked) {
        // Auto-pick: no pick set → score as if player had picked the odds favourite
        const favIsP1 = parseFloat(m.odds_p1_locked) <= parseFloat(m.odds_p2_locked)
        const favOdds = favIsP1 ? parseFloat(m.odds_p1_locked) : parseFloat(m.odds_p2_locked)
        const favWon = m.winner === (favIsP1 ? m.p1?.name : m.p2?.name)
        const stake = STAKE_BY_ROUND[ri] ?? 10
        matchYield += favWon ? Math.round(stake * (favOdds - 1)) : -stake
        matchYieldResolved++
      }
    }
  }))

  const { maxHealthPts, reachableHealthPts } = calcHealthPts(d, filterRi)

  return { filled, total, cOrig, wOrig, cDrawOrig, wDrawOrig, cBackup, wBackup, baseScore, skillBonus, maxHealthPts, reachableHealthPts, matchYield, matchYieldResolved }
}

export function calcStats(d) { return calcStatsAsOf(d, null) }

// Health hue: remap 25-90% → red-to-green. Shared by stats bar and leaderboard rows.
export function healthHue(pct) {
  return 4 + Math.max(0, Math.min(100, (pct - 25) * 100 / 65)) * 1.4
}

// Pool-adjusted composite metric.
// entries = [{score, matchYield}] — one per player with ≥1 pick.
// Returns array of SlamIndex integers in the same order.
// Guards: pool < 2 or stddev = 0 → that z = 0 for everyone (index = 100).
export function calcSlamIndex(entries) {
  const n = entries.length
  if (n < 2) return entries.map(() => 100)
  const scores = entries.map(e => e.score ?? 0)
  const yields = entries.map(e => e.matchYield ?? 0)
  const meanS = scores.reduce((a, b) => a + b, 0) / n
  const meanM = yields.reduce((a, b) => a + b, 0) / n
  const stdS = Math.sqrt(scores.reduce((s, v) => s + (v - meanS) ** 2, 0) / n)
  const stdM = Math.sqrt(yields.reduce((s, v) => s + (v - meanM) ** 2, 0) / n)
  return entries.map(e => {
    const zS = stdS > 0 ? ((e.score ?? 0) - meanS) / stdS : 0
    const zM = stdM > 0 ? ((e.matchYield ?? 0) - meanM) / stdM : 0
    return Math.round(100 + 15 * (zS + zM) / 2)
  })
}

export function calcChalkScore(d) {
  let chalkBase = 0, chalkSkill = 0
  d.rounds.forEach((r, ri) => {
    const cfg = ROUND_CONFIG[ri] || ROUND_CONFIG[0]
    r.matches.forEach(m => {
      if (!m.winner) return
      const ws = numericSeed(m.p1.seed), ls = numericSeed(m.p2.seed)
      const p1Seeded = ws <= 32, p2Seeded = ls <= 32
      if (!p1Seeded && !p2Seeded) {
        chalkBase += cfg.base * 0.5
        chalkSkill += 0.3 * 0.5
      } else {
        const chalkWinnerSeed = Math.min(ws, ls)
        const actualWinnerSeed = m.winner === m.p1.name ? ws : ls
        if (actualWinnerSeed === chalkWinnerSeed) {
          chalkBase += cfg.base
        }
      }
    })
  })
  return {
    chalkBase: parseFloat(chalkBase.toFixed(1)),
    chalkSkill: parseFloat(chalkSkill.toFixed(1)),
    chalkTotal: parseFloat((chalkBase + chalkSkill).toFixed(1)),
  }
}
