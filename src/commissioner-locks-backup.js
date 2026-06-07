// Commissioner — Lock Managing tab: BACKUP PICK locks.
// Split from commissioner-locks.js on 2026-06-02 (Chat 11 file-size split).
// Bracket card selector (with drag-select), schedule/lock-now modal, unlock,
// and the pending Scheduled Locks list (cancel / reschedule).

import { supabase } from './supabase.js'
import { state, activeDraw } from './state.js'
import { loadLockSchedules } from './data.js'
import { $c, escHtml } from './commissioner-shared.js'
import { renderLockManaging, setLockBackupMsg, resetModalTitles } from './commissioner-locks.js'

// ── MODULE STATE (backup lock card selection) ──
let selectedLockCards = new Set()  // 'ri_mi'
let _dragging = false
let _dragAddMode = true
let _dragRound = null

// Clear drag state on any mouseup (registered once at module load).
document.addEventListener('mouseup', () => { _dragging = false; _dragRound = null })

// ── WIRING (called by orchestrator after innerHTML is set) ──

export function wireBackupLock() {
  $c('lock-sel-btn')?.addEventListener('click', () => openBackupLockModal())
  $c('unlock-sel-btn')?.addEventListener('click', () => handleBackupUnlock())
  $c('clear-sel-btn')?.addEventListener('click', () => {
    selectedLockCards.clear()
    renderLockBracket()
    updateLockActionBar()
  })

  // Scheduled-locks list (event delegation)
  $c('lock-sched-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const id = btn.dataset.id
    if (btn.dataset.act === 'cancel') handleCancelScheduledLock(id)
    else if (btn.dataset.act === 'resched') openRescheduleModal(id)
  })
}

// ── SCHEDULED LOCKS LIST (pending backup locks only) ──

function pendingBackupLocks(d) {
  return (state.lockSchedules || [])
    .filter(ls => ls.draw_id === d.db_id && ls.lock_type === 'backup_picks'
      && !ls.locked_at && ls.scheduled_at)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
}

function lockRangeLabel(d, ls) {
  const round = d.rounds[ls.round_index]
  const roundName = round?.label || ('Round ' + ls.round_index)
  const s = ls.match_index_start ?? 0
  const e = ls.match_index_end ?? ((round?.matches.length ?? 1) - 1)
  const whole = round && s === 0 && e >= round.matches.length - 1
  const range = whole ? 'whole round'
    : (s === e ? 'match ' + (s + 1) : 'matches ' + (s + 1) + '–' + (e + 1))
  return roundName + ' · ' + range
}

export function renderScheduledLocksList(d) {
  const rows = pendingBackupLocks(d)
  if (rows.length === 0) {
    return '<div style="font-family:var(--mono);font-size:11px;color:var(--text3)">No scheduled backup locks pending.</div>'
  }

  const items = rows.map(ls => {
    const when = new Date(ls.scheduled_at).toLocaleString()
    const label = ls.label
      ? `<span style="font-style:italic;color:var(--text2)">"${escHtml(ls.label)}"</span> · ` : ''
    return `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border)">
        <span style="flex:1;min-width:160px;font-size:12px;color:var(--text)">
          🕐 ${label}<span style="font-family:var(--mono);font-size:11px;color:var(--text2)">${escHtml(lockRangeLabel(d, ls))}</span>
        </span>
        <span style="font-family:var(--mono);font-size:11px;color:var(--text2)">${when}</span>
        <button class="comm-btn comm-btn-secondary" data-act="resched" data-id="${ls.id}">Reschedule</button>
        <button class="comm-btn comm-btn-danger" data-act="cancel" data-id="${ls.id}">Cancel</button>
      </div>`
  }).join('')

  return `
    <div class="comm-section-title" style="font-size:12px;margin-bottom:4px">Scheduled Locks</div>
    ${items}`
}

async function handleCancelScheduledLock(id) {
  if (!state.currentUser?.is_commissioner) return
  const { error } = await supabase.from('lock_schedules').delete().eq('id', id)
  if (error) { setLockBackupMsg('Error: ' + error.message, 'error'); return }
  await loadLockSchedules()
  renderLockManaging()
  setLockBackupMsg('Scheduled lock cancelled.', 'success')
}

