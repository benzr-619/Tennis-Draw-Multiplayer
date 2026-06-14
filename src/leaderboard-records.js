// Records tab — trophy room layout

import { state } from './state.js'
import { SLAM_CONFIG } from './data.js'
import { formatAmerican } from './odds.js'
// Circular in ESM is fine: all are function calls, not top-level init
import { loadDrawStatsForAllUsers, openViewerOriginalPicks, formatStat } from './leaderboard.js'
import { openListModal } from './leaderboard-slams.js'

// ── MODULE STATE ──
let recPeriod     = 'all'
let recSort       = { col: 'slamIndex', dir: -1 }

let _recContainer    = null
let _recProfs        = null
let _recAllStatsMaps = null
let _recYears        = null
let _recContentEl    = null

// ── CONSTANTS ──
const AGG_KEY   = { score: 'avgScore', matchYield: 'avgMatchYield', slamIndex: 'avgSlamIndex' }
const POD_LABEL = { avgScore: 'SCORE', avgMatchYield: 'MATCH YLD', avgSlamIndex: 'INDEX' }
const ROUND_LBL = ['R1', 'R2', 'R3', 'R4', 'QF', 'SF', 'Final']

// ── DATA HELPERS ──

function buildAllTimeAgg(profs, draws, statsMaps) {
  const agg = {}
  profs.forEach(prof => {
    let totalScore = 0, drawsPlayed = 0
    let totalMY = 0, myCount = 0, totalSI = 0, siCount = 0
    let totalFlatYield = 0, totalFlatBets = 0
    statsMaps.forEach(sm => {
      const s = sm[prof.id]
      if (!s?.hasAnyPicks) return
      drawsPlayed++
      totalScore += s.score
      if (s.matchYield !== null) { totalMY += s.matchYield; myCount++ }
      if (s.slamIndex  !== null) { totalSI += s.slamIndex;  siCount++ }
      if (s.flatYieldResolved > 0) { totalFlatYield += s.flatYield; totalFlatBets += s.flatYieldResolved }
    })
    agg[prof.id] = {
      drawsPlayed,
      hasAnyPicks:    drawsPlayed > 0,
      avgScore:       drawsPlayed > 0 ? Math.round(totalScore / drawsPlayed) : null,
      totalMatchYield: myCount > 0   ? Math.round(totalMY)                  : null,
      avgMatchYield:   myCount > 0   ? Math.round(totalMY / myCount)        : null,
      avgSlamIndex:    siCount > 0   ? Math.round(totalSI / siCount)        : null,
      flatROI:         totalFlatBets > 0 ? totalFlatYield / totalFlatBets   : null,
      totalFlatBets,
    }
  })
  return agg
}

function buildAllBrackets(profs, draws, statsMaps) {
  const out = []
  draws.forEach((draw, i) => {
    const sm = statsMaps[i]
    profs.forEach(prof => {
      const s = sm[prof.id]
      if (!s?.hasAnyPicks) return
      out.push({ prof, draw, score: s.score, matchYield: s.matchYield, slamIndex: s.slamIndex })
    })
  })
  return out
}

function buildPoolBestUpset(profs, draws, statsMaps) {
  let best = null
  draws.forEach((draw, i) => {
    statsMaps[i] && profs.forEach(prof => {
      const s = statsMaps[i][prof.id]
      if (!s?.bestUpset) return
      if (!best || s.bestUpset.yld > best.yld) best = { ...s.bestUpset, prof, draw }
    })
  })
  return best  // { yld, ri, pickedName, opponent, decimalOdds, prof, draw } | null
}

// ── RE-RENDER HELPERS ──

function _rerenderContent() {
  if (_recContentEl) renderPeriodContent(_recContentEl)
}

function _rerenderAll() {
  if (!_recContainer) return
  _recContainer.innerHTML = ''
  _recContainer.appendChild(buildPeriodPicker())
  _recContentEl = document.createElement('div')
  _recContainer.appendChild(_recContentEl)
  renderPeriodContent(_recContentEl)
}

// ── MAIN ENTRY ──

export async function renderRecordsTab(container, profs) {
  if (state.draws.length === 0) {
    container.innerHTML = '<div class="lb-empty">No draws uploaded yet.</div>'
    return
  }
  _recContainer    = container
  _recProfs        = profs
  _recAllStatsMaps = await Promise.all(state.draws.map(d => loadDrawStatsForAllUsers(d)))
  _recYears        = [...new Set(state.draws.map(d => d.year))].sort((a, b) => b - a)
  if (recPeriod !== 'all' && !_recYears.includes(recPeriod)) recPeriod = 'all'
  _rerenderAll()
}

