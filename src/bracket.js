// Bracket renderer — ported verbatim from reference, adapted for Supabase pick saving

import { state, activeDraw } from './state.js'
import { isBackupPick, isAutoAssign, withdrawnNames, eloFavourite } from './scoring.js'
import { handlePickClick, savePickToSupabase, findSeed } from './picks.js'
import { isMatchLocked } from './lock.js'
import { renderStats } from './stats.js'
import { renderBracketLayout } from './bracket-layout.js'
import { formatAmerican } from './odds.js'
import { eloMap } from './elo.js'
import { makeFlagEl } from './flags.js'

// Per-draw ELO cache — rebuilt once when the draw ID changes, stable within a render pass
let _eloCache = { drawId: null, map: new Map(), withdrawn: new Set() }
function _getEloCache(d) {
  if (_eloCache.drawId !== d.db_id) {
    _eloCache = { drawId: d.db_id, map: eloMap(d), withdrawn: withdrawnNames(d) }
  }
  return _eloCache
}

let _renderOverride = null
export function setRenderBracketFn(fn) { _renderOverride = fn }

// Called by pick-click callbacks — dispatches to mobile renderer when override is set.
export function renderBracket() {
  if (_renderOverride) return _renderOverride()
  _doRenderBracket()
}

// Called by renderBracketDisplay directly to avoid the circular: display→renderBracket→override→display.
export function renderBracketDirect() { _doRenderBracket() }

function _doRenderBracket() {
  renderBracketLayout({
    draw: activeDraw(),
    body: document.getElementById('bracket-body'),
    labelsInner: document.getElementById('round-labels-inner'),
    placeCard,
    renderChampion: (f, x, y, wrap) => {
      const pick = f.originalPick || f.matchPick || null
      const isCorrect = !!(f.winner && pick && f.winner === pick)
      const isWrong   = !!(f.winner && pick && f.winner !== pick)
      const champDiv = document.createElement('div')
      champDiv.className = 'champ-box' + (isCorrect ? ' champ-correct' : isWrong ? ' champ-wrong' : '')
      champDiv.style.cssText = `left:${x}px;top:${y}px;position:absolute`
      const champLbl = document.createElement('div'); champLbl.className = 'champ-label'; champLbl.textContent = 'Champion'
      const champNm = document.createElement('div'); champNm.className = 'champ-name'
      if (isWrong) {
        champNm.textContent = f.winner
        const displaced = document.createElement('div')
        displaced.className = 'mc-champ-elim'
        displaced.textContent = pick
        champDiv.appendChild(displaced)
      } else if (isCorrect) {
        champNm.textContent = pick
        champNm.style.color = 'var(--green)'
      } else {
        champNm.textContent = pick || f.winner || '—'
        if (pick && !f.winner) champNm.style.color = 'var(--accent)'
      }
      champDiv.appendChild(champLbl); champDiv.appendChild(champNm); wrap.appendChild(champDiv)
    },
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

  const { map: _eloLookup, withdrawn: _withdrawnNm } = _getEloCache(d)
  const _matchIsAuto = d.original_picks_locked && isAutoAssign(m, _withdrawnNm)
  const _autoFavName = _matchIsAuto ? eloFavourite(m, _eloLookup) : null

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
      row.appendChild(seedEl); row.appendChild(makeFlagEl(d.countryMap?.[p.name]))
      const nameEl = document.createElement('span'); nameEl.className = 'pr-name'; nameEl.textContent = p.name || '—'
      row.appendChild(nameEl)
      // No click handler: elim slots aren't directly clickable.
      return row
    }

    // ── NORMAL SLOT ──
    const isOrigPick = m.originalPick && m.originalPick === p.name
    const isLivePick = m.matchPick && m.matchPick === p.name
    const isBackup = isLivePick && isBackupPick(m, d.locked)
    const backupWrong = isBackup && m.winner && m.winner !== p.name
    const backupCorrect = isBackup && m.matchPickResult === 'correct'
    const isElim = m.winner && m.winner !== p.name && p.name && !isLivePick
    const origInactive = d.locked && !m.winner && isOrigPick && !isLivePick && (m.originalPick && (!m.matchPick || isBackupPick(m, d.locked)))

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

    // Seed gutter: holds seed text + hover-toggle star (star overlays seed on hover, no layout shift)
    const gutterEl = document.createElement('div'); gutterEl.className = 'pr-seed-gutter'
    const seedEl = document.createElement('span'); seedEl.className = 'pr-seed'; seedEl.textContent = p.seed || ''
    gutterEl.appendChild(seedEl)
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
      gutterEl.appendChild(starEl)
      row.classList.add('pr-has-star')
    }
    row.appendChild(gutterEl); row.appendChild(makeFlagEl(d.countryMap?.[p.name]))
    const nameEl = document.createElement('span'); nameEl.className = 'pr-name'; nameEl.textContent = p.name || '—'
    row.appendChild(nameEl)
    // Persistent gold dot at card's left edge when high-confidence is ON
    if (isLivePick && m.highConfidence) {
      const dot = document.createElement('span'); dot.className = 'pr-hc-dot'; row.appendChild(dot)
    }
    // Mobile star: persistent between name and odds; hidden on desktop via CSS
    if (isLivePick && bothConfirmed && !m.winner) {
      const mStar = document.createElement('button')
      mStar.className = 'pr-star-mobile' + (m.highConfidence ? ' is-high' : '')
      mStar.textContent = m.highConfidence ? '★' : '☆'
      mStar.title = m.highConfidence ? 'High confidence (click to clear)' : 'Mark as high confidence'
      mStar.addEventListener('click', async e => {
        e.stopPropagation()
        m.highConfidence = !m.highConfidence
        await savePickToSupabase(m, d.db_id)
        renderStats(); renderBracket()
      })
      row.appendChild(mStar)
    }

    // Inline odds — replaces the dot; shown when any odds are available for this slot
    const slotOdds = side === 'p1' ? (m.odds_p1_locked ?? m.odds_p1_live ?? null)
      : (m.odds_p2_locked ?? m.odds_p2_live ?? null)
    const oddsLocked = side === 'p1' ? !!m.odds_p1_locked : !!m.odds_p2_locked
    if (slotOdds) {
      const oddsSpan = document.createElement('span')
      oddsSpan.className = 'pr-odds' + (oddsLocked ? ' pr-odds-locked' : '')
      oddsSpan.textContent = formatAmerican(slotOdds)
      row.appendChild(oddsSpan)
    }

    // ELO auto-assign badge — shown on the favourite's row when no valid original pick exists
    if (_autoFavName && p.name === _autoFavName) {
      row.classList.add('s-elo-auto')
      const autoBadge = document.createElement('span')
      autoBadge.className = 'pr-elo-auto'
      autoBadge.textContent = 'auto'
      row.appendChild(autoBadge)
    }

    const isResolved = cls.includes('locked')
    const backupPickLocked = d.locked && !m.editedAfterLock && isMatchLocked(ri, mi, 'backup_picks')
    const isR1PostLock = d.locked && ri === 0 && !m.editedAfterLock
    if (p.name && !m.winner && (!isResolved || m.editedAfterLock) && !backupPickLocked && !isR1PostLock) {
      row.addEventListener('click', () => handlePickClick(ri, mi, p, { renderStats, renderBracket }))
    } else if (p.name && (backupPickLocked || isR1PostLock)) {
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
