// draw-view.js — the single source of truth for DERIVED bracket state.
//
// Established 2026-06-01 (audit parts A/B/D — the bracket data-model rewrite).
//
// Authoritative ("raw") per-match fields are: round-0 p1/p2 (the actual draw),
// `winner`, and the user's `matchPick` / `originalPick` / result flags. Everything
// else a renderer needs — who occupies each round-2+ slot, which slots hold an
// eliminated pick, and where a displaced original-pick label belongs — is DERIVED
// here, in one pure pass, and written onto the match objects (`p1`/`p2` with an
// `elim` flag, plus `elimLabels`).
//
// `buildDrawView(d)` is IDEMPOTENT: it rebuilds round-2+ slots from scratch on
// every call, so it can be re-run any time raw state changes (a pick, a confirmed
// winner, an undo, a reload) instead of mutating slots incrementally from many
// different functions. Renderers consume the result and contain ZERO derivation.
//
// This replaces three previously-duplicated mechanisms:
//   1. the winner||originalPick||matchPick reconstruction loop in data.js
//   2. the markLoserForward elimination replay in data.js / picks.js
//   3. the Case-1/Case-2 displaced-label feeder lookups in bracket.js

// Walk an eliminated player forward, flagging slots that still project them and
// clearing any dead backup-pick cascade that referenced them. Mirrors the old
// markLoserForward exactly, but lives here as derivation (not a runtime mutator).
function markLoserForward(rounds, ri, mi, loserName) {
  let r = ri, m = mi
  while (true) {
    const nri = r + 1
    if (nri >= rounds.length) break
    const nmi = Math.floor(m / 2)
    const side = m % 2 === 0 ? 'p1' : 'p2'
    const nm = rounds[nri].matches[nmi]
    if (!nm || nm.winner) break
    const slotName = nm[side]?.name
    const matchPickWasLoser = nm.matchPick === loserName
    if (slotName === loserName) nm[side] = { ...nm[side], elim: true }
    if (matchPickWasLoser) nm.matchPick = null
    if (slotName !== loserName && nm.originalPick !== loserName && !matchPickWasLoser) break
    r = nri; m = nmi
  }
}

/**
 * Derive all slot occupancy, elimination flags, and displaced-pick labels for a
 * draw, in place. Idempotent. Returns the same draw for convenience.
 * Round-0 matches are never touched (they hold the actual draw).
 */
export function buildDrawView(d) {
  if (!d || !d.rounds || !d.rounds.length) return d
  const rounds = d.rounds

  // Seed lookup — every player originates in round 0.
  const seedMap = {}
  rounds[0]?.matches.forEach(m => {
    if (m.p1?.name) seedMap[m.p1.name] = m.p1.seed
    if (m.p2?.name) seedMap[m.p2.name] = m.p2.seed
  })

  // (1) Rebuild round-2+ slot occupants from feeders.
  //     winner (actual advancer) > originalPick (post-lock projection) > matchPick (pre-lock).
  for (let ri = 1; ri < rounds.length; ri++) {
    rounds[ri].matches.forEach((m, mi) => {
      m.p1 = { name: '', seed: '' }
      m.p2 = { name: '', seed: '' }
      const prev = rounds[ri - 1]
      const feedA = prev.matches[mi * 2]
      const feedB = prev.matches[mi * 2 + 1]
      const nameA = feedA?.winner || feedA?.originalPick || feedA?.matchPick || ''
      const nameB = feedB?.winner || feedB?.originalPick || feedB?.matchPick || ''
      if (nameA) m.p1 = { name: nameA, seed: seedMap[nameA] || '' }
      if (nameB) m.p2 = { name: nameB, seed: seedMap[nameB] || '' }
    })
  }

  // (2) Replay eliminations for every confirmed winner.
  rounds.forEach((r, ri) => {
    r.matches.forEach((m, mi) => {
      if (m.winner) {
        const loserName = m.p1.name === m.winner ? m.p2.name : m.p1.name
        if (loserName) markLoserForward(rounds, ri, mi, loserName)
      }
    })
  })

  // (3) Compute displaced-original-pick labels (formerly the bracket.js hack).
  rounds.forEach((r, ri) => {
    r.matches.forEach((m, mi) => {
      m.elimLabels = []
      if (m.winner) return
      // Case 1: a slot still projects the eliminated original pick.
      if (m.p1?.elim) m.elimLabels.push({ name: m.p1.name, pos: 'top' })
      if (m.p2?.elim) m.elimLabels.push({ name: m.p2.name, pos: 'bot' })
      // Case 2: the original pick was displaced by a real winner in this slot —
      // it's in neither slot and carries no elim flag. Locate its side via feeders.
      const op = m.originalPick
      if (op && !m.p1?.elim && !m.p2?.elim && op !== m.p1?.name && op !== m.p2?.name) {
        const feederP1 = ri > 0 ? rounds[ri - 1]?.matches[mi * 2] : null
        const feederP2 = ri > 0 ? rounds[ri - 1]?.matches[mi * 2 + 1] : null
        if (feederP1?.originalPick === op) m.elimLabels.push({ name: op, pos: 'top' })
        else if (feederP2?.originalPick === op) m.elimLabels.push({ name: op, pos: 'bot' })
      }
    })
  })

  return d
}
