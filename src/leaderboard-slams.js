// Slams tab — live slam board redesign

import { state } from './state.js'
import { SLAM_CONFIG, SLAM_COLORS, slamKey } from './data.js'
import { calcStatsAsOf, calcSlamIndex, healthHue } from './scoring.js'
import { supabase } from './supabase.js'
import { formatAmerican } from './odds.js'
import {
  loadAllPicksForDraw, assembleDrawForUser, loadDrawStatsForAllUsers,
  openViewerOriginalPicks, formatStat, setLbDetail, renderLeaderboard, fetchAllRows,
} from './leaderboard.js'

const STATUS_NAMES = ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Quarterfinals', 'Semifinals', 'Final']
const ROUND_LBL    = ['R1', 'R2', 'R3', 'R4', 'QF', 'SF', 'F']
const COLS = [
  { key: 'drawHealth', label: 'Health', noValue: true },
  { key: 'score',      label: 'Draw Yld' },
  { key: 'matchYield', label: 'Match Yld' },
  { key: 'slamIndex',  label: 'Index' },
]

// ── MODULE STATE ──
let slamSort      = { col: 'slamIndex', dir: -1 }
let _expandedKeys = new Set()
let _picksCache   = new Map()

export function resetSlamSort() {
  slamSort = { col: 'slamIndex', dir: -1 }; _expandedKeys = new Set(); _picksCache = new Map()
}

// ── GENERIC LIST MODAL ──

function _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

export function openListModal(title, rows) {
  const overlay = document.createElement('div')
  overlay.className = 'lb-modal-overlay open'
  overlay.innerHTML = `<div class="lb-modal">
    <div class="lb-modal-hdr">
      <span class="lb-modal-title">${_esc(title)}</span>
      <button class="lb-modal-close">✕</button>
    </div>
    <div class="lb-modal-list">${rows.map((row, i) => `
      <div class="lb-modal-row">
        <div class="lb-modal-rank">${i + 1}</div>
        <div><div class="lb-modal-name">${_esc(row.name)}</div>${row.sub ? `<div class="lb-modal-sub">${_esc(row.sub)}</div>` : ''}</div>
        <div class="lb-modal-val${row.valClass ? ' ' + row.valClass : ''}"${row.valStyle ? ` style="${row.valStyle}"` : ''}>${_esc(row.val)}</div>
      </div>`).join('')}
    </div>
  </div>`
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.querySelector('.lb-modal-close').addEventListener('click', close)
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc) }
  })
}

// ── MAIN ENTRY ──

export async function renderSlamsTab(container, profs) {
  const visibleDraws = state.draws.filter(d => !d.excludeFromLeaderboard)
  if (visibleDraws.length === 0) {
    container.innerHTML = '<div class="lb-empty">No draws uploaded yet.</div>'; return
  }
  const groups = new Map()
  visibleDraws.forEach(d => {
    const k = slamKey(d)
    if (!groups.has(k)) groups.set(k, { slam: d.slam, year: d.year, draws: [], key: k })
    groups.get(k).draws.push(d)
  })
  const SLAM_ORDER = ['USO', 'WIM', 'RG', 'AO']
  const sorted = [...groups.values()].sort((a, b) =>
    b.year !== a.year ? b.year - a.year : SLAM_ORDER.indexOf(a.slam) - SLAM_ORDER.indexOf(b.slam))

  const allDraws = sorted.flatMap(g => g.draws)
  const allResults = await Promise.all(allDraws.map(d => loadDrawStatsForAllUsers(d)))
  const allMaps = new Map()
  allDraws.forEach((d, i) => allMaps.set(d.db_id, allResults[i]))

  const active = sorted.find(g => g.draws.some(d => d.is_active))
  const past   = sorted.filter(g => g !== active)

  if (active) await _renderFull(container, active, allMaps, profs, true)

  if (past.length > 0) {
    const lbl = document.createElement('div')
    lbl.className = 'lb-past-section-label'; lbl.textContent = 'PAST SLAMS'
    container.appendChild(lbl)
    for (const g of past) {
      const wrap = document.createElement('div')
      container.appendChild(wrap); await _renderPastCompact(wrap, g, allMaps, profs)
    }
  }
}

