// Records tab — trophy room layout.
// Redesigned 2026-07-18: shrinkage-adjusted Slam Index standings replace the old
// averaged-stat podium. Simplified same day (Ben's follow-up): dropped the
// raw/vs.-chalk toggle entirely (it was just measuring how well always-picking-
// chalk does, and everyone's negative on it — not an interesting stat) and
// dropped the 3-badge honors row (Highest Single Draw Yield / Best Match Pick
// Value / Biggest Upset) from the middle of the page. Best Slam Index Ever
// stays, now clickable to a top-10 list. The personal-best tables became
// pool-wide Top 10 tables (same player can appear more than once) rather than
// one-row-per-player. Best Match Pick Value moved to the Slams tab (see
// leaderboard-roi-chip.js) since it's a career/summative stat, not specific to
// this trophy-room page. See .claude/rules/leaderboard-records-redesign.md.
// Data/aggregation helpers live in leaderboard-records-data.js; this file is
// render-only.

import { state } from './state.js'
import { SLAM_CONFIG } from './data.js'
import { supabase } from './supabase.js'
// Circular in ESM is fine: all are function calls, not top-level init
import { loadDrawStatsForAllUsers, fmtScore } from './leaderboard.js'
import {
  buildAllTimeAgg, buildAllBrackets, topByKey, buildShrinkageStandings, computePoolMeanIndex,
} from './leaderboard-records-data.js'

// ── MODULE STATE ──
let recPeriod    = 'all'
let _recHintOpen = false

let _recContainer    = null
let _recProfs        = null
let _recAllDraws     = null
let _recAllStatsMaps = null
let _recYears        = null
let _recContentEl    = null
let _recKActive      = 5 // k_active from shrinkage_k, defaulting to 5 if the table is missing/empty — see .claude/rules/slam-index.md

// ── CONSTANTS ──
const TOP_N = 10

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
  _recAllDraws     = state.draws.filter(d => !d.excludeFromLeaderboard && d.locked)
  if (_recAllDraws.length === 0) {
    container.innerHTML = '<div class="lb-empty">No completed draws yet.</div>'
    return
  }
  const [statsMaps, kRow] = await Promise.all([
    Promise.all(_recAllDraws.map(d => loadDrawStatsForAllUsers(d))),
    supabase.from('shrinkage_k').select('k_active').eq('id', 1).maybeSingle(),
  ])
  _recAllStatsMaps = statsMaps
  _recKActive      = kRow?.data?.k_active ?? 5
  _recYears        = [...new Set(_recAllDraws.map(d => d.year))].sort((a, b) => b - a)
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
    ? _recAllDraws
    : _recAllDraws.filter(d => d.year === recPeriod)
  const periodMaps    = periodDraws.map(d => _recAllStatsMaps[_recAllDraws.indexOf(d)])
  const agg           = buildAllTimeAgg(_recProfs, periodDraws, periodMaps)
  const brackets      = buildAllBrackets(_recProfs, periodDraws, periodMaps)
  // Anchor is the pool's own mean for whatever period is in view (all-time or one
  // year) — not a hardcoded 100. See shrinkSlamIndex (scoring.js) / computePoolMeanIndex.
  const standings     = buildShrinkageStandings(_recProfs, agg, computePoolMeanIndex(brackets), _recKActive)
  const topSlamIndex  = topByKey(brackets, 'slamIndex', TOP_N)
  const topDrawYield  = topByKey(brackets, 'score', TOP_N)
  const topMatchYield = topByKey(brackets, 'matchYield', TOP_N)

  content.appendChild(buildSlamIndexSectionHeader())
  if (standings.length >= 3) content.appendChild(buildPodium(standings))
  content.appendChild(buildTopTenSection(topSlamIndex, topDrawYield, topMatchYield))

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

// ── PODIUM (shrinkage-adjusted Slam Index) ──

