// Leaderboard — Chat 3

import { supabase } from './supabase.js'
import { state, activeDraw } from './state.js'
import { calcStats } from './scoring.js'
import { slamLabel, slamKey } from './data.js'

// ── MODULE STATE ──
let profiles = null          // Profile[] — cached after first fetch
let lbView = 'slam'         // 'slam' | 'alltime'
let lbSort = { col: 'score', dir: -1 }  // dir: 1 = asc, -1 = desc
let statsCache = new Map()  // drawDbId → { userId: stats }

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
    .select('user_id, match_id, pick, original_pick, result, high_confidence, edited_after_lock')
    .eq('draw_id', drawDbId)
  if (error) throw error
  return data || []
}

// Build a Draw object for a given user by swapping their picks onto an existing draw's match structure.
// Does NOT re-fetch matches — reuses baseDraw.rounds.
function assembleDrawForUser(baseDraw, userPickRows) {
  const pickMap = {}
  userPickRows.forEach(p => { pickMap[p.match_id] = p })

  const rounds = baseDraw.rounds.map(r => ({
    ...r,
    matches: r.matches.map(m => {
      const pk = m.db_id ? (pickMap[m.db_id] || {}) : {}
      return {
        ...m,
        pick: pk.pick ?? null,
        originalPick: pk.original_pick ?? null,
        result: pk.result ?? null,
        highConfidence: pk.high_confidence ?? false,
        editedAfterLock: pk.edited_after_lock ?? false,
      }
    }),
  }))
  return { ...baseDraw, rounds }
}

// Returns { userId: { score, drawAcc, matchAcc, drawHealth } }
export async function loadDrawStatsForAllUsers(baseDraw) {
  const cached = statsCache.get(baseDraw.db_id)
  if (cached) return cached

  const [allPicks, profs] = await Promise.all([
    loadAllPicksForDraw(baseDraw.db_id),
    loadAllProfiles(),
  ])

  // Group picks by user_id
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
      drawAcc: origRes > 0 ? s.cDrawOrig / origRes : null,
      matchAcc: allRes > 0 ? (s.cOrig + s.cBackup) / allRes : null,
      drawHealth: s.maxHealthPts > 0 ? s.reachableHealthPts / s.maxHealthPts : null,
      hasAnyPicks: s.filled > 0,
    }
  })

  statsCache.set(baseDraw.db_id, result)
  return result
}

// Load another user's picks into state.draws[activeTab].
// Only replaces pick fields — match/winner data is untouched.
export async function loadViewerPicks(userId) {
  const d = activeDraw()
  if (!d) return
  const allPicks = await loadAllPicksForDraw(d.db_id)
  const userPicks = allPicks.filter(p => p.user_id === userId)
  const assembled = assembleDrawForUser(d, userPicks)
  state.draws[state.activeTab] = assembled
}

// ── RENDER ──

export async function renderLeaderboard() {
  statsCache.clear() // always refresh on each navigate

  const screen = document.getElementById('screen-leaderboard')
  if (!screen) return

  // Replace lb-placeholder with lb-root if not yet done
  let lbRoot = screen.querySelector('.lb-root')
  if (!lbRoot) {
    const ph = screen.querySelector('.lb-placeholder')
    if (ph) ph.remove()
    lbRoot = document.createElement('div')
    lbRoot.className = 'lb-root'
    screen.appendChild(lbRoot)
  }

  lbRoot.innerHTML = '<div class="lb-loading">Loading…</div>'

  try {
    const profs = await loadAllProfiles()
    lbRoot.innerHTML = ''

    // Toolbar
    const toolbar = document.createElement('div')
    toolbar.className = 'lb-toolbar'

    // Slam context label
    const d = activeDraw()
    const contextLabel = document.createElement('span')
    contextLabel.className = 'lb-context'
    contextLabel.textContent = d ? slamLabel(d) : 'All Draws'
    toolbar.appendChild(contextLabel)

    // View toggle
    const toggle = document.createElement('div')
    toggle.className = 'lb-view-toggle'
    ;[{ key: 'slam', label: 'This Slam' }, { key: 'alltime', label: 'All-Time' }].forEach(({ key, label }) => {
      const btn = document.createElement('button')
      btn.className = 'lb-toggle-btn' + (lbView === key ? ' active' : '')
      btn.textContent = label
      btn.addEventListener('click', () => {
        if (lbView === key) return
        lbView = key
        lbSort = { col: lbView === 'slam' ? 'score' : 'avgScore', dir: -1 }
        renderLeaderboard()
      })
      toggle.appendChild(btn)
    })
    toolbar.appendChild(toggle)
    lbRoot.appendChild(toolbar)

    // Content
    const content = document.createElement('div')
    content.className = 'lb-content'
    lbRoot.appendChild(content)

    if (lbView === 'slam') {
      await renderSlamView(content, profs)
    } else {
      await renderAllTimeView(content, profs)
    }
  } catch (err) {
    console.error('Leaderboard error:', err)
    lbRoot.innerHTML = `<div class="lb-error">Failed to load leaderboard: ${err.message}</div>`
  }
}