// ── FULL SLAM SECTION ──

async function _renderFull(el, group, allMaps, profs, isActive) {
  const color   = SLAM_COLORS[group.slam] || 'var(--border)'
  const cfg     = SLAM_CONFIG[group.slam] || {}
  const section = document.createElement('div')
  section.className = 'lb-slam-section'
  section.style.setProperty('--lb-slam-color', color)

  const hdr = document.createElement('div'); hdr.className = 'lb-slam-header'
  const nameEl = document.createElement('span'); nameEl.className = 'lb-slam-name'; nameEl.textContent = cfg.name || group.slam
  const yearEl = document.createElement('span'); yearEl.className = 'lb-slam-year'; yearEl.textContent = group.year
  const pill   = document.createElement('span'); pill.className = 'lb-status-pill'; pill.textContent = _pillText(group.draws, isActive)
  hdr.append(nameEl, yearEl, pill); section.appendChild(hdr)

  const mwRow = document.createElement('div'); mwRow.className = 'lb-mw-row'
  let baseline = null
  if (isActive && slamSort.col === 'slamIndex') {
    const R = _deepestR(group.draws)
    if (R > 0) baseline = await _loadBaseline(group, profs, R)
  }
  _buildCards(mwRow, group, allMaps, profs, color, baseline, isActive)
  section.appendChild(mwRow)
  _buildChipsRow(section, group, allMaps, profs)
  el.appendChild(section)
}

function _deepestR(draws) {
  let R = -1
  draws.forEach(d => d.rounds.forEach((r, ri) => r.matches.forEach(m => { if (m.winner) R = Math.max(R, ri) })))
  return R
}
function _pillText(draws, isActive) {
  if (!isActive) return 'FINAL'
  const R = _deepestR(draws)
  return R < 0 ? 'LIVE' : 'LIVE · ' + (STATUS_NAMES[R] || 'Round ' + (R + 1)).toUpperCase()
}

async function _loadBaseline(group, profs, R) {
  const result = {}
  for (const d of group.draws) {
    if (!_picksCache.has(d.db_id)) {
      const rows = await fetchAllRows(
        supabase.from('picks')
          .select('user_id,match_id,match_pick,original_pick,original_pick_result,match_pick_result,high_confidence,edited_after_lock')
          .eq('draw_id', d.db_id)
      )
      _picksCache.set(d.db_id, rows)
    }
    const byUser = {}
    _picksCache.get(d.db_id).forEach(p => { if (!byUser[p.user_id]) byUser[p.user_id] = []; byUser[p.user_id].push(p) })
    const ents = profs.map(p => {
      const s = calcStatsAsOf(assembleDrawForUser(d, byUser[p.id] || []), R - 1)
      return { id: p.id, score: s.baseScore + s.skillBonus, my: s.matchYieldResolved > 0 ? s.matchYield : 0, has: s.filled > 0 }
    }).filter(e => e.has)
    const idxs = calcSlamIndex(ents.map(e => ({ score: e.score, matchYield: e.my })))
    ;[...ents].map((e, i) => ({ ...e, si: idxs[i] }))
      .sort((a, b) => (b.si ?? -Infinity) - (a.si ?? -Infinity))
      .forEach((e, i) => { result[d.db_id + ':' + e.id] = i + 1 })
  }
  return result
}

// ── SLAM CARDS ──

