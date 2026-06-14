// Commissioner — Lock Managing tab (orchestrator).
// Split from commissioner.js on 2026-06-01 (audit part E).
// Sub-split on 2026-06-02 (Chat 11): original-picks lock → commissioner-locks-orig.js,
// backup-pick locks + scheduled-locks list → commissioner-locks-backup.js.
// This file owns the tab shell, wiring delegation, and the shared message/modal helpers
// that both sub-modules import.
//
// Lock philosophy (rebuilt 2026-06-02):
//   Scheduling IS the lock commitment — no further confirmation at fire time.
//   A PL/pgSQL function (fire_scheduled_locks) fires overdue rows server-side
//   every minute via pg_cron, regardless of whether any browser is open.
//   "Lock now" inserts a row with scheduled_at = now; pg_cron fires it
//   within ~1 minute, OR the commissioner can use the direct client path for
//   truly immediate locking.

import { activeDraw } from './state.js'
import { slamLabel } from './data.js'
import { $c } from './commissioner-shared.js'
import { renderOrigPicksLockControls, wireOrigPicksLock } from './commissioner-locks-orig.js'
import { renderScheduledLocksList, renderLockBracket, wireBackupLock } from './commissioner-locks-backup.js'

// ── RENDER ──

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
        Locking snapshots every player's current picks as their original pick. All future picks become backup picks. This cannot be undone.
      </div>
      ${renderOrigPicksLockControls(d)}
      <div class="comm-msg" id="lock-orig-msg"></div>
    </div>

    <!-- Backup pick locks -->
    <div class="comm-section">
      <div class="comm-section-title">Backup Pick Locks</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.7">
        Select matches below, then schedule a lock time or lock immediately. 🔒 = locked · 🕐 = scheduled.
      </div>

      <!-- Pending scheduled backup locks -->
      <div id="lock-sched-list" style="margin-bottom:18px">${renderScheduledLocksList(d)}</div>

      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <span style="font-family:var(--mono);font-size:11px;color:var(--text3)" id="lock-sel-count">No cards selected</span>
        <button class="comm-btn comm-btn-primary" id="lock-sel-btn" disabled>Schedule lock…</button>
        <button class="comm-btn comm-btn-secondary" id="unlock-sel-btn" disabled>Unlock selected</button>
        <button class="comm-btn comm-btn-secondary" id="clear-sel-btn">Clear selection</button>
      </div>
      <div class="lock-bracket" id="lock-bracket"></div>
      <div class="comm-msg" id="lock-backup-msg"></div>
    </div>
  `

  wireOrigPicksLock()
  wireBackupLock()
  renderLockBracket()
}

// ── SHARED HELPERS (used by both lock sub-modules) ──

export function resetModalTitles() {
  const title = $c('lock-sched-title')
  const subtitle = $c('lock-sched-subtitle')
  if (title) title.textContent = 'Lock selected matches'
  if (subtitle) subtitle.textContent = 'Set a date and time to schedule the lock, or lock immediately.'
  const labelInput = $c('lock-sched-label')
  if (labelInput) labelInput.value = ''
  const labelRow = $c('lock-sched-label-row')
  if (labelRow) labelRow.style.display = ''
}

export function setLockOrigMsg(msg, type) {
  const el = $c('lock-orig-msg')
  if (!el) return
  el.className = 'comm-msg' + (type ? ' ' + type : '')
  el.textContent = msg
}

export function setLockBackupMsg(msg, type) {
  const el = $c('lock-backup-msg')
  if (!el) return
  el.className = 'comm-msg' + (type ? ' ' + type : '')
  el.textContent = msg
}
