// Your Draws tab — sortable table of the current user's draws

import { state } from './state.js'
import { supabase } from './supabase.js'
import { SLAM_CONFIG, SLAM_COLORS } from './data.js'
import { POOL_ELIGIBILITY_THRESHOLD, healthHue } from './scoring.js'
import { loadDrawStatsForAllUsers, openViewerOriginalPicks, formatStat } from './leaderboard.js'

// ── MODULE STATE ──

let ydSort    = { col: null, dir: -1 }  // null col = chronological (newest first)
let _meta     = []   // [{ draw, eligible }]
let _stats    = {}   // drawDbId → statsMap (all users, from cache)
let _container = null

export function resetYdSort() { ydSort = { col: null, dir: -1 } }

// ── COLUMNS ──

const COLS = [
  { key: 'score',      label: 'Draw Yld'  },
  { key: 'baseScore',  label: 'Base Pts'  },
  { key: 'upsetScore', label: 'Upset Pts' },
  { key: 'matchYield', label: 'Match Yld' },
  { key: 'drawAcc',    label: 'Draw %'    },
  { key: 'matchAcc',   label: 'Match %'   },
  { key: 'drawHealth', label: 'Health'    },
  { key: 'slamIndex',  label: 'Index'     },
]

// Descending chronological key: higher = more recent.
// Within a year: USO > WIM > RG > AO (calendar order reversed)
const SLAM_CHRON = ['AO', 'RG', 'WIM', 'USO']  // ascending within a year

function chronoKey(d) {
  return d.year * 100 + SLAM_CHRON.indexOf(d.slam) * 2 + (d.draw === 'WS' ? 0 : 1)
}

// ── RENDER ──

function _renderTable(container) {
  var existingWrap = container.querySelector('.lb-yd-table-wrap')
  var savedScroll = existingWrap ? existingWrap.scrollLeft : 0
  container.innerHTML = ''
  const userId = state.currentUser?.id

  const tableWrap = document.createElement('div')
  tableWrap.className = 'lb-yd-table-wrap'

  const table = document.createElement('div')
  table.className = 'lb-table lb-yd-table'
  tableWrap.appendChild(table)

  // Header row
  const hdr = document.createElement('div')
  hdr.className = 'lb-row lb-yd-row lb-header-row'

  const drawHdr = document.createElement('div')
  drawHdr.className = 'lb-cell lb-cell-name'
  drawHdr.textContent = 'Draw'
  hdr.appendChild(drawHdr)

  COLS.forEach(col => {
    const cell = document.createElement('div')
    cell.className = 'lb-cell lb-cell-' + col.key + ' lb-sortable' + (ydSort.col === col.key ? ' lb-sort-active' : '')
    cell.textContent = col.label
    const arrow = document.createElement('span')
    arrow.className = 'lb-sort-arrow'
    arrow.textContent = ydSort.col === col.key ? (ydSort.dir === -1 ? ' ↓' : ' ↑') : ' ↕'
    cell.appendChild(arrow)
    cell.addEventListener('click', () => {
      ydSort.col === col.key ? (ydSort.dir *= -1) : (ydSort.col = col.key, ydSort.dir = -1)
      _renderTable(_container)
    })
    hdr.appendChild(cell)
  })
  table.appendChild(hdr)

  // Sort rows — recSort-correct comparator: (va < vb ? -1 : 1) * dir, no trailing negation
  const sorted = [..._meta].sort((a, b) => {
    if (ydSort.col) {
      const va = _stats[a.draw.db_id]?.[userId]?.[ydSort.col] ?? -Infinity
      const vb = _stats[b.draw.db_id]?.[userId]?.[ydSort.col] ?? -Infinity
      if (va !== vb) return (va < vb ? -1 : 1) * ydSort.dir
    }
    return chronoKey(b.draw) - chronoKey(a.draw)
  })

  sorted.forEach((m, rank) => {
    const { draw, eligible } = m
    const s = _stats[draw.db_id]?.[userId] || {}
    const color = SLAM_COLORS[draw.slam] || 'var(--border)'
    const cfg   = SLAM_CONFIG[draw.slam] || {}
    const label = (cfg.name || draw.slam) + ' ' + draw.year + ' ' + (draw.draw === 'MS' ? 'M' : 'W')

    const row = document.createElement('div')
    row.className = 'lb-row lb-yd-row'
      + (rank % 2 ? ' lb-row-alt' : '')
      + (draw.is_active ? ' lb-yd-row-active' : '')
      + (!eligible ? ' lb-yd-row-muted' : '')
    row.style.setProperty('--lb-slam-color', color)

    const nameCell = document.createElement('div')
    nameCell.className = 'lb-cell lb-cell-name'
    const lbl = document.createElement('span')
    lbl.className = 'lb-player-name lb-yd-draw-label lb-player-link'
    lbl.textContent = label
    lbl.addEventListener('click', function() { openViewerOriginalPicks(state.currentUser, draw) })
    nameCell.appendChild(lbl)
    row.appendChild(nameCell)

    if (!eligible) {
      const msg = document.createElement('div')
      msg.className = 'lb-cell lb-yd-ineligible-msg'
      msg.textContent = '< 50% picked'
      row.appendChild(msg)
    } else {
      COLS.forEach(col => {
        const cell = document.createElement('div')
        cell.className = 'lb-cell lb-cell-' + col.key + (ydSort.col === col.key ? ' lb-cell-active-col' : '')
        if (col.key === 'drawHealth' && s[col.key] != null) {
          var confirmedCount = draw.rounds.reduce(function(a, r) { return a + r.matches.filter(function(m) { return m.winner }).length }, 0)
          var hue = healthHue(s[col.key] * 100, confirmedCount / 127, state.healthBands)
          var bar = document.createElement('span')
          bar.className = 'lb-yd-health-bar'
          bar.style.height = Math.round(s[col.key] * 20) + 'px'
          bar.style.background = 'hsl(' + hue + ',75%,48%)'
          cell.appendChild(bar)
          cell.appendChild(document.createTextNode(Math.round(s[col.key] * 100) + '%'))
        } else {
          cell.textContent = formatStat(col.key, s[col.key])
        }
        row.appendChild(cell)
      })
    }

    table.appendChild(row)
  })

  container.appendChild(tableWrap)
  tableWrap.scrollLeft = savedScroll
}

