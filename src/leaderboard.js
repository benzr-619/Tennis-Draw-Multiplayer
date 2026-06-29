// Leaderboard — Slams tab, detail view, your draws, viewer, data loading

import { supabase } from './supabase.js'
import { state } from './state.js'
import { calcStats, calcSlamIndex } from './scoring.js'
import { slamKey, SLAM_CONFIG, SLAM_COLORS } from './data.js'
import { buildDrawView } from './draw-view.js'
import { animateSegThumb } from './seg-thumb.js'
import { STAKE_BY_ROUND } from './odds.js'
import { renderRecordsTab } from './leaderboard-records.js'
import { renderSlamsTab, resetSlamSort } from './leaderboard-slams.js'

// ── MODULE STATE ──

let lbTab = 'slams'            // 'slams' | 'records' | 'yourdraws'
let _lbTabPrevIdx = -1         // tracks previous tab index for slide animation
let lbDetailDraw = null        // Draw | null — when set, show full-width draw detail
let lbSort = { col: 'score', dir: -1 }

export function setLbDetail(draw) { lbDetailDraw = draw; lbSort = { col: 'score', dir: -1 } }
export function clearStatsCache() { statsCache.clear() }
let statsCache = new Map()     // drawDbId → { userId: stats }
let profiles = null

// ── VIEWER STATE ──
let viewerMode = 'original'    // 'original' | 'match'
let _viewerSegPrevIdx = -1
let _viewerOrigDraw = null
let _viewerMatchDraw = null

// ── DATA ──

export async function loadAllProfiles() {
  if (profiles) return profiles
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, is_commissioner')
    .order('display_name', { ascending: true })
  if (error) throw error
  profiles = data || []
  return profiles
}

// Fetches all rows from a Supabase query builder, paginating in 1,000-row pages
// to bypass the PostgREST default cap. Pass the query without .range() applied.
export async function fetchAllRows(baseQuery) {
  const PAGE = 1000
  let from = 0
  const all = []
  while (true) {
    const { data, error } = await baseQuery.range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data || []))
    if ((data || []).length < PAGE) break
    from += PAGE
  }
  return all
}

export async function loadAllPicksForDraw(drawDbId) {
  return fetchAllRows(
    supabase.from('picks')
      .select('user_id, match_id, match_pick, original_pick, original_pick_result, match_pick_result, high_confidence, edited_after_lock')
      .eq('draw_id', drawDbId)
  )
}

// Assembles a draw using the user's current picks, then re-derives all slot/elim state.
export function assembleDrawForUser(baseDraw, userPickRows) {
  const pickMap = {}
  userPickRows.forEach(p => { pickMap[p.match_id] = p })
  const rounds = baseDraw.rounds.map(r => ({
    ...r,
    matches: r.matches.map(m => {
      const pk = m.db_id ? (pickMap[m.db_id] || {}) : {}
      return {
        ...m,
        matchPick: pk.match_pick ?? null,
        originalPick: pk.original_pick ?? null,
        originalPickResult: pk.original_pick_result ?? null,
        matchPickResult: pk.match_pick_result ?? null,
        highConfidence: pk.high_confidence ?? false,
        editedAfterLock: pk.edited_after_lock ?? false,
      }
    }),
  }))
  return buildDrawView({ ...baseDraw, rounds })
}

// Assembles a draw using original_pick as pick — for the leaderboard bracket viewer (original mode).
// Attaches actualP1/actualP2 (real feeder winners) so placeViewerCard can float
// the actual player outside the card when the pick was wrong.
// Uses projectFromPick so the user's picks occupy the slots (not the real winners).
function assembleDrawForUserOriginalPicks(baseDraw, userPickRows) {
  const pickMap = {}
  userPickRows.forEach(p => { pickMap[p.match_id] = p })

  const seedMap = {}
  baseDraw.rounds[0]?.matches.forEach(m => {
    if (m.p1?.name) seedMap[m.p1.name] = m.p1.seed || ''
    if (m.p2?.name) seedMap[m.p2.name] = m.p2.seed || ''
  })

  const rounds = baseDraw.rounds.map((r, ri) => ({
    ...r,
    matches: r.matches.map((m, mi) => {
      const pk = m.db_id ? (pickMap[m.db_id] || {}) : {}
      let actualP1, actualP2
      if (ri === 0) {
        actualP1 = { ...m.p1 }
        actualP2 = { ...m.p2 }
      } else {
        const feeder1 = baseDraw.rounds[ri - 1].matches[mi * 2]
        const feeder2 = baseDraw.rounds[ri - 1].matches[mi * 2 + 1]
        const a1 = feeder1?.winner || ''
        const a2 = feeder2?.winner || ''
        actualP1 = { name: a1, seed: seedMap[a1] || '' }
        actualP2 = { name: a2, seed: seedMap[a2] || '' }
      }
      return {
        ...m,
        actualP1,
        actualP2,
        matchPick: pk.original_pick ?? pk.match_pick ?? null,
        originalPick: pk.original_pick ?? null,
        originalPickResult: pk.original_pick_result ?? null,
        matchPickResult: pk.match_pick_result ?? null,
        highConfidence: pk.high_confidence ?? false,
        editedAfterLock: false,
      }
    }),
  }))

  return buildDrawView({ ...baseDraw, rounds }, { projectFromPick: true })
}

