// Scoring logic — ported verbatim from reference app

import { buildDrawView } from './draw-view.js'
import { eloMap } from './elo.js'
import { normaliseName } from './odds.js'

// ── SCORING VERSIONS ──
// See .claude/rules/scoring-redesign.md. v1 is the formula every draw played
// under through Wimbledon 2026 — its numeric output must never change, ever
// (existing draws are frozen at whatever version they were played under). v2
// is the post-Wimbledon-2026 redesign: strict-doubling Draw Yield with no upset
// bonus, flat $10 Match Yield stake, and a fixed stale-pick-in-Match-Yield bug
// (see "Verified formulas and gotchas" §4 in that doc). A draw's version lives
// in `draws.scoring_version` (default 1, threaded onto the assembled draw object
// in data.js) — every function below that depends on round base points, the
// upset bonus, or the Match Yield stake reads it off the draw/match object it's
// given rather than assuming a global constant.
export const SCORING_CONFIGS = {
  1: {
    roundBase: [1, 2, 3, 6, 10, 18, 32], // Math.round(1.78^ri), ri 0-6
    stakeByRound: [10, 10, 20, 20, 30, 40, 50],
    upsetBonusEnabled: true,
    staleFallbackToFavourite: false,
  },
  2: {
    roundBase: [1, 2, 4, 8, 16, 32, 64],
    stakeByRound: [10, 10, 10, 10, 10, 10, 10],
    upsetBonusEnabled: false,
    staleFallbackToFavourite: true,
  },
}

export function getScoringConfig(version) {
  return SCORING_CONFIGS[version] ?? SCORING_CONFIGS[1]
}

// Legacy exports — v1 values, kept for any external/backward-compat reference.
// Internal scoring code below always reads a version-resolved config instead.
export const ROUND_CONFIG = SCORING_CONFIGS[1].roundBase.map(base => ({ base }))
export const STAKE_BY_ROUND = SCORING_CONFIGS[1].stakeByRound

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

export function calcMatchScore(m, ri, version = 1) {
  const config = getScoringConfig(version)
  const base = config.roundBase[ri] ?? config.roundBase[0]
  const loser = m.winner === m.p1.name ? m.p2 : m.p1
  const winner = m.winner === m.p1.name ? m.p1 : m.p2
  const skillBonus = config.upsetBonusEnabled ? calcUpsetBonus(winner.seed, loser.seed) : 0
  return { base, skill: skillBonus }
}

