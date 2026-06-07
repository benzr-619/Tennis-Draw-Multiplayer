// Leaderboard — Chat 6 refinements

import { supabase } from './supabase.js'
import { state } from './state.js'
import { calcStats } from './scoring.js'
import { slamKey, SLAM_CONFIG } from './data.js'
import { buildDrawView } from './draw-view.js'
import { animateSegThumb } from './seg-thumb.js'

// ── CONSTANTS ──

const SLAM_COLORS = {
  AO:  '#2d7ab8',
  RG:  '#BD5627',
  WIM: '#275F3D',
  USO: '#071C63',
}

// ── MODULE STATE ──

let lbTab = 'slams'            // 'slams' | 'records' | 'yourdraws'
let _lbTabPrevIdx = -1         // tracks previous tab index for slide animation
let lbDetailDraw = null        // Draw | null — when set, show full-width draw detail
let lbSort = { col: 'score', dir: -1 }
let statsCache = new Map()     // drawDbId → { userId: stats }
let profiles = null

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

async function loadAllPicksForDraw(drawDbId) {
  const { data, error } = await supabase
    .from('picks')
    .select('user_id, match_id, match_pick, original_pick, original_pick_result, match_pick_result, high_confidence, edited_after_lock')
    .eq('draw_id', drawDbId)
  if (error) throw error
  return data || []
}

// Assembles a draw using the user's current picks, then re-derives all slot/elim state.
function assembleDrawForUser(baseDraw, userPickRows) {
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

// Assembles a draw using original_pick as pick — for the leaderboard bracket viewer.
// Pass 1: stamps pick fields and saves actual p1/p2 per match (viewer-specific).
// buildDrawView then re-derives all slot/elim/label state from the stamped picks.
// actualP1/actualP2 survive because buildDrawView never touches custom fields.
function assembleDrawForUserOriginalPicks(baseDraw, userPickRows) {
  const pickMap = {}
  userPickRows.forEach(p => { pickMap[p.match_id] = p })

  // Build name→seed lookup from R1 (seeds only exist there)
  const seedMap = {}
  baseDraw.rounds[0]?.matches.forEach(m => {
    if (m.p1?.name) seedMap[m.p1.name] = m.p1.seed || ''
    if (m.p2?.name) seedMap[m.p2.name] = m.p2.seed || ''
  })

  // Pass 1: stamp pick fields; save actual p1/p2 from baseDraw; compute actualP1/P2
  // for ri 1+ from feeder winners (DB doesn't store p1_name/p2_name for R2+).
  const rounds = baseDraw.rounds.map((r, ri) => ({
    ...r,
    matches: r.matches.map((m, mi) => {
      const pk = m.db_id ? (pickMap[m.db_id] || {}) : {}
      // For ri 1+: actual players are whoever won each feeder match.
      // For ri 0: actual players are the draw's own p1/p2.
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
        // Use original_pick as the projected pick so buildDrawView slots it correctly.
        matchPick: pk.original_pick ?? pk.match_pick ?? null,
        originalPick: pk.original_pick ?? null,
        originalPickResult: pk.original_pick_result ?? null,
        matchPickResult: pk.match_pick_result ?? null,
        highConfidence: pk.high_confidence ?? false,
        editedAfterLock: false,
      }
    }),
  }))

  // Viewer mode: slots derive from the friend's originalPick (NOT the actual
  // winner), so the card shows who they picked; eliminations still come from real
  // results via actualP1/actualP2. The real occupant floats outside via placeViewerCard.
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
    result[prof.id] = {
      score: Math.round(s.baseScore + s.skillBonus),
      baseScore: Math.round(s.baseScore),
      upsetScore: parseFloat(s.skillBonus.toFixed(1)),
      drawAcc: origRes > 0 ? s.cDrawOrig / origRes : null,
      matchAcc: allRes > 0 ? (s.cOrig + s.cBackup) / allRes : null,
      drawHealth: s.maxHealthPts > 0 ? s.reachableHealthPts / s.maxHealthPts : null,
      hasAnyPicks: s.filled > 0,
    }
  })

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
      await renderRecordsTab(content, profs)
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
    { key: 'score',      label: 'Score',      sortable: true },
    { key: 'baseScore',  label: 'Base Pts',   sortable: true },
    { key: 'upsetScore', label: 'Upset Pts',  sortable: true },
    { key: 'drawAcc',    label: 'Draw %',     sortable: true },
    { key: 'drawHealth', label: 'Health',     sortable: true },
    { key: 'matchAcc',   label: 'Match %',    sortable: true },
  ]

  const tableWrap = document.createElement('div')
  tableWrap.className = 'lb-detail-table-wrap'
  tableWrap.appendChild(buildDetailTable(cols, profs, statsMap, draw))
  content.appendChild(tableWrap)
}