// ── SLAM VIEW ──

async function renderSlamView(container, profs) {
  const d = activeDraw()
  if (!d) {
    container.innerHTML = '<div class="lb-empty">No draw selected.</div>'
    return
  }

  // Get all draws for the current slam key (MS + WS)
  const key = slamKey(d)
  const slamDraws = state.draws.filter(x => slamKey(x) === key)

  if (slamDraws.length === 0) {
    container.innerHTML = '<div class="lb-empty">No draws available.</div>'
    return
  }

  for (const draw of slamDraws) {
    const section = document.createElement('div')
    section.className = 'lb-section'

    const sectionTitle = document.createElement('div')
    sectionTitle.className = 'lb-section-title'
    sectionTitle.textContent = draw.draw === 'MS' ? "Men's Singles" : "Women's Singles"
    section.appendChild(sectionTitle)

    const statsMap = await loadDrawStatsForAllUsers(draw)

    const cols = [
      { key: 'name',        label: 'Player',          sortable: false },
      { key: 'score',       label: 'Score',           sortable: true },
      { key: 'drawAcc',     label: 'Draw Acc',        sortable: true },
      { key: 'matchAcc',    label: 'Match Acc',       sortable: true },
      { key: 'drawHealth',  label: 'Draw Health',     sortable: true },
    ]

    section.appendChild(buildTable(cols, profs, statsMap, draw))
    container.appendChild(section)
  }
}

// ── ALL-TIME VIEW ──

async function renderAllTimeView(container, profs) {
  if (state.draws.length === 0) {
    container.innerHTML = '<div class="lb-empty">No draws uploaded yet.</div>'
    return
  }

  // Load stats for every draw
  const allStatsMaps = await Promise.all(state.draws.map(d => loadDrawStatsForAllUsers(d)))

  // Aggregate per user
  const aggMap = {}
  profs.forEach(prof => {
    let totalScore = 0, drawAccNum = 0, drawAccDen = 0
    let matchAccNum = 0, matchAccDen = 0
    let drawsPlayed = 0

    allStatsMaps.forEach(statsMap => {
      const s = statsMap[prof.id]
      if (!s || !s.hasAnyPicks) return
      drawsPlayed++
      totalScore += s.score
      if (s.drawAcc !== null) { drawAccNum += s.drawAcc; drawAccDen++ }
      if (s.matchAcc !== null) { matchAccNum += s.matchAcc; matchAccDen++ }
    })

    aggMap[prof.id] = {
      drawsPlayed,
      avgScore: drawsPlayed > 0 ? Math.round(totalScore / drawsPlayed) : null,
      drawAcc: drawAccDen > 0 ? drawAccNum / drawAccDen : null,
      matchAcc: matchAccDen > 0 ? matchAccNum / matchAccDen : null,
      hasAnyPicks: drawsPlayed > 0,
    }
  })

  const cols = [
    { key: 'name',        label: 'Player',      sortable: false },
    { key: 'drawsPlayed', label: 'Draws',        sortable: true },
    { key: 'avgScore',    label: 'Avg Score',    sortable: true },
    { key: 'drawAcc',     label: 'Draw Acc',     sortable: true },
    { key: 'matchAcc',    label: 'Match Acc',    sortable: true },
  ]

  const section = document.createElement('div')
  section.className = 'lb-section'
  section.appendChild(buildTable(cols, profs, aggMap, null))
  container.appendChild(section)
}

