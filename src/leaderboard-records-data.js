// Records tab — pure data/aggregation helpers (no DOM).
// Split out of leaderboard-records.js 2026-07-18 (redesign) to keep that file
// render-only — see .claude/rules/leaderboard-records-redesign.md.

import { shrinkSlamIndex } from './scoring.js'

// ── ALL-TIME AGGREGATES (drawsPlayed/avgSlamIndex feed the shrinkage standings) ──

export function buildAllTimeAgg(profs, draws, statsMaps) {
  const agg = {}
  profs.forEach(prof => {
    let totalScore = 0, drawsPlayed = 0
    let totalMY = 0, myCount = 0, totalSI = 0, siCount = 0
    let totalFlatYield = 0, totalFlatBets = 0
    let totalDH = 0, dhCount = 0
    statsMaps.forEach(sm => {
      const s = sm[prof.id]
      if (!s?.hasAnyPicks || !s?.poolEligible) return
      drawsPlayed++
      totalScore += s.score
      if (s.matchYield !== null) { totalMY += s.matchYield; myCount++ }
      if (s.slamIndex  !== null) { totalSI += s.slamIndex;  siCount++ }
      if (s.flatYieldResolved > 0) { totalFlatYield += s.flatYield; totalFlatBets += s.flatYieldResolved }
      if (s.drawHealth !== null && s.drawHealth !== undefined) { totalDH += s.drawHealth; dhCount++ }
    })
    agg[prof.id] = {
      drawsPlayed,
      hasAnyPicks:    drawsPlayed > 0,
      avgScore:       drawsPlayed > 0 ? totalScore / drawsPlayed : null,
      totalMatchYield: myCount > 0   ? Math.round(totalMY)                  : null,
      avgMatchYield:   myCount > 0   ? Math.round(totalMY / myCount)        : null,
      avgSlamIndex:    siCount > 0   ? totalSI / siCount                   : null,
      siCount,
      flatROI:         totalFlatBets > 0 ? totalFlatYield / totalFlatBets   : null,
      totalFlatBets,
      avgDrawHealth:   dhCount > 0 ? totalDH / dhCount : null,
    }
  })
  return agg
}

// Flat list of every pool-eligible player×draw combination — the raw material
// for the Records tab's "top 10" tables (Draw Yield / Match Yield / Slam Index
// Ever). Deliberately NOT deduped per player — a player can occupy multiple
// slots in a top-10 list if they've had multiple standout draws.
export function buildAllBrackets(profs, draws, statsMaps) {
  const out = []
  draws.forEach((draw, i) => {
    const sm = statsMaps[i]
    profs.forEach(prof => {
      const s = sm[prof.id]
      if (!s?.hasAnyPicks || !s?.poolEligible) return
      out.push({ prof, draw, score: s.score, matchYield: s.matchYield, slamIndex: s.slamIndex, slamIndexVersion: s.slamIndexVersion })
    })
  })
  return out
}

// Top-N single-draw performances pool-wide by `key` ('score' | 'matchYield' |
// 'slamIndex'), from buildAllBrackets's flat list. Same player can appear more
// than once. Entries missing a value for `key` are excluded.
export function topByKey(brackets, key, n = 10) {
  return brackets
    .filter(e => e[key] !== null && e[key] !== undefined)
    .sort((a, b) => b[key] - a[key])
    .slice(0, n)
}

// Mean Slam Index across every v2 (absolute, chalk-referenced) player×draw
// entry — the shrinkage anchor. Recomputed fresh each render from whatever
// brackets are in scope (no storage, no new query) and DELIBERATELY drifts as
// more draws accumulate — see .claude/rules/slam-index.md "The anchor bug." A
// v1-fallback entry (a draw with no trustworthy chalk baseline) is excluded —
// it sits on a different scale (pool-relative, mean pinned to 100 by
// construction) and would corrupt the v2 mean. null when there are no v2
// entries at all (caller falls back to 100, the only sane default left).
export function computePoolMeanIndex(brackets) {
  const v2 = brackets.filter(e => (e.slamIndexVersion === 2 || e.slamIndexVersion === 4) && e.slamIndex != null)
  if (!v2.length) return null
  return v2.reduce((s, e) => s + e.slamIndex, 0) / v2.length
}

