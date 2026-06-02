// Scoring logic — ported verbatim from reference app

export const ROUND_CONFIG = Array.from({ length: 7 }, (_, i) => ({ base: Math.round(Math.pow(1.78, i)) }))

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

export function calcStatsAsOf(d, upToRi = null) {
  const isLive = upToRi === null
  const filterRi = isLive ? Infinity : upToRi
  let filled = 0, total = 0, cOrig = 0, wOrig = 0, cBackup = 0, wBackup = 0
  let baseScore = 0, skillBonus = 0
  let cDrawOrig = 0, wDrawOrig = 0
  let maxHealthPts = 0, reachableHealthPts = 0

  const eliminated = new Set()
  if (!isLive) {
    d.rounds.forEach((r, ri) => {
      if (ri > filterRi) return
      r.matches.forEach(m => {
        if (!m.winner) return
        const loser = m.p1.name === m.winner ? m.p2.name : m.p1.name
        if (loser) eliminated.add(loser)
      })
    })
  }

  d.rounds.forEach((r, ri) => r.matches.forEach(m => {
    if (!m.p1.name && !m.p2.name) return
    total++
    if (m.matchPick) filled++

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
        }
      } else {
        // Match Accuracy for backup picks — use matchPickResult
        if (m.matchPickResult === 'correct') cBackup++
        else if (m.matchPickResult === 'wrong') wBackup++
      }
    }

    if (m.originalPick) {
      const pts = ROUND_CONFIG[ri] ? ROUND_CONFIG[ri].base : 0
      maxHealthPts += pts
      if (isLive) {
        if (m.winner) {
          if (m.winner === m.originalPick) reachableHealthPts += pts
        } else {
          const pickSlot = m.originalPick === m.p1.name ? m.p1 : m.originalPick === m.p2.name ? m.p2 : null
          if (pickSlot && !pickSlot.elim) reachableHealthPts += pts
        }
      } else {
        if (ri <= filterRi && m.winner) {
          if (m.winner === m.originalPick) reachableHealthPts += pts
        } else {
          if (!eliminated.has(m.originalPick)) reachableHealthPts += pts
        }
      }
    }
  }))

  return { filled, total, cOrig, wOrig, cDrawOrig, wDrawOrig, cBackup, wBackup, baseScore, skillBonus, maxHealthPts, reachableHealthPts }
}

export function calcStats(d) { return calcStatsAsOf(d, null) }

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