// ── TABLE BUILDER ──

function buildTable(cols, profs, statsMap, draw) {
  const sortKey = lbSort.col

  // Sort profiles
  const sorted = [...profs].sort((a, b) => {
    const sa = statsMap[a.id] || {}
    const sb = statsMap[b.id] || {}
    const va = sa[sortKey] ?? -Infinity
    const vb = sb[sortKey] ?? -Infinity
    if (va === vb) return 0
    return (va < vb ? -1 : 1) * lbSort.dir * -1
  })

  const table = document.createElement('div')
  table.className = 'lb-table'

  // Header row
  const hdr = document.createElement('div')
  hdr.className = 'lb-row lb-header-row'
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
        if (lbSort.col === col.key) {
          lbSort.dir *= -1
        } else {
          lbSort.col = col.key
          lbSort.dir = -1
        }
        renderLeaderboard()
      })
    }
    hdr.appendChild(cell)
  })
  table.appendChild(hdr)

  // Data rows
  sorted.forEach((prof, rank) => {
    const s = statsMap[prof.id] || {}
    const row = document.createElement('div')
    row.className = 'lb-row' + (rank % 2 === 1 ? ' lb-row-alt' : '')
    if (prof.id === state.currentUser?.id) row.classList.add('lb-row-self')

    cols.forEach(col => {
      const cell = document.createElement('div')
      cell.className = 'lb-cell lb-cell-' + col.key

      if (col.key === 'name') {
        const nameEl = document.createElement('span')
        nameEl.className = 'lb-player-name'
        nameEl.textContent = prof.display_name
        // Clicking name opens their bracket in viewer mode
        if (draw && prof.id !== state.currentUser?.id) {
          nameEl.classList.add('lb-player-link')
          nameEl.addEventListener('click', () => openViewer(prof, draw))
        }
        cell.appendChild(nameEl)
        const rankEl = document.createElement('span')
        rankEl.className = 'lb-rank'
        rankEl.textContent = '#' + (rank + 1)
        cell.appendChild(rankEl)
      } else {
        cell.textContent = formatStat(col.key, s[col.key])
        if (!s.hasAnyPicks) cell.style.color = 'var(--text3)'
      }

      row.appendChild(cell)
    })
    table.appendChild(row)
  })

  return table
}

// ── VIEWER ──

async function openViewer(prof, draw) {
  // Switch to the right draw if needed
  const targetIdx = state.draws.indexOf(draw)
  if (targetIdx >= 0 && targetIdx !== state.activeTab) {
    state.activeTab = targetIdx
  }

  state.viewingUser = prof

  // Swap picks in the active draw
  await loadViewerPicks(prof.id)

  // Show viewer banner
  const banner = document.getElementById('viewer-banner')
  const bannerText = document.getElementById('viewer-banner-text')
  if (banner) banner.style.display = 'flex'
  if (bannerText) bannerText.textContent = "Viewing " + prof.display_name + "'s bracket"

  // Render bracket in read-only mode and switch screen
  const { renderBracket } = await import('./bracket.js')
  const { renderStats } = await import('./stats.js')
  const { applyTheme } = await import('./state.js')
  applyTheme(draw.slam)
  renderStats()
  renderBracket()
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById('screen-bracket')?.classList.add('active')
}

// ── FORMAT HELPERS ──

function formatStat(key, val) {
  if (val === null || val === undefined) return '—'
  if (key === 'score' || key === 'avgScore') return val
  if (key === 'drawsPlayed') return val
  if (key === 'drawAcc' || key === 'matchAcc') return Math.round(val * 100) + '%'
  if (key === 'drawHealth') return Math.round(val * 100) + '%'
  return val
}
