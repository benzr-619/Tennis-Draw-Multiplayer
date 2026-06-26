import { state, activeDraw, applyTheme, isMobile, hasActiveDraw } from './state.js'
import { login, signup, logout, restoreSession, updateDisplayName } from './auth.js'
import { loadAllDraws, reloadActiveDraw, slamKey, slamLabel } from './data.js'
import { renderBracket, renderBracketDirect, placeCard, setRenderBracketFn } from './bracket.js'
import { renderBracketList } from './bracket-list.js'
import { closeModal, confirmEditPlayer, renderCommRoundSelector } from './commissioner-results.js'
import { renderStats, resetStatsFilter, setCountdownClickHandler, fetchPoolSlamIndex } from './stats.js'
import { buildPrintHTML } from './print.js'
import { initCommissioner, renderResults, renderLockManaging } from './commissioner.js'
import { renderLeaderboard } from './leaderboard.js'
import { animateSegThumb } from './seg-thumb.js'
import { supabase } from './supabase.js'
import { simulateEloFill } from './elo.js'
import { savePickToSupabase } from './picks.js'
import { buildDrawView } from './draw-view.js'

// ── INIT ──
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

function $(id) { return document.getElementById(id) }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  $(id).classList.add('active')
}

// ── SEGMENTED CONTROL STATE ──
let _segPrevIdx = -1

// ── MOBILE BRACKET STATE ──
let _mobileActiveRound = 0

function defaultMobileRound(d) {
  if (!d) return 0
  for (let ri = 0; ri < d.rounds.length; ri++) {
    if (d.rounds[ri].matches.some(m => !m.winner && (m.p1?.name || m.p2?.name))) return ri
  }
  return Math.max(0, d.rounds.length - 1)
}

// Smart dispatcher: list on mobile, layout on desktop.
// Registered with setRenderBracketFn so placeCard click callbacks call this too.
function renderBracketDisplay() {
  const d = activeDraw()
  if (isMobile()) {
    renderBracketList(d, _mobileActiveRound, $('bracket-body'), placeCard)
    renderRoundSelector(d)
  } else {
    renderBracketDirect()
  }
  renderEloBanner()
}

function renderRoundSelector(d) {
  const bar = $('round-selector-bar')
  if (!bar) return
  bar.innerHTML = ''
  if (!d) return
  d.rounds.forEach((r, ri) => {
    const btn = document.createElement('button')
    btn.className = 'round-sel-btn' + (ri === _mobileActiveRound ? ' active' : '')
    btn.textContent = r.label
    btn.addEventListener('click', () => {
      _mobileActiveRound = ri
      renderBracketDisplay()
    })
    bar.appendChild(btn)
  })
}

// ── AUTH SCREEN ──
let authMode = 'login'

function setAuthMode(mode) {
  authMode = mode
  const isSignup = mode === 'signup'
  $('auth-display-name').style.display = isSignup ? '' : 'none'
  $('auth-heading').innerHTML = isSignup ? 'Create your<br><em>account.</em>' : 'Welcome<br><em>back.</em>'
  $('auth-sub').textContent = isSignup
    ? 'Pick a display name — this is what others see on the leaderboard.'
    : 'Sign in to your account to make picks and track the tournament.'
  $('auth-submit').textContent = isSignup ? 'Sign up' : 'Sign in'
  $('auth-toggle-text').textContent = isSignup ? 'Already have an account?' : "Don't have an account?"
  $('auth-toggle-link').textContent = isSignup ? 'Sign in' : 'Sign up'
  $('auth-error').className = 'auth-error'
  if (isSignup) {
    $('auth-password').autocomplete = 'new-password'
  } else {
    $('auth-password').autocomplete = 'current-password'
  }
}

$('auth-toggle-link').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'))

$('auth-form').addEventListener('submit', async e => {
  e.preventDefault()
  const btn = $('auth-submit')
  const errEl = $('auth-error')
  errEl.className = 'auth-error'
  btn.disabled = true
  btn.textContent = authMode === 'login' ? 'Signing in…' : 'Creating account…'

  const email = $('auth-email').value.trim()
  const password = $('auth-password').value
  const displayName = $('auth-display-name').value.trim()

  try {
    if (authMode === 'signup') {
      if (!displayName) throw new Error('Display name is required')
      await signup(email, password, displayName)
    } else {
      await login(email, password)
    }
    await loadAllDraws()
    await routeAfterAuth()
  } catch (err) {
    errEl.textContent = err.message
    errEl.className = 'auth-error visible'
    btn.disabled = false
    btn.textContent = authMode === 'login' ? 'Sign in' : 'Sign up'
  }
})

