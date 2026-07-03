// Realtime updates. See .claude/rules/realtime.md for the full decision record (why
// postgres_changes over Broadcast, table scope, staged rollout).
//
// Stage 1 (startBracketRealtime/stopBracketRealtime) — bracket screen. Two-tier model
// driven entirely by the caller's callbacks:
//   - patchScore(matchDbId, {score, espn_state}) — high-frequency ESPN ticks, no rebuild.
//     Must return true/false; false (match not found, DOM not there) falls back to rebuild.
//   - rebuild() — real state changes (winner confirmed, lock fired, original_picks_locked
//     or is_active flips). Debounced to ~once/second so a burst of events (e.g. a lock
//     firing and cascading several match updates) doesn't rebuild once per message.
//
// Stage 3 (startResultsRealtime/stopResultsRealtime) — commissioner Results tab. Single
// onChange callback (no patch tier — this is pure visibility, not painted per-card).
//
// Kill switch (both stages): any subscribe error/timeout/close just tears down the
// channel. There is no realtime-specific UI state to unwind — the app simply reverts to
// today's manual-refresh behavior. Never throws out of this module.

import { supabase } from './supabase.js'

const REBUILD_DEBOUNCE_MS = 1000

let _channel = null
let _rebuildTimer = null
let _pendingRebuild = false
let _cb = null

function _scheduleRebuild() {
  _pendingRebuild = true
  if (_rebuildTimer) return
  _rebuildTimer = setTimeout(() => {
    _rebuildTimer = null
    if (!_pendingRebuild) return
    _pendingRebuild = false
    try { _cb?.rebuild() } catch (err) { console.warn('[realtime] rebuild callback failed', err) }
  }, REBUILD_DEBOUNCE_MS)
}

function _handleMatchChange(payload) {
  const oldRow = payload.old || {}
  const newRow = payload.new || {}
  if (!newRow.id) return
  if (oldRow.winner !== newRow.winner) {
    // A confirmed (or undone) winner changes derived slots/eliminations downstream —
    // needs a real buildDrawView recompute, not a footer patch.
    _scheduleRebuild()
    return
  }
  let patched = false
  try { patched = !!_cb?.patchScore?.(newRow.id, { score: newRow.score, espn_state: newRow.espn_state }) }
  catch (err) { console.warn('[realtime] patchScore callback threw, falling back to rebuild', err) }
  if (!patched) _scheduleRebuild()
}

// Starts (or restarts) the bracket-screen realtime subscription for one draw.
// Safe to call repeatedly — always tears down any prior subscription first.
export function startBracketRealtime(drawId, callbacks) {
  stopBracketRealtime()
  if (!drawId) return
  _cb = callbacks

  try {
    _channel = supabase
      .channel(`bracket-rt-${drawId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `draw_id=eq.${drawId}` }, _handleMatchChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lock_schedules', filter: `draw_id=eq.${drawId}` }, () => _scheduleRebuild())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'draws', filter: `id=eq.${drawId}` }, () => _scheduleRebuild())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_settings' }, () => _scheduleRebuild())
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Kill switch — fall back to manual refresh, silently.
          stopBracketRealtime()
        }
      })
  } catch (err) {
    console.warn('[realtime] failed to start bracket subscription', err)
    stopBracketRealtime()
  }
}

export function stopBracketRealtime() {
  if (_channel) {
    try { supabase.removeChannel(_channel) } catch { /* already gone */ }
    _channel = null
  }
  if (_rebuildTimer) { clearTimeout(_rebuildTimer); _rebuildTimer = null }
  _pendingRebuild = false
  _cb = null
}

// ── STAGE 3: commissioner Results tab ──
// Pure visibility, not auto-action — no concurrent-edit handling needed (exactly one
// is_commissioner=true account per CLAUDE.md §6). Only `matches` is in scope here
// (winner/score/espn_state); lock_schedules/draws/app_settings aren't relevant to a
// single match's confirm-or-not decision on this tab. Separate channel/debounce state
// from the bracket subscription above so the two can run independently (e.g. a player
// on the bracket screen and the commissioner on Results, in different tabs/sessions).

const RESULTS_DEBOUNCE_MS = 1000

let _resultsChannel = null
let _resultsTimer = null
let _resultsPending = false
let _resultsCb = null

function _resultsScheduleNotify() {
  _resultsPending = true
  if (_resultsTimer) return
  _resultsTimer = setTimeout(() => {
    _resultsTimer = null
    if (!_resultsPending) return
    _resultsPending = false
    try { _resultsCb?.() } catch (err) { console.warn('[realtime] results notify callback failed', err) }
  }, RESULTS_DEBOUNCE_MS)
}

function _handleResultsMatchChange(payload) {
  const o = payload.old || {}
  const n = payload.new || {}
  // Only notify on the fields the commissioner actually cares about here — matches
  // also gets odds/elo writes every few hours that are irrelevant to confirming results.
  if (o.winner === n.winner && o.score === n.score && o.espn_state === n.espn_state) return
  _resultsScheduleNotify()
}

// Starts (or restarts) the commissioner Results-tab subscription for one draw.
// `onChange` is called (debounced) whenever a match's winner/score/espn_state changes —
// it's the caller's job to reload the draw and re-render; this module only notifies.
export function startResultsRealtime(drawId, onChange) {
  stopResultsRealtime()
  if (!drawId) return
  _resultsCb = onChange

  try {
    _resultsChannel = supabase
      .channel(`results-rt-${drawId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `draw_id=eq.${drawId}` }, _handleResultsMatchChange)
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Kill switch — fall back to manual refresh, silently.
          stopResultsRealtime()
        }
      })
  } catch (err) {
    console.warn('[realtime] failed to start results subscription', err)
    stopResultsRealtime()
  }
}

export function stopResultsRealtime() {
  if (_resultsChannel) {
    try { supabase.removeChannel(_resultsChannel) } catch { /* already gone */ }
    _resultsChannel = null
  }
  if (_resultsTimer) { clearTimeout(_resultsTimer); _resultsTimer = null }
  _resultsPending = false
  _resultsCb = null
}
