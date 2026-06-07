import { state, activeDraw, applyTheme } from './state.js'
import { login, signup, logout, restoreSession } from './auth.js'
import { loadAllDraws, loadLockSchedules, reloadActiveDraw, slamKey, slamLabel, SLAM_CONFIG } from './data.js'
import { renderBracket } from './bracket.js'
import { closeModal, confirmEditPlayer } from './commissioner-results.js'
import { renderStats, resetStatsFilter, setCountdownClickHandler } from './stats.js'
import { buildPrintHTML } from './print.js'
import { initCommissioner, renderResults, renderLockManaging } from './commissioner.js'
import { renderLeaderboard } from './leaderboard.js'
import { animateSegThumb } from './seg-thumb.js'

// ── INIT ──
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

function $(id) { return document.getElementById(id) }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  $(id).classList.add('active')
}

// ── SEGMENTED CONTROL STATE ──
let _segPrevIdx = -1  // tracks previous M/W index for slide animation

// ── AUTH SCREEN ──
let authMode = 'login' // 'login' | 'signup'

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
  // Commissioner-capable users land on the normal player view; they reach the
  // commissioner screen via the account-menu "Commissioner" entry (revealed below).
  document.querySelectorAll('.commish-nav').forEach(b => {
    b.hidden = !state.currentUser?.is_commissioner
  })
  await showBracketScreen()
}

// ── HEADER / NAV ──
function renderHeader() {
  const d = activeDraw()

  // Static slam name label (bracket screen)
  const nameEl = $('slam-name-label')
  if (nameEl) nameEl.textContent = d ? slamLabel(d) : '—'

  // Leaderboard slam name label
  const lbNameEl = $('lb-slam-name-label')
  if (lbNameEl) lbNameEl.textContent = d ? slamLabel(d) : '—'

  // Segmented control (bracket screen M/W switcher)
  const seg = $('seg-control')
  if (seg && d) {
    seg.innerHTML = ''
    const DRAW_TYPES = [{ key: 'MS', label: "Men's", short: 'M' }, { key: 'WS', label: "Women's", short: 'W' }]
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
      seg.appendChild(btn)
    })
    animateSegThumb(seg, _segPrevIdx, activeSegIdx)
    _segPrevIdx = activeSegIdx
  }

  // User display + avatar initials
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
  renderHeader()
  renderStats()
  renderBracket()
}

async function handleCountdownClick(lock) {
  // Switch to the draw that owns this lock if needed
  const targetIdx = state.draws.findIndex(dr => dr.db_id === lock.draw_id)
  if (targetIdx >= 0 && targetIdx !== state.activeTab) {
    await switchTab(targetIdx)
  }
  // Find the first unpicked match card in the lock range
  const d = state.draws[targetIdx >= 0 ? targetIdx : state.activeTab]
  if (!d) return
  let targetCard = null
  if (lock.lock_type === 'backup_picks' && lock.round_index != null) {
    const ri = lock.round_index
    const matches = d.rounds[ri]?.matches || []
    for (let mi = 0; mi < matches.length; mi++) {
      const inRange = (lock.match_index_start == null || mi >= lock.match_index_start) &&
                      (lock.match_index_end == null || mi <= lock.match_index_end)
      if (inRange && !matches[mi].matchPick && !matches[mi].winner) {
        targetCard = document.querySelector(`.mc[data-ri="${ri}"][data-mi="${mi}"]`)
        if (targetCard) break
      }
    }
  } else {
    // original_picks lock — find first match with no matchPick
    for (let ri = 0; ri < d.rounds.length; ri++) {
      for (let mi = 0; mi < (d.rounds[ri]?.matches.length || 0); mi++) {
        const m = d.rounds[ri].matches[mi]
        if (!m.matchPick && !m.winner) {
          targetCard = document.querySelector(`.mc[data-ri="${ri}"][data-mi="${mi}"]`)
          break
        }
      }
      if (targetCard) break
    }
  }
  if (targetCard) {
    targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' })
    targetCard.style.transition = 'box-shadow 0.2s'
    targetCard.style.boxShadow = '0 0 0 2px var(--accent)'
    setTimeout(() => { targetCard.style.boxShadow = '' }, 1200)
  }
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

function runSearch(q) {
  const res = $('search-results')
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
        const card = document.querySelector(`.mc[data-ri="${x.ri}"][data-mi="${x.mi}"]`)
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' })
          card.style.transition = 'box-shadow 0.2s'
          card.style.boxShadow = '0 0 0 2px var(--accent)'
          setTimeout(() => { card.style.boxShadow = '' }, 1200)
        }
      })
      res.appendChild(item)
    })
  })
  res.classList.add('open')
}

function closeSearch() {
  $('search-results').classList.remove('open')
  $('search-input').value = ''
  $('search-clear').classList.remove('visible')
}

$('search-input').addEventListener('input', e => {
  const q = e.target.value.trim()
  $('search-clear').classList.toggle('visible', q.length > 0)
  runSearch(q)
})
$('search-input').addEventListener('focus', e => { if (e.target.value.trim().length >= 2) runSearch(e.target.value.trim()) })
$('search-clear').addEventListener('click', closeSearch)
document.addEventListener('click', e => { if (!$('search-wrap')?.contains(e.target)) $('search-results').classList.remove('open') })

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

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    const input = $('search-input')
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

// ── NAV LINKS ──
$('nav-bracket').addEventListener('click', () => showBracketScreen())
$('nav-leaderboard').addEventListener('click', () => { showScreen('screen-leaderboard'); renderLeaderboard() })

$('nav-bracket-from-lb').addEventListener('click', () => showBracketScreen())

// ── COMMISSIONER ENTER / EXIT (combined-role nav) ──
function enterCommissioner() {
  if (!state.currentUser?.is_commissioner) return
  closeAcctMenus()
  initCommissioner() // idempotent; renders header + Results tab
  showScreen('screen-commissioner')
}
$('commish-btn')?.addEventListener('click', enterCommissioner)
$('commish-btn-lb')?.addEventListener('click', enterCommissioner)
$('exit-commish-btn')?.addEventListener('click', () => { closeAcctMenus(); showBracketScreen() })

// Cmd/Ctrl+E toggles between the draw and commissioner views (commissioner-capable only).
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAcctMenus() })

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
$('api-sync-btn').addEventListener('click', () => doRefresh('api-sync-btn', () => { renderStats(); renderBracket() }))
$('api-sync-btn-lb')?.addEventListener('click', () => doRefresh('api-sync-btn-lb', () => renderLeaderboard()))
$('api-sync-btn-cmsr')?.addEventListener('click', () => doRefresh('api-sync-btn-cmsr', () => {
  const activeTab = document.querySelector('#comm-hdr-nav .hdr-nav-link.active')?.dataset.tab
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

// ── ROUND LABELS SCROLL SYNC ──
const bb = $('bracket-body'), li = $('round-labels-inner')
if (bb && li) {
  bb.addEventListener('scroll', function () { li.style.transform = 'translateX(-' + this.scrollLeft + 'px)' })
}

// ── SHOW BRACKET SCREEN ──
async function showBracketScreen() {
  if (state.draws.length === 0) {
    applyTheme('')
    renderHeader()
    renderStats()
    renderBracket()
    showScreen('screen-bracket')
    return
  }
  const d = activeDraw()
  if (d) applyTheme(d.slam)
  renderHeader()
  renderStats()
  renderBracket()
  showScreen('screen-bracket')
}

// ── BOOT ──
async function init() {
  setCountdownClickHandler(handleCountdownClick)
  try {
    const user = await restoreSession()
    if (!user) {
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
