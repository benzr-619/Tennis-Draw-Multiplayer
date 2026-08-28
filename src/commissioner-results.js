// Commissioner — Results tab. Match-by-match winner confirmation + undo + search.
// Split from commissioner.js on 2026-06-01 (audit part E).

import { activeDraw, state, isMobile } from './state.js'
import { COUNTRY_DISPLAY_NAMES, countryNameToIoc } from './flags.js'
import { reloadActiveDraw } from './data.js'
import { applyWinner, undoWinner, clearMatchPickForward } from './picks.js'
import { buildDrawView } from './draw-view.js'
import { feederWinnerName } from './lock.js'
import { renderBracketLayout } from './bracket-layout.js'
import { renderBracketList } from './bracket-list.js'
import { $c, escHtml } from './commissioner-shared.js'
import { supabase } from './supabase.js'

// ── SEARCH STATE ──
// Survives re-renders so a pending query auto-fires after tab/gender switch.
let _pendingSearch = null
export function setPendingSearch(q) { _pendingSearch = q }

// ── HEALTH BANDS STATUS LINE (transient) ──
// Driven by the fire-and-forget band recompute in picks.js refreshHealthBands, called
// from applyWinner/undoWinner (manual) and from the Results-tab / bracket-screen
// realtime handlers (ESPN auto-confirm bridge — see commissioner.js/main.js).
let _bandsStatusTimer = null
export function onBandsUpdating() {
  const el = $c('comm-bands-status')
  if (!el) return
  if (_bandsStatusTimer) { clearTimeout(_bandsStatusTimer); _bandsStatusTimer = null }
  el.textContent = 'Updating bands…'
  el.style.display = ''
}
export function onBandsUpdated(ms) {
  const el = $c('comm-bands-status')
  if (el) {
    el.textContent = `Bands updated in ${(ms / 1000).toFixed(1)}s`
    el.style.display = ''
    if (_bandsStatusTimer) clearTimeout(_bandsStatusTimer)
    _bandsStatusTimer = setTimeout(() => { el.textContent = ''; el.style.display = 'none' }, 5000)
  }
  // Also refresh the persisted status card — it just got a fresh row written by
  // health-bands.js, and this is the one place every recompute path (manual confirm/
  // undo, auto-confirm bridge) funnels through.
  renderHealthBandsStatusSection()
}

