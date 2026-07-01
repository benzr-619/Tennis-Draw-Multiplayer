// Stats bar renderer

import { activeDraw, state, isMobile } from './state.js'
import { calcStatsAsOf, calcChalkScore, isBackupPick, healthHue as _hHue } from './scoring.js'
import { formatYield } from './odds.js'
import { loadDrawStatsForAllUsers } from './leaderboard.js'

let statsRoundFilter = null
let _countdownClickHandler = null
let _poolSlamIndex = null   // current user's Slam Index for the active draw
let _poolFlatROI = null     // current user's flat-stake ROI for the active draw (e.g. 0.45 = +45%)
let _drawerOpen = false
let _drawerMathOpen = null      // id of the open math row (e.g. 'draw-yield')
let _lastDrawId = null          // detect draw change → reset drawer state
let _outsideTouchHandler = null // touchstart handler that closes the drawer when tapping outside

function _removeOutsideTouchHandler() {
  if (_outsideTouchHandler) {
    document.removeEventListener('touchstart', _outsideTouchHandler)
    _outsideTouchHandler = null
  }
}

export function resetStatsFilter() { statsRoundFilter = null }
export function getStatsFilter() { return statsRoundFilter }
export function setCountdownClickHandler(fn) { _countdownClickHandler = fn }

// Fetches pool stats for the active draw, computes Slam Index, caches current user's value.
// Fire-and-forget safe — resolves after Supabase fetch completes.
export async function fetchPoolSlamIndex(draw, userId) {
  _poolSlamIndex = null
  _poolFlatROI = null
  if (!draw || !userId) return
  try {
    const statsMap = await loadDrawStatsForAllUsers(draw)
    _poolSlamIndex = statsMap[userId]?.slamIndex ?? null
    const { flatYield = 0, flatYieldResolved = 0 } = statsMap[userId] ?? {}
    _poolFlatROI = flatYieldResolved > 0 ? flatYield / flatYieldResolved : null
  } catch (_) {
    _poolSlamIndex = null
    _poolFlatROI = null
  }
}

// ── LOCK ICON SVG ──
function _lockSvg() {
  return `<svg width="11" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`
}

// True when the given lock schedule still covers at least one undecided match
// with no matchPick — i.e. there's actually something left for the current
// user to do before it fires. original_picks covers all of round 0.
function _lockHasUnfilled(ls) {
  const draw = state.draws.find(dr => dr.db_id === ls.draw_id)
  if (!draw) return false
  if (ls.lock_type === 'original_picks') {
    return draw.rounds[0]?.matches.some(m => !m.matchPick && !m.winner) ?? false
  }
  if (ls.lock_type === 'backup_picks') {
    const ri = ls.round_index
    if (ri == null || !draw.rounds[ri]) return false
    return draw.rounds[ri].matches.some((m, mi) => {
      const inRange = (ls.match_index_start == null || mi >= ls.match_index_start) &&
                      (ls.match_index_end == null || mi <= ls.match_index_end)
      return inRange && !m.matchPick && !m.winner
    })
  }
  return false
}

