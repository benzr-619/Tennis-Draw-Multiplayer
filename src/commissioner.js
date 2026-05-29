// Commissioner screen — Chat 2
// Draw upload/parse/confirm, original picks lock, backup pick locks

import { supabase } from './supabase.js'
import { state, activeDraw } from './state.js'
import { loadAllDraws, loadLockSchedules, slamLabel } from './data.js'
import { renderBracket } from './bracket.js'
import { renderStats } from './stats.js'
import { extractPdfText, parseTnnsText } from './parser.js'

const ROUND_SIZES = [64, 32, 16, 8, 4, 2, 1]

// ── MODULE STATE ──
let _initialized = false
let parsedR1 = null            // [{p1_name, p1_seed, p2_name, p2_seed}]
let selectedLockCards = new Set()  // 'ri_mi'

function $c(id) { return document.getElementById(id) }

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── INIT ──
export function initCommissioner() {
  // Refresh dynamic content every visit
  renderLockManaging()

  if (_initialized) return
  _initialized = true

  // Populate year selector
  const yearSel = $c('comm-year-sel')
  if (yearSel) {
    const yr = new Date().getFullYear()
    yearSel.innerHTML = [yr - 1, yr, yr + 1]
      .map(y => `<option value="${y}"${y === yr ? ' selected' : ''}>${y}</option>`)
      .join('')
  }

  // Tab switching
  document.querySelectorAll('.comm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      document.querySelectorAll('.comm-tab').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      document.querySelectorAll('.comm-tab-pane').forEach(p => { p.style.display = 'none' })
      const pane = $c('comm-pane-' + tab)
      if (pane) pane.style.display = ''
      if (tab === 'lock') renderLockManaging()
    })
  })

  initDropZone()
  $c('comm-parse-btn')?.addEventListener('click', handleParseClick)
  $c('comm-confirm-btn')?.addEventListener('click', handleConfirmDraw)
}

// ── DROP ZONE ──
function initDropZone() {
  const dz = $c('comm-drop-zone')
  const fi = $c('comm-file-input')
  if (!dz || !fi) return

  dz.addEventListener('click', () => fi.click())
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over') })
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'))
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelected(file)
  })
  fi.addEventListener('change', () => {
    if (fi.files[0]) handleFileSelected(fi.files[0])
  })
}

function handleFileSelected(file) {
  const label = $c('comm-drop-label')
  if (label) label.textContent = file.name
  const parseBtn = $c('comm-parse-btn')
  if (parseBtn) parseBtn.style.display = ''
  window._commPendingFile = file
  // Reset previous parse results
  parsedR1 = null
  const confirmBtn = $c('comm-confirm-btn')
  if (confirmBtn) confirmBtn.style.display = 'none'
  const r1wrap = $c('comm-r1-wrap')
  if (r1wrap) r1wrap.style.display = 'none'
  setDrawMsg('')
}

async function handleParseClick() {
  const file = window._commPendingFile
  if (!file) return
  const btn = $c('comm-parse-btn')
  btn.disabled = true; btn.textContent = 'Parsing…'
  setDrawMsg('')

  try {
    const text = await extractPdfText(file)
    parsedR1 = parseTnnsText(text)
    if (!parsedR1 || parsedR1.length === 0) {
      throw new Error('No matches found. Is this a TNNS Live draw PDF?')
    }
    renderR1Table(parsedR1)
    const confirmBtn = $c('comm-confirm-btn')
    if (confirmBtn) confirmBtn.style.display = ''
    setDrawMsg('Parsed ' + parsedR1.length + ' R1 matches. Review below, then confirm.', 'success')
  } catch (err) {
    setDrawMsg('Parse error: ' + err.message, 'error')
  } finally {
    btn.disabled = false; btn.textContent = 'Parse draw'
  }
}

function renderR1Table(r1) {
  const wrap = $c('comm-r1-wrap')
  if (!wrap) return
  wrap.style.display = ''

  const headerRow = `
    <div style="display:grid;grid-template-columns:24px 1fr 60px 1fr 60px;gap:6px;padding:0 0 6px;border-bottom:1px solid var(--border);margin-bottom:4px">
      <span></span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text3);text-transform:uppercase">Player 1 name</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text3);text-transform:uppercase">Seed</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text3);text-transform:uppercase">Player 2 name</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--text3);text-transform:uppercase">Seed</span>
    </div>`

  const rows = r1.map((m, i) => `
    <div class="match-edit-row" data-mi="${i}">
      <span class="match-num">${i + 1}</span>
      <input type="text" value="${escHtml(m.p1_name)}" placeholder="Player name">
      <input type="text" maxlength="4" value="${escHtml(m.p1_seed)}" placeholder="Seed">
      <input type="text" value="${escHtml(m.p2_name)}" placeholder="Player name">
      <input type="text" maxlength="4" value="${escHtml(m.p2_seed)}" placeholder="Seed">
    </div>`).join('')

  wrap.innerHTML = `
    <div style="font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3);margin-bottom:10px">
      Round 1 — review and edit if needed
    </div>
    ${headerRow}
    <div style="max-height:420px;overflow-y:auto">${rows}</div>
  `
}