// ── SHRINKAGE-ADJUSTED SLAM INDEX STANDINGS ──
// shown = (n/(n+K)) × player_avg + (K/(n+K)) × poolMeanIndex — pulls low-n
// players toward the pool's actual mean (NOT a hardcoded 100 — see
// shrinkSlamIndex in scoring.js for why) so a 1-2-draw hot streak can't outrank
// a longer track record. No participation gate — every player with ≥1
// pool-eligible draw is ranked; low-n players are naturally pulled toward the
// anchor instead of excluded.
//
// Ties (after rounding — the display never shows decimals, see
// .claude/rules/slam-index.md "single-draw noise") are broken by n descending
// (more draws played ranks higher), then by the exact unrounded shown value —
// sort-order tiebreaks only, never shown as a number or a rule; two players
// can and do legitimately display the same rounded index. The unrounded
// tiebreak matters even when n also ties: without it, two rows a few
// hundredths apart display "tied" (correct) but order arbitrarily by array
// position (not correct) — found 2026-08-25 when a player with a genuinely
// higher raw average (and higher true shrunk value) displayed BELOW another
// player at the same rounded index and same n, purely because of iteration
// order. The gap this tiebreak resolves is itself noise-level (~0.4 points
// against a ~13-point single-draw sigma) — it exists so the display order at
// least agrees with the real, if tiny, computed difference, not to imply that
// difference is meaningful.
export function buildShrinkageStandings(profs, agg, poolMeanIndex, K = 5) {
  const anchor = poolMeanIndex ?? 100
  return profs
    .filter(p => agg[p.id]?.hasAnyPicks && agg[p.id]?.avgSlamIndex !== null)
    .map(p => {
      const a = agg[p.id]
      return {
        prof: p,
        n: a.drawsPlayed,
        rawAvg: a.avgSlamIndex,
        shown: shrinkSlamIndex(a.avgSlamIndex, a.drawsPlayed, anchor, K),
      }
    })
    .sort((a, b) => {
      const rA = Math.round(a.shown), rB = Math.round(b.shown)
      if (rA !== rB) return rB - rA
      if (a.n !== b.n) return b.n - a.n
      return b.shown - a.shown
    })
}

