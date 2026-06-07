// viewer-bracket.js — Read-only bracket renderer for the leaderboard "original picks" viewer.
// Completely separate from bracket.js / the live bracket.
// Shows a user's pre-lock picks alongside actual tournament outcomes.

import { isBackupPick } from './scoring.js'
import { renderBracketLayout } from './bracket-layout.js'

// ── MAIN RENDER ──

export function renderViewerBracket(draw, viewerInfo) {
  // viewerInfo: { name, drawLabel } — header is set by the caller, not here.
  const body = document.getElementById('viewer-bracket-body')
  renderBracketLayout({
    draw,
    body,
    labelsInner: document.getElementById('viewer-round-labels-inner'),
    placeCard: placeViewerCard,
    championName: f => f.winner || f.matchPick || '—',
    emptyHTML: `<div class="bracket-empty">
      <div class="bracket-empty-icon">🎾</div>
      <div class="bracket-empty-title">No draw data available.</div>
    </div>`,
  })

  // Scroll sync: viewer body scroll → round labels follow
  const viewerLabels = document.getElementById('viewer-round-labels-inner')
  if (body && viewerLabels) {
    body.addEventListener('scroll', function () {
      viewerLabels.style.transform = 'translateX(-' + this.scrollLeft + 'px)'
    })
  }
}

// ── PLACE VIEWER CARD ──
// This function ONLY handles viewer rendering logic.
// No pick clicks, no score footer, no star buttons, no edit buttons, no backup glow.

function placeViewerCard(draw, m, ri, mi, x, y, wrap) {
  // Card-level state
  let cardCls = 'mc mc-viewer'
  if (m.originalPickResult === 'correct') cardCls += ' st-correct'
  else if (m.originalPickResult === 'wrong') cardCls += ' st-wrong'

  const card = document.createElement('div')
  card.className = cardCls
  card.style.cssText = `left:${x}px;top:${y}px`

  // For ri >= 1: m.p1/m.p2 are the predicted players (who the user picked to reach here).
  // m.actualP1/m.actualP2 are who actually reached this round in the real tournament.
  // For ri === 0: predicted = actual (both are drawn from the R1 draw).
  const hasActuals = m.actualP1 !== undefined

  function makeViewerRow(p, side) {
    const actualP = hasActuals ? (side === 'p1' ? m.actualP1 : m.actualP2) : null

    // Did the predicted player actually reach this round?
    // For ri 0 the predicted player IS the actual player, so predictedMissed is always false.
    // Two ways the friend was wrong about this slot:
    //   (a) a different real player actually reached it (actualP differs), or
    //   (b) the picked player has been eliminated somewhere (p.elim, set by
    //       buildDrawView's projectFromPick pass) — catches FUTURE rounds whose
    //       feeders aren't decided yet, which would otherwise still show blue.
    const predictedMissed =
      (actualP && actualP.name && p.name && actualP.name !== p.name) || p.elim === true

    const isOrigPick = m.originalPick && m.originalPick === p.name

    // What happened?
    // correct: this player was picked AND won the match
    // wrong: this player was picked AND lost the match (or didn't make it here)
    // missed: not picked, but they actually won
    // elim: they lost (no pick involved)
    let cls = 'pr'
    if (!p.name) {
      cls += ' no-pick'
    } else if (isOrigPick && m.originalPickResult === 'correct') {
      cls += ' s-orig-ok locked'
    } else if (isOrigPick && (m.originalPickResult === 'wrong' || predictedMissed)) {
      // Picked them but they lost — or they never even made it here
      cls += ' s-orig-wrong locked'
    } else if (predictedMissed) {
      // Predicted slot: someone else actually showed up here
      cls += ' s-orig-wrong'
    } else if (isOrigPick) {
      // Picked, match not yet resolved
      cls += ' s-orig'
    }
    // (non-picks with no special state get default .pr styling — neutral)

    const row = document.createElement('div'); row.className = cls; row.style.position = 'relative'
    const seedEl = document.createElement('span'); seedEl.className = 'pr-seed'; seedEl.textContent = p.seed || ''
    const nameEl = document.createElement('span'); nameEl.className = 'pr-name'; nameEl.textContent = p.name || '—'
    const dotEl = document.createElement('div'); dotEl.className = 'pr-dot'

    row.appendChild(seedEl)
    row.appendChild(nameEl)
    row.appendChild(dotEl)
    return row
  }

  const rowsWrap = document.createElement('div')
  rowsWrap.style.cssText = 'overflow:hidden;border-radius:5px 5px 0 0;flex-shrink:0'
  rowsWrap.appendChild(makeViewerRow(m.p1, 'p1'))
  rowsWrap.appendChild(makeViewerRow(m.p2, 'p2'))
  card.appendChild(rowsWrap)

  // ── ACTUAL PLAYER LABELS (ri >= 1 only) ──
  // Historical context: when the friend mispredicted a slot, float the player who
  // ACTUALLY reached it (the true winner of the feeder) outside the card.
  // Neutral styling on purpose — this is a record of what happened, not a pick
  // result. Green/red is reserved for the friend's pick (right/wrong). No label
  // when the friend was right (prediction === actual) or the slot is undecided.
  if (hasActuals && ri >= 1) {
    function makeActualLabel(actualP, pos) {
      if (!actualP || !actualP.name) return
      const predictedName = pos === 'top' ? m.p1.name : m.p2.name
      if (actualP.name === predictedName) return  // friend was right about this slot
      const lbl = document.createElement('div')
      lbl.className = 'mc-actual-' + pos
      lbl.textContent = actualP.name
      card.appendChild(lbl)
    }
    makeActualLabel(m.actualP1, 'top')
    makeActualLabel(m.actualP2, 'bot')
  }

  // No score footer, no pick clicks, no commissioner controls, no backup glow.

  wrap.appendChild(card)
}