// Same as assembleDrawForUserOriginalPicks but projects from matchPick (backup/current pick)
// instead of originalPick — used for the Match Picks viewer mode.
function assembleDrawForUserMatchPicks(baseDraw, userPickRows) {
  const pickMap = {}
  userPickRows.forEach(p => { pickMap[p.match_id] = p })

  const seedMap = {}
  baseDraw.rounds[0]?.matches.forEach(m => {
    if (m.p1?.name) seedMap[m.p1.name] = m.p1.seed || ''
    if (m.p2?.name) seedMap[m.p2.name] = m.p2.seed || ''
  })

  const rounds = baseDraw.rounds.map((r, ri) => ({
    ...r,
    matches: r.matches.map((m, mi) => {
      const pk = m.db_id ? (pickMap[m.db_id] || {}) : {}
      let actualP1, actualP2
      if (ri === 0) {
        actualP1 = { ...m.p1 }
        actualP2 = { ...m.p2 }
      } else {
        const feeder1 = baseDraw.rounds[ri - 1].matches[mi * 2]
        const feeder2 = baseDraw.rounds[ri - 1].matches[mi * 2 + 1]
        const a1 = feeder1?.winner || ''
        const a2 = feeder2?.winner || ''
        actualP1 = { name: a1, seed: seedMap[a1] || '' }
        actualP2 = { name: a2, seed: seedMap[a2] || '' }
      }
      return {
        ...m,
        actualP1,
        actualP2,
        matchPick: pk.match_pick ?? null,
        originalPick: null,   // cleared so buildDrawView projects from matchPick, not originalPick
        originalPickResult: null,
        matchPickResult: pk.match_pick_result ?? null,
        highConfidence: pk.high_confidence ?? false,
        editedAfterLock: false,
      }
    }),
  }))

  return buildDrawView({ ...baseDraw, rounds }, { projectFromPick: true })
}

