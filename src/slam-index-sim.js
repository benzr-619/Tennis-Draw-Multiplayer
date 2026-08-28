// Slam Index v3 — Monte Carlo estimate of the chalk-bracket standard deviations.
// See .claude/rules/slam-index.md "v3". Simulation only — no DOM, no Supabase.
// scoring.js calls into this; this module never imports scoring.js back (chalk's
// fixed prediction bracket is passed in already built, via buildEloChalkBracket).

import { eloMap } from './elo.js'
import { normaliseName } from './odds.js'

// Deterministic seeded PRNG (mulberry32) — Math.random() would make a "fixed seed"
// meaningless and the result irreproducible across runs/machines.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Real occupants + locked odds per (ri, mi), used only to detect "this simulated
// matchup is the one that actually happened" so its real odds can be used instead
// of the ELO-implied fair-odds fallback. Trusted only where locked odds exist —
// locked odds are only ever set once both occupants are confirmed real (either R0,
// or a backup_picks lock, which requires bothOccupantsResolved — see
// .claude/rules/lock-conventions.md), so p1/p2 identity is reliable exactly where
// this matters.
function _buildRealOccLookup(d) {
  return d.rounds.map(r => r.matches.map(m => ({
    p1: m.p1?.name || null,
    p2: m.p2?.name || null,
    oddsP1: m.odds_p1_locked && m.odds_p2_locked ? parseFloat(m.odds_p1_locked) : null,
    oddsP2: m.odds_p1_locked && m.odds_p2_locked ? parseFloat(m.odds_p2_locked) : null,
  })))
}

// Runs `runs` independent random walks of the full bracket forward from the real
// R0 players, using the same ELO win-probability formula the chalk baseline itself
// uses (p = 1/(1+10^(-ΔELO/400)), divisor 400, missing ELO -> 1500 — matches
// buildEloChalkBracket's convention). At every simulated match:
//   - DY: does the simulated winner equal chalk's fixed predicted winner for that
//     slot (chalk[ri][mi].winner, from buildEloChalkBracket — unchanged, still the
//     "always higher ELO wins" bracket)? If so, award that round's base points.
//     This mirrors real Draw Yield scoring exactly: chalk's pick only scores a
//     later round if the SAME named player actually keeps winning in this
//     simulated reality, not just in chalk's own idealized walk.
//   - MY: accumulate (favOdds - 1) for every match reached in this run's walk —
//     the theoretical variance term of a flat-stake fair-odds bet on the
//     favourite, independent of who actually wins. Real locked odds are used when
//     the simulated matchup is the one that actually happened; otherwise ELO's own
//     implied fair odds (o = 1/p) are used. This "path-averages" what the old
//     closed form only ever evaluated along the one real historical path.
// σ_DY = population stddev of each run's DY score. σ_MY = 10 × sqrt(mean of each
// run's MY accumulator) — mirrors the closed form's `10 * sqrt(sigmaMYsq)` shape,
// just with sigmaMYsq now averaged over simulated paths instead of computed once
// along the real path.
export function simulateChalkSigma(d, chalk, config, { runs = 40000, seed = 42 } = {}) {
  const eloLookup = eloMap(d)
  const realOcc = _buildRealOccLookup(d)
  const rng = mulberry32(seed)
  const nRounds = d.rounds.length
  const roundBase = config.roundBase

  const dyScores = new Float64Array(runs)
  const myAccums = new Float64Array(runs)

  for (let run = 0; run < runs; run++) {
    let prevOcc = null
    let dyScore = 0
    let myAccum = 0

    for (let ri = 0; ri < nRounds; ri++) {
      const nMatches = d.rounds[ri].matches.length
      const thisOcc = new Array(nMatches)

      for (let mi = 0; mi < nMatches; mi++) {
        let p1, p2
        if (ri === 0) {
          p1 = realOcc[0][mi].p1
          p2 = realOcc[0][mi].p2
        } else {
          p1 = prevOcc[mi * 2]?.winner ?? null
          p2 = prevOcc[mi * 2 + 1]?.winner ?? null
        }
        if (!p1 || !p2) { thisOcc[mi] = { winner: null }; continue }

        const e1 = eloLookup.get(normaliseName(p1)) ?? 1500
        const e2 = eloLookup.get(normaliseName(p2)) ?? 1500
        const p1WinProb = 1 / (1 + Math.pow(10, -(e1 - e2) / 400))
        const p1Wins = rng() < p1WinProb
        const winner = p1Wins ? p1 : p2
        thisOcc[mi] = { winner }

        // Draw Yield: chalk's fixed pick for this slot must be the actual simulated winner.
        const chalkWinner = chalk[ri]?.[mi]?.winner
        if (chalkWinner && winner === chalkWinner) dyScore += roundBase[ri] ?? 0

        // Match Yield: variance term for a flat-stake bet on this matchup's favourite.
        const favIsP1 = e1 >= e2
        const favProb = favIsP1 ? p1WinProb : 1 - p1WinProb
        const real = realOcc[ri]?.[mi]
        const matchesReal = real && real.p1 === p1 && real.p2 === p2 && real.oddsP1 != null
        const favOdds = matchesReal ? (favIsP1 ? real.oddsP1 : real.oddsP2) : 1 / favProb
        myAccum += favOdds - 1
      }
      prevOcc = thisOcc
    }

    dyScores[run] = dyScore
    myAccums[run] = myAccum
  }

  let dySum = 0, dySumSq = 0, mySum = 0
  for (let i = 0; i < runs; i++) { dySum += dyScores[i]; dySumSq += dyScores[i] * dyScores[i]; mySum += myAccums[i] }
  const dyMean = dySum / runs
  const sigmaDY = Math.sqrt(Math.max(0, dySumSq / runs - dyMean * dyMean))
  const sigmaMY = 10 * Math.sqrt(Math.max(0, mySum / runs))

  return { sigmaDY, sigmaMY, runs, seed }
}
