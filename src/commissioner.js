// Commissioner screen — orchestrator + header + Draw Management tab.
// Results tab lives in commissioner-results.js; Lock Managing tab in commissioner-locks.js.
// Split 2026-06-01 (audit part E).

import { supabase } from './supabase.js'
import { state, activeDraw, applyTheme } from './state.js'
import { loadAllDraws, slamLabel, slamKey } from './data.js'
import { extractPdfText, parseTnnsText } from './parser.js'
import { $c, escHtml } from './commissioner-shared.js'
import { renderResults, setPendingSearch } from './commissioner-results.js'
import { renderLockManaging } from './commissioner-locks.js'
import { renderOddsTab } from './commissioner-odds.js'
import { animateSegThumb } from './seg-thumb.js'

export { renderResults } from './commissioner-results.js'
export { renderLockManaging } from './commissioner-locks.js'

const ROUND_SIZES = [64, 32, 16, 8, 4, 2, 1]

// ── MODULE STATE (draw management only) ──
let _initialized = false
let parsedR1 = null  // [{p1_name, p1_seed, p2_name, p2_seed}]

// ── INIT ──
export function initCommissioner() {
  renderCommHeader()
  renderResults()

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

  // Tab switching — wired on both desktop (#comm-hdr-nav) and mobile (#comm-mobile-hdr-nav)
  const _allCommNavBtns = () => document.querySelectorAll('#comm-hdr-nav .hdr-nav-link, #comm-mobile-hdr-nav .hdr-nav-link')
  document.querySelectorAll('#comm-hdr-nav .hdr-nav-link, #comm-mobile-hdr-nav .hdr-nav-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      _allCommNavBtns().forEach(b => b.classList.remove('active'))
      document.querySelectorAll(`[data-tab="${tab}"]`).forEach(b => {
        if (b.closest('#comm-hdr-nav, #comm-mobile-hdr-nav')) b.classList.add('active')
      })
      document.querySelectorAll('.comm-tab-pane').forEach(p => p.classList.remove('pane-active'))
      const pane = $c('comm-pane-' + tab)
      if (pane) pane.classList.add('pane-active')
      if (tab === 'lock') renderLockManaging()
      if (tab === 'results') renderResults()
      if (tab === 'odds') renderOddsTab()
    })
  })

  // Cmd/Ctrl+F → focus the results search bar (and ensure Results tab is shown)
  document.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'f') return
    const screen = document.getElementById('screen-commissioner')
    if (!screen?.classList.contains('active')) return
    e.preventDefault()
    const input = document.getElementById('results-search-input')
    if (!input) return
    // Switch to results tab first if needed
    const activeTab = document.querySelector('#comm-hdr-nav .hdr-nav-link.active')?.dataset.tab
    if (activeTab !== 'results') {
      document.querySelector('#comm-hdr-nav .hdr-nav-link[data-tab="results"]')?.click()
    }
    // Focus after the tab (and any re-render) has settled
    setTimeout(() => document.getElementById('results-search-input')?.focus(), 50)
  })

  initDropZone()
  $c('comm-parse-btn')?.addEventListener('click', handleParseClick)
  $c('comm-confirm-btn')?.addEventListener('click', handleConfirmDraw)
  renderExistingDraws()
  renderGettingReadySection()
}

// ── COMMISSIONER HEADER ──
let _commSegPrevIdx = -1

