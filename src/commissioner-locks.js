// Commissioner — Lock Managing tab. Original-picks lock + backup-pick lock scheduling.
// Split from commissioner.js on 2026-06-01 (audit part E).

import { supabase } from './supabase.js'
import { state, activeDraw } from './state.js'
import { loadLockSchedules, slamLabel } from './data.js'
import { $c, escHtml } from './commissioner-shared.js'

// ── MODULE STATE (lock tab only) ──
let selectedLockCards = new Set()  // 'ri_mi'
let _dragging = false
let _dragAddMode = true
let _dragRound = null

// Clear drag state on any mouseup (registered once at module load).
document.addEventListener('mouseup', () => { _dragging = false; _dragRound = null })

export function renderLockManaging() {
  const d = activeDraw()
  const wrap = $c('comm-lock-wrap')
  if (!wrap) return

  if (!d) {
    wrap.innerHTML = '<div style="color:var(--text3);font-family:var(--mono);font-size:12px;padding:20px 0">No draw loaded. Upload a draw first.</div>'
    return
  }

  wrap.innerHTML = `
    <!-- Original picks lock -->
    <div class="comm-section">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <div class="comm-section-title" style="margin-bottom:0">Original Picks Lock</div>
        <span class="lock-status ${d.locked ? 'locked' : 'unlocked'}">
          ${d.locked ? '🔒 Locked' : '🔓 Unlocked'}
        </span>
        <span style="font-family:var(--mono);font-size:11px;color:var(--text3)">${slamLabel(d)} · ${d.draw}</span>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.7">
        Locking snapshots every player's current picks as their <em>original_pick</em>. All future picks become backup picks. This cannot be undone.
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${!d.locked
          ? (() => {
              const sched = getOrigPicksSchedule(d)
              if (sched) {
                const schedTime = new Date(sched.scheduled_at).toLocaleString()
                return `
                  <span style="font-size:12px;color:var(--text2);font-family:var(--mono)">🕐 Scheduled: ${schedTime}</span>
                  <button class="comm-btn comm-btn-danger" id="lock-orig-now-btn">Lock now</button>
                  <button class="comm-btn comm-btn-secondary" id="lock-orig-cancel-sched-btn">Cancel schedule</button>`
              }
              return `
                <button class="comm-btn comm-btn-danger" id="lock-orig-now-btn">Lock original picks now</button>
                <button class="comm-btn comm-btn-secondary" id="lock-orig-sched-btn">Schedule…</button>`
            })()
          : `<span style="font-size:12px;color:var(--text3);font-family:var(--mono)">Original picks are locked.</span>`
        }
      </div>
      <div class="comm-msg" id="lock-orig-msg"></div>
    </div>

    <!-- Backup pick locks -->
    <div class="comm-section">
      <div class="comm-section-title">Backup Pick Locks</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.7">
        Click cards to select matches, then lock or unlock them for backup picks. 🔒 = currently locked.
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <span style="font-family:var(--mono);font-size:11px;color:var(--text3)" id="lock-sel-count">No cards selected</span>
        <button class="comm-btn comm-btn-primary" id="lock-sel-btn" disabled>Lock selected</button>
        <button class="comm-btn comm-btn-secondary" id="unlock-sel-btn" disabled>Unlock selected</button>
        <button class="comm-btn comm-btn-secondary" id="clear-sel-btn">Clear selection</button>
      </div>
      <div class="lock-bracket" id="lock-bracket"></div>
      <div class="comm-msg" id="lock-backup-msg"></div>
    </div>
  `

  $c('lock-orig-now-btn')?.addEventListener('click', handleLockOriginalPicks)
  $c('lock-orig-sched-btn')?.addEventListener('click', openOrigPicksScheduleModal)
  $c('lock-orig-cancel-sched-btn')?.addEventListener('click', handleCancelOrigPicksSchedule)
  $c('lock-sel-btn')?.addEventListener('click', () => openLockScheduleModal())
  $c('unlock-sel-btn')?.addEventListener('click', () => handleBackupLock(false))
  $c('clear-sel-btn')?.addEventListener('click', () => {
    selectedLockCards.clear()
    renderLockBracket()
    updateLockActionBar()
  })

  renderLockBracket()
}

