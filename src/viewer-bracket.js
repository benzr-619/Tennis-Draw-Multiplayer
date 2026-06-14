// viewer-bracket.js — Read-only bracket renderer for the leaderboard bracket viewer.
// mode 'original': pre-tournament original picks, green/red by pick result
// mode 'match':    actual match players, ✓/crossed for result, purple for the user's pick

import { renderBracketLayout } from './bracket-layout.js'
import { formatAmerican } from './odds.js'

let _scrollHandler = null

// ── MAIN RENDER ──

export function renderViewerBracket(draw, mode = 'original') {
  const body = document.getElementById('viewer-bracket-body')
  renderBracketLayout({
    draw,
    body,
    labelsInner: document.getElementById('viewer-round-labels-inner'),
    placeCard: (draw, m, ri, mi, x, y, wrap) => placeViewerCard(draw, m, ri, mi, x, y, wrap, mode),
    renderChampion: (f, x, y, wrap) => {
      const champDiv = document.createElement('div')
      const champLbl = document.createElement('div'); champLbl.className = 'champ-label'; champLbl.textContent = 'Champion'
      const champNm = document.createElement('div'); champNm.className = 'champ-name'
      if (mode === 'original') {
        const pick = f.originalPick || null
        const result = f.originalPickResult
        const isCorrect = result === 'correct'
        const isWrong   = result === 'wrong'
        champDiv.className = 'champ-box' + (isCorrect ? ' champ-correct' : isWrong ? ' champ-wrong' : '')
        champNm.textContent = pick || f.winner || '—'
        if (isWrong) {
          champNm.style.cssText = 'text-decoration:line-through;color:var(--red)'
          if (f.winner) {
            const actual = document.createElement('div')
            actual.className = 'mc-champ-actual'
            actual.textContent = f.winner
            champDiv.appendChild(actual)
          }
        } else if (isCorrect) {
          champNm.style.color = 'var(--green)'
        } else if (pick) {
          champNm.style.color = 'var(--accent)'
        }
      } else {
        champDiv.className = 'champ-box'
        champNm.textContent = f.matchPick || f.winner || '—'
      }
      champDiv.style.cssText = `left:${x}px;top:${y}px;position:absolute`
      champDiv.appendChild(champLbl); champDiv.appendChild(champNm); wrap.appendChild(champDiv)
    },
    emptyHTML: `<div class="bracket-empty">
      <div class="bracket-empty-icon">🎾</div>
      <div class="bracket-empty-title">No draw data available.</div>
    </div>`,
  })

  // Scroll sync: viewer body scroll → round labels follow
  const viewerLabels = document.getElementById('viewer-round-labels-inner')
  if (body && viewerLabels) {
    if (_scrollHandler) body.removeEventListener('scroll', _scrollHandler)
    _scrollHandler = function () {
      viewerLabels.style.transform = 'translateX(-' + this.scrollLeft + 'px)'
    }
    body.addEventListener('scroll', _scrollHandler)
  }
}

// ── PLACE VIEWER CARD ──

