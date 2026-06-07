// Commissioner — Results tab. Match-by-match winner confirmation + undo + search.
// Split from commissioner.js on 2026-06-01 (audit part E).

import { activeDraw, state } from './state.js'
import { reloadActiveDraw } from './data.js'
import { applyWinner, undoWinner, clearMatchPickForward } from './picks.js'
import { buildDrawView } from './draw-view.js'
import { renderBracketLayout } from './bracket-layout.js'
import { $c } from './commissioner-shared.js'
import { supabase } from './supabase.js'

// ── SEARCH STATE ──
// Survives re-renders so a pending query auto-fires after tab/gender switch.
let _pendingSearch = null
export function setPendingSearch(q) { _pendingSearch = q }

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

// Results-only occupant: a future-round slot is filled ONLY by the feeder match's
// confirmed winner — never a projected pick (originalPick/matchPick). Round 0 is the
// real draw, so its slots are always the actual players. Keeps the Results screen
// strictly about confirmed players (and prevents confirming a winner on a predicted
// matchup), without touching buildDrawView, which the live bracket still uses to
// project picks forward.
function _resultOccupant(d, m, ri, mi, side) {
  if (ri === 0) return m[side]
  const feeder = d.rounds[ri - 1]?.matches[mi * 2 + (side === 'p1' ? 0 : 1)]
  if (feeder && feeder.winner) {
    const seed = feeder.p1?.name === feeder.winner ? feeder.p1.seed
      : feeder.p2?.name === feeder.winner ? feeder.p2.seed : ''
    return { name: feeder.winner, seed }
  }
  return { name: '', seed: '' }
}

function _placeResultCard(d, m, ri, mi, x, y, wrap) {
  const p1 = _resultOccupant(d, m, ri, mi, 'p1')
  const p2 = _resultOccupant(d, m, ri, mi, 'p2')
  const hasResult = !!m.winner
  const card = document.createElement('div')
  card.className = 'mc' + (hasResult ? ' res-done' : '')
  card.style.cssText = `left:${x}px;top:${y}px`
  card.dataset.ri = ri; card.dataset.mi = mi

  function makeResultRow(p, side, isWinner, isLoser, clickable) {
    const row = document.createElement('div')
    let cls = 'pr'
    if (isWinner) cls += ' res-winner'
    else if (isLoser) cls += ' res-loser'
    else if (clickable) cls += ' res-clickable'
    row.className = cls

    const seedEl = document.createElement('span'); seedEl.className = 'pr-seed'; seedEl.textContent = p.seed || ''
    const nameEl = document.createElement('span'); nameEl.className = 'pr-name'; nameEl.textContent = p.name || '—'
    row.appendChild(seedEl); row.appendChild(nameEl)

    // Pencil edit button — R1 only
    if (ri === 0) {
      const editBtn = document.createElement('button')
      editBtn.className = 'pr-edit-btn'; editBtn.textContent = '✎'; editBtn.title = 'Edit player'
      editBtn.addEventListener('click', e => { e.stopPropagation(); openEditPlayerModal(ri, mi, side) })
      row.appendChild(editBtn)
    }

    if (clickable && p.name) {
      row.addEventListener('click', async () => {
        row.style.pointerEvents = 'none'
        await applyWinner(d, ri, mi, p.name, { renderStats: () => {}, renderBracket: () => {} })
        renderResults()
      })
    }
    return row
  }

  const p1Winner = hasResult && m.winner === p1.name
  const p2Winner = hasResult && m.winner === p2.name
  const canClick = !hasResult && p1.name && p2.name

  const rowsWrap = document.createElement('div')
  rowsWrap.style.cssText = 'overflow:hidden;border-radius:5px 5px 0 0;flex-shrink:0'
  rowsWrap.appendChild(makeResultRow(p1, 'p1', p1Winner, hasResult && !p1Winner, canClick))
  rowsWrap.appendChild(makeResultRow(p2, 'p2', p2Winner, hasResult && !p2Winner, canClick))
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

  function _isOnResultsTab() {
    const active = document.querySelector('#comm-hdr-nav .hdr-nav-link.active')
    return active?.dataset.tab === 'results'
  }

  function _switchToResultsTab() {
    document.querySelector('#comm-hdr-nav .hdr-nav-link[data-tab="results"]')?.click()
  }

  function _switchGender(gender) {
    // gender: 'MS' | 'WS'. Clicks the correct seg button (index 0 = MS, 1 = WS).
    const idx = gender === 'MS' ? 0 : 1
    const btns = document.querySelectorAll('#comm-seg-control .seg-btn')
    btns[idx]?.click()
  }

  function _drawHasPlayer(d, lower) {
    if (!d) return false
    return d.rounds[0].matches.some(m =>
      (m.p1?.name || '').toLowerCase().includes(lower) ||
      (m.p2?.name || '').toLowerCase().includes(lower)
    )
  }

  function runSearch(q) {
    if (newClear) newClear.classList.toggle('visible', q.length > 0)

    if (!q || q.length < 2) {
      wrap?.querySelectorAll('.mc').forEach(c => c.classList.remove('res-search-highlight'))
      return
    }

    // Step 1: ensure we're on the Results tab
    if (!_isOnResultsTab()) {
      _pendingSearch = q
      _switchToResultsTab()
      return
    }

    if (!wrap) return
    const lower = q.toLowerCase()
    wrap.querySelectorAll('.mc').forEach(c => c.classList.remove('res-search-highlight'))

    let found = false
    wrap.querySelectorAll('.mc').forEach(card => {
      const names = Array.from(card.querySelectorAll('.pr-name')).map(n => n.textContent.toLowerCase())
      if (names.some(n => n.includes(lower))) {
        card.classList.add('res-search-highlight')
        found = true
      }
    })

    if (found) {
      const first = wrap.querySelector('.mc.res-search-highlight')
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      return
    }

    // Step 2: not found in current draw — check the other gender
    const d = activeDraw()
    if (!d) return
    const otherGender = d.draw === 'MS' ? 'WS' : 'MS'
    const otherDraw = state.draws.find(x => x.draw === otherGender && x.slam === d.slam && x.year === d.year)
    if (otherDraw && _drawHasPlayer(otherDraw, lower)) {
      _pendingSearch = q
      _switchGender(otherGender)
    }
  }

  newInput.addEventListener('input', e => runSearch(e.target.value.trim()))
  newClear?.addEventListener('click', () => { newInput.value = ''; runSearch('') })

  // Auto-fire a query that was set before this render (e.g. after tab/gender switch)
  if (_pendingSearch !== null) {
    const q = _pendingSearch
    _pendingSearch = null
    newInput.value = q
    runSearch(q)
  }
}