function toLocalInputValue(iso) {
  const dt = new Date(iso)
  const p = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`
}

function openRescheduleModal(id) {
  const d = activeDraw()
  const ls = (state.lockSchedules || []).find(x => x.id === id)
  if (!d || !ls) return

  const modal = $c('lock-sched-modal')
  const input = $c('lock-sched-input')
  const schedBtn = $c('lock-sched-schedule')
  const nowBtn = $c('lock-sched-now')
  const title = $c('lock-sched-title')
  const subtitle = $c('lock-sched-subtitle')
  if (!modal) return

  if (title) title.textContent = 'Reschedule backup pick lock'
  if (subtitle) subtitle.textContent = lockRangeLabel(d, ls) + ' — pick a new time, or lock now.'

  const labelRow = $c('lock-sched-label-row')
  if (labelRow) labelRow.style.display = ''
  const labelInput = $c('lock-sched-label')
  if (labelInput) labelInput.value = ls.label || ''

  input.value = toLocalInputValue(ls.scheduled_at)
  schedBtn.disabled = !input.value
  const msgEl = $c('lock-sched-msg')
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'comm-msg' }

  modal.style.display = 'flex'
  input.oninput = () => { schedBtn.disabled = !input.value }

  $c('lock-sched-cancel').onclick = () => { modal.style.display = 'none'; resetModalTitles() }

  nowBtn.onclick = async () => {
    const label = labelInput?.value.trim() || null
    modal.style.display = 'none'
    resetModalTitles()
    await updateScheduledLock(id, { scheduled_at: null, locked_at: new Date().toISOString(), label })
  }

  schedBtn.onclick = async () => {
    if (!input.value) return
    const label = labelInput?.value.trim() || null
    modal.style.display = 'none'
    resetModalTitles()
    await updateScheduledLock(id, { scheduled_at: new Date(input.value).toISOString(), label })
  }

  modal.onclick = (e) => { if (e.target === modal) { modal.style.display = 'none'; resetModalTitles() } }
}

async function updateScheduledLock(id, patch) {
  if (!state.currentUser?.is_commissioner) return
  const { error } = await supabase.from('lock_schedules').update(patch).eq('id', id)
  if (error) { setLockBackupMsg('Error: ' + error.message, 'error'); return }
  await loadLockSchedules()
  renderLockManaging()
  setLockBackupMsg(patch.locked_at ? 'Lock applied.' : 'Lock rescheduled.', 'success')
}

// ── BACKUP LOCK BRACKET ──

export function renderLockBracket() {
  const d = activeDraw()
  const container = $c('lock-bracket')
  if (!d || !container) return

  container.innerHTML = ''
  d.rounds.forEach((round, ri) => {
    if (ri === 0) return
    const col = document.createElement('div')
    col.className = 'lock-round'

    const lbl = document.createElement('div')
    lbl.className = 'lock-round-label'
    lbl.textContent = round.label
    col.appendChild(lbl)

    const half = Math.ceil(round.matches.length / 2)

    round.matches.forEach((m, mi) => {
      if (mi === half) {
        const divider = document.createElement('div')
        divider.style.cssText = 'border-top:1px solid var(--border);margin:6px 0'
        col.appendChild(divider)
      }

      const key = ri + '_' + mi
      const isLocked = isMatchBackupLocked(ri, mi)
      const scheduledLock = !isLocked ? getMatchScheduledLock(ri, mi) : null
      const isSelected = selectedLockCards.has(key)

      const prevRound = d.rounds[ri - 1]
      const feeder1 = prevRound?.matches[mi * 2]
      const feeder2 = prevRound?.matches[mi * 2 + 1]
      const p1Name = feeder1?.winner ? (m.p1?.name || '—') : '—'
      const p2Name = feeder2?.winner ? (m.p2?.name || '—') : '—'

      const card = document.createElement('div')
      card.className = 'lock-card'
        + (isLocked ? ' is-locked' : '')
        + (scheduledLock ? ' is-scheduled' : '')
        + (isSelected ? ' selected' : '')

      const schedTitle = scheduledLock
        ? `title="Scheduled: ${new Date(scheduledLock.scheduled_at).toLocaleString()}"` : ''

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">
          <div style="flex:1;min-width:0">
            <div class="lock-card-p">${escHtml(p1Name)}</div>
            <div class="lock-card-p">${escHtml(p2Name)}</div>
          </div>
          ${isLocked ? '<span style="font-size:10px;flex-shrink:0">🔒</span>' : ''}
          ${scheduledLock ? `<span class="lock-card-clock" ${schedTitle}>🕐</span>` : ''}
        </div>`

      card.addEventListener('mousedown', (e) => {
        e.preventDefault()
        _dragging = true
        _dragRound = ri
        _dragAddMode = !selectedLockCards.has(key)
        if (_dragAddMode) selectedLockCards.add(key)
        else selectedLockCards.delete(key)
        renderLockBracket()
        updateLockActionBar()
      })

      card.addEventListener('mouseover', () => {
        if (!_dragging || _dragRound !== ri) return
        if (_dragAddMode) selectedLockCards.add(key)
        else selectedLockCards.delete(key)
        renderLockBracket()
        updateLockActionBar()
      })

      col.appendChild(card)
    })

    container.appendChild(col)
  })
}

