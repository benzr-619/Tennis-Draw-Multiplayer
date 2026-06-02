import { state, activeDraw, applyTheme } from './state.js'
import { login, signup, logout, restoreSession } from './auth.js'
import { loadAllDraws, loadLockSchedules, reloadActiveDraw, slamKey, slamLabel, SLAM_CONFIG } from './data.js'
import { renderBracket, closeModal, confirmEditPlayer } from './bracket.js'
import { renderStats, resetStatsFilter } from './stats.js'
import { buildPrintHTML } from './print.js'
import { initCommissioner } from './commissioner.js'
import { renderLeaderboard } from './leaderboard.js'

// ── INIT ──
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

function $(id) { return document.getElementById(id) }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  $(id).classList.add('active')
}

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
  if (state.currentUser?.is_commissioner) {
    initCommissioner()
    showScreen('screen-commissioner')
  } else {
    await showBracketScreen()
  }
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
    DRAW_TYPES.forEach(({ key, label, short }) => {
      const btn = document.createElement('button')
      btn.className = 'seg-btn'
      btn.innerHTML = `<span class="seg-full">${label}</span><span class="seg-short">${short}</span>`
      const match = state.draws.find(x => slamKey(x) === slamKey(d) && x.draw === key)
      if (!match) { btn.disabled = true }
      else {
        if (d.draw === key) btn.classList.add('active')
        btn.addEventListener('click', () => {
          const idx = state.draws.indexOf(match)
          if (idx >= 0) switchTab(idx)
        })
      }
      seg.appendChild(btn)
    })
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
  renderHeader()
  renderStats()
  renderBracket()
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
$('print-btn').addEventListener('click', () => {
  const d = activeDraw(); if (!d || !d.rounds || !d.rounds.length) return
  const win = window.open('', '_blank')
  if (!win) { alert('Please allow popups for this site.'); return }
  try {
    win.document.open(); win.document.write(buildPrintHTML(d)); win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 400)
  } catch (err) {
    win.document.write('<pre style="padding:20px;color:red">' + err.message + '</pre>'); win.document.close()
  }
})

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

// ── VIEWER BACK ──
$('viewer-back-btn-v').addEventListener('click', async () => {
  showScreen('screen-leaderboard')
  renderLeaderboard()
})

// ── REFRESH BUTTON ──
$('api-sync-btn').addEventListener('click', async () => {
  const btn = $('api-sync-btn')
  btn.disabled = true
  $('api-sync-label').textContent = 'Refreshing…'
  try {
    await reloadActiveDraw()
    renderStats()
    renderBracket()
  } finally {
    btn.disabled = false
    $('api-sync-label').textContent = 'Refresh'
  }
})

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