export async function loadDrawStatsForAllUsers(baseDraw) {
  const cached = statsCache.get(baseDraw.db_id)
  if (cached) return cached

  const [allPicks, profs] = await Promise.all([
    loadAllPicksForDraw(baseDraw.db_id),
    loadAllProfiles(),
  ])

  const picksByUser = {}
  allPicks.forEach(p => {
    if (!picksByUser[p.user_id]) picksByUser[p.user_id] = []
    picksByUser[p.user_id].push(p)
  })

  const result = {}
  profs.forEach(prof => {
    const userPicks = picksByUser[prof.id] || []
    const userDraw = assembleDrawForUser(baseDraw, userPicks)
    const s = calcStats(userDraw)
    const origRes = s.cDrawOrig + s.wDrawOrig
    const allRes = s.cOrig + s.wOrig + s.cBackup + s.wBackup

    // Best single-match upset call: correct matchPick at the highest locked odds
    let bestUpset = null
    // Flat-stake ROI: each resolved matchPick with locked odds counts as $1 bet
    let flatYield = 0, flatYieldResolved = 0
    userDraw.rounds.forEach((r, ri) => {
      r.matches.forEach(m => {
        const pickedOdds = m.matchPick === m.p1?.name ? m.odds_p1_locked
                         : m.matchPick === m.p2?.name ? m.odds_p2_locked : null

        // Flat-stake: win = (odds-1), lose = -1, per resolved bet with locked odds
        if (pickedOdds && pickedOdds > 1) {
          if (m.matchPickResult === 'correct') { flatYield += pickedOdds - 1; flatYieldResolved++ }
          else if (m.matchPickResult === 'wrong') { flatYield -= 1; flatYieldResolved++ }
        }

        // Best upset call
        if (m.matchPickResult !== 'correct' || !pickedOdds || pickedOdds <= 1) return
        const yld = Math.round((STAKE_BY_ROUND[ri] ?? 10) * (pickedOdds - 1))
        const opponent   = m.matchPick === m.p1?.name ? (m.p2?.name || '') : (m.p1?.name || '')
        const pickedName = m.matchPick
        if (!bestUpset || yld > bestUpset.yld) bestUpset = { yld, ri, pickedName, opponent, decimalOdds: pickedOdds }
      })
    })

    result[prof.id] = {
      score: s.baseScore + s.skillBonus,
      baseScore: s.baseScore,
      upsetScore: parseFloat(s.skillBonus.toFixed(1)),
      drawAcc: origRes > 0 ? s.cDrawOrig / origRes : null,
      matchAcc: allRes > 0 ? (s.cOrig + s.cBackup) / allRes : null,
      drawHealth: s.maxHealthPts > 0 ? s.reachableHealthPts / s.maxHealthPts : null,
      matchYield: s.matchYieldResolved > 0 ? s.matchYield : null,
      matchYieldResolved: s.matchYieldResolved,
      hasAnyPicks: s.filled > 0,
      slamIndex: null, // filled below after pool is complete
      bestUpset,
      flatYield,
      flatYieldResolved,
    }
  })

  // Compute pool-adjusted Slam Index across all players with picks in this draw
  const eligibleProfs = profs.filter(p => result[p.id]?.hasAnyPicks)
  if (eligibleProfs.length > 0) {
    const entries = eligibleProfs.map(p => ({
      score: result[p.id].score ?? 0,
      matchYield: result[p.id].matchYield ?? 0,
    }))
    const indexes = calcSlamIndex(entries)
    eligibleProfs.forEach((prof, i) => { result[prof.id].slamIndex = indexes[i] })
  }

  statsCache.set(baseDraw.db_id, result)
  return result
}


// ── RENDER ENTRY ──

export async function renderLeaderboard() {
  statsCache.clear()

  const root = document.getElementById('lb-root')
  if (!root) return
  root.innerHTML = '<div class="lb-loading">Loading…</div>'

  try {
    const profs = await loadAllProfiles()
    root.innerHTML = ''

    // If we're in draw detail view, render that instead of tabs
    if (lbDetailDraw) {
      await renderDrawDetail(root, profs, lbDetailDraw)
      return
    }

    // Tab bar
    const tabbar = document.createElement('div')
    tabbar.className = 'lb-tabbar'
    const tabseg = document.createElement('div')
    tabseg.className = 'lb-tabseg'
    const LB_TABS = [{ key: 'slams', label: 'Slams' }, { key: 'records', label: 'Records' }, { key: 'yourdraws', label: 'Your Draws' }]
    const activeTabIdx = LB_TABS.findIndex(t => t.key === lbTab)
    LB_TABS.forEach(({ key, label }) => {
      const btn = document.createElement('button')
      btn.className = 'lb-tab' + (lbTab === key ? ' active' : '')
      btn.textContent = label
      btn.addEventListener('click', () => {
        if (lbTab === key) return
        lbTab = key
        lbSort = { col: 'score', dir: -1 }
        if (key === 'slams') resetSlamSort()
        renderLeaderboard()
      })
      tabseg.appendChild(btn)
    })
    tabbar.appendChild(tabseg)
    root.appendChild(tabbar)
    animateSegThumb(tabseg, _lbTabPrevIdx, activeTabIdx)
    _lbTabPrevIdx = activeTabIdx

    const content = document.createElement('div')
    content.className = 'lb-content'
    root.appendChild(content)

    if (lbTab === 'slams') {
      await renderSlamsTab(content, profs)
    } else if (lbTab === 'records') {
      await renderRecordsTab(content, profs)  // from leaderboard-records.js
    } else {
      await renderYourDrawsTab(content)
    }
  } catch (err) {
    console.error('Leaderboard error:', err)
    root.innerHTML = `<div class="lb-error">Failed to load leaderboard: ${err.message}</div>`
  }
}

// ── DRAW DETAIL VIEW ──
// Full-width sortable table for one draw, with back button