export function renderCommHeader() {
  const d = activeDraw()

  // Static slam name
  const nameEl = $c('comm-slam-name')
  if (nameEl) nameEl.textContent = d ? slamLabel(d) : '—'

  // Apply theme
  if (d) applyTheme(d.slam)

  // User display (acct chip)
  const user = state.currentUser
  const userEl = $c('hdr-user-comm')
  if (userEl && user) userEl.textContent = user.display_name

  // M/W seg control
  const seg = $c('comm-seg-control')
  if (!seg) return
  seg.innerHTML = ''
  if (!d) return

  const DRAW_TYPES = [{ key: 'MS', label: "Men's", short: 'M' }, { key: 'WS', label: "Women's", short: 'W' }]
  let newActiveIdx = -1

  function _buildSegBtn(key, label, short, i, match, targetSeg) {
    const btn = document.createElement('button')
    btn.className = 'seg-btn'
    btn.innerHTML = `<span class="seg-full">${label}</span><span class="seg-short">${short}</span>`
    if (!match) { btn.disabled = true }
    else {
      if (d.draw === key) btn.classList.add('active')
      btn.addEventListener('click', () => {
        const idx = state.draws.indexOf(match)
        if (idx < 0) return
        state.activeTab = idx
        renderCommHeader()
        const activeTab = document.querySelector('#comm-hdr-nav .hdr-nav-link.active')?.dataset.tab
        if (activeTab === 'lock') renderLockManaging()
        else if (activeTab === 'odds') renderOddsTab()
        else renderResults()
      })
    }
    targetSeg.appendChild(btn)
  }

  DRAW_TYPES.forEach(({ key, label, short }, i) => {
    const match = state.draws.find(x => slamKey(x) === slamKey(d) && x.draw === key)
    if (d.draw === key) newActiveIdx = i
    _buildSegBtn(key, label, short, i, match, seg)
  })

  animateSegThumb(seg, _commSegPrevIdx, newActiveIdx)
  _commSegPrevIdx = newActiveIdx

  // Also populate mobile seg control (inside comm results pane bottom bar)
  const segMobile = document.getElementById('comm-seg-control-mobile')
  if (segMobile) {
    segMobile.innerHTML = ''
    DRAW_TYPES.forEach(({ key, label, short }, i) => {
      const match = state.draws.find(x => slamKey(x) === slamKey(d) && x.draw === key)
      _buildSegBtn(key, label, short, i, match, segMobile)
    })
    animateSegThumb(segMobile, -1, newActiveIdx)
  }
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

    // Build 127 match rows
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

    // Auto-deactivate all draws, then activate this slam's draws (MS + WS)
    await supabase.from('draws').update({ is_active: false }).neq('id', 'none')
    await supabase.from('draws')
      .update({ is_active: true })
      .eq('slam', slam).eq('year', year)

    // Reload state and set active tab to this draw
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

    setDrawMsg('Draw saved — ' + slam + ' ' + year + ' ' + drawType + ' (' + r1.length + ' R1 matches).', 'success')

    // Update commissioner header to reflect new slam
    renderCommHeader()
    renderExistingDraws()
  } catch (err) {
    setDrawMsg('Error saving draw: ' + err.message, 'error')
    btn.disabled = false; btn.textContent = 'Confirm draw'
    return
  }

  btn.disabled = false; btn.textContent = 'Confirm draw'
}

// ── GETTING READY MODE ──
function _readNextSlamForm() {
  const labelVal = $c('comm-next-slam-label')?.value.trim() || null
  const dtVal    = $c('comm-next-slam-starts-at')?.value || null
  return { labelVal, startsAt: dtVal ? new Date(dtVal).toISOString() : null }
}

async function fetchAppSettings() {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('next_slam_label, next_slam_starts_at')
      .eq('id', 1)
      .maybeSingle()
    return data || {}
  } catch (_) { return {} }
}

async function renderGettingReadySection() {
  const wrap = $c('comm-getting-ready-wrap')
  if (!wrap) return
  const settings = await fetchAppSettings()

  let dtValue = ''
  if (settings.next_slam_starts_at) {
    const d = new Date(settings.next_slam_starts_at)
    const pad = n => String(n).padStart(2, '0')
    dtValue = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  wrap.innerHTML = `
    <div class="comm-section-title" style="margin-bottom:10px">Getting Ready Mode</div>
    <p style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.6">
      Pre-fill the next slam details so players see a countdown as soon as the current slam ends.
      Use <strong>Switch to getting-ready mode</strong> to deactivate the current slam and show the waiting screen to everyone.
    </p>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
      <div>
        <label style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);display:block;margin-bottom:5px">Next slam label</label>
        <input type="text" id="comm-next-slam-label"
          value="${settings.next_slam_label ? escHtml(settings.next_slam_label) : ''}"
          placeholder="e.g. Wimbledon 2026"
          style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text);font-family:var(--sans);font-size:13px">
      </div>
      <div>
        <label style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);display:block;margin-bottom:5px">Matches start (your local time)</label>
        <input type="datetime-local" id="comm-next-slam-starts-at"
          value="${dtValue}"
          style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text);font-family:var(--mono);font-size:12px">
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="comm-btn comm-btn-secondary" id="comm-save-next-slam-btn">Save next slam info</button>
      <button class="comm-btn comm-btn-danger" id="comm-switch-getting-ready-btn">Switch to getting-ready mode</button>
    </div>
    <div class="comm-msg" id="comm-getting-ready-msg"></div>`

  $c('comm-save-next-slam-btn')?.addEventListener('click', handleSaveNextSlam)
  $c('comm-switch-getting-ready-btn')?.addEventListener('click', handleSwitchToGettingReady)
}

async function handleSaveNextSlam() {
  const msg = $c('comm-getting-ready-msg')
  const btn = $c('comm-save-next-slam-btn')
  if (btn) btn.disabled = true
  const { labelVal, startsAt } = _readNextSlamForm()
  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert({ id: 1, next_slam_label: labelVal, next_slam_starts_at: startsAt })
    if (error) throw error
    if (msg) { msg.className = 'comm-msg success'; msg.textContent = 'Next slam info saved.' }
  } catch (err) {
    if (msg) { msg.className = 'comm-msg error'; msg.textContent = 'Error: ' + err.message }
  } finally {
    if (btn) btn.disabled = false
  }
}

