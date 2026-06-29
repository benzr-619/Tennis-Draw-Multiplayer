// Data loading — assembles Supabase rows into local state shape
// Assembly applies defensive defaults for all nullable fields (migrateState equivalent)

import { supabase } from './supabase.js'
import { state } from './state.js'
import { buildDrawView } from './draw-view.js'

// Background archive load — resolves when all inactive draws are merged into state.draws.
// Leaderboard awaits this before rendering. null = not yet started / already complete.
let _archiveLoadPromise = null

/**
 * Awaits the background archive load. No-op if archive is already loaded or there was
 * nothing to load. Safe to call multiple times — returns the same in-flight promise.
 */
export function ensureAllDrawsLoaded() {
  return _archiveLoadPromise ?? Promise.resolve()
}

/**
 * Load draws from Supabase and assemble into state.draws.
 * Active draws (is_active=true) are loaded synchronously before returning so the
 * bracket screen can paint immediately. Inactive past draws load in the background
 * and are merged into state.draws when ready; ensureAllDrawsLoaded() awaits them.
 */
export async function loadAllDraws() {
  if (!state.currentUser) return
  _archiveLoadPromise = null

  // 1. Fetch the draws table (small, fast)
  console.time('loadAllDraws:drawRows')
  const { data: drawRows, error: de } = await supabase
    .from('draws')
    .select('id, slam, draw_type, year, original_picks_locked, is_active, exclude_from_leaderboard, created_at, elo_synced_at')
    .order('created_at', { ascending: true })
  console.timeEnd('loadAllDraws:drawRows')

  if (de) throw de
  if (!drawRows || drawRows.length === 0) {
    state.draws = []
    _archiveLoadPromise = Promise.resolve()
    return
  }

  // 2. Partition: active draws block first render; inactive load in background
  const activeRows   = drawRows.filter(dr =>  dr.is_active)
  const inactiveRows = drawRows.filter(dr => !dr.is_active)

  // Between-slams: no active draw exists, so the user needs the last draw available
  // for the "tap to browse" overlay. Load everything synchronously (same as old behavior).
  if (activeRows.length === 0) {
    console.time('loadAllDraws:allDraws(between-slams)')
    const allDraws = await Promise.all(drawRows.map(dr => loadDraw(dr)))
    console.timeEnd('loadAllDraws:allDraws(between-slams)')
    state.draws = allDraws
    state.activeTab = allDraws.length - 1
    await loadLockSchedules()
    _archiveLoadPromise = Promise.resolve()
    return
  }

  // 3. Load only the active draws before returning (unblocks first paint)
  console.time('loadAllDraws:activeDraws')
  const activeDraws = await Promise.all(activeRows.map(dr => loadDraw(dr)))
  console.timeEnd('loadAllDraws:activeDraws')

  state.draws = activeDraws

  // 4. Set activeTab to the active slam's MS draw (or WS if no MS, or last as fallback)
  const activeMs = state.draws.findIndex(d => d.is_active && d.draw === 'MS')
  const activeWs = state.draws.findIndex(d => d.is_active && d.draw === 'WS')
  const activeIdx = activeMs >= 0 ? activeMs : activeWs >= 0 ? activeWs : state.draws.length - 1
  state.activeTab = Math.max(0, Math.min(activeIdx, state.draws.length - 1))

  // 5. Lock schedules only needed for the active draw — load them now
  await loadLockSchedules()

  // 6. Load inactive past draws in the background — does NOT block the caller
  if (inactiveRows.length === 0) {
    _archiveLoadPromise = Promise.resolve()
    return
  }

  _archiveLoadPromise = (async () => {
    console.time('loadAllDraws:archiveDraws')
    const inactiveDraws = await Promise.all(inactiveRows.map(dr => loadDraw(dr)))
    console.timeEnd('loadAllDraws:archiveDraws')

    // Preserve the user's current tab selection before the index shift
    const currentDrawId = state.draws[state.activeTab]?.db_id

    // Rebuild state.draws in original created_at order (active + inactive merged)
    const byId = {}
    ;[...activeDraws, ...inactiveDraws].forEach(d => { byId[d.db_id] = d })
    state.draws = drawRows.map(dr => byId[dr.id]).filter(Boolean)

    // Re-resolve activeTab: prefer to stay on whatever the user had selected
    const restoredIdx = currentDrawId
      ? state.draws.findIndex(d => d.db_id === currentDrawId)
      : -1
    if (restoredIdx >= 0) {
      state.activeTab = restoredIdx
    } else {
      const ms = state.draws.findIndex(d => d.is_active && d.draw === 'MS')
      const ws = state.draws.findIndex(d => d.is_active && d.draw === 'WS')
      state.activeTab = ms >= 0 ? ms : ws >= 0 ? ws : state.draws.length - 1
    }
  })()
}