export async function renderYourDrawsTab(container) {
  _container = container

  if (!state.currentUser) {
    container.innerHTML = '<div class="lb-empty">Not logged in.</div>'
    return
  }
  if (!state.draws.length) {
    container.innerHTML = '<div class="lb-empty">No draws uploaded yet.</div>'
    return
  }

  const userId = state.currentUser.id

  // Single query: all the user's picks across all draws (draw_id + original_pick only)
  const { data: pickRows } = await supabase
    .from('picks')
    .select('draw_id, original_pick')
    .eq('user_id', userId)

  // Count original picks per draw
  const origByDraw = {}
  ;(pickRows || []).forEach(p => {
    if (!origByDraw[p.draw_id]) origByDraw[p.draw_id] = 0
    if (p.original_pick) origByDraw[p.draw_id]++
  })

  function matchCount(d) {
    return d.rounds.reduce((n, r) => n + r.matches.length, 0)
  }

  // Keep only draws with at least one original pick; determine pool eligibility
  _meta = state.draws
    .filter(d => (origByDraw[d.db_id] || 0) > 0)
    .map(d => {
      const orig  = origByDraw[d.db_id] || 0
      const total = matchCount(d)
      return { draw: d, eligible: total > 0 && orig / total >= POOL_ELIGIBILITY_THRESHOLD }
    })

  if (!_meta.length) {
    container.innerHTML = '<div class="lb-empty">No draws with picks yet.</div>'
    return
  }

  // Load stats for eligible draws (statsCache in leaderboard.js avoids duplicate fetches)
  _stats = {}
  await Promise.all(
    _meta.filter(m => m.eligible).map(async m => {
      _stats[m.draw.db_id] = await loadDrawStatsForAllUsers(m.draw)
    })
  )

  _renderTable(container)
}
