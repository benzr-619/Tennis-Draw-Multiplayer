// Slams tab — Combined M/W card (click-to-reveal). Split out of
// leaderboard-slams.js 2026-07-18 (redesign) to keep that file under the
// project's line-count ceiling — see
// .claude/rules/leaderboard-records-redesign.md "File-size ceiling".
//
// Only for slams with both MS and WS draws. Sums Draw Yield/Match Yield across
// both draws for players pool-eligible in BOTH, then recomputes Slam Index via
// calcSlamIndex fed the combined totals (not a re-average of the two per-draw
// indices). Slams-tab-only — never surfaced on the Records tab.

import { state } from './state.js'
import { calcSlamIndex, chalkBaselinesForVersion, combineChalkBaselines } from './scoring.js'
import { formatStat, assembleDrawForUser } from './leaderboard.js'

const COLS = [
  { key: 'score',      label: 'Draw Yld' },
  { key: 'matchYield', label: 'Match Yld' },
  { key: 'slamIndex',  label: 'Index' },
]

// `_combinedExpanded` is owned by the caller (leaderboard-slams.js's module
// state) and passed in — this module has no state of its own.
export function buildCombinedSection(section, group, allMaps, profs, color, isOpen, onToggle) {
  const btn = document.createElement('button')
  btn.className = 'lb-combined-toggle'
  btn.textContent = isOpen ? 'HIDE COMBINED M/W ↑' : 'SHOW COMBINED M/W →'
  btn.addEventListener('click', onToggle)
  section.appendChild(btn)
  if (isOpen) section.appendChild(buildCombinedCard(group, allMaps, profs, color))
}

function buildCombinedCard(group, allMaps, profs, color) {
  const [d1, d2] = group.draws
  const m1 = allMaps.get(d1.db_id) || {}, m2 = allMaps.get(d2.db_id) || {}

  const eligible = profs.filter(p => {
    const s1 = m1[p.id], s2 = m2[p.id]
    return s1?.hasAnyPicks && s1?.poolEligible && s2?.hasAnyPicks && s2?.poolEligible
  })

  const card = document.createElement('div')
  card.className = 'lb-draw-card'; card.style.setProperty('--lb-slam-color', color)
  const cardHdr = document.createElement('div')
  cardHdr.className = 'lb-draw-card-header'
  cardHdr.innerHTML = `<span class="lb-draw-label">Combined M/W</span>`
  card.appendChild(cardHdr)

  if (!eligible.length) {
    const empty = document.createElement('div'); empty.className = 'lb-prelock-msg'
    empty.textContent = 'No players are pool-eligible in both draws yet'
    card.appendChild(empty); return card
  }

  const totals = eligible.map(p => ({
    prof: p,
    score: (m1[p.id].score ?? 0) + (m2[p.id].score ?? 0),
    matchYield: (m1[p.id].matchYield ?? 0) + (m2[p.id].matchYield ?? 0),
  }))
  // Both draws must be on a chalk-referenced version (v2 or v4, mixed is fine —
  // the formula shape is identical) to trust a combined chalk baseline; a mixed
  // v1/v2 pairing genuinely falls back to the pool-relative index (see
  // calcSlamIndex) — that's a real version mismatch, not the invalid-chalk case.
  // An invalid chalk baseline with BOTH draws on v2/v4, though, is "no number
  // yet" (e.g. a fresh draw with no decided matches) — it must not silently
  // substitute v1 either. See .claude/rules/slam-index.md "Fallback policy
  // reversal".
  const v1c = d1.slam_index_version ?? 1, v2c = d2.slam_index_version ?? 1
  const bothChalkOk = (v1c === 2 || v1c === 4) && (v2c === 2 || v2c === 4)
  const siVersion = bothChalkOk ? Math.max(v1c, v2c) : 1
  const chalk = bothChalkOk
    ? combineChalkBaselines(chalkBaselinesForVersion(assembleDrawForUser(d1, []), v1c), chalkBaselinesForVersion(assembleDrawForUser(d2, []), v2c))
    : null
  const indexes = bothChalkOk && !chalk?.valid
    ? totals.map(() => null)
    : calcSlamIndex(totals.map(t => ({ score: t.score, matchYield: t.matchYield })), { version: siVersion, chalk })
  const rows = totals.map((t, i) => ({ ...t, slamIndex: indexes[i] }))
    .sort((a, b) => (b.slamIndex ?? -Infinity) - (a.slamIndex ?? -Infinity))

  const table = document.createElement('div'); table.className = 'lb-table lb-combined-table'
  const hdr = document.createElement('div'); hdr.className = 'lb-row lb-row-card lb-header-row'
  hdr.innerHTML = `<div class="lb-cell lb-cell-name">Player</div>` +
    COLS.map(c => `<div class="lb-cell lb-cell-${c.key}">${c.label}</div>`).join('')
  table.appendChild(hdr)

  rows.forEach((row, rank) => {
    const isSelf = row.prof.id === state?.currentUser?.id
    const tr = document.createElement('div')
    tr.className = `lb-row lb-row-card${rank % 2 ? ' lb-row-alt' : ''}${isSelf ? ' lb-row-self' : ''}`
    const nameCell = document.createElement('div'); nameCell.className = 'lb-cell lb-cell-name'
    const rnkEl = document.createElement('span'); rnkEl.className = 'lb-rank'; rnkEl.textContent = '#' + (rank + 1)
    const nameEl = document.createElement('span'); nameEl.className = 'lb-player-name'; nameEl.textContent = row.prof.display_name
    nameCell.append(rnkEl, nameEl)
    if (isSelf) { const b = document.createElement('span'); b.className = 'rec-you-badge'; b.textContent = 'YOU'; nameCell.appendChild(b) }
    tr.appendChild(nameCell)
    const scoreCell = document.createElement('div'); scoreCell.className = 'lb-cell lb-cell-score'; scoreCell.textContent = formatStat('score', row.score)
    const myCell = document.createElement('div'); myCell.className = 'lb-cell lb-cell-matchYield'; myCell.textContent = formatStat('matchYield', row.matchYield)
    const idxCell = document.createElement('div'); idxCell.className = 'lb-cell lb-cell-slamIndex lb-cell-active-col'; idxCell.textContent = formatStat('slamIndex', row.slamIndex)
    tr.append(scoreCell, myCell, idxCell)
    table.appendChild(tr)
  })
  card.appendChild(table)
  return card
}