function _buildCards(mwRow, group, allMaps, profs, color, baseline, isActive) {
  const cards = []
  for (const draw of group.draws) {
    const { card, table, sortHdrs } = _buildCard(draw, profs, allMaps.get(draw.db_id), color, baseline, isActive)
    mwRow.appendChild(card); cards.push({ table, sortHdrs, draw })
  }
  cards.forEach(({ sortHdrs }) => sortHdrs.forEach(({ col, cell: hc }) => {
    hc.addEventListener('click', () => {
      slamSort.col === col ? (slamSort.dir *= -1) : (slamSort.col = col, slamSort.dir = -1)
      cards.forEach(({ table, sortHdrs: sh }) => {
        const rects = {}
        table.querySelectorAll('[data-uid]').forEach(r => { rects[r.dataset.uid] = r.getBoundingClientRect() })
        const rows = [...table.querySelectorAll('[data-uid]')]
        rows.sort((a, b) => {
          const va = parseFloat(a.dataset[col]) ?? -Infinity, vb = parseFloat(b.dataset[col]) ?? -Infinity
          if (va !== vb) return (va < vb ? -1 : 1) * slamSort.dir * -1
          return parseFloat(b.dataset.drawHealth ?? -1) - parseFloat(a.dataset.drawHealth ?? -1)
        })
        rows.forEach(r => table.appendChild(r))
        requestAnimationFrame(() => rows.forEach(r => {
          const old = rects[r.dataset.uid]; if (!old) return
          const dy = old.top - r.getBoundingClientRect().top; if (Math.abs(dy) < 1) return
          r.style.transition = 'none'; r.style.transform = `translateY(${dy}px)`
          void r.offsetWidth; r.style.transition = 'transform 0.22s ease'; r.style.transform = ''
        }))
        sh.forEach(h => {
          const on = h.col === slamSort.col
          h.cell.classList.toggle('lb-sort-active', on); h.cell.style.color = on ? color : ''
          const arr = h.cell.querySelector('.lb-sort-arrow')
          if (arr) arr.textContent = on ? (slamSort.dir === -1 ? ' ↓' : ' ↑') : ' ↕'
        })
        table.querySelectorAll('[data-col]').forEach(c => {
          c.classList.toggle('lb-cell-active-col', c.dataset.col === slamSort.col)
        })
      })
    })
  }))
}

