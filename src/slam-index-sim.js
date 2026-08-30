// Slam Index v4 — persisted Monte Carlo σ_DY matrix. See .claude/rules/slam-index.md
// "v4". Pure simulation/bit-packing math only — no DOM, no Supabase. scoring.js and
// commissioner-results.js call into this; this module never imports either back
// (chalk's fixed prediction bracket is passed in already built, via
// buildEloChalkBracket in scoring.js).
//
// v4 no longer simulates Match Yield at all (its variance is an exact closed form —
// see calcSigmaMYLive in scoring.js, bets settle independently so there's no
// cross-match covariance to simulate away). Draw Yield still needs simulation
// because a real bracket DOES have cross-round covariance (a busted round-1 pick
// kills every later round it fed) — but instead of collapsing 40,000 runs straight
// to a frozen sigma, this module persists the full per-run, per-position outcome
// matrix (did this run's simulated winner match chalk's fixed prediction at this
// bracket slot?) so sigma_DY can be re-derived, cheaply and without re-simulating,
// every time the real decided-match set changes.

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

// Real R0 occupants only — needed to seed each simulated walk from the actual
// draw. Round-2+ occupants are never read from reality; every simulated run
// propagates its own winners forward independently (see the module comment above
// — the whole point is to never condition on real results).
function _buildRealR0(d) {
  return d.rounds[0].matches.map(m => ({ p1: m.p1?.name || null, p2: m.p2?.name || null }))
}

// Canonical flat (ri, mi) position order — must be identical every time a draw's
// matrix is built or masked, or bit indices silently point at the wrong match.
// d.rounds is fixed round/match order for a given draw shape, so this is stable.
export function flattenDrawPositions(d) {
  const positions = []
  d.rounds.forEach((r, ri) => r.matches.forEach((m, mi) => positions.push({ ri, mi })))
  return positions
}

function _bitIndex(posIndex, run, runs) { return posIndex * runs + run }
function _getBit(bytes, i) { return (bytes[i >> 3] >> (i & 7)) & 1 }
function _setBit(bytes, i) { bytes[i >> 3] |= (1 << (i & 7)) }

// Runs `runs` independent random walks of the full bracket forward from the real
// R0 players, using ORIGINAL pre-tournament ELO (eloMap(d) at the moment this is
// called — see .claude/rules/betting.md "ELO Sync Frozen Once a Draw Is Complete";
// in practice this only ever runs once, at the first winner confirmation, well
// before ELO could have drifted much). Never conditions on any real round-2+
// result, at any point — every run propagates its own winners forward using the
// same ELO win-probability formula chalk's own bracket uses
// (p = 1/(1+10^(-ΔELO/400)), divisor 400, missing ELO -> 1500).
//
// At every simulated match, records one bit: did this run's simulated winner
// equal chalk's FIXED predicted winner for that slot (chalk[ri][mi].winner, from
// buildEloChalkBracket — the "always higher ELO wins" bracket)? This mirrors real
// Draw Yield scoring exactly — chalk's pick only scores a later round if the SAME
// named player keeps winning in this simulated reality, not just in chalk's own
// idealized walk.
//
// Returns { matrix: Uint8Array (bit-packed, position-major — bit index
// posIndex*runs+run), positions, runs, seed }. No score/sigma is computed here —
// see sigmaDYFromMatrix, which masks this matrix to whatever's actually decided.
export function runChalkSimulationMatrix(d, chalk, { runs = 40000, seed = 42 } = {}) {
  const eloLookup = eloMap(d)
  const realR0 = _buildRealR0(d)
  const rng = mulberry32(seed)
  const positions = flattenDrawPositions(d)
  const nRounds = d.rounds.length

  const matrix = new Uint8Array(Math.ceil((positions.length * runs) / 8))

  for (let run = 0; run < runs; run++) {
    let prevOcc = null
    let posIndex = 0

    for (let ri = 0; ri < nRounds; ri++) {
      const nMatches = d.rounds[ri].matches.length
      const thisOcc = new Array(nMatches)

      for (let mi = 0; mi < nMatches; mi++, posIndex++) {
        let p1, p2
        if (ri === 0) {
          p1 = realR0[mi].p1
          p2 = realR0[mi].p2
        } else {
          p1 = prevOcc[mi * 2]?.winner ?? null
          p2 = prevOcc[mi * 2 + 1]?.winner ?? null
        }
        if (!p1 || !p2) { thisOcc[mi] = { winner: null }; continue }

        const e1 = eloLookup.get(normaliseName(p1)) ?? 1500
        const e2 = eloLookup.get(normaliseName(p2)) ?? 1500
        const p1WinProb = 1 / (1 + Math.pow(10, -(e1 - e2) / 400))
        const winner = rng() < p1WinProb ? p1 : p2
        thisOcc[mi] = { winner }

        const chalkWinner = chalk[ri]?.[mi]?.winner
        if (chalkWinner && winner === chalkWinner) _setBit(matrix, _bitIndex(posIndex, run, runs))
      }
      prevOcc = thisOcc
    }
  }

  return { matrix, positions, runs, seed }
}

// Masks a persisted simulation matrix to the set of bracket positions actually
// decided in reality (`decidedKeys` — a Set of "ri-mi" strings) and returns the
// standard deviation of chalk's simulated score across all `runs` — i.e. σ_DY as
// of exactly this decided set. Never re-simulates; this is a cheap aggregation
// over already-persisted random outcomes (≤127 decided positions × runs additions,
// a few million integer ops, done on every confirm/undo rather than a fresh 40k
// full-bracket walk each time).
export function sigmaDYFromMatrix(matrix, positions, runs, decidedKeys, roundBase) {
  const tally = new Float64Array(runs)
  positions.forEach((pos, posIndex) => {
    if (!decidedKeys.has(`${pos.ri}-${pos.mi}`)) return
    const base = roundBase[pos.ri] ?? 0
    if (!base) return
    for (let run = 0; run < runs; run++) {
      if (_getBit(matrix, _bitIndex(posIndex, run, runs))) tally[run] += base
    }
  })
  let sum = 0, sumSq = 0
  for (let i = 0; i < runs; i++) { sum += tally[i]; sumSq += tally[i] * tally[i] }
  const mean = sum / runs
  return Math.sqrt(Math.max(0, sumSq / runs - mean * mean))
}

// Base64 <-> Uint8Array, chunked to avoid blowing the argument-count limit that a
// single `String.fromCharCode(...bytes)` spread hits on a ~635KB array (a full
// 40,000×127-bit matrix). Plain browser btoa/atob — no Buffer available outside Node.
const B64_CHUNK = 0x8000
export function matrixToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK))
  }
  return btoa(binary)
}
export function base64ToMatrix(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