// ── HEALTH BANDS STATUS CARD (persisted) ──
// Unlike the 5s toast above, this survives reloads/different sessions — reads
// health_bands_status directly so the commissioner can check, at any time, how long
// the live per-match recompute is taking and what's been triggering it. That's the
// signal for deciding when to flip HEALTH_BANDS_LIVE_MODE off in favour of relying on
// historical between-slams calibration (see .claude/rules/health-bands.md).
function _bandsAgoLabel(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m ago`
}

let _bandsStatusGen = 0
export async function renderHealthBandsStatusSection() {
  const wrap = $c('comm-bands-history-wrap')
  if (!wrap) return
  const gen = ++_bandsStatusGen
  const { loadHealthBandsStatus } = await import('./health-bands.js')
  const status = await loadHealthBandsStatus()
  if (gen !== _bandsStatusGen) return // a newer call already superseded this one

  wrap.innerHTML = ''
  if (!status || !status.last_attempt) {
    wrap.innerHTML = '<span style="font-family:var(--mono);font-size:11px;color:var(--text3);padding:4px 12px;display:inline-block">Health bands: no live recompute recorded yet</span>'
    return
  }

  const ok = !status.last_error
  const pill = document.createElement('span')
  pill.style.cssText = `font-family:var(--mono);font-size:11px;padding:3px 9px;border-radius:11px;margin:4px 12px;display:inline-block;color:${ok ? 'var(--green)' : 'var(--red)'};background:${ok ? 'rgba(76,153,104,0.1)' : 'rgba(192,57,43,0.1)'}`
  if (ok) {
    const dur = status.last_duration_ms != null ? (status.last_duration_ms / 1000).toFixed(1) + 's' : '—'
    const nLabel = status.last_n != null ? `n=${status.last_n}` : 'full recompute'
    pill.textContent = `Health bands · last update ${_bandsAgoLabel(status.last_ok)} · took ${dur} · ${nLabel} · via ${status.last_source || '—'}`
  } else {
    pill.textContent = `Health bands · last attempt FAILED ${_bandsAgoLabel(status.last_attempt)} (${status.last_source || '—'}) · ${status.last_error}`
  }
  wrap.appendChild(pill)
}

// ── SHRINKAGE K STATUS CARD ──
// Mirrors the health-bands status card above: a persisted row (shrinkage_k) that
// survives reloads/sessions, plus a manual recompute the commissioner can run any
// time (not just at Getting Ready). See .claude/rules/slam-index.md "The K
// recomputation procedure" for what computeShrinkageK actually does — this is
// wiring only. k_active is what buildShrinkageStandings actually uses; a
// recompute only ever proposes k_suggested — moving it to k_active needs an
// explicit Apply click, and Apply is disabled whenever a guard tripped
// (last_error set / k_suggested null).
export async function recomputeShrinkageK() {
  const [{ loadAllProfiles, loadDrawStatsForAllUsers }, { buildAllBrackets, computeShrinkageK }] = await Promise.all([
    import('./leaderboard.js'),
    import('./leaderboard-records-data.js'),
  ])
  const profs = await loadAllProfiles()
  const draws = state.draws.filter(d => !d.excludeFromLeaderboard && d.locked)
  const statsMaps = await Promise.all(draws.map(d => loadDrawStatsForAllUsers(d)))
  const brackets = buildAllBrackets(profs, draws, statsMaps)
  const result = computeShrinkageK(brackets)
  const row = {
    id: 1,
    k_suggested: result.reason ? null : result.k,
    sigma_within: result.sigma_within,
    sigma_between: result.sigma_between,
    n_players: result.n_players,
    n_draws: result.n_draws,
    draw_gap_max: result.draw_gap_max,
    computed_at: new Date().toISOString(),
    last_error: result.reason,
  }
  const { error } = await supabase.from('shrinkage_k').upsert(row, { onConflict: 'id' })
  if (error) throw error
  return row
}

async function handleRecomputeK() {
  if (!state.currentUser?.is_commissioner) return
  const btn = $c('comm-recompute-k-btn')
  const msg = $c('comm-shrinkage-k-msg')
  if (btn) btn.disabled = true
  if (msg) { msg.className = 'comm-msg'; msg.textContent = 'Recomputing…' }
  try {
    await recomputeShrinkageK()
    if (msg) { msg.className = 'comm-msg success'; msg.textContent = 'Done.' }
  } catch (err) {
    if (msg) { msg.className = 'comm-msg error'; msg.textContent = 'Error: ' + err.message }
  } finally {
    if (btn) btn.disabled = false
    renderShrinkageKSection()
  }
}

async function handleApplyK() {
  if (!state.currentUser?.is_commissioner) return
  const { data } = await supabase.from('shrinkage_k').select('k_suggested').eq('id', 1).maybeSingle()
  if (data?.k_suggested == null) return
  await supabase.from('shrinkage_k').update({ k_active: data.k_suggested }).eq('id', 1)
  renderShrinkageKSection()
}

let _shrinkageKGen = 0
export async function renderShrinkageKSection() {
  const wrap = $c('comm-shrinkage-k-wrap')
  if (!wrap) return
  const gen = ++_shrinkageKGen
  const { data: row } = await supabase.from('shrinkage_k').select('*').eq('id', 1).maybeSingle()
  if (gen !== _shrinkageKGen) return // a newer call already superseded this one

  wrap.innerHTML = ''
  const kActive = row?.k_active ?? 5

  const pill = document.createElement('div')
  pill.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--text3);padding:4px 12px;line-height:1.7'
  if (!row || row.computed_at == null) {
    pill.textContent = `Shrinkage K: k_active=${kActive} (never recomputed)`
  } else if (row.last_error) {
    pill.innerHTML = `Shrinkage K: k_active=${kActive} · recompute ${new Date(row.computed_at).toLocaleString()} — not applicable: ${escHtml(row.last_error)}`
  } else {
    const gapFlag = row.draw_gap_max != null && row.draw_gap_max > 10
    const gapStr = row.draw_gap_max != null
      ? `<span${gapFlag ? ' style="color:var(--red)"' : ''}>draw_gap_max=${row.draw_gap_max.toFixed(1)}${gapFlag ? ' ⚠ normalisation check' : ''}</span>`
      : 'draw_gap_max=—'
    pill.innerHTML = `Shrinkage K: k_active=${kActive} · k_suggested=${row.k_suggested != null ? Number(row.k_suggested).toFixed(2) : '—'} · `
      + `σ_within=${row.sigma_within != null ? Number(row.sigma_within).toFixed(1) : '—'} · σ_between=${row.sigma_between != null ? Number(row.sigma_between).toFixed(1) : '—'} · `
      + `n_players=${row.n_players ?? '—'} · n_draws=${row.n_draws ?? '—'} · ${gapStr}<br>`
      + `recomputed ${new Date(row.computed_at).toLocaleString()}`
  }
  wrap.appendChild(pill)

  const btnRow = document.createElement('div')
  btnRow.style.cssText = 'padding:4px 12px 8px;display:flex;gap:8px;align-items:center'
  btnRow.innerHTML = `
    <button class="comm-btn comm-btn-secondary" id="comm-recompute-k-btn">Recompute K</button>
    <button class="comm-btn comm-btn-secondary" id="comm-apply-k-btn"${row?.k_suggested == null ? ' disabled' : ''}>Apply k_suggested → k_active</button>
    <div class="comm-msg" id="comm-shrinkage-k-msg"></div>`
  wrap.appendChild(btnRow)

  $c('comm-recompute-k-btn')?.addEventListener('click', handleRecomputeK)
  $c('comm-apply-k-btn')?.addEventListener('click', handleApplyK)
}

// ── SLAM INDEX v3 — MONTE CARLO σ STATUS CARD (persisted, per-draw) ──
// Mirrors the shrinkage-K card's shape (a persisted row + a manual recompute
// button) but scoped to the currently active draw, not the whole pool — sigma_dy/
// sigma_my are a property of one draw's own bracket, not a cross-draw quantity.
// See .claude/rules/slam-index.md "v3" and src/slam-index-sim.js for what the
// recompute actually does; this is wiring only.
async function handleRecomputeSlamIndexSim() {
  if (!state.currentUser?.is_commissioner) return
  const d = activeDraw()
  if (!d) return
  const btn = $c('comm-recompute-sim-btn')
  const msg = $c('comm-sim-msg')
  if (btn) btn.disabled = true
  if (msg) { msg.className = 'comm-msg'; msg.textContent = 'Simulating (40,000 runs)…' }
  try {
    const [{ calcChalkBaselines, getScoringConfig, buildEloChalkBracket }, { simulateChalkSigma }] = await Promise.all([
      import('./scoring.js'),
      import('./slam-index-sim.js'),
    ])
    const config = getScoringConfig(d.scoring_version ?? 1)
    const realized = calcChalkBaselines(d) // chalkDY/chalkMY are unchanged — same closed form as v2
    if (!realized.valid) throw new Error('Not enough ELO/odds data for this draw to trust a chalk baseline.')
    const chalk = buildEloChalkBracket(d)
    const seed = 42, runs = 40000
    const { sigmaDY, sigmaMY } = simulateChalkSigma(d, chalk, config, { runs, seed })
    const computedAt = new Date().toISOString()

    const { error } = await supabase.from('draws').update({
      chalk_dy: realized.chalkDY, chalk_my: realized.chalkMY,
      sigma_dy: sigmaDY, sigma_my: sigmaMY,
      sim_seed: seed, sim_runs: runs, sim_computed_at: computedAt,
      slam_index_version: 3,
    }).eq('id', d.db_id)
    if (error) throw error

    // Patch in-memory BEFORE reload — reloadActiveDraw() rebuilds its drawRow from
    // local flags, not a fresh draws fetch (see data.js reloadActiveDraw).
    d.chalk_dy = realized.chalkDY; d.chalk_my = realized.chalkMY
    d.sigma_dy = sigmaDY; d.sigma_my = sigmaMY
    d.sim_seed = seed; d.sim_runs = runs; d.sim_computed_at = computedAt
    d.slam_index_version = 3
    await reloadActiveDraw()

    if (msg) { msg.className = 'comm-msg success'; msg.textContent = `Done — σ_DY=${sigmaDY.toFixed(1)}, σ_MY=${sigmaMY.toFixed(1)}` }
    renderResults()
  } catch (err) {
    if (msg) { msg.className = 'comm-msg error'; msg.textContent = 'Error: ' + err.message }
  } finally {
    if (btn) btn.disabled = false
    renderSlamIndexSimSection()
  }
}

let _simStatusGen = 0
export async function renderSlamIndexSimSection() {
  const wrap = $c('comm-sim-wrap')
  if (!wrap) return
  const gen = ++_simStatusGen
  const d = activeDraw()
  if (gen !== _simStatusGen) return

  wrap.innerHTML = ''
  if (!d) return

  const pill = document.createElement('div')
  pill.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--text3);padding:4px 12px;line-height:1.7'
  if (d.sim_computed_at == null) {
    pill.textContent = 'Slam Index σ (Monte Carlo): not yet computed for this draw — falls back to the v2 closed-form estimate'
  } else {
    pill.innerHTML = `Slam Index σ (Monte Carlo): σ_DY=${Number(d.sigma_dy).toFixed(1)} · σ_MY=${Number(d.sigma_my).toFixed(1)} · `
      + `chalk_DY=${Number(d.chalk_dy).toFixed(1)} · chalk_MY=${Number(d.chalk_my).toFixed(1)} · runs=${d.sim_runs} · seed=${d.sim_seed}<br>`
      + `computed ${new Date(d.sim_computed_at).toLocaleString()}`
  }
  wrap.appendChild(pill)

  const btnRow = document.createElement('div')
  btnRow.style.cssText = 'padding:4px 12px 8px;display:flex;gap:8px;align-items:center'
  btnRow.innerHTML = `
    <button class="comm-btn comm-btn-secondary" id="comm-recompute-sim-btn">Recompute σ (Monte Carlo)</button>
    <div class="comm-msg" id="comm-sim-msg"></div>`
  wrap.appendChild(btnRow)

  $c('comm-recompute-sim-btn')?.addEventListener('click', handleRecomputeSlamIndexSim)
}

// ── MOBILE ROUND STATE ──
let _commMobileRound = 0
export function getCommMobileRound() { return _commMobileRound }
export function setCommMobileRound(ri) { _commMobileRound = ri }

export function renderCommRoundSelector() {
  const bar = document.getElementById('comm-round-selector-bar')
  if (!bar) return
  bar.innerHTML = ''
  const d = activeDraw()
  if (!d) return
  d.rounds.forEach((r, ri) => {
    const btn = document.createElement('button')
    btn.className = 'round-sel-btn' + (ri === _commMobileRound ? ' active' : '')
    btn.textContent = r.label
    btn.addEventListener('click', () => {
      _commMobileRound = ri
      renderCommRoundSelector()
      renderResults()
    })
    bar.appendChild(btn)
  })
}

export function renderResults() {
  const body = $c('results-bracket-body')
  if (!body) return

  if (isMobile()) {
    renderBracketList(activeDraw(), _commMobileRound, body, _placeResultCard)
    renderCommRoundSelector()
    _wireResultsSearch(body, true)
    return
  }

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

  _wireResultsSearch(wrap, false)
}

// Results-only occupant: a future-round slot is filled ONLY by the feeder match's
// confirmed winner — never a projected pick (originalPick/matchPick). Round 0 is the
// real draw, so its slots are always the actual players. Keeps the Results screen
// strictly about confirmed players (and prevents confirming a winner on a predicted
// matchup), without touching buildDrawView, which the live bracket still uses to
// project picks forward.
function _resultOccupant(d, m, ri, mi, side) {
  if (ri === 0) return m[side]
  const name = feederWinnerName(d, ri, mi, side)
  if (name) {
    const feeder = d.rounds[ri - 1]?.matches[mi * 2 + (side === 'p1' ? 0 : 1)]
    const seed = feeder.p1?.name === name ? feeder.p1.seed
      : feeder.p2?.name === name ? feeder.p2.seed : ''
    return { name, seed }
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

  function makeResultRow(p, side, isWinner, isLoser, clickable, isEspnPick) {
    const row = document.createElement('div')
    let cls = 'pr'
    if (isWinner) cls += ' res-winner'
    else if (isLoser) cls += ' res-loser'
    else if (clickable) cls += ' res-clickable'
    row.className = cls

    const seedEl = document.createElement('span'); seedEl.className = 'pr-seed'; seedEl.textContent = p.seed || ''
    const nameEl = document.createElement('span'); nameEl.className = 'pr-name'; nameEl.textContent = p.name || '—'
    row.appendChild(seedEl); row.appendChild(nameEl)

    // ESPN-detected-winner safety-net marker (unconfirmed only) — lets the commissioner
    // eyeball the auto-detected result before confirming, and before scores_autoconfirm_enabled
    // is ever turned on. See .claude/rules/scores-feed.md.
    if (isEspnPick) {
      const espnTag = document.createElement('span')
      espnTag.className = 'pr-espn-pick'
      espnTag.textContent = 'ESPN ✓'
      row.appendChild(espnTag)
    }

    // Pencil edit button — R1 only
    if (ri === 0) {
      const editBtn = document.createElement('button')
      editBtn.className = 'pr-edit-btn'; editBtn.textContent = '✎'; editBtn.title = 'Edit player'
      editBtn.addEventListener('click', e => { e.stopPropagation(); openEditPlayerModal(ri, mi, side) })
      row.appendChild(editBtn)
    }

    if (clickable && p.name) {
      row.addEventListener('click', () => {
        row.style.pointerEvents = 'none'
        applyWinner(d, ri, mi, p.name, { renderStats: () => {}, renderBracket: renderResults })
          .catch(err => console.error('Winner save failed:', err))
      })
    }
    return row
  }

  const p1Winner = hasResult && m.winner === p1.name
  const p2Winner = hasResult && m.winner === p2.name
  const canClick = !hasResult && p1.name && p2.name
  // Only meaningful pre-confirmation — once hasResult, the real winner/loser styling
  // already shows the outcome and this would be redundant.
  const espnPickP1 = !hasResult && m.espn_winner && m.espn_winner === p1.name
  const espnPickP2 = !hasResult && m.espn_winner && m.espn_winner === p2.name

  const rowsWrap = document.createElement('div')
  rowsWrap.style.cssText = 'overflow:hidden;border-radius:5px 5px 0 0;flex-shrink:0'
  rowsWrap.appendChild(makeResultRow(p1, 'p1', p1Winner, hasResult && !p1Winner, canClick, espnPickP1))
  rowsWrap.appendChild(makeResultRow(p2, 'p2', p2Winner, hasResult && !p2Winner, canClick, espnPickP2))
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

function _wireResultsSearch(wrap, mobile) {
  const inputId = mobile ? 'comm-mobile-search-input' : 'results-search-input'
  const clearId = mobile ? 'comm-mobile-search-clear' : 'results-search-clear'
  const resultsId = mobile ? 'comm-mobile-search-results' : null
  const input = document.getElementById(inputId)
  const clearBtn = document.getElementById(clearId)
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
    const idx = gender === 'MS' ? 0 : 1
    const segId = mobile ? 'comm-seg-control-mobile' : 'comm-seg-control'
    const btns = document.querySelectorAll(`#${segId} .seg-btn`)
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
  document.getElementById('epm-country').value = COUNTRY_DISPLAY_NAMES[m[side].country] || ''
  document.getElementById('edit-player-modal').style.display = 'flex'
  setTimeout(() => document.getElementById('epm-name').focus(), 50)
}