// ── BACKUP LOCK MODAL ──

function openBackupLockModal() {
  const d = activeDraw()
  if (!d || selectedLockCards.size === 0) return

  const modal = $c('lock-sched-modal')
  const input = $c('lock-sched-input')
  const schedBtn = $c('lock-sched-schedule')
  const nowBtn = $c('lock-sched-now')
  const title = $c('lock-sched-title')
  const subtitle = $c('lock-sched-subtitle')
  if (!modal) return

  const count = selectedLockCards.size
  if (title) title.textContent = 'Schedule backup pick lock'
  if (subtitle) subtitle.textContent = `${count} match${count > 1 ? 'es' : ''} will be locked for backup picks at the scheduled time.`

  // Show label row for backup pick locks
  const labelRow = $c('lock-sched-label-row')
  if (labelRow) labelRow.style.display = ''
  const labelInput = $c('lock-sched-label')
  if (labelInput) labelInput.value = ''

  input.value = ''
  schedBtn.disabled = true
  const msgEl = $c('lock-sched-msg')
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'comm-msg' }

  modal.style.display = 'flex'
  input.oninput = () => { schedBtn.disabled = !input.value }

  $c('lock-sched-cancel').onclick = () => { modal.style.display = 'none'; resetModalTitles() }

  nowBtn.onclick = async () => {
    const label = $c('lock-sched-label')?.value.trim() || null
    modal.style.display = 'none'
    resetModalTitles()
    await handleBackupLockInsert(null, label) // null = lock immediately (locked_at = now)
  }

  schedBtn.onclick = async () => {
    if (!input.value) return
    const scheduledAt = new Date(input.value).toISOString()
    const label = $c('lock-sched-label')?.value.trim() || null
    modal.style.display = 'none'
    resetModalTitles()
    await handleBackupLockInsert(scheduledAt, label)
  }

  modal.onclick = (e) => { if (e.target === modal) { modal.style.display = 'none'; resetModalTitles() } }
}