function _buildCard(draw, profs, statsMap, color, baseline, isActive) {
  const card = document.createElement('div')
  card.className = 'lb-draw-card'; card.style.setProperty('--lb-slam-color', color)

  const cardHdr = document.createElement('div')
  const drawLabel = `<span class="lb-draw-label">${draw.draw === 'MS' ? "Men's Singles" : "Women's Singles"}</span>`
  if (draw.locked) {
    cardHdr.className = 'lb-draw-card-header lb-draw-card-clickable'
    cardHdr.innerHTML = drawLabel + `<span class="lb-draw-expand">All stats →</span>`
    cardHdr.addEventListener('click', e => { e.stopPropagation(); setLbDetail(draw); renderLeaderboard() })
  } else {
    cardHdr.className = 'lb-draw-card-header'
    cardHdr.innerHTML = drawLabel
  }
  card.appendChild(cardHdr)

  if (isActive && statsMap) {
    const eligible = profs.filter(p => statsMap[p.id]?.hasAnyPicks && statsMap[p.id]?.slamIndex !== null)
    if (eligible.length >= 3) card.appendChild(_buildSlamPodium(draw, statsMap, profs))
  }

  const sortedProfs = [...profs].filter(p => statsMap[p.id]?.hasAnyPicks)
    .sort((a, b) => {
      const va = statsMap[a.id]?.[slamSort.col] ?? -Infinity
      const vb = statsMap[b.id]?.[slamSort.col] ?? -Infinity
      if (va !== vb) return vb - va
      return (statsMap[b.id]?.drawHealth ?? -1) - (statsMap[a.id]?.drawHealth ?? -1)
    })

  const table = document.createElement('div'); table.className = 'lb-table'

  // Header row — build then grab cell refs for sort wiring
  const hdrCls = k => `lb-cell lb-cell-${k} lb-sortable${slamSort.col === k ? ' lb-sort-active' : ''}`
  const hdrStyle = k => slamSort.col === k ? ` style="color:${color}"` : ''
  const arrText  = k => slamSort.col === k ? (slamSort.dir === -1 ? ' ↓' : ' ↑') : ' ↕'
  const hdr = document.createElement('div'); hdr.className = 'lb-row lb-row-card lb-header-row'
  hdr.innerHTML = `<div class="lb-cell lb-cell-name">Player</div>` +
    COLS.map(c => `<div class="${hdrCls(c.key)}"${hdrStyle(c.key)}>${c.label}<span class="lb-sort-arrow">${arrText(c.key)}</span></div>`).join('')
  table.appendChild(hdr)
  const sortHdrs = COLS.map((c, i) => ({ col: c.key, cell: hdr.children[i + 1] }))

  if (!draw.locked) {
    const msg = document.createElement('div')
    msg.className = 'lb-prelock-msg'
    msg.textContent = 'Leaderboard unlocks after the picks deadline'
    table.appendChild(msg)
  } else {
    sortedProfs.forEach((prof, rank) => {
      const s = statsMap[prof.id] || {}
      const isSelf = prof.id === state?.currentUser?.id
      const row = document.createElement('div')
      row.className = `lb-row lb-row-card${rank % 2 ? ' lb-row-alt' : ''}${isSelf ? ' lb-row-self' : ''}`
      row.dataset.uid = prof.id; row.dataset.slamIndex = s.slamIndex ?? -Infinity
      row.dataset.score = s.score ?? -Infinity; row.dataset.matchYield = s.matchYield ?? -Infinity
      row.dataset.drawHealth = s.drawHealth ?? -1

      const nameCell = document.createElement('div'); nameCell.className = 'lb-cell lb-cell-name'
      const rnkEl = document.createElement('span'); rnkEl.className = 'lb-rank'; rnkEl.textContent = '#' + (rank + 1)
      if (baseline && slamSort.col === 'slamIndex') {
        const old = baseline[draw.db_id + ':' + prof.id], cur = rank + 1
        if (old && old !== cur) {
          const arr = document.createElement('span')
          arr.className = old > cur ? 'lb-arrow-up' : 'lb-arrow-dn'; arr.textContent = old > cur ? ' ▲' : ' ▼'
          rnkEl.appendChild(arr)
        }
      }
      const nameEl = document.createElement('span')
      nameEl.className = 'lb-player-name lb-player-link'; nameEl.textContent = prof.display_name
      nameEl.addEventListener('click', e => { e.stopPropagation(); openViewerOriginalPicks(prof, draw) })
      nameCell.append(rnkEl, nameEl)
      if (isSelf) { const b = document.createElement('span'); b.className = 'rec-you-badge'; b.textContent = 'YOU'; nameCell.appendChild(b) }
      row.appendChild(nameCell)

      COLS.forEach(col => {
        const cell = document.createElement('div')
        cell.className = 'lb-cell lb-cell-' + col.key + (col.key === slamSort.col ? ' lb-cell-active-col' : '')
        cell.dataset.col = col.key
        if (!col.noValue) cell.textContent = formatStat(col.key, s[col.key])
        row.appendChild(cell)
      })

      if (s.drawHealth !== null && s.drawHealth !== undefined && _deepestR([draw]) >= 0) {
        const pct = Math.round(s.drawHealth * 100), bar = document.createElement('div')
        const confirmedCount = draw.rounds.reduce((a, r) => a + r.matches.filter(m => m.winner).length, 0)
        bar.className = 'lb-health-bar'
        bar.style.cssText = `width:${pct}%;background:hsl(${healthHue(pct, confirmedCount / 127, state.healthBands)},75%,48%);transition:width 0.3s ease`
        row.appendChild(bar)
      }
      table.appendChild(row)
    })
  }
  card.appendChild(table)
  return { card, table, sortHdrs }
}

// ── SLAM PODIUM ──