// ── ROUTING ──
async function routeAfterAuth() {
  document.querySelectorAll('.commish-nav').forEach(b => {
    b.hidden = !state.currentUser?.is_commissioner
  })
  await showBracketScreen()
}

// ── HEADER / NAV ──
function renderHeader() {
  const d = activeDraw()

  const nameEl = $('slam-name-label')
  if (nameEl) nameEl.textContent = d ? slamLabel(d) : '—'

  const lbNameEl = $('lb-slam-name-label')
  if (lbNameEl) lbNameEl.textContent = d ? slamLabel(d) : '—'

  // Populate M/W seg (desktop row 2 and mobile bottom bar share the same build logic)
  const DRAW_TYPES = [{ key: 'MS', label: "Men's", short: 'M' }, { key: 'WS', label: "Women's", short: 'W' }]

  function _buildSeg(segEl) {
    if (!segEl || !d) return
    segEl.innerHTML = ''
    let activeSegIdx = 0
    DRAW_TYPES.forEach(({ key, label, short }, i) => {
      const btn = document.createElement('button')
      btn.className = 'seg-btn'
      btn.innerHTML = `<span class="seg-full">${label}</span><span class="seg-short">${short}</span>`
      const match = state.draws.find(x => slamKey(x) === slamKey(d) && x.draw === key)
      if (!match) { btn.disabled = true }
      else {
        if (d.draw === key) { btn.classList.add('active'); activeSegIdx = i }
        btn.addEventListener('click', () => {
          const idx = state.draws.indexOf(match)
          if (idx >= 0) switchTab(idx)
        })
      }
      segEl.appendChild(btn)
    })
    return activeSegIdx
  }

  const seg = $('seg-control')
  const activeIdx = _buildSeg(seg)
  if (seg && d) {
    animateSegThumb(seg, _segPrevIdx, activeIdx)
    _segPrevIdx = activeIdx
  }

  // Mobile bottom bar M/W seg — same logic, no animation tracking needed
  const segMobile = $('seg-control-mobile')
  if (segMobile && d) {
    _buildSeg(segMobile)
    animateSegThumb(segMobile, -1, activeIdx)
  }

  // User display
  const user = state.currentUser
  const userEl = $('hdr-user')
  const userLbEl = $('hdr-user-lb')
  if (userEl && user) userEl.textContent = user.display_name
  if (userLbEl && user) userLbEl.textContent = user.display_name
}

async function switchTab(i) {
  state.activeTab = i
  resetStatsFilter()
  const d = state.draws[i]
  if (!d) return
  applyTheme(d.slam)
  await reloadActiveDraw()
  if (isMobile()) _mobileActiveRound = defaultMobileRound(activeDraw())
  renderHeader()
  renderStats()
  renderBracketDisplay()
  fetchPoolSlamIndex(activeDraw(), state.currentUser?.id).then(() => renderStats())
}

// ── FIND UNPICKED CARD HELPER ──
function _findUnpickedCard(d, lock) {
  if (lock.lock_type === 'backup_picks' && lock.round_index != null) {
    const ri = lock.round_index
    const matches = d.rounds[ri]?.matches || []
    for (let mi = 0; mi < matches.length; mi++) {
      const inRange = (lock.match_index_start == null || mi >= lock.match_index_start) &&
                      (lock.match_index_end == null || mi <= lock.match_index_end)
      if (inRange && !matches[mi].matchPick && !matches[mi].winner) {
        const card = document.querySelector(`.mc[data-ri="${ri}"][data-mi="${mi}"]`)
        if (card) return card
      }
    }
  } else {
    for (let ri = 0; ri < d.rounds.length; ri++) {
      for (let mi = 0; mi < (d.rounds[ri]?.matches.length || 0); mi++) {
        const m = d.rounds[ri].matches[mi]
        if (!m.matchPick && !m.winner) {
          const card = document.querySelector(`.mc[data-ri="${ri}"][data-mi="${mi}"]`)
          if (card) return card
        }
      }
    }
  }
  return null
}