async function renderDrawDetail(root, profs, draw) {
  const color = SLAM_COLORS[draw.slam] || 'var(--border)'
  const cfg = SLAM_CONFIG[draw.slam] || {}
  const drawTypeLabel = draw.draw === 'MS' ? "Men's Singles" : "Women's Singles"

  // Detail header: back button + draw title
  const hdr = document.createElement('div')
  hdr.className = 'lb-detail-header'
  hdr.style.setProperty('--lb-slam-color', color)

  const back = document.createElement('button')
  back.className = 'lb-detail-back'
  back.textContent = '← Slams'
  back.addEventListener('click', () => {
    lbDetailDraw = null
    lbSort = { col: 'score', dir: -1 }
    renderLeaderboard()
  })

  const title = document.createElement('span')
  title.className = 'lb-detail-title'
  title.textContent = `${cfg.name || draw.slam} ${draw.year} — ${drawTypeLabel}`

  hdr.appendChild(back)
  hdr.appendChild(title)
  root.appendChild(hdr)

  const content = document.createElement('div')
  content.className = 'lb-content'
  root.appendChild(content)

  const statsMap = await loadDrawStatsForAllUsers(draw)

  const cols = [
    { key: 'score',      label: 'Draw Yld',   sortable: true },
    { key: 'baseScore',  label: 'Base Pts',   sortable: true },
    { key: 'upsetScore', label: 'Upset Pts',  sortable: true },
    { key: 'matchYield', label: 'Match Yld',  sortable: true },
    { key: 'drawAcc',    label: 'Draw %',     sortable: true },
    { key: 'matchAcc',   label: 'Match %',    sortable: true },
    { key: 'drawHealth', label: 'Health',     sortable: true },
    { key: 'slamIndex',  label: 'Index',      sortable: true },
  ]

  const tableWrap = document.createElement('div')
  tableWrap.className = 'lb-detail-table-wrap'
  tableWrap.appendChild(buildDetailTable(cols, profs, statsMap, draw))
  content.appendChild(tableWrap)
}

// ── DRAW DETAIL TABLE (full-width, sortable) ──

function buildDetailTable(cols, profs, statsMap, draw) {
  const table = document.createElement('div')
  table.className = 'lb-table lb-detail-table'

  // Sort
  const sortKey = lbSort.col
  const sorted = [...profs]
    .filter(p => statsMap[p.id]?.hasAnyPicks)
    .sort((a, b) => {
      const va = statsMap[a.id]?.[sortKey] ?? -Infinity
      const vb = statsMap[b.id]?.[sortKey] ?? -Infinity
      if (va === vb) return 0
      return (va < vb ? -1 : 1) * lbSort.dir * -1
    })

  // Header
  const hdr = document.createElement('div')
  hdr.className = 'lb-row lb-row-detail lb-header-row'
  const nameHdrCell = document.createElement('div')
  nameHdrCell.className = 'lb-cell lb-cell-name'
  nameHdrCell.textContent = 'Player'
  hdr.appendChild(nameHdrCell)
  cols.forEach(col => {
    const cell = document.createElement('div')
    cell.className = 'lb-cell lb-cell-' + col.key
    cell.textContent = col.label
    if (col.sortable) {
      cell.classList.add('lb-sortable')
      if (lbSort.col === col.key) cell.classList.add('lb-sort-active')
      const arrow = document.createElement('span')
      arrow.className = 'lb-sort-arrow'
      arrow.textContent = lbSort.col === col.key ? (lbSort.dir === -1 ? ' ↓' : ' ↑') : ' ↕'
      cell.appendChild(arrow)
      cell.addEventListener('click', () => {
        if (lbSort.col === col.key) { lbSort.dir *= -1 } else { lbSort.col = col.key; lbSort.dir = -1 }
        renderLeaderboard()
      })
    }
    hdr.appendChild(cell)
  })
  table.appendChild(hdr)

  // Rows
  sorted.forEach((prof, rank) => {
    const s = statsMap[prof.id] || {}
    const row = document.createElement('div')
    row.className = 'lb-row lb-row-detail' + (rank % 2 === 1 ? ' lb-row-alt' : '')
    if (prof.id === state.currentUser?.id) row.classList.add('lb-row-self')

    const nameCell = document.createElement('div')
    nameCell.className = 'lb-cell lb-cell-name'
    const rankEl = document.createElement('span')
    rankEl.className = 'lb-rank'
    rankEl.textContent = '#' + (rank + 1)
    const nameEl = document.createElement('span')
    nameEl.className = 'lb-player-name lb-player-link'
    nameEl.textContent = prof.display_name
    nameEl.addEventListener('click', () => openViewerOriginalPicks(prof, draw))
    nameCell.appendChild(rankEl)
    nameCell.appendChild(nameEl)
    row.appendChild(nameCell)

    cols.forEach(col => {
      const cell = document.createElement('div')
      cell.className = 'lb-cell lb-cell-' + col.key
      cell.textContent = formatStat(col.key, s[col.key])
      row.appendChild(cell)
    })

    table.appendChild(row)
  })

  return table
}