function readR1FromTable() {
  const rows = $c('comm-r1-wrap')?.querySelectorAll('.match-edit-row') || []
  return Array.from(rows).map(row => {
    const inputs = row.querySelectorAll('input')
    return {
      p1_name: inputs[0]?.value.trim() || '',
      p1_seed: inputs[1]?.value.trim() || '',
      p2_name: inputs[2]?.value.trim() || '',
      p2_seed: inputs[3]?.value.trim() || '',
    }
  })
}

// ── CONFIRM DRAW ──
async function handleConfirmDraw() {
  if (!state.currentUser?.is_commissioner) return

  const slam = $c('comm-slam-sel')?.value
  const drawType = $c('comm-draw-sel')?.value
  const year = $c('comm-year-sel')?.value

  if (!slam) { setDrawMsg('Select a slam.', 'error'); return }
  if (!drawType) { setDrawMsg('Select draw type.', 'error'); return }
  if (!year) { setDrawMsg('Select a year.', 'error'); return }
  if (!parsedR1 || parsedR1.length === 0) { setDrawMsg('No parsed matches to confirm.', 'error'); return }

  const btn = $c('comm-confirm-btn')
  btn.disabled = true; btn.textContent = 'Saving…'
  setDrawMsg('')

  try {
    const r1 = readR1FromTable()

    // Check if draw already exists
    const { data: existing } = await supabase
      .from('draws').select('id')
      .eq('slam', slam).eq('draw_type', drawType).eq('year', year)
      .maybeSingle()

    let drawId
    if (existing) {
      // Wipe existing matches, reset lock state
      await supabase.from('matches').delete().eq('draw_id', existing.id)
      await supabase.from('draws')
        .update({ original_picks_locked: false }).eq('id', existing.id)
      drawId = existing.id
    } else {
      const { data: newDraw, error: de } = await supabase
        .from('draws')
        .insert({ slam, draw_type: drawType, year })
        .select('id').single()
      if (de) throw de
      drawId = newDraw.id
    }

    // Build 127 match rows: R1 from parsed data, R2–F empty
    const matchInserts = []
    for (let ri = 0; ri < ROUND_SIZES.length; ri++) {
      const size = ROUND_SIZES[ri]
      for (let mi = 0; mi < size; mi++) {
        if (ri === 0) {
          const m = r1[mi] || {}
          matchInserts.push({
            draw_id: drawId, round_index: ri, match_index: mi,
            p1_name: m.p1_name || '', p1_seed: m.p1_seed || '',
            p2_name: m.p2_name || '', p2_seed: m.p2_seed || '',
          })
        } else {
          matchInserts.push({
            draw_id: drawId, round_index: ri, match_index: mi,
            p1_name: '', p1_seed: '', p2_name: '', p2_seed: '',
          })
        }
      }
    }

    const { error: me } = await supabase.from('matches').insert(matchInserts)
    if (me) throw me

    // Reload state and switch to new draw
    await loadAllDraws()
    const newIdx = state.draws.findIndex(d => d.db_id === drawId)
    if (newIdx >= 0) state.activeTab = newIdx

    // Reset form
    parsedR1 = null
    window._commPendingFile = null
    const dropLabel = $c('comm-drop-label')
    if (dropLabel) dropLabel.textContent = 'Drop PDF here or click to select'
    const r1wrap = $c('comm-r1-wrap')
    if (r1wrap) { r1wrap.innerHTML = ''; r1wrap.style.display = 'none' }
    $c('comm-confirm-btn').style.display = 'none'
    $c('comm-parse-btn').style.display = 'none'

    const label = slam + ' ' + year + ' ' + drawType
    setDrawMsg('Draw saved — ' + label + ' (' + r1.length + ' R1 matches). Navigate to Bracket to view.', 'success')

    // Notify main.js so it can refresh the bracket screen header
    window.dispatchEvent(new CustomEvent('draw-uploaded'))
  } catch (err) {
    setDrawMsg('Error saving draw: ' + err.message, 'error')
    btn.disabled = false; btn.textContent = 'Confirm draw'
    return
  }

  btn.disabled = false; btn.textContent = 'Confirm draw'
}