// ── COUNTDOWN ELEMENT BUILDER ──
// Returns a countdown Element for the next upcoming lock, or null if none.
// compact=true → slim .sc-countdown element for the new post-lock bar.
// compact=false → .stat-pill.countdown-pill for pre-lock desktop pill.
// mobileIcon=true → stacked label-over-(icon+time) layout for #mobile-countdown-wrap.
export function buildCountdownEl(d, s, { compact = false, mobileIcon = false } = {}) {
  if (!d) return null

  if (!d.locked) {
    const origSched = (state.lockSchedules || []).find(ls =>
      ls.lock_type === 'original_picks' && !ls.locked_at && ls.scheduled_at &&
      new Date(ls.scheduled_at) > new Date() && ls.draw_id === d.db_id
    )
    if (!origSched) return null
    const msLeft = new Date(origSched.scheduled_at) - Date.now()
    const totalMins = Math.max(0, Math.floor(msLeft / 60000))
    const hh = String(Math.floor(totalMins / 60)).padStart(2, '0')
    const mm = String(totalMins % 60).padStart(2, '0')
    const stats = s || calcStatsAsOf(d, null)
    const allFilled = stats.filled === stats.total
    const urgentCls = !allFilled ? ' countdown-urgent' : ''
    const hasEAL = d.rounds[0]?.matches.some(m => m.editedAfterLock && !m.winner)
    const hasClick = !!_countdownClickHandler && (!allFilled || hasEAL)

    if (compact) {
      const el = document.createElement('div')
      el.className = 'sc-countdown' + (hasClick ? ' countdown-clickable' : '') + urgentCls
      el.innerHTML = `<span class="sc-countdown-lbl${urgentCls}">picks lock in</span><span class="sc-countdown-row">${_lockSvg()}<span class="sc-countdown-txt${urgentCls}">${hh}:${mm}</span></span>`
      if (hasClick) el.addEventListener('click', () => _countdownClickHandler(origSched))
      return el
    }

    if (mobileIcon) {
      const el = document.createElement('div')
      el.className = 'stat-pill countdown-pill' + (hasClick ? ' countdown-clickable' : '') + urgentCls
      el.style.cssText = 'flex-direction:column;align-items:flex-end;gap:1px'
      if (hasClick) el.addEventListener('click', () => _countdownClickHandler(origSched))
      const labelHTML = origSched.label ? `<span class="countdown-lbl${urgentCls}">${origSched.label}</span>` : ''
      el.innerHTML = `${labelHTML}<span class="sval countdown-val${urgentCls}" style="display:flex;align-items:center;gap:4px">${_lockSvg()}${hh}:${mm}</span>`
      return el
    }

    const el = document.createElement('div')
    el.className = 'stat-pill countdown-pill' + (hasClick ? ' countdown-clickable' : '') + urgentCls
    el.style.cssText = 'flex-direction:row;align-items:center;gap:10px'
    if (hasClick) el.addEventListener('click', () => _countdownClickHandler(origSched))
    el.innerHTML = `<span class="slbl" style="margin-bottom:0">picks lock in</span><span class="sval countdown-val${urgentCls}">${hh}:${mm}</span>`
    return el
  }

  // Post-lock: next backup picks lock. Priority: has unfilled picks > soonest > current draw's gender.
  const allUpcoming = (state.lockSchedules || [])
    .filter(ls => !ls.locked_at && ls.scheduled_at && new Date(ls.scheduled_at) > new Date())
    .sort((a, b) => {
      const aUnfilled = _lockHasUnfilled(a)
      const bUnfilled = _lockHasUnfilled(b)
      if (aUnfilled !== bUnfilled) return aUnfilled ? -1 : 1
      const diff = new Date(a.scheduled_at) - new Date(b.scheduled_at)
      if (diff !== 0) return diff
      if (a.draw_id === d.db_id && b.draw_id !== d.db_id) return -1
      if (b.draw_id === d.db_id && a.draw_id !== d.db_id) return 1
      return 0
    })
  const upcoming = allUpcoming[0]
  if (!upcoming) return null

  const msLeft = new Date(upcoming.scheduled_at) - Date.now()
  const totalMins = Math.max(0, Math.floor(msLeft / 60000))
  const hh = String(Math.floor(totalMins / 60)).padStart(2, '0')
  const mm = String(totalMins % 60).padStart(2, '0')
  const displayTime = `${hh}h:${mm}m`

  const allFilled = !_lockHasUnfilled(upcoming)
  const urgentCls = !allFilled ? ' countdown-urgent' : ''
  const hasClick = !allFilled && _countdownClickHandler

  if (compact) {
    const el = document.createElement('div')
    el.className = 'sc-countdown' + (hasClick ? ' countdown-clickable' : '') + urgentCls
    const labelStr = upcoming.label || 'next lock'
    el.innerHTML = `<span class="sc-countdown-lbl${urgentCls}">${labelStr}</span><span class="sc-countdown-row">${_lockSvg()}<span class="sc-countdown-txt${urgentCls}">${displayTime}</span></span>`
    if (hasClick) el.addEventListener('click', () => _countdownClickHandler(upcoming))
    return el
  }

  if (mobileIcon) {
    const el = document.createElement('div')
    el.className = 'stat-pill countdown-pill' + (hasClick ? ' countdown-clickable' : '') + urgentCls
    el.style.cssText = 'flex-direction:column;align-items:flex-end;gap:1px'
    if (hasClick) el.addEventListener('click', () => _countdownClickHandler(upcoming))
    const labelHTML = upcoming.label
      ? `<span class="countdown-lbl${urgentCls}" style="font-style:italic">${upcoming.label}</span>`
      : ''
    el.innerHTML = `${labelHTML}<span class="sval countdown-val${urgentCls}" style="display:flex;align-items:center;gap:4px">${_lockSvg()}${displayTime}</span>`
    return el
  }

  const labelText = upcoming.label
    ? `next lock: <span style="font-style:italic">${upcoming.label}</span>`
    : 'next lock'

  const el = document.createElement('div')
  el.className = 'stat-pill countdown-pill' + urgentCls
  el.style.cssText = 'flex-direction:row;align-items:center;gap:10px'
  if (hasClick) {
    el.classList.add('countdown-clickable')
    el.addEventListener('click', () => _countdownClickHandler(upcoming))
  }
  el.innerHTML = `<span class="countdown-lbl${urgentCls}">${labelText}</span><span class="sval countdown-val${urgentCls}">${displayTime}</span>`
  return el
}