// ── YOUR DRAWS TAB ──

async function renderYourDrawsTab(container) {
  if (!state.currentUser) {
    container.innerHTML = '<div class="lb-empty">Not logged in.</div>'
    return
  }

  if (state.draws.length === 0) {
    container.innerHTML = '<div class="lb-empty">No draws uploaded yet.</div>'
    return
  }

  // Determine which draws the current user has picks in
  const userId = state.currentUser.id
  const userDrawIds = new Set()
  await Promise.all(state.draws.map(async d => {
    const { data } = await supabase
      .from('picks')
      .select('match_id')
      .eq('draw_id', d.db_id)
      .eq('user_id', userId)
      .limit(1)
    if (data && data.length > 0) userDrawIds.add(d.db_id)
  }))

  // Group by slam+year, newest first
  const groups = new Map()
  state.draws.forEach(d => {
    const k = slamKey(d)
    if (!groups.has(k)) groups.set(k, { slam: d.slam, year: d.year, draws: [] })
    groups.get(k).draws.push(d)
  })

  const SLAM_ORDER = ['USO', 'WIM', 'RG', 'AO']
  const sorted = [...groups.values()].sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year
    return SLAM_ORDER.indexOf(a.slam) - SLAM_ORDER.indexOf(b.slam)
  })

  const grid = document.createElement('div')
  grid.className = 'lb-yd-grid'
  container.appendChild(grid)

  for (const group of sorted) {
    const color = SLAM_COLORS[group.slam] || 'var(--border)'
    const cfg = SLAM_CONFIG[group.slam] || {}

    const card = document.createElement('div')
    card.className = 'lb-yd-card'
    card.style.setProperty('--lb-slam-color', color)

    const cardTop = document.createElement('div')
    cardTop.className = 'lb-yd-card-top'

    const slamName = document.createElement('div')
    slamName.className = 'lb-yd-slam-name'
    slamName.textContent = cfg.name || group.slam

    const yearEl = document.createElement('div')
    yearEl.className = 'lb-yd-year'
    yearEl.textContent = group.year

    cardTop.appendChild(slamName)
    cardTop.appendChild(yearEl)
    card.appendChild(cardTop)

    const btnRow = document.createElement('div')
    btnRow.className = 'lb-yd-btn-row'

    const drawMap = {}
    group.draws.forEach(d => { drawMap[d.draw] = d })

    ;['MS', 'WS'].forEach(drawType => {
      const draw = drawMap[drawType]
      const label = drawType === 'MS' ? 'M' : 'W'
      const hasPicks = draw && userDrawIds.has(draw.db_id)

      const btn = document.createElement('button')
      btn.className = 'lb-yd-btn' + (hasPicks ? '' : ' lb-yd-btn-disabled')
      btn.textContent = label
      btn.disabled = !hasPicks

      if (hasPicks) {
        btn.addEventListener('click', () => {
          openViewerOriginalPicks(state.currentUser, draw)
        })
      }

      btnRow.appendChild(btn)
    })

    card.appendChild(btnRow)
    grid.appendChild(card)
  }
}

// ── VIEWER ──