function _flashCard(card) {
  if (!card) return
  card.scrollIntoView({ behavior: 'smooth', block: 'center' })
  card.style.transition = 'box-shadow 0.2s'
  card.style.boxShadow = '0 0 0 2px var(--accent)'
  setTimeout(() => { card.style.boxShadow = '' }, 1200)
}

async function handleCountdownClick(lock) {
  const targetIdx = state.draws.findIndex(dr => dr.db_id === lock.draw_id)
  if (targetIdx >= 0 && targetIdx !== state.activeTab) {
    await switchTab(targetIdx)
  }
  const d = state.draws[targetIdx >= 0 ? targetIdx : state.activeTab]
  if (!d) return

  if (isMobile()) {
    // Switch to the correct round in list view first
    if (lock.lock_type === 'backup_picks' && lock.round_index != null) {
      _mobileActiveRound = lock.round_index
    } else {
      for (let ri = 0; ri < d.rounds.length; ri++) {
        if (d.rounds[ri].matches.some(m => !m.matchPick && !m.winner && (m.p1?.name || m.p2?.name))) {
          _mobileActiveRound = ri; break
        }
      }
    }
    renderBracketDisplay()
    setTimeout(() => _flashCard(_findUnpickedCard(d, lock)), 80)
    return
  }

  _flashCard(_findUnpickedCard(d, lock))
}

// ── SEARCH ──
function allMatchesForSearch() {
  const results = []
  const activeKey = activeDraw() ? slamKey(activeDraw()) : null
  state.draws.forEach((d, di) => {
    if (slamKey(d) !== activeKey) return
    d.rounds.forEach((r, ri) => {
      r.matches.forEach((m, mi) => {
        ;[m.p1, m.p2].forEach(p => {
          if (p.name) results.push({ drawIdx: di, ri, mi, m, p, round: r.label, draw: d })
        })
      })
    })
  })
  return results
}

function runSearch(q, resultsEl) {
  const res = resultsEl || $('search-results')
  if (!q || q.length < 2) { res.classList.remove('open'); return }
  const lower = q.toLowerCase()
  const all = allMatchesForSearch()
  const matched = all.filter(x => x.p.name.toLowerCase().includes(lower))
  const seen = new Set()
  const deduped = matched.filter(x => {
    const k = x.drawIdx + '_' + x.ri + '_' + x.mi + '_' + x.p.name
    if (seen.has(k)) return false; seen.add(k); return true
  })
  if (deduped.length === 0) {
    res.innerHTML = '<div class="search-no-results">No players found</div>'
    res.classList.add('open'); return
  }
  const byDraw = new Map()
  deduped.forEach(x => { const k = x.drawIdx; if (!byDraw.has(k)) byDraw.set(k, []); byDraw.get(k).push(x) })
  res.innerHTML = ''
  byDraw.forEach((items, di) => {
    const d = state.draws[di]
    const grp = document.createElement('div'); grp.className = 'search-group-label'
    grp.textContent = slamLabel(d) + ' · ' + d.draw
    res.appendChild(grp)
    items.forEach(x => {
      const item = document.createElement('div'); item.className = 'search-result-item'
      const opp = x.m.p1.name === x.p.name ? x.m.p2 : x.m.p1
      item.innerHTML = `<span class="search-result-round">${x.round}</span><span class="search-result-name">${x.p.name}</span><span class="search-result-vs">vs ${opp.name || 'TBD'}</span>`
      item.addEventListener('click', async () => {
        closeSearch()
        if (x.drawIdx !== state.activeTab) await switchTab(x.drawIdx)
        // On mobile, jump to the right round first
        if (isMobile()) {
          _mobileActiveRound = x.ri
          renderBracketDisplay()
          setTimeout(() => {
            const card = document.querySelector(`.mc[data-ri="${x.ri}"][data-mi="${x.mi}"]`)
            _flashCard(card)
          }, 80)
        } else {
          const card = document.querySelector(`.mc[data-ri="${x.ri}"][data-mi="${x.mi}"]`)
          _flashCard(card)
        }
      })
      res.appendChild(item)
    })
  })
  res.classList.add('open')
}