function _updateMobileCountdownWrap(d, s) {
  const wrap = document.getElementById('mobile-countdown-wrap')
  if (!wrap) return
  wrap.innerHTML = ''
  const el = buildCountdownEl(d, s, { mobileIcon: true })
  if (el) {
    el.style.borderRight = 'none'
    el.style.padding = '0'
    wrap.appendChild(el)
  }
}

// ── HEALTH UNDERLINE ──
// Lazily creates and returns #health-underline, appended to stats-strip.
function _getOrCreateHealthEl(strip) {
  let el = document.getElementById('health-underline')
  if (!el) {
    el = document.createElement('div')
    el.id = 'health-underline'
    el.className = 'health-underline'
  }
  strip.appendChild(el)
  return el
}

function _updateHealthUnderline(strip, s, hasResult, d) {
  const el = _getOrCreateHealthEl(strip)
  if (!s || !hasResult || s.maxHealthPts === 0) {
    el.style.display = 'none'
    return
  }
  el.style.display = ''
  const pct = Math.max(0, Math.min(100, Math.round(s.reachableHealthPts / s.maxHealthPts * 100)))
  const confirmedCount = d ? d.rounds.reduce((a, r) => a + r.matches.filter(m => m.winner).length, 0) : 0
  const hue = _hHue(pct, confirmedCount / 127, state.healthBands)
  const fillColor = `hsl(${hue},75%,48%)`
  const labelColor = `hsl(${hue},65%,34%)`
  // Clamp label position so it never clips at the edges
  const labelLeft = Math.max(3, Math.min(97, pct))
  el.innerHTML = `
    <div class="health-ul-labels-row">
      <span class="health-ul-pct" style="left:${labelLeft}%;color:${labelColor}">${pct}%</span>
      <span class="health-ul-drw-lbl" style="position:absolute;left:4px;bottom:0">Draw Health</span>
    </div>
    <div class="health-ul-track">
      <div class="health-ul-fill" style="width:${pct}%;background:${fillColor}"></div>
    </div>`
  return { pct, hue, fillColor, labelColor }
}

