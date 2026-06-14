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

/**
 * Derive all slot occupancy, elimination flags, and displaced-pick labels for a
 * draw, in place. Idempotent. Returns the same draw for convenience.
 * Round-0 matches are never touched (they hold the actual draw).
 */
// opts.projectFromPick (VIEWER ONLY): fill round-2+ slots from the user's
// originalPick/matchPick FIRST (ignore the actual winner) so the friend's
// projected bracket shows through, and build the eliminated-players set from the
// REAL results carried on each match's `actualP1`/`actualP2` (attached by
// assembleDrawForUserOriginalPicks) rather than off the slots. Default mode is
// unchanged: winner-first slots, eliminations read off the slots.
export function buildDrawView(d, opts = {}) {
  if (!d || !d.rounds || !d.rounds.length) return d
  const projectFromPick = opts.projectFromPick === true
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
      const nameA = projectFromPick
        ? (feedA?.originalPick || feedA?.matchPick || feedA?.winner || '')
        : (feedA?.winner || feedA?.originalPick || feedA?.matchPick || '')
      const nameB = projectFromPick
        ? (feedB?.originalPick || feedB?.matchPick || feedB?.winner || '')
        : (feedB?.winner || feedB?.originalPick || feedB?.matchPick || '')
      if (nameA) m.p1 = { name: nameA, seed: seedMap[nameA] || '' }
      if (nameB) m.p2 = { name: nameB, seed: seedMap[nameB] || '' }
    })
  }

  // (2) A player is eliminated if they lost ANY confirmed match. Build that set
  //     once from the actual participants of every decided match (a decided
  //     match's slots hold the real players, since winners take slot priority
  //     in step 1).
  const eliminated = new Set()
  rounds.forEach(r => {
    r.matches.forEach(m => {
      if (m.winner) {
        // In projectFromPick mode the slots hold PICKS, not real players, so read
        // the actual participants off actualP1/actualP2 to find the real loser.
        const realA = projectFromPick ? (m.actualP1?.name || '') : m.p1.name
        const realB = projectFromPick ? (m.actualP2?.name || '') : m.p2.name
        const loserName = realA === m.winner ? realB : realA
        if (loserName) eliminated.add(loserName)
      }
    })
  })

  // (3) Flag every still-undecided slot that projects an eliminated player, and
  //     clear any dead backup-pick cascade that referenced one. This replaces the
  //     old single-path markLoserForward walk, which stopped at the first match
  //     already holding a confirmed winner — and so failed to cross out a pick
  //     that re-emerged (via originalPick) in slots BEYOND that match.
  rounds.forEach(r => {
    r.matches.forEach(m => {
      if (m.winner) return
      if (m.matchPick && eliminated.has(m.matchPick)) m.matchPick = null
      if (m.p1?.name && eliminated.has(m.p1.name)) m.p1 = { ...m.p1, elim: true }
      if (m.p2?.name && eliminated.has(m.p2.name)) m.p2 = { ...m.p2, elim: true }
    })
  })

  // (4) Compute displaced-original-pick labels (formerly the bracket.js hack).
  rounds.forEach((r, ri) => {
    r.matches.forEach((m, mi) => {
      m.elimLabels = []
      // Viewer floats the actual occupant (mc-actual), not the displaced pick, so
      // it never consumes elimLabels — skip the whole pass in projectFromPick mode.
      if (projectFromPick) return
      // For each slot, check the feeder match's originalPick against whoever
      // actually occupies the slot. If they differ, the pick was displaced — float
      // it outside in red+crossed. Both slots are checked independently so a match
      // can show displaced picks from both halves (e.g. the Final shows the top-half
      // pick above AND the bottom-half pick below if both were eliminated before the Final).
      if (ri > 0) {
        const feeder1 = rounds[ri - 1].matches[mi * 2]
        const feeder2 = rounds[ri - 1].matches[mi * 2 + 1]
        const op1 = feeder1?.originalPick
        const op2 = feeder2?.originalPick
        if (op1 && op1 !== m.p1?.name) m.elimLabels.push({ name: op1, pos: 'top' })
        if (op2 && op2 !== m.p2?.name) m.elimLabels.push({ name: op2, pos: 'bot' })
      }
    })
  })

  return d
}