function renderPeriodContent(content) {
  // Capture old podium name positions before clearing (for FLIP)
  const oldRects = {}
  content.querySelectorAll('.rec-pod-name[data-id]').forEach(el => {
    oldRects[el.dataset.id] = el.getBoundingClientRect()
  })

  content.innerHTML = ''

  const periodDraws = recPeriod === 'all'
    ? state.draws
    : state.draws.filter(d => d.year === recPeriod)
  const periodMaps = periodDraws.map(d => _recAllStatsMaps[state.draws.indexOf(d)])
  const agg        = buildAllTimeAgg(_recProfs, periodDraws, periodMaps)
  const brackets   = buildAllBrackets(_recProfs, periodDraws, periodMaps)
  const bestUpset  = buildPoolBestUpset(_recProfs, periodDraws, periodMaps)
  const aggKey     = AGG_KEY[recSort.col] ?? 'avgSlamIndex'

  const eligible = _recProfs.filter(p => agg[p.id]?.hasAnyPicks && agg[p.id]?.[aggKey] !== null)
  if (eligible.length >= 3) content.appendChild(buildPodium(eligible, agg, aggKey))
  content.appendChild(buildStandingsTable(_recProfs, agg))
  content.appendChild(buildHonorsRow(_recProfs, brackets, agg, bestUpset))

  // FLIP: animate podium names from old positions to new
  if (Object.keys(oldRects).length) {
    requestAnimationFrame(() => {
      content.querySelectorAll('.rec-pod-name[data-id]').forEach(el => {
        const old = oldRects[el.dataset.id]
        if (!old) return
        const n = el.getBoundingClientRect()
        const dx = old.left - n.left, dy = old.top - n.top
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
        el.style.transition = 'none'
        el.style.transform  = `translate(${dx}px,${dy}px)`
        void el.offsetWidth
        el.style.transition = 'transform 0.22s ease'
        el.style.transform  = ''
      })
    })
  }
}

// ── PERIOD PICKER ──

function buildPeriodPicker() {
  const row = document.createElement('div')
  row.className = 'rec-period-row'
  ;['all', ..._recYears].forEach(p => {
    const btn = document.createElement('button')
    btn.className = 'rec-period-pill' + (recPeriod === p ? ' active' : '')
    btn.textContent = p === 'all' ? 'ALL TIME' : String(p)
    btn.addEventListener('click', () => {
      if (recPeriod === p) return
      recPeriod = p
      _rerenderAll()
    })
    row.appendChild(btn)
  })
  return row
}

// ── PODIUM ──

function buildPodium(eligible, agg, aggKey) {
  const top3 = [...eligible]
    .sort((a, b) => (agg[b.id]?.[aggKey] ?? -Infinity) - (agg[a.id]?.[aggKey] ?? -Infinity))
    .slice(0, 3)

  const wrap = document.createElement('div')
  wrap.className = 'rec-podium'

  // Visual order: rank2 left, rank1 center, rank3 right
  [[top3[1], 2], [top3[0], 1], [top3[2], 3]].forEach(([prof, rank]) => {
    const s = agg[prof.id]
    const block = document.createElement('div')
    block.className = 'rec-pod-block' + (rank === 1 ? ' rec-pod-top' : '')

    const nameEl = document.createElement('div')
    nameEl.className = 'rec-pod-name' + (prof.id === state.currentUser?.id ? ' rec-pod-you' : '')
    nameEl.dataset.id = prof.id
    nameEl.textContent = prof.display_name

    const sub = document.createElement('div')
    sub.className = 'rec-pod-stat'
    const lbl = POD_LABEL[aggKey] ?? 'INDEX'
    sub.textContent = `${lbl} ${formatStat(recSort.col, s[aggKey])} · ${s.drawsPlayed} DRAW${s.drawsPlayed !== 1 ? 'S' : ''}`

    const rankEl = document.createElement('div')
    rankEl.className = 'rec-pod-rank' + (rank === 1 ? ' rec-pod-rank-1' : '')
    rankEl.textContent = '#' + rank

    block.appendChild(nameEl)
    block.appendChild(sub)
    block.appendChild(rankEl)
    wrap.appendChild(block)
  })

  return wrap
}

// ── STANDINGS TABLE ──