function closeSearch() {
  ;[$('search-results'), $('mobile-search-results')].forEach(el => el?.classList.remove('open'))
  ;[$('search-input'), $('mobile-search-input')].forEach(el => { if (el) el.value = '' })
  ;[$('search-clear'), $('mobile-search-clear')].forEach(el => el?.classList.remove('visible'))
}

// Desktop search
$('search-input').addEventListener('input', e => {
  const q = e.target.value.trim()
  $('search-clear').classList.toggle('visible', q.length > 0)
  runSearch(q, $('search-results'))
})
$('search-input').addEventListener('focus', e => { if (e.target.value.trim().length >= 2) runSearch(e.target.value.trim(), $('search-results')) })
$('search-clear').addEventListener('click', closeSearch)
document.addEventListener('click', e => {
  if (!$('search-wrap')?.contains(e.target) && !$('mobile-search-wrap')?.contains(e.target)) {
    $('search-results')?.classList.remove('open')
    $('mobile-search-results')?.classList.remove('open')
  }
})

$('search-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSearch(); return }
  const res = $('search-results')
  if (!res.classList.contains('open')) return
  const items = res.querySelectorAll('.search-result-item')
  if (!items.length) return
  const focused = res.querySelector('.search-result-item.kbd-focus')
  const idx = focused ? Array.from(items).indexOf(focused) : -1
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = idx < items.length - 1 ? idx + 1 : 0
    items.forEach(i => i.classList.remove('kbd-focus'))
    items[next].classList.add('kbd-focus')
    items[next].scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (idx <= 0) { items.forEach(i => i.classList.remove('kbd-focus')); return }
    items.forEach(i => i.classList.remove('kbd-focus'))
    items[idx - 1].classList.add('kbd-focus')
    items[idx - 1].scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (focused) focused.click()
  }
})

// Mobile search
const _msi = $('mobile-search-input')
const _msc = $('mobile-search-clear')
if (_msi) {
  _msi.addEventListener('input', e => {
    const q = e.target.value.trim()
    _msc?.classList.toggle('visible', q.length > 0)
    runSearch(q, $('mobile-search-results'))
  })
  _msi.addEventListener('focus', e => {
    if (e.target.value.trim().length >= 2) runSearch(e.target.value.trim(), $('mobile-search-results'))
  })
  _msc?.addEventListener('click', () => {
    _msi.value = ''
    _msc.classList.remove('visible')
    $('mobile-search-results')?.classList.remove('open')
  })
}

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    const input = isMobile() ? $('mobile-search-input') : $('search-input')
    if (input && $('screen-bracket').classList.contains('active')) {
      e.preventDefault(); input.focus(); input.select()
    }
  }
})

// ── PRINT ──
function doPrint() {
  const d = activeDraw(); if (!d || !d.rounds || !d.rounds.length) return
  const win = window.open('', '_blank')
  if (!win) { alert('Please allow popups for this site.'); return }
  try {
    win.document.open(); win.document.write(buildPrintHTML(d)); win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 400)
  } catch (err) {
    win.document.write('<pre style="padding:20px;color:red">' + err.message + '</pre>'); win.document.close()
  }
}
$('print-btn').addEventListener('click', doPrint)

// ── LOGOUT ──
async function doLogout() {
  await logout()
  showScreen('screen-auth')
  setAuthMode('login')
}
$('logout-btn').addEventListener('click', doLogout)
$('logout-btn-lb').addEventListener('click', doLogout)
$('logout-btn-comm').addEventListener('click', doLogout)

// ── NAV ACTIVE STATE ──
function _setNavActive(page) {
  const isBracket = page === 'bracket'
  $('nav-bracket')?.classList.toggle('active', isBracket)
  $('nav-leaderboard')?.classList.toggle('active', !isBracket)
  $('mobile-nav-bracket')?.classList.toggle('active', isBracket)
  $('mobile-nav-leaderboard')?.classList.toggle('active', !isBracket)
  $('lb-mobile-nav-bracket')?.classList.toggle('active', isBracket)
  $('lb-mobile-nav-leaderboard')?.classList.toggle('active', !isBracket)
}