export async function loadDraw(drawRow) {
  const drawId = drawRow.id
  const userId = state.currentUser?.id
  const _lbl = `${drawRow.slam}_${drawRow.year}_${drawRow.draw_type}`

  // Fetch matches
  console.time(`loadDraw:matches:${_lbl}`)
  const { data: matchRows, error: me } = await supabase
    .from('matches')
    .select('id, round_index, match_index, p1_name, p1_seed, p1_country, p2_name, p2_seed, p2_country, winner, score, roster_changed_at, replaced_name, odds_p1_live, odds_p2_live, odds_fetched_at, odds_p1_locked, odds_p2_locked, odds_locked_at, elo_p1, elo_p2')
    .eq('draw_id', drawId)
    .order('round_index', { ascending: true })
  console.timeEnd(`loadDraw:matches:${_lbl}`)

  if (me) throw me

  // Fetch picks for current user
  let pickMap = {}
  if (userId) {
    console.time(`loadDraw:picks:${_lbl}`)
    const { data: pickRows, error: pe } = await supabase
      .from('picks')
      .select('match_id, match_pick, original_pick, original_pick_result, match_pick_result, high_confidence, edited_after_lock, notes, updated_at')
      .eq('draw_id', drawId)
      .eq('user_id', userId)
    console.timeEnd(`loadDraw:picks:${_lbl}`)

    if (pe) throw pe

    pickRows.forEach(p => { pickMap[p.match_id] = p })
  }

  // Build rounds array from matchRows
  const roundsMap = {}
  ;(matchRows || []).forEach(mr => {
    const ri = mr.round_index
    if (!roundsMap[ri]) roundsMap[ri] = { label: roundLabel(ri), matches: [] }
    const pk = pickMap[mr.id] || {}

    // Defensive defaults — migrateState equivalent
    const match = {
      db_id: mr.id,
      p1: { name: mr.p1_name ?? '', seed: mr.p1_seed ?? '', country: mr.p1_country ?? '' },
      p2: { name: mr.p2_name ?? '', seed: mr.p2_seed ?? '', country: mr.p2_country ?? '' },
      matchPick: pk.match_pick ?? null,
      originalPick: pk.original_pick ?? null,
      originalPickResult: pk.original_pick_result ?? null,
      matchPickResult: pk.match_pick_result ?? null,
      highConfidence: pk.high_confidence ?? false,
      editedAfterLock: pk.edited_after_lock ?? false,
      notes: pk.notes ?? '',
      winner: mr.winner ?? null,
      score: mr.score ?? '',
      roster_changed_at: mr.roster_changed_at ?? null,
      replaced_name: mr.replaced_name ?? null,
      odds_p1_live: mr.odds_p1_live ?? null,
      odds_p2_live: mr.odds_p2_live ?? null,
      odds_fetched_at: mr.odds_fetched_at ?? null,
      odds_p1_locked: mr.odds_p1_locked ?? null,
      odds_p2_locked: mr.odds_p2_locked ?? null,
      odds_locked_at: mr.odds_locked_at ?? null,
      elo_p1: mr.elo_p1 ?? null,
      elo_p2: mr.elo_p2 ?? null,
    }
    roundsMap[ri].matches[mr.match_index] = match
  })

  // Convert to sorted array
  const maxRi = Math.max(...Object.keys(roundsMap).map(Number), -1)
  const rounds = []
  for (let i = 0; i <= maxRi; i++) {
    rounds.push(roundsMap[i] || { label: roundLabel(i), matches: [] })
    // Ensure no gaps in matches array
    rounds[i].matches = rounds[i].matches.map(m => m || emptyMatch())
  }

  const assembled = {
    db_id: drawRow.id,
    slam: drawRow.slam,
    draw: drawRow.draw_type,
    year: drawRow.year,
    locked: drawRow.original_picks_locked ?? false,
    is_active: drawRow.is_active ?? false,
    excludeFromLeaderboard: drawRow.exclude_from_leaderboard ?? false,
    elo_synced_at: drawRow.elo_synced_at ?? null,
    rounds,
  }

  // Unified roster-change detection: collect alerts + handle in-memory pick state.
  // Uses roster_changed_at (stamped by the commissioner swap) and the user's pick
  // updated_at to determine whether the player has already repicked since the change.
  assembled.rosterAlerts = []

  if (assembled.locked) {
    // Post-lock: reopen the match for a one-time repick + push an alert.
    // Reach ALL players (even those whose pick is still valid) — the prompt is a heads-up.
    // A repick advances updated_at past roster_changed_at, silencing the alert on next load.
    assembled.rounds[0]?.matches.forEach((m, mi) => {
      if (m.winner || !m.roster_changed_at) return
      const pickUpdatedAt = pickMap[m.db_id]?.updated_at
      const repickedSinceChange = pickUpdatedAt && new Date(pickUpdatedAt) >= new Date(m.roster_changed_at)
      if (repickedSinceChange) return

      m.editedAfterLock = true
      const stillInMatch = m.originalPick === m.p1.name || m.originalPick === m.p2.name
      let pickedThrough = null
      if (!stillInMatch) {
        const dep = m.replaced_name
        pickedThrough = assembled.rounds.reduce((maxRi, round, rIdx) => {
          if (rIdx === 0) return maxRi
          return round.matches.some(fm => fm.matchPick === dep) ? rIdx : maxRi
        }, 0)
        m.originalPick = null
        if (m.matchPick && m.matchPick !== m.p1.name && m.matchPick !== m.p2.name) m.matchPick = null
      }

      assembled.rosterAlerts.push({ replaced_name: m.replaced_name, p1_name: m.p1.name, p2_name: m.p2.name, db_id: m.db_id, ri: 0, mi, pickedWithdrawn: !stillInMatch, pickedThrough })
    })
  } else {
    // Pre-lock: clear stale in-memory picks (no editedAfterLock), push alerts.
    // No DB writes — RLS prevents writing to other users' picks rows.
    assembled.rounds[0]?.matches.forEach((m, mi) => {
      if (m.winner || !m.roster_changed_at) return
      const pickUpdatedAt = pickMap[m.db_id]?.updated_at
      const repickedSinceChange = pickUpdatedAt && new Date(pickUpdatedAt) >= new Date(m.roster_changed_at)
      if (repickedSinceChange) return

      let pickedWithdrawn = false
      let pickedThrough = null
      if (m.matchPick && m.matchPick !== m.p1.name && m.matchPick !== m.p2.name) {
        // Their pick points at the departed player — capture cascade depth, then clear.
        pickedWithdrawn = true
        const stale = m.matchPick
        pickedThrough = assembled.rounds.reduce((maxRi, round, rIdx) => {
          if (rIdx === 0) return maxRi
          return round.matches.some(fm => fm.matchPick === stale) ? rIdx : maxRi
        }, 0)
        m.matchPick = null
        assembled.rounds.forEach((round, rIdx) => {
          if (rIdx === 0) return
          round.matches.forEach(fm => { if (fm.matchPick === stale) fm.matchPick = null })
        })
      }

      assembled.rosterAlerts.push({ replaced_name: m.replaced_name, p1_name: m.p1.name, p2_name: m.p2.name, db_id: m.db_id, ri: 0, mi, pickedWithdrawn, pickedThrough })
    })
  }

  // Build player→country lookup from round-0 (where PDF codes are stored).
  // Country is NOT cascaded through derived slots; renderers look up by player name.
  const countryMap = {}
  ;(roundsMap[0]?.matches || []).forEach(m => {
    if (m?.p1?.name && m?.p1?.country) countryMap[m.p1.name] = m.p1.country
    if (m?.p2?.name && m?.p2?.country) countryMap[m.p2.name] = m.p2.country
  })
  assembled.countryMap = countryMap

  // Derive all round-2+ slots, elimination flags, and displaced-pick labels in
  // one pure pass. (Replaces the old inline reconstruction + markLoserForward replay.)
  return buildDrawView(assembled)
}