function buildStandingsTable(profs, agg) {
  const wrap = document.createElement('div')
  wrap.className = 'rec-standings-wrap'
  const table = document.createElement('div')
  table.className = 'lb-table rec-standings-table'
  wrap.appendChild(table)

  const COLS = [
    { key: 'score',      aggKey: 'avgScore',      label: 'Draw Yld' },
    { key: 'matchYield', aggKey: 'avgMatchYield',  label: 'Match Yld' },
    { key: 'slamIndex',  aggKey: 'avgSlamIndex',   label: 'Index' },
  ]

  const sortedProfs = [...profs]
    .filter(p => agg[p.id]?.hasAnyPicks)
    .sort((a, b) => {
      const ak = AGG_KEY[recSort.col] ?? 'avgSlamIndex'
      const va = agg[a.id]?.[ak] ?? -Infinity
      const vb = agg[b.id]?.[ak] ?? -Infinity
      return va === vb ? 0 : (va < vb ? -1 : 1) * recSort.dir * -1
    })

  // Header
  const hdr = document.createElement('div')
  hdr.className = 'lb-row lb-row-standings lb-header-row'
  const mkHdrCell = (cls, text) => {
    const c = document.createElement('div'); c.className = cls; c.textContent = text; return c
  }
  hdr.appendChild(mkHdrCell('lb-cell lb-cell-srank', ''))
  hdr.appendChild(mkHdrCell('lb-cell lb-cell-name', 'Player'))
  hdr.appendChild(mkHdrCell('lb-cell lb-cell-draws', 'Draws'))
  COLS.forEach(col => {
    const cell = document.createElement('div')
    cell.className = 'lb-cell lb-cell-' + col.key + ' lb-sortable' + (recSort.col === col.key ? ' lb-sort-active' : '')
    cell.textContent = col.label
    const arrow = document.createElement('span')
    arrow.className = 'lb-sort-arrow'
    arrow.textContent = recSort.col === col.key ? (recSort.dir === -1 ? ' ↓' : ' ↑') : ' ↕'
    cell.appendChild(arrow)
    cell.addEventListener('click', () => {
      recSort.col === col.key ? (recSort.dir *= -1) : (recSort.col = col.key, recSort.dir = -1)
      _rerenderContent()
    })
    hdr.appendChild(cell)
  })
  table.appendChild(hdr)

  // Rows
  sortedProfs.forEach((prof, rank) => {
    const s   = agg[prof.id] || {}
    const isSelf = prof.id === state.currentUser?.id
    const row = document.createElement('div')
    row.className = 'lb-row lb-row-standings' + (rank % 2 === 1 ? ' lb-row-alt' : '') + (isSelf ? ' lb-row-self' : '')

    const rnk = document.createElement('div')
    rnk.className = 'lb-cell lb-cell-srank lb-rank'
    rnk.textContent = rank + 1
    row.appendChild(rnk)

    const nameCell = document.createElement('div')
    nameCell.className = 'lb-cell lb-cell-name'
    const nameSpan = document.createElement('span')
    nameSpan.className = 'lb-rec-name'
    nameSpan.textContent = prof.display_name
    nameCell.appendChild(nameSpan)
    if (isSelf) {
      const badge = document.createElement('span')
      badge.className = 'rec-you-badge'
      badge.textContent = 'YOU'
      nameCell.appendChild(badge)
    }
    row.appendChild(nameCell)

    const drw = document.createElement('div')
    drw.className = 'lb-cell lb-cell-draws'
    drw.textContent = s.drawsPlayed ?? '—'
    row.appendChild(drw)

    COLS.forEach(col => {
      const cell = document.createElement('div')
      cell.className = 'lb-cell lb-cell-' + col.key + (recSort.col === col.key ? ' lb-cell-active-col' : '')
      cell.textContent = formatStat(col.key, s[col.aggKey])
      row.appendChild(cell)
    })

    table.appendChild(row)
  })

  return wrap
}

// ── HONORS ROW ──

function buildHonorsRow(profs, brackets, agg, bestUpset) {
  const row = document.createElement('div')
  row.className = 'rec-honors-row'
  row.appendChild(buildBestDrawChip(profs, brackets))
  row.appendChild(buildSharpestBettorChip(profs, agg))
  row.appendChild(buildBiggestUpsetChip(bestUpset))
  return row
}

// ── HONOR CHIP: BEST SINGLE DRAW ──

function buildBestDrawChip(profs, brackets) {
  const sorted = [...brackets].sort((a, b) => b.score - a.score)
  const best   = sorted[0]
  const chip   = document.createElement('div')
  chip.className = 'lb-rec-card rec-honor-chip'
  const hdr = document.createElement('div'); hdr.className = 'lb-rec-card-header'
  const title = document.createElement('span'); title.className = 'lb-rec-card-title'
  title.textContent = 'BEST SINGLE DRAW'; hdr.appendChild(title); chip.appendChild(hdr)
  if (!best) { chip.appendChild(mkEmpty()); return chip }
  const cfg = SLAM_CONFIG[best.draw.slam] || {}
  const body = document.createElement('div')
  body.className = 'rec-honor-body rec-honor-clickable'
  body.addEventListener('click', () => openListModal('Best Single Draw', sorted.map(e => {
    const ec = SLAM_CONFIG[e.draw.slam] || {}
    return { name: e.prof.display_name, sub: (ec.name || e.draw.slam) + ' ' + e.draw.year + ' ' + e.draw.draw, val: String(e.score) }
  })))
  const main = document.createElement('div'); main.className = 'rec-honor-main'
  main.textContent = `${best.prof.display_name} · ${cfg.name || best.draw.slam} ${best.draw.year} ${best.draw.draw} · ${best.score}`
  body.appendChild(main); chip.appendChild(body)
  return chip
}