// ── NAV LINKS ──
$('nav-bracket').addEventListener('click', () => { _setNavActive('bracket'); showBracketScreen() })
$('nav-leaderboard').addEventListener('click', () => { _setNavActive('leaderboard'); showScreen('screen-leaderboard'); renderLeaderboard() })
$('nav-bracket-from-lb').addEventListener('click', () => { _setNavActive('bracket'); showBracketScreen() })
$('mobile-nav-bracket')?.addEventListener('click', () => { _setNavActive('bracket'); showBracketScreen() })
$('mobile-nav-leaderboard')?.addEventListener('click', () => { _setNavActive('leaderboard'); showScreen('screen-leaderboard'); renderLeaderboard() })
$('lb-mobile-nav-bracket')?.addEventListener('click', () => { _setNavActive('bracket'); showBracketScreen() })
$('lb-mobile-nav-leaderboard')?.addEventListener('click', () => { _setNavActive('leaderboard'); showScreen('screen-leaderboard'); renderLeaderboard() })

// ── COMMISSIONER ENTER / EXIT ──
function enterCommissioner() {
  if (!state.currentUser?.is_commissioner) return
  closeAcctMenus()
  initCommissioner()
  showScreen('screen-commissioner')
}
$('commish-btn')?.addEventListener('click', enterCommissioner)
$('commish-btn-lb')?.addEventListener('click', enterCommissioner)
$('exit-commish-btn')?.addEventListener('click', () => { closeAcctMenus(); showBracketScreen() })

document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'e' || e.shiftKey || e.altKey) return
  if (!state.currentUser?.is_commissioner) return
  e.preventDefault()
  if ($('screen-commissioner').classList.contains('active')) showBracketScreen()
  else enterCommissioner()
})

// ── ACCOUNT MENU ──
function wireAcctMenu(chipId, menuId) {
  const chip = $(chipId), menu = $(menuId)
  if (!chip || !menu) return
  chip.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = menu.classList.toggle('open')
    chip.classList.toggle('open', open)
    chip.setAttribute('aria-expanded', open ? 'true' : 'false')
  })
}
function closeAcctMenus() {
  document.querySelectorAll('.acct-menu.open').forEach(m => m.classList.remove('open'))
  document.querySelectorAll('.acct-chip.open').forEach(c => { c.classList.remove('open'); c.setAttribute('aria-expanded', 'false') })
}
wireAcctMenu('acct-chip', 'acct-menu')
wireAcctMenu('acct-chip-lb', 'acct-menu-lb')
wireAcctMenu('acct-chip-cmsr', 'acct-menu-cmsr')
document.addEventListener('click', closeAcctMenus)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeAcctMenus(); closeRenameModal(); closeEloModal() } })

// ── VIEWER BACK ──
$('viewer-back-btn-v').addEventListener('click', async () => {
  showScreen('screen-leaderboard')
  renderLeaderboard()
})

// ── REFRESH BUTTON ──
async function doRefresh(btnId, after) {
  const btn = $(btnId)
  if (!btn) return
  btn.disabled = true
  btn.classList.add('spinning')
  try {
    await reloadActiveDraw()
    after()
  } finally {
    btn.disabled = false
    btn.classList.remove('spinning')
  }
}
$('api-sync-btn').addEventListener('click', () => doRefresh('api-sync-btn', () => {
  renderStats()
  renderBracketDisplay()
  fetchPoolSlamIndex(activeDraw(), state.currentUser?.id).then(() => renderStats())
}))
$('api-sync-btn-lb')?.addEventListener('click', () => doRefresh('api-sync-btn-lb', () => renderLeaderboard()))
$('api-sync-btn-cmsr')?.addEventListener('click', () => doRefresh('api-sync-btn-cmsr', () => {
  const activeTab = (document.querySelector('#comm-hdr-nav .hdr-nav-link.active') ||
                     document.querySelector('#comm-mobile-hdr-nav .hdr-nav-link.active'))?.dataset.tab
  if (activeTab === 'lock') renderLockManaging()
  else renderResults()
}))

// ── COUNTDOWN REFRESH ──
setInterval(() => {
  if ($('screen-bracket').classList.contains('active')) {
    renderStats()
  }
}, 60000)

// ── MODAL WIRING ──
$('epm-cancel').addEventListener('click', closeModal)
$('epm-confirm').addEventListener('click', confirmEditPlayer)
$('edit-player-modal').addEventListener('click', e => { if (e.target === $('edit-player-modal')) closeModal() })

