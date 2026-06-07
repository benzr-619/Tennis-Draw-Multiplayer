// Stats bar renderer — ported from reference app

import { activeDraw, state } from './state.js'
import { calcStatsAsOf, calcChalkScore, isBackupPick } from './scoring.js'

let statsRoundFilter = null
let _countdownClickHandler = null

export function resetStatsFilter() { statsRoundFilter = null }
export function getStatsFilter() { return statsRoundFilter }
export function setCountdownClickHandler(fn) { _countdownClickHandler = fn }

export function renderStats() {
  const strip = document.getElementById('stats-strip')
  if (!strip) return
  const d = activeDraw()
  strip.innerHTML = ''
  if (!d) return

  const s = calcStatsAsOf(d, statsRoundFilter)
  const locked = d.locked

  function attachTip(el, label, tip) {
    el.addEventListener('mouseenter', () => {
      const bar = document.getElementById('stat-desc-bar')
      const lbl = document.getElementById('stat-desc-label')
      const txt = document.getElementById('stat-desc-text')
      if (lbl) lbl.textContent = label
      if (txt) txt.textContent = tip
      if (bar) bar.classList.add('visible')
    })
    el.addEventListener('mouseleave', () => {
      const bar = document.getElementById('stat-desc-bar')
      if (bar) bar.classList.remove('visible')
    })
  }

  function simplePill(label, val, valCls, tip) {
    const p = document.createElement('div')
    p.className = 'stat-pill'
    p.innerHTML = `<span class="slbl">${label}</span><span class="sval${valCls ? ' ' + valCls : ''}">${val}</span>`
    if (tip) attachTip(p, label, tip)
    strip.appendChild(p)
  }

  if (!locked) {
    const pct = s.total > 0 ? Math.round(s.filled / s.total * 100) : 0
    simplePill('picks filled', s.filled + ' / ' + s.total, '')
    simplePill('complete', pct + '%', '')

    // Countdown to original picks lock if one is scheduled
    const origSched = (state.lockSchedules || []).find(ls =>
      ls.lock_type === 'original_picks' && !ls.locked_at && ls.scheduled_at &&
      new Date(ls.scheduled_at) > new Date() &&
      ls.draw_id === d.db_id
    )
    if (origSched) {
      const msLeft = new Date(origSched.scheduled_at) - Date.now()
      const totalMins = Math.max(0, Math.floor(msLeft / 60000))
      const hh = String(Math.floor(totalMins / 60)).padStart(2, '0')
      const mm = String(totalMins % 60).padStart(2, '0')
      const allFilled = s.filled === s.total
      const countdownPill = document.createElement('div')
      countdownPill.className = 'stat-pill countdown-pill'
      countdownPill.style.marginLeft = 'auto'
      countdownPill.style.flexDirection = 'row'
      countdownPill.style.alignItems = 'center'
      countdownPill.style.gap = '10px'
      countdownPill.innerHTML = `
        <span class="slbl" style="margin-bottom:0">picks lock in</span>
        <span class="sval countdown-val${!allFilled ? ' countdown-urgent' : ''}">${hh}:${mm}</span>`
      strip.appendChild(countdownPill)
    }

    return
  }

  // Round filter selector
  const selWrap = document.createElement('div')
  selWrap.style.cssText = 'display:flex;align-items:center;gap:3px;padding:0 10px 0 14px;border-right:1px solid var(--border);height:100%;flex-shrink:0'
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

  // Score pill
  const chalk = calcChalkScore(d)
  const totalScore = Math.round(s.baseScore + s.skillBonus)
  const chalkDiff = chalk.chalkTotal > 0 ? (s.baseScore + s.skillBonus - chalk.chalkTotal) : null
  const chalkHTML = chalkDiff !== null
    ? `<span class="score-chalk-num">${chalkDiff >= 0 ? '+' : ''}${Math.round(chalkDiff)}</span><span class="score-chalk-lbl"> vs chalk</span>`
    : ''

  const scorePill = document.createElement('div'); scorePill.className = 'stat-pill'
  scorePill.innerHTML = `
    <span class="slbl">Score</span>
    <div class="score-pill-row">
      <span class="score-main">${totalScore}</span>
      <span class="score-eq">=</span>
      <span class="score-base">${s.baseScore}</span><span class="score-lbl"> base</span>
      <span class="score-plus">+</span>
      <span class="score-base">${Math.round(s.skillBonus)}</span><span class="score-lbl"> upset</span>
      ${chalkHTML ? `<span class="score-chalk-sep">|</span>${chalkHTML}` : ''}
    </div>`
  attachTip(scorePill, 'Score', 'Base points for each correct original pick: 1, 2, 3, 6, 10, 18, 32 (R1→F). Upset bonus = winner seed minus loser seed — unseeded counts as 33, floored at 0. Unseeded vs. unseeded is a flat 0.5. Chalk shows what a seed-order bracket would score.')
  strip.appendChild(scorePill)

  // Draw Accuracy
  const origRes = s.cDrawOrig + s.wDrawOrig
  const drawAccPct = origRes > 0 ? Math.round(s.cDrawOrig / origRes * 100) : '—'
  const drawAccFrac = origRes > 0 ? `${s.cDrawOrig} / ${origRes}` : '—'
  const drawAccPill = document.createElement('div'); drawAccPill.className = 'stat-pill'
  drawAccPill.innerHTML = `
    <span class="slbl">Draw Accuracy</span>
    <div style="display:flex;align-items:baseline;gap:8px">
      <span class="sval">${drawAccFrac}</span>
      ${origRes > 0 ? `<span class="score-chalk-num">${drawAccPct}%</span>` : ''}
    </div>`
  attachTip(drawAccPill, 'Draw Accuracy', 'How often your pre-tournament picks were right, evaluated when each match is confirmed. Original picks only.')
  strip.appendChild(drawAccPill)

  // Match Accuracy
  const allRes = s.cOrig + s.wOrig + s.cBackup + s.wBackup
  const matchCorrect = s.cOrig + s.cBackup
  const matchAccPct = allRes > 0 ? Math.round(matchCorrect / allRes * 100) : '—'
  const matchAccFrac = allRes > 0 ? `${matchCorrect} / ${allRes}` : '—'
  const matchAccPill = document.createElement('div'); matchAccPill.className = 'stat-pill'
  matchAccPill.innerHTML = `
    <span class="slbl">Match Accuracy</span>
    <div style="display:flex;align-items:baseline;gap:8px">
      <span class="sval">${matchAccFrac}</span>
      ${allRes > 0 ? `<span class="score-chalk-num">${matchAccPct}%</span>` : ''}
    </div>`
  attachTip(matchAccPill, 'Match Accuracy', 'How often you picked the right winner at match time, including any pick changes made during the tournament.')
  strip.appendChild(matchAccPill)

  // Draw Health
  const healthPill = document.createElement('div'); healthPill.className = 'stat-pill'
  healthPill.style.borderRight = 'none'
  if (s.maxHealthPts > 0) {
    const pct = Math.round(s.reachableHealthPts / s.maxHealthPts * 100)
    const barColor = pct >= 67 ? '#2d7a3a' : pct >= 33 ? '#d4820a' : '#c0392b'
    const textColor = pct >= 67 ? 'var(--green)' : pct >= 33 ? '#d4820a' : 'var(--red)'
    healthPill.innerHTML = `
      <span class="slbl">Draw Health</span>
      <div class="health-val-row">
        <div class="health-bar-track">
          <div class="health-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <span class="health-pct" style="color:${textColor}">${pct}%</span>
      </div>`
  } else {
    healthPill.innerHTML = `<span class="slbl">Draw Health</span><span class="sval" style="color:var(--text3)">—</span>`
  }
  attachTip(healthPill, 'Draw Health', "How much of your draw's scoring potential is still alive? The lower it gets, the more busted your bracket.")
  strip.appendChild(healthPill)

  // ── LOCK COUNTDOWN ──
  // Find the soonest upcoming lock across ALL draws; tie-break to current draw.
  const allUpcoming = (state.lockSchedules || [])
    .filter(ls => !ls.locked_at && ls.scheduled_at && new Date(ls.scheduled_at) > new Date())
    .sort((a, b) => {
      const diff = new Date(a.scheduled_at) - new Date(b.scheduled_at)
      if (diff !== 0) return diff
      // Tie: prefer current draw
      if (a.draw_id === d.db_id && b.draw_id !== d.db_id) return -1
      if (b.draw_id === d.db_id && a.draw_id !== d.db_id) return 1
      return 0
    })
  const upcoming = allUpcoming[0]

  if (upcoming) {
    const msLeft = new Date(upcoming.scheduled_at) - Date.now()
    const totalMins = Math.max(0, Math.floor(msLeft / 60000))
    const hh = String(Math.floor(totalMins / 60)).padStart(2, '0')
    const mm = String(totalMins % 60).padStart(2, '0')
    const displayTime = `${hh}h:${mm}m`

    // Check whether all affected picks in the upcoming lock's draw are filled
    const upcomingDraw = state.draws.find(dr => dr.db_id === upcoming.draw_id)
    let allFilled = true
    if (upcoming.lock_type === 'backup_picks' && upcomingDraw) {
      const rounds = upcomingDraw.rounds
      const ri = upcoming.round_index
      if (ri != null && rounds[ri]) {
        rounds[ri].matches.forEach((m, mi) => {
          const inRange = (upcoming.match_index_start == null || mi >= upcoming.match_index_start) &&
                          (upcoming.match_index_end == null || mi <= upcoming.match_index_end)
          if (inRange && !m.matchPick && !m.winner) allFilled = false
        })
      }
    }

    const labelText = upcoming.label
      ? `next lock: <span style="font-style:italic">${upcoming.label}</span>`
      : 'next lock'

    const countdownPill = document.createElement('div')
    countdownPill.className = 'stat-pill countdown-pill'
    countdownPill.style.borderRight = 'none'
    countdownPill.style.marginLeft = 'auto'
    countdownPill.style.flexDirection = 'row'
    countdownPill.style.alignItems = 'center'
    countdownPill.style.gap = '10px'
    if (!allFilled && _countdownClickHandler) {
      countdownPill.classList.add('countdown-clickable')
      countdownPill.addEventListener('click', () => _countdownClickHandler(upcoming))
    }
    countdownPill.innerHTML = `
      <span class="countdown-lbl${!allFilled ? ' countdown-urgent' : ''}">${labelText}</span>
      <span class="sval countdown-val${!allFilled ? ' countdown-urgent' : ''}">${displayTime}</span>`
    strip.appendChild(countdownPill)
  }

  const bar = document.getElementById('stat-desc-bar')
  if (bar) bar.classList.remove('visible')
}