// ── SLAMS TAB ──

async function renderSlamsTab(container, profs) {
  if (state.draws.length === 0) {
    container.innerHTML = '<div class="lb-empty">No draws uploaded yet.</div>'
    return
  }

  // Group by slam+year
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

  for (const group of sorted) {
    const groupEl = document.createElement('div')
    groupEl.className = 'lb-slam-group'

    const groupHdr = document.createElement('div')
    groupHdr.className = 'lb-slam-header'
    const nameEl = document.createElement('span')
    nameEl.className = 'lb-slam-name'
    nameEl.textContent = SLAM_CONFIG[group.slam]?.name || group.slam
    const yearEl = document.createElement('span')
    yearEl.className = 'lb-slam-year'
    yearEl.textContent = group.year
    groupHdr.appendChild(nameEl)
    groupHdr.appendChild(yearEl)
    groupEl.appendChild(groupHdr)

    const mwRow = document.createElement('div')
    mwRow.className = 'lb-mw-row'

    const color = SLAM_COLORS[group.slam] || 'var(--border)'
    for (const draw of group.draws) {
      const statsMap = await loadDrawStatsForAllUsers(draw)
      mwRow.appendChild(buildSlamCard(draw, profs, statsMap, color))
    }

    groupEl.appendChild(mwRow)
    container.appendChild(groupEl)
  }
}