function _buildSlamPodium(draw, statsMap, profs) {
  const eligible = profs
    .filter(p => statsMap[p.id]?.hasAnyPicks && statsMap[p.id]?.slamIndex !== null)
    .sort((a, b) => (statsMap[b.id]?.slamIndex ?? -Infinity) - (statsMap[a.id]?.slamIndex ?? -Infinity))
  const top3 = eligible.slice(0, 3)
  const wrap = document.createElement('div'); wrap.className = 'rec-podium'
  ;[[top3[1], 2], [top3[0], 1], [top3[2], 3]].forEach(([prof, rank]) => {
    if (!prof) return
    const s = statsMap[prof.id]
    const block = document.createElement('div')
    block.className = 'rec-pod-block' + (rank === 1 ? ' rec-pod-top' : '')
    const nameEl = document.createElement('div')
    nameEl.className = 'rec-pod-name' + (prof.id === state.currentUser?.id ? ' rec-pod-you' : '')
    nameEl.dataset.id = prof.id
    nameEl.textContent = prof.display_name
    const sub = document.createElement('div'); sub.className = 'rec-pod-stat'
    sub.textContent = `INDEX ${s.slamIndex} · ${draw.draw}`
    const rankEl = document.createElement('div')
    rankEl.className = 'rec-pod-rank' + (rank === 1 ? ' rec-pod-rank-1' : '')
    rankEl.textContent = rank === 1 ? '1ST' : rank === 2 ? '2ND' : '3RD'
    block.appendChild(nameEl); block.appendChild(sub); block.appendChild(rankEl)
    wrap.appendChild(block)
  })
  return wrap
}

// ── STORYLINE CHIPS ──

function _buildChipsRow(section, group, allMaps, profs) {
  const row = document.createElement('div'); row.className = 'lb-chip-row'

  // CHIP A — BIGGEST UPSET
  const upsetEntries = []
  profs.forEach(p => group.draws.forEach(d => {
    const s = allMaps.get(d.db_id)?.[p.id]
    if (s?.bestUpset) upsetEntries.push({ ...s.bestUpset, draw: d, prof: p })
  }))
  const cA = _mkChip('BIGGEST UPSET')
  if (!upsetEntries.length) { cA.appendChild(_emptyChip()) } else {
    const maxYld = Math.max(...upsetEntries.map(e => e.yld))
    const topEntries = upsetEntries.filter(e => e.yld === maxYld)
    const first = topEntries[0]
    const chipText = topEntries.length > 1
      ? `${topEntries.length} players · ${first.pickedName} ${formatAmerican(first.decimalOdds)}`
      : `${first.pickedName} ${formatAmerican(first.decimalOdds)}`
    const body = document.createElement('div'); body.className = 'rec-honor-body rec-honor-clickable'
    const main = document.createElement('div'); main.className = 'rec-honor-main'; main.textContent = chipText
    body.appendChild(main)
    body.addEventListener('click', () => openListModal('Biggest Upset', topEntries.map(e => {
      const cfg = SLAM_CONFIG[e.draw.slam] || {}
      return { name: e.prof.display_name, sub: `Beat ${e.opponent} · ${cfg.name || e.draw.slam} ${e.draw.year} · ${ROUND_LBL[e.ri] || 'R' + (e.ri + 1)}`, val: `+${e.yld}`, valClass: 'lb-modal-val-pos' }
    })))
    cA.appendChild(body)
  }
  row.appendChild(cA)

  // CHIP B — BEST MATCH PICK VALUE
  const roiEntries = []
  profs.forEach(p => {
    let totalFlatYield = 0, totalResolved = 0
    group.draws.forEach(d => {
      const s = allMaps.get(d.db_id)?.[p.id]
      if (!s) return
      totalFlatYield += s.flatYield ?? 0
      totalResolved += s.flatYieldResolved ?? 0
    })
    if (totalResolved > 0) roiEntries.push({ prof: p, roi: totalFlatYield / totalResolved, n: totalResolved })
  })
  roiEntries.sort((a, b) => b.roi - a.roi)
  const cB = _mkChip('BEST MATCH PICK VALUE')
  const subLbl = document.createElement('span'); subLbl.className = 'lb-rec-card-title'
  subLbl.style.cssText = 'font-size:9px;opacity:0.7'; subLbl.textContent = 'FLAT-STAKE ROI'
  cB.querySelector('.lb-rec-card-header').appendChild(subLbl)
  if (!roiEntries.length) { cB.appendChild(_emptyChip()) } else {
    const best = roiEntries[0], bPct = Math.round(best.roi * 100)
    const body = document.createElement('div'); body.className = 'rec-honor-body rec-honor-clickable'
    const main = document.createElement('div'); main.className = 'rec-honor-main'
    main.textContent = `${best.prof.display_name} · ${bPct >= 0 ? '+' : '−'}${Math.abs(bPct)}%`
    body.appendChild(main)
    body.addEventListener('click', () => openListModal('Best Match Pick Value', roiEntries.map(e => {
      const p = Math.round(e.roi * 100)
      return { name: e.prof.display_name, sub: `${e.n} pick${e.n !== 1 ? 's' : ''}`, val: (p >= 0 ? '+' : '−') + Math.abs(p) + '%', valClass: p >= 0 ? 'lb-modal-val-pos' : '' }
    })))
    cB.appendChild(body)
  }
  row.appendChild(cB); section.appendChild(row)
}

