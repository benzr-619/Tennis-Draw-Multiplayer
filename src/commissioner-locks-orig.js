// Commissioner — Lock Managing tab: ORIGINAL PICKS lock.
// Split from commissioner-locks.js on 2026-06-02 (Chat 11 file-size split).
// Controls + handlers + schedule modal for the single per-draw original-picks lock.

import { supabase } from './supabase.js'
import { state, activeDraw } from './state.js'
import { loadLockSchedules } from './data.js'
import { $c } from './commissioner-shared.js'
import { renderLockManaging, setLockOrigMsg, resetModalTitles } from './commissioner-locks.js'

// ── RENDER ──

export function renderOrigPicksLockControls(d) {
  if (d.locked) {
    return `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--text3);font-family:var(--mono)">Original picks are locked.</span>
        <button class="comm-btn comm-btn-secondary" id="lock-orig-unlock-btn">Unlock (testing only)</button>
      </div>`
  }

  const sched = getOrigPicksSchedule(d)
  if (sched) {
    const schedTime = new Date(sched.scheduled_at).toLocaleString()
    return `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--text2);font-family:var(--mono)">🕐 Scheduled: ${schedTime}</span>
        <button class="comm-btn comm-btn-danger" id="lock-orig-now-btn">Lock now</button>
        <button class="comm-btn comm-btn-secondary" id="lock-orig-cancel-sched-btn">Cancel</button>
      </div>`
  }

  return `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="comm-btn comm-btn-primary" id="lock-orig-sched-btn">Schedule lock…</button>
      <button class="comm-btn comm-btn-secondary" id="lock-orig-now-btn">Lock now</button>
    </div>`
}

export function wireOrigPicksLock() {
  $c('lock-orig-now-btn')?.addEventListener('click', handleLockOrigNow)
  $c('lock-orig-sched-btn')?.addEventListener('click', () => openOrigPicksScheduleModal())
  $c('lock-orig-cancel-sched-btn')?.addEventListener('click', handleCancelOrigPicksSchedule)
  $c('lock-orig-unlock-btn')?.addEventListener('click', handleUnlockOrigPicks)
}

// ── HANDLERS ──

// Lock immediately from client (no waiting for Edge Function).
async function handleLockOrigNow() {
  if (!state.currentUser?.is_commissioner) return
  const d = activeDraw()
  if (!d || d.locked) return

  const btn = $c('lock-orig-now-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Locking…' }
  setLockOrigMsg('')

  try {
    await _doLockOriginalPicks(d)
    renderLockManaging()
    setLockOrigMsg('Original picks locked.', 'success')
  } catch (err) {
    setLockOrigMsg('Error: ' + err.message, 'error')
    if (btn) { btn.disabled = false; btn.textContent = 'Lock now' }
  }
}

// The actual DB work — called by handleLockOrigNow and the schedule modal's "now" path.
// No confirm dialogs. Confirmation happens at schedule/action time in the UI.
async function _doLockOriginalPicks(d) {
  // 1. Lock the draw
  const { error: de } = await supabase
    .from('draws').update({ original_picks_locked: true }).eq('id', d.db_id)
  if (de) throw de

  // 2. Delete any pending schedule row
  const pendingSched = getOrigPicksSchedule(d)
  if (pendingSched) {
    await supabase.from('lock_schedules').delete().eq('id', pendingSched.id)
  }

  // 3. Snapshot: original_pick = match_pick for all users
  const { data: allPicks, error: pe } = await supabase
    .from('picks').select('id, match_pick').eq('draw_id', d.db_id)
  if (pe) throw pe

  for (const pk of (allPicks || [])) {
    await supabase.from('picks').update({ original_pick: pk.match_pick }).eq('id', pk.id)
  }

  // 4. Update local state
  d.locked = true
  d.rounds.forEach(r => r.matches.forEach(m => { m.originalPick = m.matchPick }))
  await loadLockSchedules()
}

function openOrigPicksScheduleModal() {
  const d = activeDraw()
  if (!d) return

  const modal = $c('lock-sched-modal')
  const input = $c('lock-sched-input')
  const schedBtn = $c('lock-sched-schedule')
  const title = $c('lock-sched-title')
  const subtitle = $c('lock-sched-subtitle')
  if (!modal) return

  if (title) title.textContent = 'Schedule original picks lock'
  if (subtitle) subtitle.textContent = `Picks will be locked at the scheduled time. This will snapshot all current picks and cannot be undone.`

  // Hide label row for orig picks (not relevant)
  const labelRow = $c('lock-sched-label-row')
  if (labelRow) labelRow.style.display = 'none'

  input.value = ''
  schedBtn.disabled = true
  const msgEl = $c('lock-sched-msg')
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'comm-msg' }

  modal.style.display = 'flex'
  input.oninput = () => { schedBtn.disabled = !input.value }

  $c('lock-sched-cancel').onclick = () => { modal.style.display = 'none'; resetModalTitles() }
  $c('lock-sched-now').onclick = null  // not used for orig picks — hide or ignore

  $c('lock-sched-schedule').onclick = async () => {
    if (!input.value) return
    const scheduledAt = new Date(input.value).toISOString()
    modal.style.display = 'none'
    resetModalTitles()
    await scheduleOrigPicksLock(d, scheduledAt)
  }

  modal.onclick = (e) => { if (e.target === modal) { modal.style.display = 'none'; resetModalTitles() } }
}

async function scheduleOrigPicksLock(d, scheduledAt) {
  // Remove any existing pending schedule
  const existing = getOrigPicksSchedule(d)
  if (existing) {
    await supabase.from('lock_schedules').delete().eq('id', existing.id)
  }

  const { error } = await supabase.from('lock_schedules').insert({
    draw_id: d.db_id,
    lock_type: 'original_picks',
    round_index: 0,
    scheduled_at: scheduledAt,
  })
  if (error) { setLockOrigMsg('Error scheduling: ' + error.message, 'error'); return }

  await loadLockSchedules()
  renderLockManaging()
  setLockOrigMsg('Lock scheduled for ' + new Date(scheduledAt).toLocaleString() + '.', 'success')
}

async function handleCancelOrigPicksSchedule() {
  const d = activeDraw()
  if (!d) return
  const sched = getOrigPicksSchedule(d)
  if (!sched) return

  const { error } = await supabase.from('lock_schedules').delete().eq('id', sched.id)
  if (error) { setLockOrigMsg('Error: ' + error.message, 'error'); return }

  await loadLockSchedules()
  renderLockManaging()
  setLockOrigMsg('Schedule cancelled.', 'success')
}

async function handleUnlockOrigPicks() {
  const d = activeDraw()
  if (!d) return
  const { error } = await supabase
    .from('draws').update({ original_picks_locked: false }).eq('id', d.db_id)
  if (error) { setLockOrigMsg('Error: ' + error.message, 'error'); return }
  d.locked = false
  await loadLockSchedules()
  renderLockManaging()
  setLockOrigMsg('Original picks unlocked.', 'success')
}

// ── HELPERS ──

function getOrigPicksSchedule(d) {
  return (state.lockSchedules || []).find(ls =>
    ls.draw_id === d.db_id && ls.lock_type === 'original_picks' && !ls.locked_at && ls.scheduled_at
  ) ?? null
}