// ── ELO AUTO-FILL ──
const _eloSurfaceLabel = { AO: 'hard court', RG: 'clay', WIM: 'grass', USO: 'hard court' }
let _eloBannerDrawId = null
function renderEloBanner() {
  const d = activeDraw()
  const el = $('bracket-notifications')
  if (!el) return
  if (_eloBannerDrawId && _eloBannerDrawId === d?.db_id && !d?.locked) {
    el.innerHTML = '<div class="elo-chalk-banner">ELO chalk applied. Scroll through to review and add some upsets.</div>'
  } else {
    el.innerHTML = ''
    if (d?.locked) _eloBannerDrawId = null
  }
}
function openEloModal() {
  const d = activeDraw()
  const surface = _eloSurfaceLabel[d?.slam] ?? 'surface'
  const fills = d ? simulateEloFill(d) : []
  let emptyCount = 0
  if (d) {
    for (const round of d.rounds) {
      for (const m of round.matches) {
        if (!m.matchPick && !m.winner) emptyCount++
      }
    }
  }
  const skipped = emptyCount - fills.length
  const skipNote = skipped > 0
    ? `${skipped} match${skipped > 1 ? 'es' : ''} skipped — ELO unavailable for those players.`
    : 'All empty matches covered.'
  $('ecm-body').innerHTML =
    `This will fill <strong>${fills.length}</strong> of <strong>${emptyCount}</strong> empty matches using ${surface} ELO ratings. Your existing picks won't change.<br><br>` +
    `<span style="color:var(--text3)">${skipNote}</span>`
  $('ecm-confirm').disabled = fills.length === 0
  $('ecm-msg').textContent = ''
  $('elo-confirm-modal').style.display = 'flex'
}
function closeEloModal() { $('elo-confirm-modal').style.display = 'none' }
document.addEventListener('click', e => { if (e.target.id === 'autofill-elo-btn') openEloModal() })
$('ecm-cancel').addEventListener('click', closeEloModal)
$('elo-confirm-modal').addEventListener('click', e => { if (e.target === $('elo-confirm-modal')) closeEloModal() })
$('ecm-confirm').addEventListener('click', async () => {
  const d = activeDraw()
  const fills = simulateEloFill(d)
  if (!fills.length) { $('ecm-msg').textContent = 'No empty matches with ELO data to fill.'; return }
  const btn = $('ecm-confirm')
  btn.disabled = true; btn.textContent = 'Filling…'
  try {
    for (const { ri, mi, playerName } of fills) {
      const m = d.rounds[ri].matches[mi]
      m.matchPick = playerName
      await savePickToSupabase(m, d.db_id)
    }
    buildDrawView(d)
    _eloBannerDrawId = d.db_id
    renderStats()
    renderBracket()
    renderEloBanner()
    closeEloModal()
  } catch (err) {
    $('ecm-msg').textContent = err.message || 'Failed to save.'
  } finally {
    btn.disabled = false; btn.textContent = 'Auto-fill'
  }
})

// ── RENAME MODAL ──
function openRenameModal() {
  closeAcctMenus()
  $('rename-input').value = state.currentUser?.display_name ?? ''
  $('rename-msg').textContent = ''
  $('rename-modal').style.display = 'flex'
  $('rename-input').focus()
  $('rename-input').select()
}
function closeRenameModal() {
  $('rename-modal').style.display = 'none'
}
;['rename-btn', 'rename-btn-lb', 'rename-btn-cmsr'].forEach(id => {
  const el = $(id)
  if (el) el.addEventListener('click', openRenameModal)
})
$('rename-cancel').addEventListener('click', closeRenameModal)
$('rename-modal').addEventListener('click', e => { if (e.target === $('rename-modal')) closeRenameModal() })
$('rename-confirm').addEventListener('click', async () => {
  const newName = $('rename-input').value.trim()
  if (!newName) { $('rename-msg').textContent = 'Name cannot be empty.'; return }
  const btn = $('rename-confirm')
  btn.disabled = true
  btn.textContent = 'Saving…'
  try {
    await updateDisplayName(state.currentUser.id, newName)
    renderHeader()
    closeRenameModal()
  } catch (err) {
    $('rename-msg').textContent = err.message || 'Failed to save.'
  } finally {
    btn.disabled = false
    btn.textContent = 'Save'
  }
})