// ── LOCK MANAGING ──
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
          ? `<button class="comm-btn comm-btn-danger" id="lock-orig-now-btn">Lock original picks now</button>`
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
  $c('lock-sel-btn')?.addEventListener('click', () => handleBackupLock(true))
  $c('unlock-sel-btn')?.addEventListener('click', () => handleBackupLock(false))
  $c('clear-sel-btn')?.addEventListener('click', () => {
    selectedLockCards.clear()
    renderLockBracket()
    updateLockActionBar()
  })

  renderLockBracket()
}

function renderLockBracket() {
  const d = activeDraw()
  const container = $c('lock-bracket')
  if (!d || !container) return

  container.innerHTML = ''
  d.rounds.forEach((round, ri) => {
    const col = document.createElement('div')
    col.className = 'lock-round'

    const lbl = document.createElement('div')
    lbl.className = 'lock-round-label'
    lbl.textContent = round.label
    col.appendChild(lbl)

    round.matches.forEach((m, mi) => {
      const key = ri + '_' + mi
      const isLocked = isMatchBackupLocked(ri, mi)
      const isSelected = selectedLockCards.has(key)

      const card = document.createElement('div')
      card.className = 'lock-card'
        + (isLocked ? ' is-locked' : '')
        + (isSelected ? ' selected' : '')

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">
          <div style="flex:1;min-width:0">
            <div class="lock-card-p">${escHtml(m.p1.name || '—')}</div>
            <div class="lock-card-p">${escHtml(m.p2.name || '—')}</div>
          </div>
          ${isLocked ? '<span style="font-size:10px;flex-shrink:0">🔒</span>' : ''}
        </div>`

      card.addEventListener('click', () => {
        if (selectedLockCards.has(key)) selectedLockCards.delete(key)
        else selectedLockCards.add(key)
        renderLockBracket()
        updateLockActionBar()
      })
      col.appendChild(card)
    })

    container.appendChild(col)
  })
}

function isMatchBackupLocked(ri, mi) {
  return (state.lockSchedules || []).some(ls => {
    if (ls.lock_type !== 'backup_picks') return false
    if (!ls.locked_at) return false
    if (ls.round_index !== ri) return false
    const start = ls.match_index_start ?? 0
    const end = ls.match_index_end ?? 999
    return mi >= start && mi <= end
  })
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
    // 1. Set draws.original_picks_locked = true
    const { error: de } = await supabase
      .from('draws').update({ original_picks_locked: true }).eq('id', d.db_id)
    if (de) throw de

    // 2. Snapshot original_pick = pick for all picks in this draw
    const { data: allPicks, error: pe } = await supabase
      .from('picks').select('id, pick').eq('draw_id', d.db_id)
    if (pe) throw pe

    for (const pk of (allPicks || [])) {
      await supabase.from('picks').update({ original_pick: pk.pick }).eq('id', pk.id)
    }

    // 3. Update local state
    d.locked = true
    d.rounds.forEach(r => r.matches.forEach(m => { m.originalPick = m.pick }))

    // 4. Re-render bracket + stats
    renderStats()
    renderBracket()
    // Refresh lock managing UI
    renderLockManaging()
    setLockOrigMsg('Original picks locked.', 'success')
  } catch (err) {
    setLockOrigMsg('Error: ' + err.message, 'error')
    if (btn) { btn.disabled = false; btn.textContent = 'Lock original picks now' }
  }
}

async function handleBackupLock(shouldLock) {
  if (!state.currentUser?.is_commissioner) return
  const d = activeDraw()
  if (!d || selectedLockCards.size === 0) return

  // Group by round
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
        // Build contiguous ranges and insert one lock_schedules row per range
        const ranges = []
        let start = sorted[0], end = sorted[0]
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] === end + 1) { end = sorted[i] }
          else { ranges.push([start, end]); start = sorted[i]; end = sorted[i] }
        }
        ranges.push([start, end])

        for (const [s, e] of ranges) {
          const { error } = await supabase.from('lock_schedules').insert({
            draw_id: d.db_id,
            round_index: ri,
            match_index_start: s,
            match_index_end: e,
            lock_type: 'backup_picks',
            locked_at: new Date().toISOString(),
          })
          if (error) throw error
        }
      } else {
        // Unlock: null out locked_at on any schedule covering these matches
        for (const mi of sorted) {
          const matching = (state.lockSchedules || []).filter(ls =>
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
    renderBracket()
    renderLockManaging()
    setLockBackupMsg(shouldLock ? 'Selected matches locked.' : 'Selected matches unlocked.', 'success')
  } catch (err) {
    setLockBackupMsg('Error: ' + err.message, 'error')
  }
}

// ── MSG HELPERS ──
function setDrawMsg(msg, type) {
  const el = $c('comm-draw-msg')
  if (!el) return
  el.className = 'comm-msg' + (type ? ' ' + type : '')
  el.textContent = msg
}

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
