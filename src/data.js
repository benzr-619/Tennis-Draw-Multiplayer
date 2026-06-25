// Data loading — assembles Supabase rows into local state shape
// Assembly applies defensive defaults for all nullable fields (migrateState equivalent)

import { supabase } from './supabase.js'
import { state } from './state.js'
import { buildDrawView } from './draw-view.js'

/**
 * Load all draws from Supabase and assemble into state.draws.
 * Fetches matches + picks for each draw. Respects state.currentUser.
 */
export async function loadAllDraws() {
  if (!state.currentUser) return

  // 1. Fetch all draws
  const { data: drawRows, error: de } = await supabase
    .from('draws')
    .select('id, slam, draw_type, year, original_picks_locked, is_active, exclude_from_leaderboard, created_at')
    .order('created_at', { ascending: true })

  if (de) throw de
  if (!drawRows || drawRows.length === 0) {
    state.draws = []
    return
  }

  // 2. For each draw, fetch matches + picks + lock_schedules in parallel
  const assembled = await Promise.all(drawRows.map(dr => loadDraw(dr)))
  state.draws = assembled

  // Set activeTab to the active slam's MS draw (or WS if no MS, or last draw as fallback)
  const activeMs = state.draws.findIndex(d => d.is_active && d.draw === 'MS')
  const activeWs = state.draws.findIndex(d => d.is_active && d.draw === 'WS')
  const activeIdx = activeMs >= 0 ? activeMs : activeWs >= 0 ? activeWs : state.draws.length - 1
  state.activeTab = Math.max(0, Math.min(activeIdx, state.draws.length - 1))

  // Load lock schedules for active draw
  await loadLockSchedules()
}

export async function loadDraw(drawRow) {
  const drawId = drawRow.id
  const userId = state.currentUser?.id

  // Fetch matches
  const { data: matchRows, error: me } = await supabase
    .from('matches')
    .select('id, round_index, match_index, p1_name, p1_seed, p2_name, p2_seed, winner, score, roster_changed_at, odds_p1_live, odds_p2_live, odds_fetched_at, odds_p1_locked, odds_p2_locked, odds_locked_at')
    .eq('draw_id', drawId)
    .order('round_index', { ascending: true })

  if (me) throw me

  // Fetch picks for current user
  let pickMap = {}
  if (userId) {
    const { data: pickRows, error: pe } = await supabase
      .from('picks')
      .select('match_id, match_pick, original_pick, original_pick_result, match_pick_result, high_confidence, edited_after_lock, notes, updated_at')
      .eq('draw_id', drawId)
      .eq('user_id', userId)

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
      p1: { name: mr.p1_name ?? '', seed: mr.p1_seed ?? '' },
      p2: { name: mr.p2_name ?? '', seed: mr.p2_seed ?? '' },
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
      odds_p1_live: mr.odds_p1_live ?? null,
      odds_p2_live: mr.odds_p2_live ?? null,
      odds_fetched_at: mr.odds_fetched_at ?? null,
      odds_p1_locked: mr.odds_p1_locked ?? null,
      odds_p2_locked: mr.odds_p2_locked ?? null,
      odds_locked_at: mr.odds_locked_at ?? null,
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
    rounds,
  }

  // For locked draws: detect post-lock round-0 roster changes (in memory, no DB write).
  // The commissioner's edit stamps the match's roster_changed_at. We reopen that match
  // for a ONE-TIME repick for every player who hasn't already repicked since the change
  // (their pick's updated_at predates the change, or they have no pick yet). This reaches
  // ALL players — including those who picked the player who stayed — not just those whose
  // pick vanished. A player who repicks advances their updated_at and won't be reopened.
  if (assembled.locked) {
    assembled.rounds[0]?.matches.forEach(m => {
      if (m.winner || !m.roster_changed_at) return
      const pickUpdatedAt = pickMap[m.db_id]?.updated_at
      const repickedSinceChange = pickUpdatedAt && new Date(pickUpdatedAt) >= new Date(m.roster_changed_at)
      if (repickedSinceChange) return

      // Reopen the match for this player.
      m.editedAfterLock = true
      const stillInMatch = m.originalPick === m.p1.name || m.originalPick === m.p2.name
      if (!stillInMatch) {
        // They picked the removed player (or had no valid pick): clear it — they must repick.
        m.originalPick = null
        if (m.matchPick && m.matchPick !== m.p1.name && m.matchPick !== m.p2.name) m.matchPick = null
      }
      // If they picked the player who stayed, keep their pick — they may repick, but
      // won't lose a valid pick by ignoring the prompt.
    })
  }

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

// Reload just the active draw's picks (e.g. after switching tabs)
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
    winner: null, score: '', roster_changed_at: null,
    odds_p1_live: null, odds_p2_live: null, odds_fetched_at: null,
    odds_p1_locked: null, odds_p2_locked: null, odds_locked_at: null,
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