function placeViewerCard(draw, m, ri, mi, x, y, wrap, mode) {
  const isMatch = mode === 'match'

  // Card border: original mode uses green/red; match mode is neutral
  let cardCls = 'mc mc-viewer'
  if (!isMatch && m.originalPickResult === 'correct') cardCls += ' st-correct'
  else if (!isMatch && m.originalPickResult === 'wrong') cardCls += ' st-wrong'

  const card = document.createElement('div')
  card.className = cardCls
  card.style.cssText = `left:${x}px;top:${y}px`

  const rowsWrap = document.createElement('div')
  rowsWrap.style.cssText = 'overflow:hidden;border-radius:5px 5px 0 0;flex-shrink:0'

  if (isMatch) {
    // ── MATCH PICKS MODE ──
    // Show who actually played (actualP1/actualP2), fall back to projected slot if pending.
    // Winner gets ✓, loser gets crossed out. Purple row = user's pick.
    const slots = [
      { p: m.actualP1?.name ? m.actualP1 : m.p1, isP1: true },
      { p: m.actualP2?.name ? m.actualP2 : m.p2, isP1: false },
    ]

    slots.forEach(({ p, isP1 }) => {
      const isPick   = !!(p.name && m.matchPick && m.matchPick === p.name)
      const isWinner = !!(p.name && m.winner && m.winner === p.name)
      const isLoser  = !!(p.name && m.winner && m.winner !== p.name)

      let cls = 'pr'
      if (!p.name) cls += ' no-pick'
      else if (isPick && isLoser) cls += ' s-backup-wrong'
      else if (isPick)            cls += ' s-backup'
      else if (isLoser)           cls += ' mp-loser'

      const row = document.createElement('div'); row.className = cls; row.style.position = 'relative'
      const seedEl = document.createElement('span'); seedEl.className = 'pr-seed'; seedEl.textContent = p.seed || ''
      const nameEl = document.createElement('span'); nameEl.className = 'pr-name'; nameEl.textContent = p.name || '—'
      row.appendChild(seedEl)
      row.appendChild(nameEl)

      // Odds inline after name
      const slotOdds = isP1 ? (m.odds_p1_locked ?? m.odds_p1_live ?? null)
        : (m.odds_p2_locked ?? m.odds_p2_live ?? null)
      const oddsLocked = isP1 ? !!m.odds_p1_locked : !!m.odds_p2_locked
      if (slotOdds && p.name) {
        const oddsSpan = document.createElement('span')
        oddsSpan.className = 'pr-odds' + (oddsLocked ? ' pr-odds-locked' : '')
        oddsSpan.textContent = formatAmerican(slotOdds)
        row.appendChild(oddsSpan)
      }

      // Check mark only when the pick won
      if (isPick && isWinner) {
        const check = document.createElement('span')
        check.className = 'pr-check'
        check.textContent = '✓'
        row.appendChild(check)
      }

      rowsWrap.appendChild(row)
    })

  } else {
    // ── ORIGINAL PICKS MODE ──
    // User's original picks fill the slots (projectFromPick: true).
    // Card border green/red by originalPickResult. When the actual player
    // differs from the pick, the actual player floats outside via mc-actual-top/bot.

    const hasActuals = m.actualP1 !== undefined

    const makeOrigRow = (p, side) => {
      const actualP = hasActuals ? (side === 'p1' ? m.actualP1 : m.actualP2) : null
      const predictedMissed =
        (actualP && actualP.name && p.name && actualP.name !== p.name) || p.elim === true
      const isPick = m.originalPick && m.originalPick === p.name
      const result = m.originalPickResult

      let cls = 'pr'
      if (!p.name)                                              cls += ' no-pick'
      else if (isPick && result === 'correct')                  cls += ' s-orig-ok locked'
      else if (isPick && (result === 'wrong' || predictedMissed)) cls += ' s-orig-wrong locked'
      else if (predictedMissed)                                 cls += ' s-orig-wrong'
      else if (isPick)                                          cls += ' s-orig'

      const row = document.createElement('div'); row.className = cls; row.style.position = 'relative'
      const seedEl = document.createElement('span'); seedEl.className = 'pr-seed'; seedEl.textContent = p.seed || ''
      const nameEl = document.createElement('span'); nameEl.className = 'pr-name'; nameEl.textContent = p.name || '—'
      row.appendChild(seedEl)
      row.appendChild(nameEl)
      return row
    }

    rowsWrap.appendChild(makeOrigRow(m.p1, 'p1'))
    rowsWrap.appendChild(makeOrigRow(m.p2, 'p2'))
    card.appendChild(rowsWrap)

    // Actual player labels — float outside when the actual player differs from the predicted pick
    if (hasActuals && ri >= 1) {
      const makeActualLabel = (actualP, pos) => {
        if (!actualP || !actualP.name) return
        const predictedName = pos === 'top' ? m.p1.name : m.p2.name
        if (actualP.name === predictedName) return
        const lbl = document.createElement('div')
        lbl.className = 'mc-actual-' + pos
        lbl.textContent = actualP.name
        card.appendChild(lbl)
      }
      makeActualLabel(m.actualP1, 'top')
      makeActualLabel(m.actualP2, 'bot')
    }

    wrap.appendChild(card)
    return
  }

  card.appendChild(rowsWrap)
  wrap.appendChild(card)
}
