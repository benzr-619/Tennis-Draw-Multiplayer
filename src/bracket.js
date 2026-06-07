// Bracket renderer — ported verbatim from reference, adapted for Supabase pick saving

import { state, activeDraw } from './state.js'
import { isBackupPick } from './scoring.js'
import { handlePickClick, savePickToSupabase, findSeed } from './picks.js'
import { isMatchLocked } from './lock.js'
import { renderStats } from './stats.js'
import { renderBracketLayout } from './bracket-layout.js'

export function renderBracket() {
  renderBracketLayout({
    draw: activeDraw(),
    body: document.getElementById('bracket-body'),
    labelsInner: document.getElementById('round-labels-inner'),
    placeCard,
    championName: f => f.winner || f.matchPick || '—',
    emptyHTML: `
      <div class="bracket-empty">
        <div class="bracket-empty-icon">🎾</div>
        <div class="bracket-empty-title">No draw uploaded yet.</div>
        <div class="bracket-empty-sub">The commissioner will upload the draw when it's available.</div>
      </div>`,
  })
}

// ── PLACE CARD ──
export function placeCard(d, m, ri, mi, x, y, wrap) {
  let cardCls = 'mc'
  if (m.editedAfterLock) cardCls += ' st-needs-repick'
  else if (m.originalPickResult === 'correct') cardCls += ' st-correct'
  else if (m.originalPickResult === 'wrong') cardCls += ' st-wrong'

  const card = document.createElement('div')
  card.className = cardCls
  card.style.cssText = `left:${x}px;top:${y}px`
  card.dataset.ri = ri
  card.dataset.mi = mi

  function makeRow(p, side) {
    // ── ELIM SLOT: original pick was knocked out in a previous round ──
    // The eliminated original pick keeps the slot, shown red + crossed-out
    // (same as a busted round-0 pick), until a confirmed winner from the
    // feeder match displaces it — at which point buildDrawView rebuilds the
    // slot with the real winner and floats this name above (Case 2). Backup
    // picks don't project into future rounds, so the elim name always owns
    // the row here.
    if (p.elim && !m.winner) {
      const row = document.createElement('div'); row.className = 'pr s-orig-wrong'; row.style.position = 'relative'
      const seedEl = document.createElement('span'); seedEl.className = 'pr-seed'; seedEl.textContent = p.seed || ''
      const nameEl = document.createElement('span'); nameEl.className = 'pr-name'; nameEl.textContent = p.name || '—'
      const dotEl = document.createElement('div'); dotEl.className = 'pr-dot'
      row.appendChild(seedEl); row.appendChild(nameEl); row.appendChild(dotEl)
      // No click handler: elim slots aren't directly clickable.
      return row
    }

    // ── NORMAL SLOT ──
    const isOrigPick = m.originalPick && m.originalPick === p.name
    const isLivePick = m.matchPick && m.matchPick === p.name
    const isBackup = isLivePick && isBackupPick(m)
    const backupWrong = isBackup && m.winner && m.winner !== p.name
    const backupCorrect = isBackup && m.matchPickResult === 'correct'
    const isElim = m.winner && m.winner !== p.name && p.name && !isLivePick
    const origInactive = d.locked && !m.winner && isOrigPick && !isLivePick && (m.originalPick && (!m.matchPick || isBackupPick(m)))

    let cls = 'pr'
    if (!p.name) {
      cls += ' no-pick'
    } else if (isOrigPick && m.originalPickResult === 'correct') {
      cls += ' s-orig-ok locked'
    } else if (isOrigPick && m.originalPickResult === 'wrong') {
      cls += ' s-orig-wrong locked'
    } else if (isBackup && backupWrong) {
      cls += ' s-backup-wrong locked'
    } else if (isBackup) {
      cls += ' s-backup'
    } else if (origInactive) {
      cls += ' s-orig-inactive'
    } else if (isOrigPick || isLivePick) {
      cls += ' s-orig'
    } else if (isElim) {
      cls += ' s-elim'
    }

    const row = document.createElement('div'); row.className = cls; row.style.position = 'relative'
    const seedEl = document.createElement('span'); seedEl.className = 'pr-seed'; seedEl.textContent = p.seed || ''
    const nameEl = document.createElement('span'); nameEl.className = 'pr-name'; nameEl.textContent = p.name || '—'
    const dotEl = document.createElement('div'); dotEl.className = 'pr-dot'
    row.appendChild(seedEl); row.appendChild(nameEl)

    // Checkmark for correct backup pick
    if (backupCorrect) {
      const ck = document.createElement('span'); ck.className = 'pr-backup-ok-icon'; ck.textContent = '✓'
      row.appendChild(ck)
    }

    // High-confidence star
    const bothConfirmed = ri === 0
      ? (m.p1.name && m.p2.name)
      : (d.rounds[ri - 1]?.matches[mi * 2]?.winner && d.rounds[ri - 1]?.matches[mi * 2 + 1]?.winner)
    if (isLivePick && bothConfirmed && !m.winner) {
      const starEl = document.createElement('button')
      starEl.className = 'pr-star' + (m.highConfidence ? ' is-high' : '')
      starEl.textContent = m.highConfidence ? '★' : '☆'
      starEl.title = m.highConfidence ? 'High confidence (click to clear)' : 'Mark as high confidence'
      starEl.addEventListener('click', async e => {
        e.stopPropagation()
        m.highConfidence = !m.highConfidence
        await savePickToSupabase(m, d.db_id)
        renderStats(); renderBracket()
      })
      row.appendChild(starEl)
    }
    row.appendChild(dotEl)

    const isResolved = cls.includes('locked')
    const backupPickLocked = d.locked && !m.editedAfterLock && isMatchLocked(ri, mi, 'backup_picks')
    if (p.name && !m.winner && (!isResolved || m.editedAfterLock) && !backupPickLocked) {
      row.addEventListener('click', () => handlePickClick(ri, mi, p, { renderStats, renderBracket }))
    } else if (p.name && backupPickLocked) {
      row.classList.add('pick-locked')
    }
    return row
  }

  const rowsWrap = document.createElement('div')
  rowsWrap.style.cssText = 'overflow:hidden;border-radius:5px 5px 0 0;flex-shrink:0'
  rowsWrap.appendChild(makeRow(m.p1, 'p1'))
  rowsWrap.appendChild(makeRow(m.p2, 'p2'))
  card.appendChild(rowsWrap)

  // Notes input — shown when draw is locked and match has a pick
  if (d.locked && (m.matchPick || m.originalPick)) {
    const footer = document.createElement('div'); footer.className = 'mc-footer'
    const inp = document.createElement('input')
    inp.type = 'text'
    inp.className = 'mc-notes'
    inp.placeholder = 'Notes…'
    inp.value = m.notes || ''
    inp.addEventListener('click', e => e.stopPropagation())
    inp.addEventListener('change', async e => {
      m.notes = e.target.value.trim()
      await savePickToSupabase(m, d.db_id)
    })
    footer.appendChild(inp)
    card.appendChild(footer)
  }

  // ── FLOATING LABELS FOR DISPLACED ORIGINAL PICKS ──
  // The eliminated original pick is shown outside the card (red + crossed-out).
  // Which slot it belongs to is decided by buildDrawView() and delivered as
  // m.elimLabels — the renderer just paints them (audit part D removed the old
  // Case-1/Case-2 feeder-lookup hack that used to live here).
  ;(m.elimLabels || []).forEach(({ name, pos }) => {
    if (!name) return
    const lbl = document.createElement('div')
    lbl.className = `mc-orig-elim mc-orig-elim-${pos}`
    lbl.textContent = name
    card.appendChild(lbl)
  })

  // ── BACKUP PICK GLOW ──
  const upcomingBackupLock = state.lockSchedules.find(ls =>
    ls.lock_type === 'backup_picks' &&
    !ls.locked_at &&
    ls.scheduled_at &&
    new Date(ls.scheduled_at) > Date.now() &&
    ls.round_index === ri &&
    (ls.match_index_start == null || mi >= ls.match_index_start) &&
    (ls.match_index_end == null || mi <= ls.match_index_end)
  )
  if (upcomingBackupLock && !m.matchPick && !m.winner) {
    card.classList.add('needs-backup-pick')
  }

  wrap.appendChild(card)
}