// Card for Slams tab: score + health only, no sort, fully clickable → detail view
function buildSlamCard(draw, profs, statsMap, color) {
  const card = document.createElement('div')
  card.className = 'lb-draw-card lb-draw-card-clickable'
  card.style.setProperty('--lb-slam-color', color)

  const drawTypeLabel = draw.draw === 'MS' ? "Men's Singles" : "Women's Singles"

  const cardHdr = document.createElement('div')
  cardHdr.className = 'lb-draw-card-header'
  const labelEl = document.createElement('span')
  labelEl.className = 'lb-draw-label'
  labelEl.textContent = drawTypeLabel
  const expandEl = document.createElement('span')
  expandEl.className = 'lb-draw-expand'
  expandEl.textContent = 'All stats →'
  cardHdr.appendChild(labelEl)
  cardHdr.appendChild(expandEl)
  card.appendChild(cardHdr)

  // Sort by score descending (fixed, not user-controllable)
  const sortedProfs = [...profs]
    .filter(p => statsMap[p.id]?.hasAnyPicks)
    .sort((a, b) => (statsMap[b.id]?.score ?? -Infinity) - (statsMap[a.id]?.score ?? -Infinity))

  const table = document.createElement('div')
  table.className = 'lb-table'

  // Header
  const hdr = document.createElement('div')
  hdr.className = 'lb-row lb-row-card lb-header-row'
  ;['Player', 'Score', 'Health'].forEach((label, i) => {
    const cell = document.createElement('div')
    cell.className = 'lb-cell' + (i === 0 ? ' lb-cell-name' : i === 1 ? ' lb-cell-score' : ' lb-cell-health')
    cell.textContent = label
    hdr.appendChild(cell)
  })
  table.appendChild(hdr)

  sortedProfs.forEach((prof, rank) => {
    const s = statsMap[prof.id] || {}
    const row = document.createElement('div')
    row.className = 'lb-row lb-row-card' + (rank % 2 === 1 ? ' lb-row-alt' : '')
    if (prof.id === state.currentUser?.id) row.classList.add('lb-row-self')

    // Name cell — clickable to open bracket viewer
    const nameCell = document.createElement('div')
    nameCell.className = 'lb-cell lb-cell-name'
    const rankEl = document.createElement('span')
    rankEl.className = 'lb-rank'
    rankEl.textContent = '#' + (rank + 1)
    const nameEl = document.createElement('span')
    nameEl.className = 'lb-player-name lb-player-link'
    nameEl.textContent = prof.display_name
    nameEl.addEventListener('click', (e) => {
      e.stopPropagation()  // don't trigger card click
      openViewerOriginalPicks(prof, draw)
    })
    nameCell.appendChild(rankEl)
    nameCell.appendChild(nameEl)
    row.appendChild(nameCell)

    // Score
    const scoreCell = document.createElement('div')
    scoreCell.className = 'lb-cell lb-cell-score'
    scoreCell.textContent = formatStat('score', s.score)
    row.appendChild(scoreCell)

    // Health
    const healthCell = document.createElement('div')
    healthCell.className = 'lb-cell lb-cell-health'
    healthCell.textContent = formatStat('drawHealth', s.drawHealth)
    row.appendChild(healthCell)

    table.appendChild(row)
  })

  card.appendChild(table)

  // Clicking the card (but not a player name) → draw detail view
  card.addEventListener('click', () => {
    lbDetailDraw = draw
    lbSort = { col: 'score', dir: -1 }
    renderLeaderboard()
  })

  return card
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

// ── RECORDS TAB ──

async function renderRecordsTab(container, profs) {
  if (state.draws.length === 0) {
    container.innerHTML = '<div class="lb-empty">No draws uploaded yet.</div>'
    return
  }

  const allStatsMaps = await Promise.all(state.draws.map(d => loadDrawStatsForAllUsers(d)))

  const allTimeAgg = buildAllTimeAgg(profs, state.draws, allStatsMaps)
  const allBrackets = buildAllBrackets(profs, state.draws, allStatsMaps)
  const years = [...new Set(state.draws.map(d => d.year))].sort((a, b) => b - a)

  // All-Time section
  const allTimeSection = document.createElement('div')
  allTimeSection.className = 'lb-records-section'
  const allTimeLabel = document.createElement('div')
  allTimeLabel.className = 'lb-records-section-label'
  allTimeLabel.textContent = 'All Time'
  allTimeSection.appendChild(allTimeLabel)
  const allTimeCards = document.createElement('div')
  allTimeCards.className = 'lb-records-cards'
  allTimeCards.appendChild(buildRecCard('Avg Score', profs, allTimeAgg, 'avgScore', true))
  allTimeCards.appendChild(buildRecCard('Match Accuracy', profs, allTimeAgg, 'matchAcc', true))
  allTimeCards.appendChild(buildTopBracketsCard(profs, allBrackets))
  allTimeSection.appendChild(allTimeCards)
  container.appendChild(allTimeSection)

  // Per-year sections
  for (const year of years) {
    const yearDraws = state.draws.filter(d => d.year === year)
    const yearStatsMaps = yearDraws.map(d => allStatsMaps[state.draws.indexOf(d)])
    const yearAgg = buildAllTimeAgg(profs, yearDraws, yearStatsMaps)
    const yearBrackets = buildAllBrackets(profs, yearDraws, yearStatsMaps)

    const yearSection = document.createElement('div')
    yearSection.className = 'lb-records-section'

    const divider = document.createElement('div')
    divider.className = 'lb-year-divider'
    const yearLbl = document.createElement('span')
    yearLbl.className = 'lb-year-label'
    yearLbl.textContent = year === new Date().getFullYear() ? 'This Year' : year
    const line = document.createElement('span')
    line.className = 'lb-year-line'
    divider.appendChild(yearLbl)
    divider.appendChild(line)
    yearSection.appendChild(divider)

    const yearCards = document.createElement('div')
    yearCards.className = 'lb-records-cards'
    yearCards.appendChild(buildRecCard('Avg Score', profs, yearAgg, 'avgScore', true))
    yearCards.appendChild(buildRecCard('Match Accuracy', profs, yearAgg, 'matchAcc', true))
    yearCards.appendChild(buildTopBracketsCard(profs, yearBrackets))
    yearSection.appendChild(yearCards)
    container.appendChild(yearSection)
  }
}

function buildAllTimeAgg(profs, draws, statsMaps) {
  const agg = {}
  profs.forEach(prof => {
    let totalScore = 0, matchAccNum = 0, matchAccDen = 0, drawsPlayed = 0
    statsMaps.forEach(statsMap => {
      const s = statsMap[prof.id]
      if (!s || !s.hasAnyPicks) return
      drawsPlayed++
      totalScore += s.score
      if (s.matchAcc !== null) { matchAccNum += s.matchAcc; matchAccDen++ }
    })
    agg[prof.id] = {
      drawsPlayed,
      avgScore: drawsPlayed > 0 ? Math.round(totalScore / drawsPlayed) : null,
      matchAcc: matchAccDen > 0 ? matchAccNum / matchAccDen : null,
      hasAnyPicks: drawsPlayed > 0,
    }
  })
  return agg
}

function buildAllBrackets(profs, draws, statsMaps) {
  const brackets = []
  draws.forEach((draw, i) => {
    const statsMap = statsMaps[i]
    profs.forEach(prof => {
      const s = statsMap[prof.id]
      if (!s || !s.hasAnyPicks) return
      brackets.push({ prof, draw, score: s.score })
    })
  })
  brackets.sort((a, b) => b.score - a.score)
  return brackets
}

// ── RECORDS CARD BUILDERS ──

// showSampleSize: whether to show drawsPlayed sub-label per row
function buildRecCard(title, profs, aggMap, statKey, showSampleSize) {
  const card = document.createElement('div')
  card.className = 'lb-rec-card'

  const hdr = document.createElement('div')
  hdr.className = 'lb-rec-card-header'
  const titleEl = document.createElement('span')
  titleEl.className = 'lb-rec-card-title'
  titleEl.textContent = title
  hdr.appendChild(titleEl)
  card.appendChild(hdr)

  const sorted = [...profs]
    .filter(p => aggMap[p.id]?.hasAnyPicks)
    .sort((a, b) => {
      const va = aggMap[a.id]?.[statKey] ?? -Infinity
      const vb = aggMap[b.id]?.[statKey] ?? -Infinity
      return vb - va
    })

  let showAll = false
  const tableWrap = document.createElement('div')

  const renderRows = () => {
    tableWrap.innerHTML = ''
    const list = showAll ? sorted : sorted.slice(0, 3)
    list.forEach((prof, i) => {
      const s = aggMap[prof.id] || {}
      const row = document.createElement('div')
      row.className = 'lb-rec-row' + (prof.id === state.currentUser?.id ? ' lb-rec-row-self' : '')

      const pos = document.createElement('span')
      pos.className = 'lb-rec-pos'
      pos.textContent = '#' + (i + 1)

      const nameWrap = document.createElement('div')
      const name = document.createElement('div')
      name.className = 'lb-rec-name'
      name.textContent = prof.display_name
      nameWrap.appendChild(name)
      if (showSampleSize && s.drawsPlayed) {
        const sub = document.createElement('div')
        sub.className = 'lb-rec-sub'
        sub.textContent = s.drawsPlayed + (s.drawsPlayed === 1 ? ' draw' : ' draws')
        nameWrap.appendChild(sub)
      }

      const val = document.createElement('span')
      val.className = 'lb-rec-val'
      val.textContent = formatStat(statKey, s[statKey])

      row.appendChild(pos)
      row.appendChild(nameWrap)
      row.appendChild(val)
      tableWrap.appendChild(row)
    })

    if (sorted.length > 3) {
      const toggle = document.createElement('div')
      toggle.style.cssText = 'padding:6px 14px;font-family:var(--mono);font-size:10px;color:var(--text3);cursor:pointer;border-top:1px solid var(--border)'
      toggle.textContent = showAll ? 'Show less ↑' : `Show all ${sorted.length} ↓`
      toggle.addEventListener('click', (e) => { e.stopPropagation(); showAll = !showAll; renderRows() })
      tableWrap.appendChild(toggle)
    }
  }

  renderRows()
  card.appendChild(tableWrap)
  return card
}

function buildTopBracketsCard(profs, brackets) {
  const card = document.createElement('div')
  card.className = 'lb-rec-card'

  const hdr = document.createElement('div')
  hdr.className = 'lb-rec-card-header'
  const titleEl = document.createElement('span')
  titleEl.className = 'lb-rec-card-title'
  titleEl.textContent = 'Top Brackets'
  hdr.appendChild(titleEl)
  card.appendChild(hdr)

  let showAll = false
  const tableWrap = document.createElement('div')

  const renderRows = () => {
    tableWrap.innerHTML = ''
    const list = showAll ? brackets : brackets.slice(0, 3)
    list.forEach((entry, i) => {
      const row = document.createElement('div')
      row.className = 'lb-rec-row lb-rec-row-clickable' + (entry.prof.id === state.currentUser?.id ? ' lb-rec-row-self' : '')

      const pos = document.createElement('span')
      pos.className = 'lb-rec-pos'
      pos.textContent = '#' + (i + 1)

      const nameWrap = document.createElement('div')
      const name = document.createElement('div')
      name.className = 'lb-rec-name'
      name.textContent = entry.prof.display_name
      const sub = document.createElement('div')
      sub.className = 'lb-rec-sub'
      const cfg = SLAM_CONFIG[entry.draw.slam] || {}
      sub.textContent = (cfg.name || entry.draw.slam) + ' ' + entry.draw.year + ' ' + entry.draw.draw
      nameWrap.appendChild(name)
      nameWrap.appendChild(sub)

      const val = document.createElement('span')
      val.className = 'lb-rec-val'
      val.textContent = entry.score

      row.appendChild(pos)
      row.appendChild(nameWrap)
      row.appendChild(val)

      // Click → open original-picks bracket viewer for this bracket
      row.addEventListener('click', () => openViewerOriginalPicks(entry.prof, entry.draw))

      tableWrap.appendChild(row)
    })

    if (brackets.length > 3) {
      const toggle = document.createElement('div')
      toggle.style.cssText = 'padding:6px 14px;font-family:var(--mono);font-size:10px;color:var(--text3);cursor:pointer;border-top:1px solid var(--border)'
      toggle.textContent = showAll ? 'Show less ↑' : `Show all ${brackets.length} ↓`
      toggle.addEventListener('click', (e) => { e.stopPropagation(); showAll = !showAll; renderRows() })
      tableWrap.appendChild(toggle)
    }
  }

  renderRows()
  card.appendChild(tableWrap)
  return card
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

// Opens the dedicated viewer screen showing a user's ORIGINAL picks with outcomes
async function openViewerOriginalPicks(prof, draw) {
  // Assemble the draw with original picks + actuals, store in a module var
  // (does NOT overwrite state.draws — live bracket data stays untouched)
  const allPicks = await loadAllPicksForDraw(draw.db_id)
  const userPicks = allPicks.filter(p => p.user_id === prof.id)
  const viewerDraw = assembleDrawForUserOriginalPicks(draw, userPicks)

  // Populate viewer header
  const cfg = SLAM_CONFIG[draw.slam] || {}
  const drawTypeLabel = draw.draw === 'MS' ? "Men's Singles" : "Women's Singles"
  const nameEl = document.getElementById('viewer-hdr-name-v')
  if (nameEl) nameEl.textContent = prof.display_name
  const drawEl = document.getElementById('viewer-hdr-draw-v')
  if (drawEl) drawEl.textContent = `${cfg.name || draw.slam} ${draw.year} · ${drawTypeLabel}`

  const { renderViewerBracket } = await import('./viewer-bracket.js')
  const { applyTheme } = await import('./state.js')
  applyTheme(draw.slam)
  renderViewerBracket(viewerDraw)

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById('screen-viewer')?.classList.add('active')
}

// ── FORMAT ──

function formatStat(key, val) {
  if (val === null || val === undefined) return '—'
  if (key === 'score' || key === 'avgScore') return val
  if (key === 'baseScore') return val
  if (key === 'upsetScore') return val % 1 === 0 ? val : val.toFixed(1)
  if (key === 'drawsPlayed') return val
  if (key === 'drawAcc' || key === 'matchAcc') return Math.round(val * 100) + '%'
  if (key === 'drawHealth') return Math.round(val * 100) + '%'
  return val
}