export async function loadLockSchedules() {
  if (!state.draws?.length) { state.lockSchedules = []; return }

  const drawIds = state.draws.map(d => d.db_id)
  const { data, error } = await supabase
    .from('lock_schedules')
    .select('*')
    .in('draw_id', drawIds)

  if (error) throw error
  state.lockSchedules = data || []
}

// Reload all draws without resetting the user's current tab selection.
export async function refreshAll() {
  if (!state.currentUser) return
  const savedId = state.draws[state.activeTab]?.db_id
  await loadAllDraws()
  if (savedId) {
    const idx = state.draws.findIndex(d => d.db_id === savedId)
    if (idx >= 0) state.activeTab = idx
  }
}

// Reload just the active draw's picks (e.g. after commissioner action)
export async function reloadActiveDraw() {
  const d = state.draws[state.activeTab]
  if (!d) return
  const drawRow = { id: d.db_id, slam: d.slam, draw_type: d.draw, year: d.year, original_picks_locked: d.locked, is_active: d.is_active, exclude_from_leaderboard: d.excludeFromLeaderboard }
  const refreshed = await loadDraw(drawRow)
  state.draws[state.activeTab] = refreshed
  await loadLockSchedules()
}

// ── HELPERS ──
const ROUND_LABELS = ['R1', 'R2', 'R3', 'R4', 'QF', 'SF', 'F']
function roundLabel(ri) { return ROUND_LABELS[ri] || 'R' + (ri + 1) }