function getOrigPicksSchedule(d) {
  return (state.lockSchedules || []).find(ls =>
    ls.draw_id === d.db_id && ls.lock_type === 'original_picks' && !ls.locked_at && ls.scheduled_at
  ) ?? null
}

function openOrigPicksScheduleModal() {
  const modal = $c('lock-sched-modal')
  const input = $c('lock-sched-input')
  const schedBtn = $c('lock-sched-schedule')
  const title = $c('lock-sched-title')
  const subtitle = $c('lock-sched-subtitle')
  if (!modal) return

  if (title) title.textContent = 'Schedule original picks lock'
  if (subtitle) subtitle.textContent = 'Set a date and time to schedule the lock, or lock immediately.'

  input.value = ''
  schedBtn.disabled = true
  const msgEl = $c('lock-sched-msg')
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'comm-msg' }

  modal.style.display = 'flex'

  input.oninput = () => { schedBtn.disabled = !input.value }

  $c('lock-sched-cancel').onclick = () => {
    modal.style.display = 'none'
    resetModalTitles()
  }

  $c('lock-sched-now').onclick = async () => {
    modal.style.display = 'none'
    resetModalTitles()
    await handleLockOriginalPicks()
  }

  $c('lock-sched-schedule').onclick = async () => {
    if (!input.value) return
    const d = activeDraw()
    if (!d) return
    const scheduledAt = new Date(input.value).toISOString()
    modal.style.display = 'none'
    resetModalTitles()

    const existing = getOrigPicksSchedule(d)
    if (existing) {
      await supabase.from('lock_schedules').delete().eq('id', existing.id)
    }

    const { error } = await supabase.from('lock_schedules').insert({
      draw_id: d.db_id,
      lock_type: 'original_picks',
      scheduled_at: scheduledAt,
    })
    if (error) { setLockOrigMsg('Error scheduling: ' + error.message, 'error'); return }

    await loadLockSchedules()
    renderLockManaging()
    setLockOrigMsg('Lock scheduled for ' + new Date(scheduledAt).toLocaleString() + '.', 'success')
  }

  modal.onclick = (e) => {
    if (e.target === modal) { modal.style.display = 'none'; resetModalTitles() }
  }
}

async function handleCancelOrigPicksSchedule() {
  const d = activeDraw()
  if (!d) return
  const sched = getOrigPicksSchedule(d)
  if (!sched) return

  const { error } = await supabase.from('lock_schedules').delete().eq('id', sched.id)
  if (error) { setLockOrigMsg('Error cancelling: ' + error.message, 'error'); return }

  await loadLockSchedules()
  renderLockManaging()
  setLockOrigMsg('Schedule cancelled.', 'success')
}

function resetModalTitles() {
  const title = $c('lock-sched-title')
  const subtitle = $c('lock-sched-subtitle')
  if (title) title.textContent = 'Lock selected matches'
  if (subtitle) subtitle.textContent = 'Set a date and time to schedule the lock, or lock immediately.'
}