export function isBackupPick(m, locked) {
  if (!!m.originalPick && m.matchPick && m.matchPick !== m.originalPick) return true
  if (locked && m.matchPick && !m.originalPick) return true
  return false
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

  const config = getScoringConfig(view.scoring_version ?? 1)
  const withdrawnNm = withdrawnNames(view)
  const eloLookup = eloMap(view)

  let maxHealthPts = 0, reachableHealthPts = 0
  view.rounds.forEach((r, ri) => r.matches.forEach(m => {
    const pts = config.roundBase[ri] ?? 0
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

// Draw Health numerator/denominator for an ARBITRARY set of confirmed matches,
// rather than "everything up to round filterRi". Same clone-and-replay shape as
// calcHealthPts — the only difference is the null-out condition: we forget every
// winner whose match db_id is NOT in `confirmedIds`, then re-derive the view.
//
// `confirmedIds` is a Set of match db_id strings. Callers must pass a coherent set
// — matches in proper bracket order (e.g. ordered by winner_confirmed_at) so
// buildDrawView never sees a later-round result without its feeder.
//
// Used by the health-bands calibration (src/health-bands.js) to compute a draw's
// health trajectory match-by-match. Body kept verbatim with calcHealthPts.
export function calcHealthAtMatchSet(d, confirmedIds) {
  const view = structuredClone(d)
  view.rounds.forEach(r => r.matches.forEach(m => {
    if (!confirmedIds.has(m.db_id)) { m.winner = null; m.score = null }
  }))
  buildDrawView(view)

  const config = getScoringConfig(view.scoring_version ?? 1)
  const withdrawnNm = withdrawnNames(view)
  const eloLookup = eloMap(view)

  let maxHealthPts = 0, reachableHealthPts = 0
  view.rounds.forEach((r, ri) => r.matches.forEach(m => {
    const pts = config.roundBase[ri] ?? 0
    if (isAutoAssign(m, withdrawnNm)) {
      const fav = eloFavourite(m, eloLookup)
      if (!fav) return
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

// Score a "no real pick" match (blank, or — v2 only — a stale pick that names
// neither current occupant) as if the player had bet the odds favourite.
// Returns null when locked odds aren't available for both sides.
function _autoFavouriteYield(m, stake) {
  if (!m.odds_p1_locked || !m.odds_p2_locked) return null
  const favIsP1 = parseFloat(m.odds_p1_locked) <= parseFloat(m.odds_p2_locked)
  const favOdds = favIsP1 ? parseFloat(m.odds_p1_locked) : parseFloat(m.odds_p2_locked)
  const favWon = m.winner === (favIsP1 ? m.p1?.name : m.p2?.name)
  return favWon ? Math.round(stake * (favOdds - 1)) : -stake
}

// Shrinkage estimator for the Records-tab all-time Slam Index standings — pulls
// a player's raw average toward an anchor by an amount inversely proportional to
// their sample size, so a 1-2-draw hot streak can't outrank a longer consistent
// track record. See .claude/rules/leaderboard-records-redesign.md for the
// rejected alternatives (min-draws gate, cumulative totals, medal counts).
//
// `anchor` must be the POOL'S ACTUAL MEAN Slam Index, not a hardcoded 100. Under
// v1 (field-relative) Slam Index, z-scoring forced the pool mean to exactly 100,
// so 100 was a correct, stable anchor. Under v2 (absolute, chalk-referenced) 100
// means "matched chalk" — almost nobody does, so anchoring to 100 pulled
// low-sample players toward a score most of the pool never reaches, rewarding
// not playing. The anchor must be recomputed from real data — see
// `computeShrinkageK`'s poolMeanIndex in leaderboard-records-data.js. This is
// deliberately allowed to drift as more draws accumulate — see
// .claude/rules/slam-index.md "The anchor bug."
export function shrinkSlamIndex(avg, n, anchor, K = 5) {
  if (n <= 0) return anchor
  return (n / (n + K)) * avg + (K / (n + K)) * anchor
}

export function calcStatsAsOf(d, upToRi = null) {
  const isLive = upToRi === null
  const filterRi = isLive ? Infinity : upToRi
  let filled = 0, total = 0, cOrig = 0, wOrig = 0, cBackup = 0, wBackup = 0
  let baseScore = 0, skillBonus = 0
  let cDrawOrig = 0, wDrawOrig = 0
  let matchYield = 0, matchYieldResolved = 0

  const version = d.scoring_version ?? 1
  const config = getScoringConfig(version)
  const withdrawnNm = withdrawnNames(d)
  const eloLookup = eloMap(d)

  d.rounds.forEach((r, ri) => r.matches.forEach(m => {
    total++
    if (m.matchPick) filled++
    if (!m.p1.name && !m.p2.name) return

    if (ri <= filterRi && m.winner) {
      const backup = isBackupPick(m, d.locked)
      // Draw Accuracy — based on original pick result only
      if (m.originalPickResult === 'correct') cDrawOrig++
      else if (m.originalPickResult === 'wrong') wDrawOrig++

      // Match Accuracy — cOrig/wOrig (non-backup) vs cBackup/wBackup, gating
      // unchanged from before this fix.
      if (!backup) {
        if (m.originalPickResult === 'correct') cOrig++
        else if (m.originalPickResult === 'wrong') wOrig++
      } else {
        // Match Accuracy for backup picks — use matchPickResult
        if (m.matchPickResult === 'correct') cBackup++
        else if (m.matchPickResult === 'wrong') wBackup++
      }

      // Draw Yield (baseScore/skillBonus) — independent of backup-pick status:
      // a correct original pick scores regardless of whether a later backup
      // pick was ever registered for this slot (a live match can carry both).
      // Reads isAutoAssign(...) directly rather than through the precomputed
      // originalPickResult string, so a withdrawn-player pick (a real,
      // non-null value that's always 'wrong' against the actual winner)
      // still reaches the ELO auto-assign branch. Mirrors calcHealthPts /
      // calcHealthAtMatchSet's structure exactly — those are unaffected by
      // backup status or this ordering bug and are the reference here.
      if (isAutoAssign(m, withdrawnNm)) {
        const fav = eloFavourite(m, eloLookup)
        if (fav && m.winner === fav) {
          const sc = calcMatchScore(m, ri, version)
          baseScore += sc.base
          skillBonus += sc.skill
        }
      } else if (m.originalPickResult === 'correct') {
        const sc = calcMatchScore(m, ri, version)
        baseScore += sc.base
        skillBonus += sc.skill
      }

      // Match Yield — all resolved matches with locked odds
      const stake = config.stakeByRound[ri] ?? 10
      const pickName = m.matchPick || m.originalPick
      const pickMatchesOccupant = !!pickName && (pickName === m.p1?.name || pickName === m.p2?.name)

      if (pickName && m.matchPickResult) {
        const lockedOdds = pickName === m.p1?.name ? m.odds_p1_locked
          : pickName === m.p2?.name ? m.odds_p2_locked : null
        if (lockedOdds) {
          matchYield += m.matchPickResult === 'correct'
            ? Math.round(stake * (lockedOdds - 1))
            : -stake
          matchYieldResolved++
        } else if (!pickMatchesOccupant && config.staleFallbackToFavourite) {
          // v2 only: a stale pick (names neither current occupant) is treated
          // like a blank pick rather than silently excluded — see
          // .claude/rules/scoring-redesign.md "Verified formulas and gotchas" §4.
          const yld = _autoFavouriteYield(m, stake)
          if (yld !== null) { matchYield += yld; matchYieldResolved++ }
        }
      } else if (!pickName) {
        // Auto-pick: no pick set → score as if player had picked the odds favourite
        const yld = _autoFavouriteYield(m, stake)
        if (yld !== null) { matchYield += yld; matchYieldResolved++ }
      }
    }
  }))

  const { maxHealthPts, reachableHealthPts } = calcHealthPts(d, filterRi)

  return { filled, total, cOrig, wOrig, cDrawOrig, wDrawOrig, cBackup, wBackup, baseScore, skillBonus, maxHealthPts, reachableHealthPts, matchYield, matchYieldResolved }
}

export function calcStats(d) { return calcStatsAsOf(d, null) }

// Minimum-participation eligibility gate for leaderboard/Slam Index pool membership.
// A player counts toward a draw's pool only if they filled original_pick on at least
// POOL_ELIGIBILITY_THRESHOLD of that draw's matches — otherwise a near-empty bracket
// gets scored almost entirely off the ELO auto-assign fallback (isAutoAssign above)
// and can rank purely on auto-assigned points rather than real picks. Does not change
// scoring itself — only who counts toward the ranked pool. See
// .claude/rules/leaderboard-detail.md "Pool Eligibility" (decided 2026-07-02).
export const POOL_ELIGIBILITY_THRESHOLD = 0.5

export function isPoolEligible(d) {
  let picked = 0, total = 0
  d.rounds.forEach(r => r.matches.forEach(m => {
    total++
    if (m.originalPick) picked++
  }))
  return total > 0 && picked / total >= POOL_ELIGIBILITY_THRESHOLD
}

// Health hue: red-to-green. Calibrated against the historical health distribution
// at the same tournament stage (n confirmed matches) — a bracket is green at/above
// the historical gradient ceiling at this stage, red at/below the floor, and smoothly
// interpolated in between. Floor/ceil are LOW_PCTL/HIGH_PCTL percentiles (currently
// 10th/90th — see health-bands.js) rather than min/max, so a single outlier sample
// can't dominate the whole scale. Falls back to the static 25/90 band when no
// calibration data is available.
//   pct         — this bracket's current health %
//   n           — stage fraction (confirmedMatches / 127)
//   healthBands — Map<n(1..127), {lo, hi}> from loadHealthBands(), or null
export function healthHue(pct, n, healthBands) {
  const band = healthBands?.get(Math.round(n * 127))
  const floor = band?.lo ?? 25
  const ceil  = band?.hi ?? 90
  return 4 + Math.max(0, Math.min(100,
    (pct - floor) * 100 / Math.max(1, ceil - floor)
  )) * 1.4
}

// ── SLAM INDEX v2 — ABSOLUTE, CROSS-SLAM CHALK BASELINE ──
// See .claude/rules/slam-index.md. v1 (below, unchanged) z-scores a player against
// whoever else entered that specific draw, which pins the pool mean to exactly 100
// every time and makes indices incomparable across slams. v2 keeps the identical
// formula shape (100 + 15 × average of two z-like edges) but measures each edge
// against a fixed, player-independent reference: an ELO-favourite "chalk" bracket
// (for Draw Yield) and an odds-favourite "chalk" bettor (for Match Yield), each
// with its own theoretical standard deviation. A player's index no longer depends
// on who else played that draw — only on the draw's own chalk baseline.

// Builds the full ELO-favourite bracket: p1/p2 occupants propagated round-by-round
// from real R0 players, chalk winner = higher ELO at each slot (missing ELO → 1500).
// favProb = the propagated favourite's win probability for that specific matchup —
// feeds sigmaDY's "how coin-flippy was this chalk matchup" term.
function _buildEloChalkBracket(d) {
  const eloLookup = eloMap(d)
  const occ = d.rounds.map(r => r.matches.map(() => ({ p1: null, p2: null, winner: null, favProb: null })))
  d.rounds.forEach((r, ri) => {
    r.matches.forEach((m, mi) => {
      const slot = occ[ri][mi]
      if (ri === 0) {
        slot.p1 = m.p1?.name || null
        slot.p2 = m.p2?.name || null
      } else {
        slot.p1 = occ[ri - 1][mi * 2]?.winner || null
        slot.p2 = occ[ri - 1][mi * 2 + 1]?.winner || null
      }
      if (!slot.p1 || !slot.p2) return
      const e1 = eloLookup.get(normaliseName(slot.p1)) ?? 1500
      const e2 = eloLookup.get(normaliseName(slot.p2)) ?? 1500
      const p1WinProb = 1 / (1 + Math.pow(10, -(e1 - e2) / 400))
      const favIsP1 = e1 >= e2
      slot.winner = favIsP1 ? slot.p1 : slot.p2
      slot.favProb = favIsP1 ? p1WinProb : (1 - p1WinProb)
    })
  })
  return occ
}

// Computes the four draw-level reference values Slam Index v2 measures against.
// Scoped to currently-decided matches only (m.winner set) — mid-tournament this
// keeps the baseline comparable to a player's own live baseScore/matchYield, which
// are likewise only summed over decided matches (calcStatsAsOf).
// chalkMY/sigmaMY use a flat 10-point stake regardless of the draw's own stake
// table — sigmaMY's "100×(o-1) is the variance of a fair-odds unit bet" derivation
// only holds for a fixed stake, and every draw is on the flat-10 v2 stake table in
// practice (see .claude/rules/scoring-redesign.md). chalkMY reuses
// _autoFavouriteYield rather than reimplementing the win/loss math.
// `valid` is false when there isn't enough ELO/odds data to trust the baseline —
// callers must fall back to the v1 field-relative index in that case.
// `filterRi` (default Infinity = live) mirrors calcHealthPts: pass a round index to
// get the baseline "as of" that round, for movement-arrow baselines computed via
// calcStatsAsOf(d, R-1) — the chalk reference must be nulled to the same cutoff or
// the edge it measures against drifts out of sync with the entry it's comparing.
export function calcChalkBaselines(d, filterRi = Infinity) {
  let view = d
  if (filterRi !== Infinity) {
    view = structuredClone(d)
    view.rounds.forEach((r, ri) => {
      if (ri > filterRi) r.matches.forEach(m => { m.winner = null; m.score = null })
    })
    buildDrawView(view)
  }
  const config = getScoringConfig(view.scoring_version ?? 1)
  const chalk = _buildEloChalkBracket(view)
  let chalkDY = 0, sigmaDYsq = 0
  let chalkMY = 0, sigmaMYsq = 0
  let hasElo = false, hasOdds = false

  view.rounds.forEach((r, ri) => {
    const base = config.roundBase[ri] ?? 0
    r.matches.forEach((m, mi) => {
      if (!m.winner) return // scope to decided matches only

      const slot = chalk[ri][mi]
      if (slot.winner) {
        hasElo = true
        if (m.winner === slot.winner) chalkDY += base
        sigmaDYsq += base * base * slot.favProb * (1 - slot.favProb)
      }

      if (m.odds_p1_locked && m.odds_p2_locked) {
        const yld = _autoFavouriteYield(m, 10)
        if (yld !== null) {
          hasOdds = true
          chalkMY += yld
          const favOdds = Math.min(parseFloat(m.odds_p1_locked), parseFloat(m.odds_p2_locked))
          sigmaMYsq += (favOdds - 1)
        }
      }
    })
  })

  return {
    chalkDY,
    chalkMY,
    sigmaDY: Math.sqrt(sigmaDYsq),
    sigmaMY: 10 * Math.sqrt(sigmaMYsq),
    valid: hasElo && hasOdds && sigmaDYsq > 0 && sigmaMYsq > 0,
  }
}

// Combines two draws' chalk baselines (e.g. MS+WS for the Slams-tab Combined card)
// by summing the chalk totals and adding variances (the two draws' outcomes are
// independent). Used only where a caller has already summed a player's Draw
// Yield/Match Yield across both draws.
export function combineChalkBaselines(c1, c2) {
  return {
    chalkDY: c1.chalkDY + c2.chalkDY,
    chalkMY: c1.chalkMY + c2.chalkMY,
    sigmaDY: Math.sqrt(c1.sigmaDY ** 2 + c2.sigmaDY ** 2),
    sigmaMY: Math.sqrt(c1.sigmaMY ** 2 + c2.sigmaMY ** 2),
    valid: c1.valid && c2.valid,
  }
}

// Composite metric. entries = [{score, matchYield}] — one per player with ≥1 pick.
// Returns array of SlamIndex integers in the same order.
//
// v2 (opts.version === 2, opts.chalk.valid true): each entry is scored INDEPENDENTLY
// against the draw's fixed chalk baseline — no pool population needed at all, which
// is what makes the result comparable across different slams/pools. Same formula
// shape as v1, reference point swapped from "pool mean/spread" to "chalk mean/spread".
//
// v1 (default, or v2 requested but the draw lacks the ELO/odds data to trust a chalk
// baseline): original pool-relative z-score. Guards: pool < 2 or stddev = 0 → that
// z = 0 for everyone (index = 100).
export function calcSlamIndex(entries, opts = {}) {
  const { version = 1, chalk = null } = opts
  if (version === 2 && chalk?.valid) {
    return entries.map(e => Math.round(100 + 15 * (
      ((e.score ?? 0) - chalk.chalkDY) / chalk.sigmaDY +
      ((e.matchYield ?? 0) - chalk.chalkMY) / chalk.sigmaMY
    ) / 2))
  }
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