// ── ROUND LABELS SCROLL SYNC (desktop only) ──
const bb = $('bracket-body'), li = $('round-labels-inner')
if (bb && li) {
  bb.addEventListener('scroll', function () { li.style.transform = 'translateX(-' + this.scrollLeft + 'px)' })
}

// ── GETTING READY (between-slams) ──
async function renderGettingReady() {
  let label = null, startsAt = null
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('next_slam_label, next_slam_starts_at')
      .eq('id', 1)
      .maybeSingle()
    label = data?.next_slam_label ?? null
    startsAt = data?.next_slam_starts_at ?? null
  } catch (_) {}

  const logoHtml = `<img src="/icons/icon-192.png" alt="" style="width:100px;height:100px;border-radius:50%;display:block;margin-bottom:8px">`

  if (!label) {
    return `<div class="bracket-empty">
      ${logoHtml}
      <div class="bracket-empty-title" style="font-size:26px">No draw uploaded yet.</div>
    </div>`
  }

  let countdownHtml = ''
  if (startsAt) {
    const msLeft = new Date(startsAt) - Date.now()
    if (msLeft > 0) {
      const totalMins = Math.floor(msLeft / 60000)
      const days = Math.floor(totalMins / 1440)
      const hrs  = Math.floor((totalMins % 1440) / 60)
      const mins = totalMins % 60
      const str = days >= 1
        ? `Matches start in ${days} day${days === 1 ? '' : 's'}`
        : `Matches start in ${hrs}h ${String(mins).padStart(2, '0')}m`
      countdownHtml = `<div class="bracket-empty-sub" style="font-family:var(--mono);font-size:16px">${str}</div>`
    }
  }

  return `<div class="bracket-empty">
    ${logoHtml}
    <div class="bracket-empty-title" style="font-size:28px">${label}</div>
    ${countdownHtml}
    <div class="bracket-empty-sub" style="font-size:13px;margin-top:12px;opacity:0.7;font-family:var(--mono)">tap anywhere to browse the last draw</div>
  </div>`
}

// ── SHOW BRACKET SCREEN ──
async function showBracketScreen() {
  if (!hasActiveDraw()) {
    // Render last slam dimmed behind a frosted overlay
    const d = activeDraw() // loadAllDraws fallback points activeTab at last draw
    if (d) {
      applyTheme(d.slam)
      if (isMobile() && _mobileActiveRound === 0) _mobileActiveRound = defaultMobileRound(d)
    } else { applyTheme('') }
    renderHeader()
    renderStats()
    renderBracketDisplay()
    showScreen('screen-bracket')
    const area = $('bracket-area')
    if (area) {
      area.querySelector('.getting-ready-overlay')?.remove()
      const overlay = document.createElement('div')
      overlay.className = 'getting-ready-overlay'
      overlay.innerHTML = await renderGettingReady()
      overlay.addEventListener('click', () => overlay.remove())
      overlay.style.cursor = 'pointer'
      area.appendChild(overlay)
    }
    return
  }
  // Active draw: remove overlay if lingering from between-slams mode
  $('bracket-area')?.querySelector('.getting-ready-overlay')?.remove()
  const d = activeDraw()
  if (d) {
    applyTheme(d.slam)
    if (isMobile() && _mobileActiveRound === 0) _mobileActiveRound = defaultMobileRound(d)
  }
  renderHeader()
  renderStats()
  renderBracketDisplay()
  showScreen('screen-bracket')
  fetchPoolSlamIndex(activeDraw(), state.currentUser?.id).then(() => renderStats())
}

// ── BOOT ──
async function init() {
  setCountdownClickHandler(handleCountdownClick)
  setRenderBracketFn(renderBracketDisplay)
  try {
    const user = await restoreSession()
    if (!user) {
      if (new URLSearchParams(window.location.search).has('signup')) setAuthMode('signup')
      showScreen('screen-auth')
      return
    }
    await loadAllDraws()
    await routeAfterAuth()
  } catch (err) {
    console.error('Init error:', err)
    showScreen('screen-auth')
  }
}

document.addEventListener('DOMContentLoaded', init)