// ── HONOR CHIP: SHARPEST BETTOR ──
// Flat-stake ROI: each resolved matchPick with locked odds = $1 bet.
// Win: +(oddsDecimal − 1). Loss: −1. Average over all bets = ROI per unit.
// Normalises out round stakes so early-round and final-round bets count equally.

function buildSharpestBettorChip(profs, agg) {
  const chip = document.createElement('div')
  chip.className = 'lb-rec-card rec-honor-chip'
  const hdr = document.createElement('div'); hdr.className = 'lb-rec-card-header'
  const title = document.createElement('span'); title.className = 'lb-rec-card-title'; title.textContent = 'SHARPEST BETTOR'
  const sub = document.createElement('span'); sub.className = 'lb-rec-card-title'
  sub.style.cssText = 'font-size:9px;opacity:0.7'; sub.textContent = 'FLAT-STAKE ROI'
  hdr.append(title, sub); chip.appendChild(hdr)

  const sorted = [...profs]
    .filter(p => agg[p.id]?.hasAnyPicks && agg[p.id]?.flatROI !== null)
    .sort((a, b) => (agg[b.id]?.flatROI ?? -Infinity) - (agg[a.id]?.flatROI ?? -Infinity))

  if (sorted.length === 0) { chip.appendChild(mkEmpty()); return chip }

  const best = sorted[0], bs = agg[best.id], bPct = Math.round(bs.flatROI * 100)
  const body = document.createElement('div')
  body.className = 'rec-honor-body rec-honor-clickable'
  body.addEventListener('click', () => openListModal('Sharpest Bettor', sorted.map(p => {
    const s = agg[p.id], pct = Math.round(s.flatROI * 100), pos = pct >= 0
    return { name: p.display_name, sub: s.totalFlatBets + (s.totalFlatBets === 1 ? ' bet' : ' bets'), val: (pos ? '+' : '−') + Math.abs(pct) + '%', valClass: pos ? 'lb-modal-val-pos' : '' }
  })))
  const main = document.createElement('div'); main.className = 'rec-honor-main'
  main.textContent = `${best.display_name} · ${bPct >= 0 ? '+' : '−'}${Math.abs(bPct)}% · ${bs.totalFlatBets} bet${bs.totalFlatBets !== 1 ? 's' : ''}`
  body.appendChild(main); chip.appendChild(body)
  return chip
}

// ── HONOR CHIP: BIGGEST UPSET CALL ──

function buildBiggestUpsetChip(bestUpset) {
  const chip = document.createElement('div')
  chip.className = 'lb-rec-card rec-honor-chip'

  const hdr = document.createElement('div')
  hdr.className = 'lb-rec-card-header'
  const title = document.createElement('span')
  title.className = 'lb-rec-card-title'
  title.textContent = 'BIGGEST UPSET CALL'
  hdr.appendChild(title)
  chip.appendChild(hdr)

  if (!bestUpset) { chip.appendChild(mkEmpty()); return chip }

  const body = document.createElement('div')
  body.className = 'rec-honor-body rec-honor-clickable'
  body.addEventListener('click', () => {
    const cfg = SLAM_CONFIG[bestUpset.draw.slam] || {}
    openListModal('Biggest Upset Call', [{
      name: bestUpset.prof.display_name,
      sub: `Beat ${bestUpset.opponent} · ${cfg.name || bestUpset.draw.slam} ${bestUpset.draw.year} · ${ROUND_LBL[bestUpset.ri] || 'R' + (bestUpset.ri + 1)}`,
      val: `+${bestUpset.yld}`,
      valClass: 'lb-modal-val-pos',
    }])
  })

  const main = document.createElement('div')
  main.className = 'rec-honor-main'
  main.textContent = `${bestUpset.prof.display_name} · ${bestUpset.pickedName} ${formatAmerican(bestUpset.decimalOdds)}`
  body.appendChild(main)

  chip.appendChild(body)
  return chip
}

// ── UTILS ──

function mkEmpty() {
  const el = document.createElement('div')
  el.className = 'rec-honor-empty'
  el.textContent = '—'
  return el
}