// Applies one round-0 player-slot edit: DB write (name/seed/country, roster_changed_at
// + replaced_name stamping, odds/ELO clearing) + in-memory patch + pre/post-lock
// stale-pick handling. Shared by the modal-driven single edit (confirmEditPlayer,
// below) and the batch re-upload diff flow's ROSTER CHANGE bucket
// (commissioner-qualifiers.js — see .claude/rules/qualifiers.md). Does NOT call
// buildDrawView or re-render — callers do that once after all their edits land.
export async function applyPlayerSwap(d, ri, mi, side, newName, newSeed, newIoc) {
  const m = d.rounds[ri].matches[mi]
  const oldName = m[side].name
  m[side] = { name: newName, seed: newSeed, country: newIoc }
  if (m.matchPick === oldName) m.matchPick = null
  if (m.originalPick === oldName) m.originalPick = null

  // Any real round-0 swap stamps roster_changed_at + replaced_name so every player's app
  // can detect the change at load (pre- or post-lock). The one-time-repick reopen
  // (editedAfterLock) stays post-lock only — see the block below.
  const isRealR0Swap = ri === 0 && oldName && oldName !== newName
  const rosterChangedAt = isRealR0Swap ? new Date().toISOString() : null

  if (state.currentUser?.is_commissioner && m.db_id) {
    const update = {}
    if (side === 'p1') { update.p1_name = newName; update.p1_seed = newSeed; update.p1_country = newIoc }
    else { update.p2_name = newName; update.p2_seed = newSeed; update.p2_country = newIoc }
    if (isRealR0Swap) {
      update.roster_changed_at = rosterChangedAt
      update.replaced_name = oldName
    }
    if (oldName && oldName !== newName) {
      // H2H odds are relative, so a swap invalidates both prices.
      update.odds_p1_live = null; update.odds_p2_live = null
      update.odds_p1_locked = null; update.odds_p2_locked = null
      // ELO is per-player; only the replaced side needs clearing.
      if (side === 'p1') update.elo_p1 = null; else update.elo_p2 = null
    }
    await supabase.from('matches').update(update).eq('id', m.db_id)
    if (isRealR0Swap) {
      m.roster_changed_at = rosterChangedAt
      m.replaced_name = oldName
    }
    if (oldName && oldName !== newName) {
      m.odds_p1_live = null; m.odds_p2_live = null
      m.odds_p1_locked = null; m.odds_p2_locked = null
      if (side === 'p1') m.elo_p1 = null; else m.elo_p2 = null
    }
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

  // Patch countryMap so flag renders update immediately without a full reload.
  if (oldName && oldName !== newName) delete d.countryMap[oldName]
  if (newName && newIoc) d.countryMap[newName] = newIoc
  else if (newName) delete d.countryMap[newName]
}

export async function confirmEditPlayer() {
  if (!editCtx) return
  const d = activeDraw(); if (!d) return
  const { ri, mi, side } = editCtx
  const newName = document.getElementById('epm-name').value.trim()
  const newSeed = document.getElementById('epm-seed').value.trim()
  const rawCountry = document.getElementById('epm-country').value.trim()
  const newIoc = rawCountry ? (countryNameToIoc(rawCountry) ?? null) : null

  await applyPlayerSwap(d, ri, mi, side, newName, newSeed, newIoc)

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