async function handleSwitchToGettingReady() {
  if (!state.currentUser?.is_commissioner) return
  if (!window.confirm('This will deactivate the current slam and show a getting-ready screen to all players. Continue?')) return

  const msg = $c('comm-getting-ready-msg')
  const btn = $c('comm-switch-getting-ready-btn')
  if (btn) btn.disabled = true

  try {
    const { labelVal, startsAt } = _readNextSlamForm()
    const { error: se } = await supabase
      .from('app_settings')
      .upsert({ id: 1, next_slam_label: labelVal, next_slam_starts_at: startsAt })
    if (se) throw se

    const { error: de } = await supabase
      .from('draws')
      .update({ is_active: false })
      .neq('id', 'none')
    if (de) throw de

    await loadAllDraws()
    renderCommHeader()
    renderExistingDraws()
    await renderGettingReadySection()
    if (msg) { msg.className = 'comm-msg success'; msg.textContent = 'Getting-ready mode active. All draws deactivated.' }
  } catch (err) {
    if (msg) { msg.className = 'comm-msg error'; msg.textContent = 'Error: ' + err.message }
  } finally {
    if (btn) btn.disabled = false
  }
}

// ── EXISTING DRAWS ──
export function renderExistingDraws() {
  const wrap = $c('comm-existing-draws-wrap')
  if (!wrap) return
  if (state.draws.length === 0) { wrap.innerHTML = ''; return }

  const SLAM_NAMES = { AO: 'Australian Open', RG: 'Roland Garros', WIM: 'Wimbledon', USO: 'US Open' }
  const DRAW_NAMES = { MS: "Men's Singles", WS: "Women's Singles" }

  wrap.innerHTML = '<div class="comm-section-title" style="margin-bottom:10px">Existing draws</div>'
  const list = document.createElement('div')
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px'

  state.draws.forEach(d => {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 12px;border:1px solid var(--border);border-radius:7px;background:var(--surface)'

    const label = document.createElement('span')
    label.style.cssText = 'flex:1;font-family:var(--mono);font-size:12px;color:var(--text)'
    label.textContent = `${SLAM_NAMES[d.slam] || d.slam} ${d.year} · ${DRAW_NAMES[d.draw] || d.draw}`

    const cbWrap = document.createElement('label')
    cbWrap.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-family:var(--mono);font-size:11px;color:var(--text2);white-space:nowrap'

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = d.excludeFromLeaderboard
    cb.addEventListener('change', async () => {
      cb.disabled = true
      await supabase.from('draws').update({ exclude_from_leaderboard: cb.checked }).eq('id', d.db_id)
      d.excludeFromLeaderboard = cb.checked
      cb.disabled = false
    })

    cbWrap.append(cb, 'Exclude from leaderboard')
    row.append(label, cbWrap)
    list.appendChild(row)
  })

  wrap.appendChild(list)
}

// ── MSG HELPER ──
function setDrawMsg(msg, type) {
  const el = $c('comm-draw-msg')
  if (!el) return
  el.className = 'comm-msg' + (type ? ' ' + type : '')
  el.textContent = msg
}
