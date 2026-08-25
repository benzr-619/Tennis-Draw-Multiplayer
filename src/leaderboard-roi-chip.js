// Personal "Match Pick ROI" badge — the current user's own flat-stake ROI
// across every eligible draw they've played. Originally shipped 2026-07-18 as
// a pool-wide "Best Match Pick Value" chip on the Slams tab; Ben clarified
// that move wasn't intended — replaced same day with this simpler personal
// stat on the Your Draws tab instead. See
// .claude/rules/leaderboard-records-redesign.md.
//
// Each resolved matchPick with locked odds = a flat $1 bet: win = +(odds−1),
// lose = −1. Normalises out round stakes so an early-round pick and a Final
// pick count equally toward ROI.

import { buildAllTimeAgg } from './leaderboard-records-data.js'

export function buildPersonalRoiBadge(user, draws, statsMaps) {
  const agg = buildAllTimeAgg([user], draws, statsMaps)
  const s = agg[user.id]

  const chip = document.createElement('div')
  chip.className = 'lb-rec-card rec-honor-chip lb-yd-roi-chip'
  const hdr = document.createElement('div'); hdr.className = 'lb-rec-card-header'
  const title = document.createElement('span'); title.className = 'lb-rec-card-title'; title.textContent = 'MATCH PICK ROI'
  hdr.appendChild(title); chip.appendChild(hdr)

  const body = document.createElement('div')
  body.className = 'rec-honor-body'
  const main = document.createElement('div')
  main.className = 'rec-honor-main lb-yd-roi-main'
  if (s?.flatROI === null || s?.flatROI === undefined) {
    main.textContent = '—'
  } else {
    const pct = Math.round(s.flatROI * 100), pos = pct >= 0
    const valEl = document.createElement('span')
    valEl.className = 'lb-yd-roi-val ' + (pos ? 'lb-yd-roi-pos' : 'lb-yd-roi-neg')
    valEl.textContent = `${pos ? '+' : '−'}${Math.abs(pct)}%`
    const subEl = document.createElement('span')
    subEl.className = 'lb-yd-roi-sub'
    subEl.textContent = ` · ${s.totalFlatBets} pick${s.totalFlatBets !== 1 ? 's' : ''}`
    main.append(valEl, subEl)
  }
  body.appendChild(main); chip.appendChild(body)
  return chip
}