// Opens the dedicated viewer screen showing a user's picks with outcomes.
// Assembles both draws (original + match) upfront so toggling is instant (no extra DB call).
export async function openViewerOriginalPicks(prof, draw) {
  const allPicks = await loadAllPicksForDraw(draw.db_id)
  const userPicks = allPicks.filter(p => p.user_id === prof.id)

  _viewerOrigDraw = assembleDrawForUserOriginalPicks(draw, userPicks)
  _viewerMatchDraw = assembleDrawForUserMatchPicks(draw, userPicks)
  viewerMode = 'original'
  _viewerSegPrevIdx = -1

  // Compute stats from the standard assembly (same data source as leaderboard summary cards)
  const statsDraw = assembleDrawForUser(draw, userPicks)
  const stats = calcStats(statsDraw)

  // Import viewer modules upfront — dynamic imports are cached, and we need
  // renderViewerBracket in scope for the toggle handler closure below.
  const [{ renderViewerBracket }, { applyTheme }] = await Promise.all([
    import('./viewer-bracket.js'),
    import('./state.js'),
  ])

  // Header identity
  const cfg = SLAM_CONFIG[draw.slam] || {}
  const drawTypeLabel = draw.draw === 'MS' ? "Men's Singles" : "Women's Singles"
  const nameEl = document.getElementById('viewer-hdr-name-v')
  if (nameEl) nameEl.textContent = prof.display_name
  const drawEl = document.getElementById('viewer-hdr-draw-v')
  if (drawEl) drawEl.textContent = `${cfg.name || draw.slam} ${draw.year} · ${drawTypeLabel}`

  // Wire toggle
  const seg = document.getElementById('viewer-seg-control')
  if (seg) {
    const btns = seg.querySelectorAll('.seg-btn')
    btns.forEach((btn, i) => {
      btn.classList.toggle('active', i === 0)
      btn.onclick = () => {
        const newMode = btn.dataset.mode
        if (newMode === viewerMode) return
        const oldIdx = viewerMode === 'original' ? 0 : 1
        const newIdx = newMode === 'original' ? 0 : 1
        viewerMode = newMode
        btns.forEach((b, j) => b.classList.toggle('active', j === newIdx))
        seg.querySelectorAll('.seg-thumb').forEach(t => t.remove())
        animateSegThumb(seg, oldIdx, newIdx)
        renderViewerStats(stats, viewerMode)
        const d = viewerMode === 'original' ? _viewerOrigDraw : _viewerMatchDraw
        renderViewerBracket(d, viewerMode)
      }
    })
  }

  // Stats strip
  renderViewerStats(stats, viewerMode)

  applyTheme(draw.slam)
  renderViewerBracket(_viewerOrigDraw, viewerMode)

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById('screen-viewer')?.classList.add('active')

  // Thumb placement must happen after the screen is visible so button widths are non-zero
  if (seg) requestAnimationFrame(() => animateSegThumb(seg, -1, 0))
}

function renderViewerStats(s, mode = 'original') {
  const strip = document.getElementById('viewer-stats-strip')
  if (!strip) return
  strip.innerHTML = ''

  const origRes = s.cDrawOrig + s.wDrawOrig
  const allRes = s.cOrig + s.wOrig + s.cBackup + s.wBackup

  const score   = s.baseScore + s.skillBonus
  const drawAcc = origRes > 0 ? Math.round(s.cDrawOrig / origRes * 100) + '%' : null
  const matchAcc = allRes > 0 ? Math.round((s.cOrig + s.cBackup) / allRes * 100) + '%' : null
  const health  = s.maxHealthPts > 0 ? Math.round(s.reachableHealthPts / s.maxHealthPts * 100) + '%' : null
  const myld    = s.matchYieldResolved > 0
    ? (s.matchYield >= 0 ? '+' + s.matchYield : '−' + Math.abs(s.matchYield))
    : null

  // Original draw: pick-based metrics. Match picks: betting/backup metrics.
  const pills = mode === 'original'
    ? [
        { label: 'Draw Yld', val: fmtScore(score) },
        drawAcc !== null ? { label: 'Draw %',  val: drawAcc } : null,
        health  !== null ? { label: 'Health',  val: health  } : null,
      ]
    : [
        myld    !== null ? { label: 'Match Yld', val: myld     } : null,
        matchAcc !== null ? { label: 'Match %',  val: matchAcc } : null,
      ]

  pills.filter(Boolean).forEach(({ label, val }) => {
    const pill = document.createElement('div')
    pill.className = 'viewer-stat-pill'
    pill.innerHTML = `<span class="vslbl">${label}</span><span class="vsval">${val}</span>`
    strip.appendChild(pill)
  })
}

// ── FORMAT ──

export function fmtScore(n) { return n % 1 === 0 ? String(n) : n.toFixed(1) }

export function formatStat(key, val) {
  if (val === null || val === undefined) return '—'
  if (key === 'score' || key === 'avgScore') return fmtScore(+val)
  if (key === 'baseScore') return String(val)
  if (key === 'upsetScore') return val % 1 === 0 ? val : val.toFixed(1)
  if (key === 'drawsPlayed') return val
  if (key === 'drawAcc' || key === 'matchAcc') return Math.round(val * 100) + '%'
  if (key === 'drawHealth') return Math.round(val * 100) + '%'
  if (key === 'matchYield' || key === 'avgMatchYield' || key === 'totalMatchYield') return val >= 0 ? '+' + val : '−' + Math.abs(val)
  if (key === 'slamIndex' || key === 'avgSlamIndex') return val
  return val
}