function buildPodium(standings) {
  const top3 = standings.slice(0, 3)

  const wrap = document.createElement('div')
  wrap.className = 'rec-podium'

  // Visual order: rank2 left, rank1 center, rank3 right
  ;[[top3[1], 2], [top3[0], 1], [top3[2], 3]].forEach(([entry, rank]) => {
    if (!entry) return
    const block = document.createElement('div')
    block.className = 'rec-pod-block' + (rank === 1 ? ' rec-pod-top' : '')

    const nameEl = document.createElement('div')
    nameEl.className = 'rec-pod-name' + (entry.prof.id === state.currentUser?.id ? ' rec-pod-you' : '')
    nameEl.dataset.id = entry.prof.id
    nameEl.textContent = entry.prof.display_name

    const sub = document.createElement('div')
    sub.className = 'rec-pod-stat'
    sub.textContent = `INDEX ${Math.round(entry.shown)} · ${entry.n} DRAW${entry.n !== 1 ? 'S' : ''}`

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

// ── SLAM INDEX SECTION HEADER + SHRINKAGE HINT ──
// The hint lives here — a standalone header ABOVE the podium/standings block —
// rather than inside the standings table's header cell (where it originally
// shipped). `.rec-standings-wrap` needs `overflow:hidden` so row backgrounds
// respect its rounded corners, which was silently clipping the expanded hint
// box. Moving the hint to an unclipped ancestor fixes that outright, rather
// than fighting the table's own overflow requirement. Not the shared
// `#stats-drawer` (`.claude/rules/ui-detail.md`) — that drawer is scoped to the
// current slam's Slam Index, not this all-time aggregate. See
// .claude/rules/leaderboard-records-redesign.md "Correction from the original
// brief."

function buildSlamIndexSectionHeader() {
  const hdr = document.createElement('div')
  hdr.className = 'rec-si-hdr'

  const label = document.createElement('span')
  label.className = 'rec-si-title'
  label.textContent = 'ADJUSTED CAREER INDEX'
  hdr.appendChild(label)

  const wrap = document.createElement('span')
  wrap.className = 'rec-hint-wrap'

  const btn = document.createElement('button')
  btn.className = 'rec-hint-btn'
  btn.textContent = 'ⓘ'
  btn.setAttribute('aria-expanded', String(_recHintOpen))
  wrap.appendChild(btn)

  const box = document.createElement('div')
  box.className = 'rec-hint-box' + (_recHintOpen ? ' open' : '')
  box.innerHTML = `<div class="rec-hint-def">Career-average Slam Index, weighted
    toward the pool average for players with fewer draws.</div>`
  wrap.appendChild(box)

  btn.addEventListener('click', e => {
    e.stopPropagation()
    _recHintOpen = !_recHintOpen
    _rerenderContent()
  })

  hdr.appendChild(wrap)
  return hdr
}

// ── TOP 10 ALL-TIME: SLAM INDEX / DRAW YIELD / MATCH YIELD (pool-wide
// single-draw performances — same player can appear more than once) ──

function buildTopTenSection(topSlamIndex, topDrawYield, topMatchYield) {
  const section = document.createElement('div')
  section.className = 'rec-pb-section'

  const hdr = document.createElement('div')
  hdr.className = 'rec-pb-section-hdr'
  const label = document.createElement('span')
  label.className = 'rec-pb-section-title'
  label.textContent = 'TOP 10 ALL-TIME'
  hdr.appendChild(label)
  section.appendChild(hdr)

  section.appendChild(buildTopTenTable('SLAM INDEX', topSlamIndex, 'slamIndex'))

  const grid = document.createElement('div')
  grid.className = 'rec-pb-grid'
  grid.appendChild(buildTopTenTable('DRAW YIELD', topDrawYield, 'score'))
  grid.appendChild(buildTopTenTable('MATCH YIELD', topMatchYield, 'matchYield'))
  section.appendChild(grid)

  return section
}

function buildTopTenTable(title, entries, statKey) {
  const wrap = document.createElement('div')
  wrap.className = 'rec-pb-table-wrap'
  const hdr = document.createElement('div')
  hdr.className = 'rec-pb-table-title'
  hdr.textContent = title
  wrap.appendChild(hdr)

  if (!entries.length) { wrap.appendChild(mkEmpty()); return wrap }

  entries.forEach((e, rank) => {
    const row = document.createElement('div')
    row.className = 'rec-pb-row' + (rank % 2 === 1 ? ' lb-row-alt' : '')

    const rnk = document.createElement('div')
    rnk.className = 'rec-pb-rank'
    rnk.textContent = rank + 1
    row.appendChild(rnk)

    const cfg = SLAM_CONFIG[e.draw.slam] || {}
    const nameCell = document.createElement('div')
    nameCell.className = 'rec-pb-name lb-player-name'
    nameCell.textContent = e.prof.display_name
    row.appendChild(nameCell)

    // Draw tag sits next to the score (not stacked under the name) — the
    // tables are wide enough for it, and this matches the old single-line
    // card format ("player · slam year draw · value") this replaced.
    const valGroup = document.createElement('div')
    valGroup.className = 'rec-pb-val-group'
    const subEl = document.createElement('span')
    subEl.className = 'rec-pb-sub'
    subEl.textContent = `${cfg.name || e.draw.slam} ${e.draw.year} ${e.draw.draw}`
    const dotEl = document.createElement('span')
    dotEl.className = 'rec-pb-dot'
    dotEl.textContent = '·'
    const valEl = document.createElement('span')
    valEl.className = 'rec-pb-val'
    valEl.textContent = fmtScore(e[statKey])
    valGroup.append(subEl, dotEl, valEl)
    row.appendChild(valGroup)

    wrap.appendChild(row)
  })

  return wrap
}

// ── UTILS ──

function mkEmpty() {
  const el = document.createElement('div')
  el.className = 'rec-honor-empty'
  el.textContent = '—'
  return el
}