// ── K RECOMPUTATION ──
// Estimates the shrinkage constant from real cross-draw variance instead of a
// guessed number. Standing method — see .claude/rules/slam-index.md "The K
// recomputation procedure" for the full derivation and why each guard exists;
// this comment is the short version.
//
// Restricted throughout to (a) v2-only entries (a v1-fallback entry sits on a
// different scale — see computePoolMeanIndex) and (b) players with ≥2 v2 draws
// (a single-draw player carries no within-player signal and would only add
// noise to both the draw means used for centering and the variance estimate).
//
// 1. Draw-centre: subtract each draw's OWN mean (computed over this same
//    restricted population) from every entry, isolating player consistency
//    from draw-level effects (a tough field, a chalky bracket, etc). Skipping
//    this step is not a smaller error — it collapses sigma_between to ~0 and
//    sends K to infinity, since without it "draw was hard" and "player is
//    inconsistent" are indistinguishable.
// 2. sigma_within² — pooled within-player variance of the centred residuals
//    around each player's own mean, proper degrees of freedom (Σ(n_i − 1), not
//    n_i) so no player's sample is double-counted.
// 3. sigma_between² — variance of player means, minus the sampling noise a
//    finite mean_n draws already contributes (Var(mean of n) ≈ sigma_within²/n)
//    — the standard method-of-moments random-effects estimator.
// 4. K = sigma_within² / sigma_between² — the ratio IS the shrinkage constant:
//    how many "extra draws" of pull toward the anchor it takes to counteract
//    one draw's worth of pure noise.
//
// Diagnostics (n_players, n_draws, draw_gap_max, sigma_within, sigma_between)
// are returned whenever mathematically defined, INDEPENDENT of whether K itself
// is trustworthy — a commissioner watching these evolve across slams is exactly
// how a currently-guarded K (e.g. only 2 draws on record) gets confirmed before
// there's enough data to trust it. `k`/`reason` are gated by three guards; the
// caller treats a non-null `reason` as "do not offer to apply this K" even if a
// raw number is present, and the UI additionally hides the diagnostic numbers
// in that case (see commissioner Results-tab status card) — this function
// itself does not suppress them.
export function computeShrinkageK(brackets) {
  const byPlayer = new Map()
  brackets
    .filter(e => (e.slamIndexVersion === 2 || e.slamIndexVersion === 4) && e.slamIndex != null)
    .forEach(e => {
      if (!byPlayer.has(e.prof.id)) byPlayer.set(e.prof.id, [])
      byPlayer.get(e.prof.id).push(e)
    })

  const multiDrawGroups = [...byPlayer.values()].filter(list => list.length >= 2)
  const nPlayers = multiDrawGroups.length
  const entries = multiDrawGroups.flat()

  const byDraw = new Map()
  entries.forEach(e => {
    const key = e.draw.db_id
    if (!byDraw.has(key)) byDraw.set(key, [])
    byDraw.get(key).push(e.slamIndex)
  })
  const nDraws = byDraw.size
  const drawMeans = [...byDraw.values()].map(vals => vals.reduce((a, b) => a + b, 0) / vals.length)
  const drawGapMax = drawMeans.length >= 2 ? Math.max(...drawMeans) - Math.min(...drawMeans) : null
  const drawMeanByKey = new Map([...byDraw.entries()].map(([key, vals]) => [key, vals.reduce((a, b) => a + b, 0) / vals.length]))

  const base = { n_players: nPlayers, n_draws: nDraws, draw_gap_max: drawGapMax, sigma_within: null, sigma_between: null, k: null }

  if (nDraws < 2 || nPlayers < 2) {
    return { ...base, reason: 'Not enough cross-draw data yet to estimate anything.' }
  }

  // sigma_within² — pooled within-player variance of the draw-centred residuals
  let ssWithin = 0, dfWithin = 0
  const playerMeans = []
  multiDrawGroups.forEach(list => {
    const resids = list.map(e => e.slamIndex - drawMeanByKey.get(e.draw.db_id))
    const mean = resids.reduce((a, b) => a + b, 0) / resids.length
    ssWithin += resids.reduce((s, v) => s + (v - mean) ** 2, 0)
    dfWithin += resids.length - 1
    playerMeans.push(mean)
  })
  const sigmaWithin = dfWithin > 0 ? Math.sqrt(ssWithin / dfWithin) : null

  // sigma_between² — variance of player means minus the sampling noise a finite
  // mean_n draws already contributes
  const meanN = entries.length / nPlayers
  const grandMean = playerMeans.reduce((a, b) => a + b, 0) / playerMeans.length
  const varOfMeans = playerMeans.reduce((s, v) => s + (v - grandMean) ** 2, 0) / (playerMeans.length - 1)
  const sigmaBetweenSq = sigmaWithin != null ? varOfMeans - (sigmaWithin ** 2) / meanN : null
  const sigmaBetween = sigmaBetweenSq != null && sigmaBetweenSq > 0 ? Math.sqrt(sigmaBetweenSq) : null

  const diagnostics = { n_players: nPlayers, n_draws: nDraws, draw_gap_max: drawGapMax, sigma_within: sigmaWithin, sigma_between: sigmaBetween }
  const k = sigmaBetween != null ? (sigmaWithin ** 2) / sigmaBetweenSq : null

  if (nDraws < 3) return { ...diagnostics, k, reason: `Only ${nDraws} draws with a computable Slam Index — need at least 3 to trust draw-centering.` }
  if (nPlayers < 5) return { ...diagnostics, k, reason: `Only ${nPlayers} players with ≥2 draws — need at least 5.` }
  if (sigmaBetween == null) return { ...diagnostics, k: null, reason: 'No detectable skill spread above single-draw noise (σ_between² ≤ 0).' }

  return { ...diagnostics, k, reason: null }
}
