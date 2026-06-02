// Commissioner — Results tab. Match-by-match winner confirmation + undo + search.
// Split from commissioner.js on 2026-06-01 (audit part E).

import { activeDraw } from './state.js'
import { reloadActiveDraw } from './data.js'
import { applyWinner, undoWinner } from './picks.js'
import { renderBracketLayout } from './bracket-layout.js'
import { $c } from './commissioner-shared.js'

export function renderResults() {
  const body = $c('results-bracket-body')
  if (!body) return

  const labelsInner = $c('results-round-labels-inner')
  const wrap = renderBracketLayout({
    draw: activeDraw(),
    body,
    labelsInner,
    placeCard: _placeResultCard,
    championName: f => f.winner || '—',
    emptyHTML: '<div class="bracket-empty"><div class="bracket-empty-icon">🎾</div><div class="bracket-empty-title">No draw uploaded yet.</div></div>',
  })

  // Scroll sync for round labels
  if (wrap && labelsInner) {
    body.addEventListener('scroll', function () {
      labelsInner.style.transform = 'translateX(-' + this.scrollLeft + 'px)'
    }, { passive: true })
  }

  _wireResultsSearch(wrap)
}

function _placeResultCard(d, m, ri, mi, x, y, wrap) {
  const hasResult = !!m.winner
  const card = document.createElement('div')
  card.className = 'mc' + (hasResult ? ' res-done' : '')
  card.style.cssText = `left:${x}px;top:${y}px`
  card.dataset.ri = ri; card.dataset.mi = mi

  function makeResultRow(p, isWinner, isLoser, clickable) {
    const row = document.createElement('div')
    let cls = 'pr'
    if (isWinner) cls += ' res-winner'
    else if (isLoser) cls += ' res-loser'
    else if (clickable) cls += ' res-clickable'
    row.className = cls

    const seedEl = document.createElement('span'); seedEl.className = 'pr-seed'; seedEl.textContent = p.seed || ''
    const nameEl = document.createElement('span'); nameEl.className = 'pr-name'; nameEl.textContent = p.name || '—'
    row.appendChild(seedEl); row.appendChild(nameEl)

    if (clickable && p.name) {
      row.addEventListener('click', async () => {
        row.style.pointerEvents = 'none'
        await applyWinner(d, ri, mi, p.name, { renderStats: () => {}, renderBracket: () => {} })
        renderResults()
      })
    }
    return row
  }

  const p1Winner = hasResult && m.winner === m.p1.name
  const p2Winner = hasResult && m.winner === m.p2.name
  const canClick = !hasResult && m.p1.name && m.p2.name

  const rowsWrap = document.createElement('div')
  rowsWrap.style.cssText = 'overflow:hidden;border-radius:5px 5px 0 0;flex-shrink:0'
  rowsWrap.appendChild(makeResultRow(m.p1, p1Winner, hasResult && !p1Winner, canClick))
  rowsWrap.appendChild(makeResultRow(m.p2, p2Winner, hasResult && !p2Winner, canClick))
  card.appendChild(rowsWrap)

  // Undo button
  if (hasResult) {
    const undoBtn = document.createElement('button')
    undoBtn.className = 'mc-res-undo'
    undoBtn.textContent = 'Undo result'
    undoBtn.addEventListener('click', async () => {
      undoBtn.disabled = true
      await undoWinner(d, ri, mi, { renderStats: () => {}, renderBracket: () => {} })
      // Reload from DB so backup-pick cascades are re-derived (buildDrawView) from
      // the authoritative stored picks after clearing the result.
      await reloadActiveDraw()
      renderResults()
    })
    card.appendChild(undoBtn)
  }

  wrap.appendChild(card)
}

function _wireResultsSearch(wrap) {
  const input = $c('results-search-input')
  const clearBtn = $c('results-search-clear')
  if (!input) return

  // Remove old listeners by replacing elements
  const newInput = input.cloneNode(true)
  const newClear = clearBtn?.cloneNode(true)
  input.replaceWith(newInput)
  clearBtn?.replaceWith(newClear)

  function runSearch(q) {
    if (newClear) newClear.classList.toggle('visible', q.length > 0)
    if (!wrap) return
    wrap.querySelectorAll('.mc').forEach(c => c.classList.remove('res-search-highlight'))
    if (!q || q.length < 2) return
    const lower = q.toLowerCase()
    wrap.querySelectorAll('.mc').forEach(card => {
      const names = Array.from(card.querySelectorAll('.pr-name')).map(n => n.textContent.toLowerCase())
      if (names.some(n => n.includes(lower))) {
        card.classList.add('res-search-highlight')
      }
    })
    // Scroll to first match
    const first = wrap.querySelector('.mc.res-search-highlight')
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  }

  newInput.addEventListener('input', e => runSearch(e.target.value.trim()))
  newClear?.addEventListener('click', () => { newInput.value = ''; runSearch('') })
}