function renderLockBracket() {
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

async function handleLockOriginalPicks() {
  if (!state.currentUser?.is_commissioner) return
  const d = activeDraw()
  if (!d) return

  const confirmed = confirm(
    'Lock original picks for ' + slamLabel(d) + ' ' + d.draw + '?\n\n' +
    'This snapshots all current picks as original picks and cannot be undone.'
  )
  if (!confirmed) return

  const btn = $c('lock-orig-now-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Locking…' }
  setLockOrigMsg('')

  try {
    const { error: de } = await supabase
      .from('draws').update({ original_picks_locked: true }).eq('id', d.db_id)
    if (de) throw de

    const pendingSched = getOrigPicksSchedule(d)
    if (pendingSched) {
      await supabase.from('lock_schedules').delete().eq('id', pendingSched.id)
    }

    const { data: allPicks, error: pe } = await supabase
      .from('picks').select('id, match_pick').eq('draw_id', d.db_id)
    if (pe) throw pe

    for (const pk of (allPicks || [])) {
      await supabase.from('picks').update({ original_pick: pk.match_pick }).eq('id', pk.id)
    }

    d.locked = true
    d.rounds.forEach(r => r.matches.forEach(m => { m.originalPick = m.matchPick }))

    renderLockManaging()
    setLockOrigMsg('Original picks locked.', 'success')
  } catch (err) {
    setLockOrigMsg('Error: ' + err.message, 'error')
    if (btn) { btn.disabled = false; btn.textContent = 'Lock original picks now' }
  }
}

// ── LOCK SCHEDULE MODAL ──
function openLockScheduleModal() {
  const modal = $c('lock-sched-modal')
  const input = $c('lock-sched-input')
  const schedBtn = $c('lock-sched-schedule')
  if (!modal) return

  input.value = ''
  schedBtn.disabled = true
  const msgEl = $c('lock-sched-msg')
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'comm-msg' }

  modal.style.display = 'flex'

  input.oninput = () => { schedBtn.disabled = !input.value }

  $c('lock-sched-cancel').onclick = () => { modal.style.display = 'none' }

  $c('lock-sched-now').onclick = async () => {
    modal.style.display = 'none'
    await handleBackupLock(true, null)
  }

  $c('lock-sched-schedule').onclick = async () => {
    if (!input.value) return
    const scheduledAt = new Date(input.value).toISOString()
    modal.style.display = 'none'
    await handleBackupLock(true, scheduledAt)
  }

  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none' }
}

async function handleBackupLock(shouldLock, scheduledAt = null) {
  if (!state.currentUser?.is_commissioner) return
  const d = activeDraw()
  if (!d || selectedLockCards.size === 0) return

  const byRound = new Map()
  for (const key of selectedLockCards) {
    const [ri, mi] = key.split('_').map(Number)
    if (!byRound.has(ri)) byRound.set(ri, [])
    byRound.get(ri).push(mi)
  }

  try {
    for (const [ri, mis] of byRound) {
      const sorted = [...mis].sort((a, b) => a - b)

      if (shouldLock) {
        const ranges = []
        let start = sorted[0], end = sorted[0]
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] === end + 1) { end = sorted[i] }
          else { ranges.push([start, end]); start = sorted[i]; end = sorted[i] }
        }
        ranges.push([start, end])

        for (const [s, e] of ranges) {
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
          if (scheduledAt) {
            row.scheduled_at = scheduledAt
          } else {
            row.locked_at = new Date().toISOString()
          }
          const { error } = await supabase.from('lock_schedules').insert(row)
          if (error) throw error
        }
      } else {
        for (const mi of sorted) {
          const matching = (state.lockSchedules || []).filter(ls =>
            ls.draw_id === d.db_id &&
            ls.lock_type === 'backup_picks' && ls.round_index === ri &&
            (ls.match_index_start ?? 0) <= mi && (ls.match_index_end ?? 999) >= mi
          )
          for (const ls of matching) {
            await supabase.from('lock_schedules')
              .update({ locked_at: null }).eq('id', ls.id)
          }
        }
      }
    }

    selectedLockCards.clear()
    await loadLockSchedules()
    renderLockManaging()
    const doneMsg = !shouldLock
      ? 'Selected matches unlocked.'
      : scheduledAt
        ? 'Lock scheduled for ' + new Date(scheduledAt).toLocaleString() + '.'
        : 'Selected matches locked.'
    setLockBackupMsg(doneMsg, 'success')
  } catch (err) {
    setLockBackupMsg('Error: ' + err.message, 'error')
  }
}

// ── MSG HELPERS ──
function setLockOrigMsg(msg, type) {
  const el = $c('lock-orig-msg')
  if (!el) return
  el.className = 'comm-msg' + (type ? ' ' + type : '')
  el.textContent = msg
}

function setLockBackupMsg(msg, type) {
  const el = $c('lock-backup-msg')
  if (!el) return
  el.className = 'comm-msg' + (type ? ' ' + type : '')
  el.textContent = msg
}