// ── DETAILS DRAWER ──
function _buildDrawerContent(s, hasResult) {
  const drawer = document.getElementById('stats-drawer')
  if (!drawer) return

  const _raw = s.baseScore + s.skillBonus
  const totalScore = hasResult ? (_raw % 1 === 0 ? String(_raw) : _raw.toFixed(1)) : '—'
  const myldStr = hasResult && s.matchYieldResolved > 0 ? formatYield(s.matchYield) : '—'
  const slamIdxStr = hasResult && _poolSlamIndex !== null ? String(_poolSlamIndex) : '—'

  const origRes = s.cDrawOrig + s.wDrawOrig
  const drawAccPct = origRes > 0 ? Math.round(s.cDrawOrig / origRes * 100) : null
  const drawAccVal = drawAccPct !== null ? `${drawAccPct}%` : '—'
  const drawAccFrac = origRes > 0 ? `${s.cDrawOrig} of ${origRes}` : '—'

  const allRes = s.cOrig + s.wOrig + s.cBackup + s.wBackup
  const matchCorrect = s.cOrig + s.cBackup
  const matchAccPct = allRes > 0 ? Math.round(matchCorrect / allRes * 100) : null
  const matchAccVal = matchAccPct !== null ? `${matchAccPct}%` : '—'
  const matchAccFrac = allRes > 0 ? `${matchCorrect} of ${allRes}` : '—'

  const healthPct = s.maxHealthPts > 0 ? Math.round(s.reachableHealthPts / s.maxHealthPts * 100) : null
  const healthVal = healthPct !== null ? `${healthPct}%` : '—'
  const healthValStyle = ''

  const breakdownStr = hasResult && (s.baseScore + s.skillBonus) > 0
    ? ` · ${s.baseScore} base + ${s.skillBonus} upset pts`
    : ''

  const rows = [
    {
      id: 'slam-index',
      label: 'Slam Index',
      value: slamIdxStr,
      valueStyle: '',
      def: 'Your standing vs the pool, combining both yields. 100 = pool average.',
      math: 'Compares your Draw and Match Yields to the pool\'s average and spread. Dead average = 100; the further you sit from the pack — above or below — the further your index moves from 100.',
    },
    {
      id: 'draw-yield',
      label: 'Draw Yield',
      value: totalScore,
      valueStyle: '',
      def: `Only original, pre-tournament picks score here. Rounds pay 1·2·3·6·10·18·32 points, plus a bonus for calling upsets.${breakdownStr}`,
      math: 'Upset bonus = winner\'s seed − loser\'s seed, never below 0. Unseeded counts as seed 33; unseeded vs unseeded pays a flat 0.5.',
    },
    {
      id: 'match-yield',
      label: 'Match Yield',
      value: myldStr,
      valueStyle: '',
      def: 'Winnings from betting your match-by-match picks at the bookies\' odds. Stakes by round: 10·10·20·20·30·40·50.',
      math: 'Win = stake × (odds − 1), at odds frozen when the match\'s picks lock. Loss = −stake. Once both players in a match are confirmed, you can make a new pick whether or not your original is still alive. No pick? You\'re scored on the favourite automatically. Bookies\' odds carry a built-in house margin, so breaking even means you beat the bookie.',
    },
    {
      id: 'draw-acc',
      label: 'Draw Accuracy',
      value: drawAccVal,
      valueStyle: '',
      def: `Original, pre-tournament picks you got right. · ${drawAccFrac}`,
      math: null,
    },
    {
      id: 'match-acc',
      label: 'Match Accuracy',
      value: matchAccVal,
      valueStyle: '',
      def: `Match-time picks you got right. · ${matchAccFrac}${_poolFlatROI !== null ? ` · ${_poolFlatROI >= 0 ? '+' : ''}${Math.round(_poolFlatROI * 100)}% flat-stake ROI` : ''}`,
      math: null,
    },
    {
      id: 'draw-health',
      label: 'Draw Health',
      value: healthVal,
      valueStyle: healthValStyle,
      def: 'Share of your draw\'s pre-tournament potential still alive. The lower it gets the more busted your bracket.',
      math: 'Points from picks confirmed correct or still alive ÷ total points your original picks could have earned.',
    },
  ]

  let html = ''
  rows.forEach(row => {
    const hasInfo = row.math !== null
    const mathOpenCls = (_drawerMathOpen === row.id && hasInfo) ? ' sd-math-open' : ''
    const valAttr = row.valueStyle ? ` style="${row.valueStyle}"` : ''
    const infoBtn = hasInfo
      ? `<button class="sd-info-btn" data-stat="${row.id}" title="The math">ⓘ</button>`
      : ''
    html += `<div class="sd-row${mathOpenCls}" data-stat="${row.id}">
        <span class="sd-lbl">${row.label}</span>
        <span class="sd-val"${valAttr}>${row.value}</span>
        <span class="sd-def">${row.def}${infoBtn}</span>
      </div>`
    if (hasInfo) {
      const mathOpen = _drawerMathOpen === row.id ? ' open' : ''
      html += `<div class="sd-math${mathOpen}" data-stat="${row.id}">
        <div class="sd-math-inner">
          <span class="sd-math-title">The Math</span>${row.math}
        </div>
      </div>`
    }
  })

  // Wrap in constrained inner div
  const inner = document.createElement('div')
  inner.className = 'sd-inner'
  inner.innerHTML = html
  drawer.innerHTML = ''
  drawer.appendChild(inner)

  // Wire ⓘ click handlers — only one math section open at a time
  inner.querySelectorAll('.sd-info-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const id = btn.dataset.stat
      const mathEl = inner.querySelector(`.sd-math[data-stat="${id}"]`)
      const rowEl = inner.querySelector(`.sd-row[data-stat="${id}"]`)
      if (!mathEl) return
      // Close others
      inner.querySelectorAll('.sd-math.open').forEach(el => {
        if (el !== mathEl) {
          el.classList.remove('open')
          const sibRow = inner.querySelector(`.sd-row[data-stat="${el.dataset.stat}"]`)
          if (sibRow) sibRow.classList.remove('sd-math-open')
        }
      })
      const nowOpen = mathEl.classList.toggle('open')
      if (rowEl) rowEl.classList.toggle('sd-math-open', nowOpen)
      _drawerMathOpen = nowOpen ? id : null
    })
  })
}