// Insert lock_schedules rows for the selected cards.
// scheduledAt = null → lock immediately (locked_at = now)
// scheduledAt = ISO string → scheduled (Edge Function fires it)
// label = optional string shown in the countdown pill
async function handleBackupLockInsert(scheduledAt, label = null) {
  if (!state.currentUser?.is_commissioner) return
  const d = activeDraw()
  if (!d || selectedLockCards.size === 0) return

  // Group selected cards by round
  const byRound = new Map()
  for (const key of selectedLockCards) {
    const [ri, mi] = key.split('_').map(Number)
    if (!byRound.has(ri)) byRound.set(ri, [])
    byRound.get(ri).push(mi)
  }

  try {
    for (const [ri, mis] of byRound) {
      const sorted = [...mis].sort((a, b) => a - b)

      // Compact into contiguous ranges
      const ranges = []
      let start = sorted[0], end = sorted[0]
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === end + 1) { end = sorted[i] }
        else { ranges.push([start, end]); start = sorted[i]; end = sorted[i] }
      }
      ranges.push([start, end])

      for (const [s, e] of ranges) {
        // Delete any existing overlapping rows (locked or scheduled) before inserting
        const overlapping = (state.lockSchedules || []).filter(ls =>
          ls.draw_id === d.db_id &&
          ls.lock_type === 'backup_picks' &&
          ls.round_index === ri &&
          (ls.match_index_start ?? 0) <= e &&
          (ls.match_index_end ?? 999) >= s
        )
        for (const ls of overlapping) {
          await supabase.from('lock_schedules').delete().eq('id', ls.id)
        }

        const row = {
          draw_id: d.db_id,
          round_index: ri,
          match_index_start: s,
          match_index_end: e,
          lock_type: 'backup_picks',
        }
        if (label) row.label = label
        if (scheduledAt) {
          row.scheduled_at = scheduledAt
        } else {
          row.locked_at = new Date().toISOString()
        }
        const { error } = await supabase.from('lock_schedules').insert(row)
        if (error) throw error
      }
    }

    selectedLockCards.clear()
    await loadLockSchedules()
    renderLockManaging()

    const doneMsg = scheduledAt
      ? 'Lock scheduled for ' + new Date(scheduledAt).toLocaleString() + '.'
      : 'Selected matches locked.'
    setLockBackupMsg(doneMsg, 'success')
  } catch (err) {
    setLockBackupMsg('Error: ' + err.message, 'error')
  }
}

// Unlock selected cards (clears locked_at, removes scheduled rows)
async function handleBackupUnlock() {
  if (!state.currentUser?.is_commissioner) return
  const d = activeDraw()
  if (!d || selectedLockCards.size === 0) return

  try {
    for (const key of selectedLockCards) {
      const [ri, mi] = key.split('_').map(Number)
      const matching = (state.lockSchedules || []).filter(ls =>
        ls.draw_id === d.db_id &&
        ls.lock_type === 'backup_picks' &&
        ls.round_index === ri &&
        (ls.match_index_start ?? 0) <= mi &&
        (ls.match_index_end ?? 999) >= mi
      )
      for (const ls of matching) {
        // If scheduled but not yet fired, delete the row entirely
        // If already locked, clear locked_at
        if (!ls.locked_at) {
          await supabase.from('lock_schedules').delete().eq('id', ls.id)
        } else {
          await supabase.from('lock_schedules').update({ locked_at: null }).eq('id', ls.id)
        }
      }
    }

    selectedLockCards.clear()
    await loadLockSchedules()
    renderLockManaging()
    setLockBackupMsg('Selected matches unlocked.', 'success')
  } catch (err) {
    setLockBackupMsg('Error: ' + err.message, 'error')
  }
}

// ── HELPERS ──

function isMatchBackupLocked(ri, mi) {
  const d = activeDraw()
  return (state.lockSchedules || []).some(ls => {
    if (ls.draw_id !== d?.db_id) return false
    if (ls.lock_type !== 'backup_picks') return false
    if (!ls.locked_at) return false
    if (ls.round_index !== ri) return false
    const start = ls.match_index_start ?? 0
    const end = ls.match_index_end ?? 999
    return mi >= start && mi <= end
  })
}

function getMatchScheduledLock(ri, mi) {
  const d = activeDraw()
  return (state.lockSchedules || []).find(ls => {
    if (ls.draw_id !== d?.db_id) return false
    if (ls.lock_type !== 'backup_picks') return false
    if (ls.locked_at) return false
    if (!ls.scheduled_at) return false
    if (ls.round_index !== ri) return false
    const start = ls.match_index_start ?? 0
    const end = ls.match_index_end ?? 999
    return mi >= start && mi <= end
  }) ?? null
}

function updateLockActionBar() {
  const count = selectedLockCards.size
  const countEl = $c('lock-sel-count')
  const lockBtn = $c('lock-sel-btn')
  const unlockBtn = $c('unlock-sel-btn')
  if (countEl) countEl.textContent = count === 0
    ? 'No cards selected'
    : count + ' card' + (count > 1 ? 's' : '') + ' selected'
  if (lockBtn) lockBtn.disabled = count === 0
  if (unlockBtn) unlockBtn.disabled = count === 0
}
