import { normaliseName } from './odds.js'

// Build normalised-name → ELO map from all R0 matches of a draw.
// Only R0 matches have elo_p1/elo_p2 populated (the actual drawn players).
export function eloMap(draw) {
  const map = new Map()
  const r0 = draw.rounds[0]?.matches ?? []
  for (const m of r0) {
    if (m.elo_p1 != null && m.p1?.name) map.set(normaliseName(m.p1.name), m.elo_p1)
    if (m.elo_p2 != null && m.p2?.name) map.set(normaliseName(m.p2.name), m.elo_p2)
  }
  return map
}

// Pure simulation — returns [{ri, mi, playerName}] for matches that would be auto-filled.
// Processes rounds in order so R0 simulated outcomes feed R1 slot derivation, and so on.
// Never overwrites an existing matchPick. Skips matches where both occupants have null ELO.
export function simulateEloFill(draw) {
  const elo = eloMap(draw)
  if (elo.size === 0) return []

  // Track picks chosen by simulation so later rounds can derive occupants from them.
  // simPicks[ri][mi] = playerName or null
  const simPicks = draw.rounds.map(r => new Array(r.matches.length).fill(null))
  const results = []

  for (let ri = 0; ri < draw.rounds.length; ri++) {
    const matches = draw.rounds[ri].matches
    for (let mi = 0; mi < matches.length; mi++) {
      const m = matches[mi]
      if (m.matchPick) continue  // existing pick — never overwrite

      let occ1, occ2
      if (ri === 0) {
        occ1 = m.p1?.name || null
        occ2 = m.p2?.name || null
      } else {
        const f1 = draw.rounds[ri - 1]?.matches[mi * 2]
        const f2 = draw.rounds[ri - 1]?.matches[mi * 2 + 1]
        // Winner (confirmed result) > existing pick > simulated pick from this session
        occ1 = f1?.winner || f1?.matchPick || simPicks[ri - 1][mi * 2] || null
        occ2 = f2?.winner || f2?.matchPick || simPicks[ri - 1][mi * 2 + 1] || null
      }

      if (!occ1 && !occ2) continue

      const e1 = occ1 ? (elo.get(normaliseName(occ1)) ?? null) : null
      const e2 = occ2 ? (elo.get(normaliseName(occ2)) ?? null) : null
      if (e1 === null && e2 === null) continue

      // Higher ELO wins; if only one has ELO, pick that player
      const chosen = (e1 !== null && (e2 === null || e1 >= e2)) ? occ1 : occ2
      simPicks[ri][mi] = chosen
      results.push({ ri, mi, playerName: chosen })
    }
  }
  return results
}
