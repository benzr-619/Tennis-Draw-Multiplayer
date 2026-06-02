// bracket-layout.js — shared bracket GEOMETRY only.
// Used by bracket.js (live), viewer-bracket.js (read-only), and commissioner.js (results).
// This module positions cards, draws connectors, separators, section labels, the
// champion box, and round labels. It knows NOTHING about pick state, colors, clicks,
// or commissioner controls — that all lives in the per-renderer `placeCard` callback.
//
// Established 2026-06-01 (audit part C). Replaces three verbatim copies of this code.

export const CW = 180, CH = 62, GAP = 20, COL = 200

const DEFAULT_EMPTY = `
  <div class="bracket-empty">
    <div class="bracket-empty-icon">🎾</div>
    <div class="bracket-empty-title">No draw uploaded yet.</div>
  </div>`

/**
 * Render the bracket scaffold and place every card via the provided callback.
 *
 * @param {object}   opts
 * @param {object}   opts.draw          assembled draw with .rounds
 * @param {Element}  opts.body          container element to render into (cleared first)
 * @param {Element}  [opts.labelsInner] round-labels strip element (optional)
 * @param {Function} opts.placeCard     (draw, match, ri, mi, x, y, wrap) => void
 * @param {Function} [opts.championName] (finalMatch) => string  — defaults to winner||'—'
 * @param {string}   [opts.emptyHTML]   markup shown when there is no draw
 * @returns {Element|null} the `.bracket-svg-wrap` element, or null if empty
 */