function emptyMatch() {
  return {
    db_id: null,
    p1: { name: '', seed: '' },
    p2: { name: '', seed: '' },
    matchPick: null, originalPick: null,
    originalPickResult: null, matchPickResult: null,
    highConfidence: false, editedAfterLock: false, notes: '',
    winner: null, score: '', roster_changed_at: null, replaced_name: null,
    odds_p1_live: null, odds_p2_live: null, odds_fetched_at: null,
    odds_p1_locked: null, odds_p2_locked: null, odds_locked_at: null,
    elo_p1: null, elo_p2: null,
  }
}

// ── SLAM HELPERS ──
export const SLAM_COLORS = {
  AO:  '#2d7ab8',
  RG:  '#BD5627',
  WIM: '#275F3D',
  USO: '#071C63',
}

export const SLAM_CONFIG = {
  AO: { name: 'Australian Open', surface: 'Hard' },
  RG: { name: 'Roland Garros', surface: 'Clay' },
  WIM: { name: 'Wimbledon', surface: 'Grass' },
  USO: { name: 'US Open', surface: 'Hard' },
}

export function slamKey(d) { return d.slam + '_' + d.year }
export function slamLabel(d) { const cfg = SLAM_CONFIG[d.slam] || {}; return (cfg.name || d.slam) + ' ' + d.year }
export function drawLabel(d) { const cfg = SLAM_CONFIG[d.slam] || {}; return (cfg.name || d.slam) + ' ' + d.year + ' ' + d.draw }
export function uniqueSlams() {
  const seen = new Set()
  return state.draws.filter(d => { const k = slamKey(d); if (seen.has(k)) return false; seen.add(k); return true })
}