// ── EDIT PLAYER MODAL ──
let editCtx = null

export function openEditPlayerModal(ri, mi, side) {
  const d = activeDraw(); if (!d) return
  const m = d.rounds[ri].matches[mi]
  editCtx = { ri, mi, side }
  document.getElementById('epm-title').textContent = 'Edit player — ' + (m[side].name || 'empty slot')
  document.getElementById('epm-seed').value = m[side].seed || ''
  document.getElementById('epm-name').value = m[side].name || ''
  document.getElementById('edit-player-modal').style.display = 'flex'
  setTimeout(() => document.getElementById('epm-name').focus(), 50)
}

export async function confirmEditPlayer() {
  if (!editCtx) return
  const d = activeDraw(); if (!d) return
  const { ri, mi, side } = editCtx
  const m = d.rounds[ri].matches[mi]
  const oldName = m[side].name
  const newName = document.getElementById('epm-name').value.trim()
  const newSeed = document.getElementById('epm-seed').value.trim()
  m[side] = { name: newName, seed: newSeed }
  if (m.matchPick === oldName) m.matchPick = null
  if (m.originalPick === oldName) m.originalPick = null

  // Post-lock round-0 roster change: stamp the match so every player's app can
  // detect the change at load and reopen it for a one-time repick. Only when the
  // name actually changed, the draw is locked, and this is a round-0 (actual draw) match.
  const isPostLockRosterChange = d.locked && ri === 0 && oldName && oldName !== newName
  const rosterChangedAt = isPostLockRosterChange ? new Date().toISOString() : null

  if (state.currentUser?.is_commissioner && m.db_id) {
    const update = {}
    if (side === 'p1') { update.p1_name = newName; update.p1_seed = newSeed }
    else { update.p2_name = newName; update.p2_seed = newSeed }
    if (rosterChangedAt) update.roster_changed_at = rosterChangedAt
    await supabase.from('matches').update(update).eq('id', m.db_id)
    if (rosterChangedAt) m.roster_changed_at = rosterChangedAt
  }

  if (oldName && oldName !== newName) {
    if (d.locked) {
      // In-memory only — each player's stale pick is detected at load time in data.js.
      // We do NOT write to the picks table here: RLS would only update the commissioner's
      // own row, and the right logic is per-user (only flag users who picked the old player).
      m.originalPick = null
      m.matchPick = null
      m.editedAfterLock = true
    } else {
      // Pre-lock: clear the old player's pick from future rounds
      clearMatchPickForward(d, ri, mi, oldName)
    }
  }

  // Re-derive slot occupants so R2+ reflect the new player before rendering.
  buildDrawView(d)
  closeModal(); editCtx = null
  renderResults()
}

export function closeModal() {
  const modal = document.getElementById('edit-player-modal')
  modal.style.display = 'none'
  document.getElementById('epm-inputs').style.display = ''
  document.getElementById('epm-subtitle').textContent = 'Update name and seed. Picks for this player will be cleared.'
  document.getElementById('epm-btn-area').innerHTML = `
    <button id="epm-confirm" style="flex:1;padding:9px;background:var(--accent);color:var(--accent-text);border:none;border-radius:7px;font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer">Update player</button>
    <button id="epm-cancel" style="padding:9px 16px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);border-radius:7px;font-family:var(--sans);font-size:13px;cursor:pointer">Cancel</button>`
  document.getElementById('epm-cancel').addEventListener('click', closeModal)
  document.getElementById('epm-confirm').addEventListener('click', confirmEditPlayer)
}