export function renderBracketLayout({ draw, body, labelsInner, placeCard, championName, emptyHTML }) {
  if (!body) return null
  body.innerHTML = ''
  if (!draw || !draw.rounds || !draw.rounds.length) {
    body.innerHTML = emptyHTML || DEFAULT_EMPTY
    return null
  }

  const rounds = draw.rounds
  const r1 = rounds[0].matches
  const total = r1.length, half = Math.ceil(total / 2), q = Math.ceil(half / 2)
  const drawRounds = rounds.length - 1
  const VGAP = 32, CELL = CH + VGAP, Q_SEP = 28, QQ_SEP = 18

  function r1YCenter(idx) {
    let y = idx * CELL + CH / 2
    if (idx >= q) y += QQ_SEP
    if (idx >= half) y += Q_SEP
    if (idx >= half + q) y += QQ_SEP
    return y
  }
  function matchYCenter(ri, mi) {
    const f = mi * Math.pow(2, ri), l = (mi + 1) * Math.pow(2, ri) - 1
    return (r1YCenter(f) + r1YCenter(l)) / 2
  }

  const lastR1Y = r1YCenter(total - 1)
  const totalH = lastR1Y + CH / 2 + 16
  const CHAMP_W = 140
  const totalW = drawRounds * COL - GAP + GAP + CW + GAP + CHAMP_W + 20

  const wrap = document.createElement('div')
  wrap.className = 'bracket-svg-wrap'
  wrap.style.cssText = `width:${totalW}px;height:${totalH}px;position:relative`

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', totalW); svg.setAttribute('height', totalH)
  svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible'

  const connColor = '#c8c4bb'
  function addLine(x1, y1, x2, y2) {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2)
    l.setAttribute('stroke', connColor); l.setAttribute('stroke-width', '1'); svg.appendChild(l)
  }
  function drawSep(y, dashed) {
    const lw = drawRounds * COL - GAP
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', 0); line.setAttribute('x2', lw); line.setAttribute('y1', y); line.setAttribute('y2', y)
    line.setAttribute('stroke', dashed ? '#c8c4bb' : '#b0aa9f')
    line.setAttribute('stroke-width', dashed ? '1' : '1.5')
    if (dashed) line.setAttribute('stroke-dasharray', '5,4')
    svg.appendChild(line)
  }
  function sepY(idx) { return (r1YCenter(idx - 1) + CH / 2 + r1YCenter(idx) - CH / 2) / 2 }
  drawSep(sepY(q), true); drawSep(sepY(half), false); drawSep(sepY(half + q), true)

  const sectionDefs = [
    { label: 'Top Half · Q1', mi: 0 },
    { label: 'Top Half · Q2', mi: q },
    { label: 'Bottom Half · Q3', mi: half },
    { label: 'Bottom Half · Q4', mi: half + q },
  ]
  sectionDefs.forEach(s => {
    const lbl = document.createElement('div')
    lbl.style.cssText = `position:absolute;left:0;font-family:var(--mono);font-size:8px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3);white-space:nowrap;top:${r1YCenter(s.mi) - CH / 2 - 13}px`
    lbl.textContent = s.label; wrap.appendChild(lbl)
  })

  for (let ri = 0; ri < drawRounds; ri++) {
    const x = ri * COL
    rounds[ri].matches.forEach((m, mi) => {
      const cy = matchYCenter(ri, mi), y = cy - CH / 2
      placeCard(draw, m, ri, mi, x, y, wrap)
      if (ri < drawRounds - 1) {
        const rx = x + CW, midX = rx + GAP / 2
        const pcy = matchYCenter(ri + 1, Math.floor(mi / 2))
        addLine(rx, cy, midX, cy)
        if (mi % 2 === 0) { addLine(midX, cy, midX, matchYCenter(ri, mi + 1)) }
        addLine(midX, pcy, (ri + 1) * COL, pcy)
      }
    })
  }

  const finX = drawRounds * COL, finCY = totalH / 2, finY = finCY - CH / 2
  const finMatch = rounds[rounds.length - 1].matches[0]
  if (finMatch) {
    placeCard(draw, finMatch, rounds.length - 1, 0, finX, finY, wrap)
    const sfRi = drawRounds - 1
    if (rounds[sfRi] && rounds[sfRi].matches.length >= 2) {
      const sfX = (drawRounds - 1) * COL, midX = sfX + CW + GAP / 2
      const sf0 = matchYCenter(sfRi, 0), sf1 = matchYCenter(sfRi, 1)
      addLine(sfX + CW, sf0, midX, sf0); addLine(sfX + CW, sf1, midX, sf1)
      addLine(midX, sf0, midX, sf1); addLine(midX, finCY, finX, finCY)
    }
  }

  // Champion box
  const champX = finX + CW + GAP, champY = finCY - 36
  const champDiv = document.createElement('div'); champDiv.className = 'champ-box'
  champDiv.style.cssText = `left:${champX}px;top:${champY}px;position:absolute`
  const champLbl = document.createElement('div'); champLbl.className = 'champ-label'; champLbl.textContent = 'Champion'
  const champNm = document.createElement('div'); champNm.className = 'champ-name'
  const nameFn = championName || (f => (f && f.winner) || '—')
  champNm.textContent = (finMatch && nameFn(finMatch)) || '—'
  champDiv.appendChild(champLbl); champDiv.appendChild(champNm); wrap.appendChild(champDiv)
  addLine(finX + CW, finCY, champX, finCY)

  // Round labels
  if (labelsInner) {
    labelsInner.innerHTML = ''
    for (let ri = 0; ri < drawRounds; ri++) {
      const l = document.createElement('div')
      l.style.cssText = 'width:180px;flex-shrink:0;text-align:center;font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3)'
      l.textContent = rounds[ri].label; labelsInner.appendChild(l)
      if (ri < drawRounds - 1) { const g = document.createElement('div'); g.style.cssText = 'width:20px;flex-shrink:0'; labelsInner.appendChild(g) }
    }
    const finLbl = document.createElement('div')
    finLbl.style.cssText = 'width:180px;flex-shrink:0;text-align:center;font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3);padding-left:20px'
    finLbl.textContent = 'Final'; labelsInner.appendChild(finLbl)
    labelsInner.style.transform = 'translateX(0)'
  }

  const outer = document.createElement('div'); outer.style.cssText = 'display:inline-block'
  wrap.appendChild(svg); outer.appendChild(wrap); body.appendChild(outer)
  return wrap
}