export function renderStats() {
  const strip = document.getElementById('stats-strip')
  if (!strip) return
  const d = activeDraw()
  strip.innerHTML = ''
  if (!d) { _updateMobileCountdownWrap(null, null); return }

  // Reset drawer state when draw changes
  if (d.db_id !== _lastDrawId) {
    _lastDrawId = d.db_id
    _drawerOpen = false
    _drawerMathOpen = null
    const drawer = document.getElementById('stats-drawer')
    if (drawer) drawer.classList.remove('open')
  }

  const s = calcStatsAsOf(d, statsRoundFilter)
  const locked = d.locked

  if (!locked) {
    // ── Pre-lock: unchanged pills ──
    const pct = s.total > 0 ? Math.round(s.filled / s.total * 100) : 0
    function simplePill(label, val) {
      const p = document.createElement('div')
      p.className = 'stat-pill'
      p.innerHTML = `<span class="slbl">${label}</span><span class="sval">${val}</span>`
      strip.appendChild(p)
    }
    simplePill('picks filled', s.filled + ' / ' + s.total)
    simplePill('complete', pct + '%')

    const hasElo = d.rounds[0]?.matches.some(m => m.elo_p1 != null || m.elo_p2 != null)
    let cdEl = null
    if (!isMobile()) {
      cdEl = buildCountdownEl(d, s)
      if (cdEl) { cdEl.style.marginLeft = 'auto'; strip.appendChild(cdEl) }
    }
    if (hasElo) {
      const link = document.createElement('button')
      link.className = 'sc-autofill-link'
      link.id = 'autofill-elo-btn'
      link.textContent = 'Finish for me'
      if (!cdEl) link.style.marginLeft = 'auto'
      strip.appendChild(link)
    }
    _updateMobileCountdownWrap(d, s)

    // Health underline and drawer hidden pre-lock
    _updateHealthUnderline(strip, null, false, d)
    const drawer = document.getElementById('stats-drawer')
    if (drawer) { drawer.classList.remove('open'); drawer.innerHTML = '' }
    _drawerOpen = false
    return
  }

  // ── Post-lock: redesigned bar ──

  // Gate all bar stats until at least one match result exists
  const hasResult = d.rounds.some(r => r.matches.some(m => m.winner))

  const _raw = s.baseScore + s.skillBonus
  const totalScore = hasResult ? (_raw % 1 === 0 ? String(_raw) : _raw.toFixed(1)) : '—'
  const myldStr = hasResult && s.matchYieldResolved > 0 ? formatYield(s.matchYield) : '—'
  const slamIdxStr = hasResult && _poolSlamIndex !== null ? String(_poolSlamIndex) : '—'

  // ── Round filter (desktop only) ──
  if (!isMobile()) {
    const selWrap = document.createElement('div')
    selWrap.style.cssText = 'display:flex;align-items:center;gap:3px;padding:0 0 4px 16px;flex-shrink:0'
    const availableRounds = [{ label: 'All Results', ri: null }]
    d.rounds.forEach((r, ri) => { if (r.matches.every(m => m.winner)) availableRounds.push({ label: r.label, ri }) })
    availableRounds.forEach(({ label, ri }) => {
      const isActive = statsRoundFilter === ri
      const displayLabel = ri === null ? (isActive ? 'All Results' : 'All') : (isActive ? 'After ' + label : label)
      const btn = document.createElement('button')
      btn.style.cssText = 'font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:3px;border:1px solid '
        + (isActive ? 'var(--accent)' : 'var(--border2)')
        + ';background:' + (isActive ? 'var(--accent)' : 'none')
        + ';color:' + (isActive ? 'var(--accent-text)' : 'var(--text2)')
        + ';cursor:pointer;white-space:nowrap;transition:all 0.12s'
      btn.textContent = displayLabel
      btn.addEventListener('click', () => { statsRoundFilter = ri; renderStats() })
      selWrap.appendChild(btn)
    })
    strip.appendChild(selWrap)
  }

  // 1. Slam Index hero
  const heroEl = document.createElement('div')
  heroEl.className = 'sc-hero'
  heroEl.innerHTML = `<span class="sc-hero-val">${slamIdxStr}</span><span class="sc-hero-lbl">Slam Index</span>`
  strip.appendChild(heroEl)

  // 2. Draw Yield + Match Yield stacked
  const yieldsEl = document.createElement('div')
  yieldsEl.className = 'sc-yields'
  const myldDim = (!hasResult || s.matchYieldResolved === 0) ? ' sc-dim' : ''
  yieldsEl.innerHTML = `
    <div class="sc-yield-cell">
      <span class="sc-yield-lbl">Draw Yield</span>
      <span class="sc-yield-val">${totalScore}</span>
    </div>
    <div class="sc-yield-cell">
      <span class="sc-yield-lbl">Match Yield</span>
      <span class="sc-yield-val${myldDim}">${myldStr}</span>
    </div>`
  strip.appendChild(yieldsEl)

  // 3. Stats Guide pill (all viewports — mobile now supported)
  {
    const guideBtn = document.createElement('button')
    guideBtn.className = `sc-guide-btn${_drawerOpen ? ' open' : ''}`
    guideBtn.setAttribute('aria-expanded', _drawerOpen ? 'true' : 'false')
    guideBtn.innerHTML = `Stats Guide <span class="sc-guide-chevron">▾</span>`

    const _wireOutsideTouch = () => {
      _removeOutsideTouchHandler()
      _outsideTouchHandler = e => {
        const stp = document.getElementById('stats-strip')
        const dr = document.getElementById('stats-drawer')
        if ((stp && stp.contains(e.target)) || (dr && dr.contains(e.target))) return
        _drawerOpen = false
        guideBtn.classList.remove('open')
        guideBtn.setAttribute('aria-expanded', 'false')
        if (dr) dr.classList.remove('open')
        _removeOutsideTouchHandler()
      }
      document.addEventListener('touchstart', _outsideTouchHandler)
    }

    guideBtn.addEventListener('click', () => {
      _drawerOpen = !_drawerOpen
      guideBtn.classList.toggle('open', _drawerOpen)
      guideBtn.setAttribute('aria-expanded', String(_drawerOpen))
      const drawer = document.getElementById('stats-drawer')
      if (drawer) drawer.classList.toggle('open', _drawerOpen)
      if (_drawerOpen) _wireOutsideTouch()
      else _removeOutsideTouchHandler()
    })

    // Re-wire with the current guideBtn if drawer state was restored as open
    if (_drawerOpen) _wireOutsideTouch()

    strip.appendChild(guideBtn)
  }

  // 4. Flex spacer
  const spacer = document.createElement('div')
  spacer.style.flex = '1'
  strip.appendChild(spacer)

  // 5. Compact countdown (desktop only — mobile uses mobile-countdown-wrap)
  if (!isMobile()) {
    const cdEl = buildCountdownEl(d, s, { compact: true })
    if (cdEl) strip.appendChild(cdEl)
  }
  _updateMobileCountdownWrap(d, s)

  // 6. Health underline (appended last so it sits on top z-index within strip)
  _updateHealthUnderline(strip, s, hasResult, d)

  // Build drawer content (restores open state via _drawerOpen / _drawerMathOpen)
  _buildDrawerContent(s, hasResult)
  const drawer = document.getElementById('stats-drawer')
  if (drawer && _drawerOpen) drawer.classList.add('open')
}