function _mkChip(title) {
  const el = document.createElement('div'); el.className = 'lb-rec-card rec-honor-chip'
  const hdr = document.createElement('div'); hdr.className = 'lb-rec-card-header'
  const titleEl = document.createElement('span'); titleEl.className = 'lb-rec-card-title'
  titleEl.textContent = title; hdr.appendChild(titleEl); el.appendChild(hdr)
  return el
}
function _emptyChip() {
  const el = document.createElement('div'); el.className = 'rec-honor-empty'; el.textContent = '—'; return el
}

// ── PAST SLAM COMPACT CARD ──

async function _renderPastCompact(wrapper, group, allMaps, profs) {
  wrapper.innerHTML = ''
  const color = SLAM_COLORS[group.slam] || 'var(--border)'
  const cfg   = SLAM_CONFIG[group.slam] || {}

  const combined = {}
  profs.forEach(p => {
    const sis = group.draws.map(d => allMaps.get(d.db_id)?.[p.id]).filter(s => s?.hasAnyPicks && s.slamIndex !== null).map(s => s.slamIndex)
    if (sis.length) combined[p.id] = Math.round(sis.reduce((a, b) => a + b, 0) / sis.length)
  })
  const top3 = profs.filter(p => combined[p.id] !== undefined).sort((a, b) => combined[b.id] - combined[a.id]).slice(0, 3)

  const card = document.createElement('div')
  card.className = 'lb-past-card'; card.style.setProperty('--lb-slam-color', color)
  card.innerHTML = `<div><div class="lb-past-name">${_esc(cfg.name || group.slam)}</div><div style="font-family:var(--mono);font-size:11px;color:var(--text3)">${group.year}</div></div>`

  const top3El = document.createElement('div'); top3El.className = 'lb-past-top3'
  top3.forEach((p, i) => {
    const span = document.createElement('span')
    span.className = 'lb-past-entry' + (i === 0 ? ' lb-past-entry-rank1' : '')
    span.textContent = `${i + 1} ${p.display_name} · ${combined[p.id]}`
    top3El.appendChild(span)
  })
  card.appendChild(top3El)

  const viewBtn = document.createElement('span')
  viewBtn.className = 'lb-past-view'
  viewBtn.textContent = _expandedKeys.has(group.key) ? 'HIDE ↑' : 'VIEW →'
  card.appendChild(viewBtn)

  card.addEventListener('click', async () => {
    _expandedKeys.has(group.key) ? _expandedKeys.delete(group.key) : _expandedKeys.add(group.key)
    await _renderPastCompact(wrapper, group, allMaps, profs)
  })
  wrapper.appendChild(card)

  if (_expandedKeys.has(group.key)) {
    const expEl = document.createElement('div'); expEl.style.marginTop = '8px'
    await _renderFull(expEl, group, allMaps, profs, false)
    wrapper.appendChild(expEl)
  }
}
