// Draw Health band calibration.
//
// The health-hue colour scale (scoring.js healthHue) is calibrated against the
// historical distribution of Draw Health at each tournament stage, where stage =
// n confirmed matches out of 127. This module owns all band computation: simulating
// each draw's per-match health trajectory, storing raw samples, and recomputing the
// gradient bounds (LOW_PCTL/HIGH_PCTL percentiles) consumed by the renderers.
//
// Why not a fixed P25/P75: that only gradients the middle 50% of the historical
// distribution — everyone outside it (by definition, ~half the cohort) renders at
// full-saturation red/green regardless of how close they are to the edge. With the
// current small sample (~11-24 real-pick samples per stage as of 2026-06-30), the
// gap between P25/P75 can be a sliver of the true range (e.g. 4.7 of 35 points at
// n=59), producing a harsh cliff instead of a gradient. LOW_PCTL/HIGH_PCTL widen
// that window so more of the cohort sees a real gradient instead of clipping.
//
// Nothing here ever blocks the main thread — long loops yield via setTimeout(0).

import { supabase } from './supabase.js'
import { calcHealthAtMatchSet } from './scoring.js'
import { loadDraw } from './data.js'
import {
  assembleDrawForUser,
  loadAllPicksForDraw,
  loadAllProfiles,
  fetchAllRows,
} from './leaderboard.js'

// Flip to false once past-slam historical data is rich enough that including the
// current slam in real-time adds no meaningful calibration. Signal: when the
// "Bands updated in Xs" note in the Results tab starts feeling slow.
export const HEALTH_BANDS_LIVE_MODE = true

const YIELD_EVERY = 20  // yield to the event loop every N trajectory steps

// Gradient bounds: at/below LOW_PCTL renders pure red, at/above HIGH_PCTL renders
// pure green. Wider = smoother gradient but less aggressive flagging of extremes;
// narrower = more selective about what counts as "good"/"bad" but harsher cliffs.
// 10/90 chosen as a default that's robust to the current small sample size (P1/P99
// would essentially track min/max with ~15-24 points, letting one outlier sample
// dominate the whole scale). Revisit once more slam history accumulates.
const LOW_PCTL = 10
const HIGH_PCTL = 90

// ── PERCENTILES ──
function percentile(sortedArr, p) {
  const len = sortedArr.length
  if (len === 0) return null
  if (len === 1) return sortedArr[0]
  const idx = (p / 100) * (len - 1)
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  if (lo === hi) return sortedArr[lo]
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo)
}

// ── ORDERING HELPERS ──
// Real confirmation order from the DB (winner_confirmed_at ascending).
async function orderedConfirmedIds(drawId) {
  const { data, error } = await supabase
    .from('matches')
    .select('id, winner_confirmed_at, round_index, match_index')
    .eq('draw_id', drawId)
    .not('winner', 'is', null)
    .order('winner_confirmed_at', { ascending: true, nullsFirst: true })
    .order('round_index', { ascending: true })
    .order('match_index', { ascending: true })
  if (error) throw error
  return (data || []).map(r => r.id)
}

// Synthetic bracket order from an in-memory assembled draw (rounds ascending,
// match index ascending). Confirmed matches only.
function syntheticOrderedConfirmedIds(d) {
  const out = []
  d.rounds.forEach(r => r.matches.forEach(m => { if (m.winner && m.db_id) out.push(m.db_id) }))
  return out
}

// ── TRAJECTORY ──
// Returns [{ n, health_pct }] for n = 1..orderedMatchIds.length, computing health
// at each prefix of the confirmed-match set. Yields every YIELD_EVERY steps.
export async function computeDrawTrajectory(assembledDrawForOneUser, orderedMatchIds) {
  const out = []
  for (let k = 1; k <= orderedMatchIds.length; k++) {
    const set = new Set(orderedMatchIds.slice(0, k))
    const { maxHealthPts, reachableHealthPts } = calcHealthAtMatchSet(assembledDrawForOneUser, set)
    const health_pct = maxHealthPts > 0 ? reachableHealthPts / maxHealthPts * 100 : 0
    out.push({ n: k, health_pct })
    if (k % YIELD_EVERY === 0) await new Promise(r => setTimeout(r, 0))
  }
  return out
}

// ── SAMPLE STORE ──
async function upsertSamples(samples) {
  const CHUNK = 500
  for (let i = 0; i < samples.length; i += CHUNK) {
    const { error } = await supabase
      .from('health_band_samples')
      .upsert(samples.slice(i, i + CHUNK), { onConflict: 'n,draw_id,user_id' })
    if (error) throw error
  }
}

// Recompute the gradient bounds (LOW_PCTL/HIGH_PCTL) for ALL bands from every stored sample.
async function recomputeAllBands() {
  const rows = await fetchAllRows(
    supabase.from('health_band_samples').select('n, health_pct')
  )
  const byN = new Map()
  rows.forEach(r => {
    if (!byN.has(r.n)) byN.set(r.n, [])
    byN.get(r.n).push(r.health_pct)
  })
  const bandRows = []
  for (const [n, vals] of byN) {
    vals.sort((a, b) => a - b)
    bandRows.push({ n, lo: percentile(vals, LOW_PCTL), hi: percentile(vals, HIGH_PCTL), sample_size: vals.length })
  }
  if (!bandRows.length) return
  const CHUNK = 200
  for (let i = 0; i < bandRows.length; i += CHUNK) {
    const { error } = await supabase
      .from('health_bands')
      .upsert(bandRows.slice(i, i + CHUNK), { onConflict: 'n' })
    if (error) throw error
  }
}

// Recompute the gradient bounds for a single band n from all stored samples at that n.
async function recomputeBandForN(n) {
  const rows = await fetchAllRows(
    supabase.from('health_band_samples').select('health_pct').eq('n', n)
  )
  const vals = rows.map(r => r.health_pct).sort((a, b) => a - b)
  if (!vals.length) return
  const { error } = await supabase
    .from('health_bands')
    .upsert({ n, lo: percentile(vals, LOW_PCTL), hi: percentile(vals, HIGH_PCTL), sample_size: vals.length }, { onConflict: 'n' })
  if (error) throw error
}

// ── DRAW LOADING ──
async function fetchAllDrawRows() {
  const { data, error } = await supabase
    .from('draws')
    .select('id, slam, draw_type, year, original_picks_locked, is_active, exclude_from_leaderboard, elo_synced_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

async function fetchDrawRow(drawId) {
  const { data } = await supabase
    .from('draws')
    .select('id, slam, draw_type, year, original_picks_locked, is_active, exclude_from_leaderboard, elo_synced_at')
    .eq('id', drawId)
    .maybeSingle()
  return data || null
}

function groupPicksByUser(allPicks) {
  const byUser = {}
  allPicks.forEach(p => { (byUser[p.user_id] ||= []).push(p) })
  return byUser
}

// A profile with no real original picks in this draw never "played" it — every
// match auto-assigns to the ELO favourite, producing the same degenerate trajectory
// for every such profile. Including them in calibration skews P25/P75 toward that
// auto-assign baseline and washes out real human bracket variance (confirmed via
// Supabase query: 14 of 15 profiles in two "historical" draws had zero pick rows,
// producing a near-uniform 85-90% band that real players' brackets fell below).
function hasRealOriginalPicks(userPickRows) {
  return userPickRows.some(p => p.original_pick != null)
}

// Simulate every user's trajectory for one draw and return the sample rows.
// Skips profiles with no real original picks in this draw (see hasRealOriginalPicks).
async function simulateDraw(baseDraw, drawId, profs, orderedIds, isSynthetic) {
  const allPicks = await loadAllPicksForDraw(drawId)
  const picksByUser = groupPicksByUser(allPicks)
  const samples = []
  for (const prof of profs) {
    const userPicks = picksByUser[prof.id] || []
    if (!hasRealOriginalPicks(userPicks)) continue
    const userDraw = assembleDrawForUser(baseDraw, userPicks)
    const traj = await computeDrawTrajectory(userDraw, orderedIds)
    traj.forEach(pt => samples.push({
      n: pt.n, draw_id: drawId, user_id: prof.id,
      health_pct: pt.health_pct, is_synthetic: isSynthetic,
    }))
  }
  return samples
}

// ── INITIAL SETUP (one-time / manual override) ──
// Simulates every draw × every user, marks all samples synthetic, recomputes bands.
export async function initializeAllBands(onProgress) {
  const t0 = Date.now()
  const drawRows = await fetchAllDrawRows()
  const profs = await loadAllProfiles()
  let sampleCount = 0

  for (let i = 0; i < drawRows.length; i++) {
    const dr = drawRows[i]
    const baseDraw = await loadDraw(dr)
    const orderedIds = await orderedConfirmedIds(dr.id)
    const samples = await simulateDraw(baseDraw, dr.id, profs, orderedIds, true)
    await upsertSamples(samples)
    sampleCount += samples.length
    if (onProgress) onProgress({ draw: i + 1, totalDraws: drawRows.length, done: false })
  }

  await recomputeAllBands()
  const durationMs = Date.now() - t0
  if (onProgress) onProgress({ done: true, durationMs, sampleCount, totalDraws: drawRows.length })
  return { durationMs, sampleCount, totalDraws: drawRows.length }
}

// ── BETWEEN-SLAMS RECOMPUTE ──
// Re-simulates draws that still hold synthetic samples (their real winner_confirmed_at
// ordering is now available) with is_synthetic = false, then recomputes all bands.
// Old draws with all-real samples are never touched. completedDrawIds (optional)
// force-includes draws that may have no samples yet.
export async function addSlamToBands(completedDrawIds, onProgress) {
  const t0 = Date.now()

  const synthRows = await fetchAllRows(
    supabase.from('health_band_samples').select('draw_id').eq('is_synthetic', true)
  )
  const resim = new Set(synthRows.map(r => r.draw_id))
  ;(completedDrawIds || []).forEach(id => resim.add(id))
  const ids = [...resim]

  const profs = await loadAllProfiles()
  let sampleCount = 0

  for (let i = 0; i < ids.length; i++) {
    const drawId = ids[i]
    const dr = await fetchDrawRow(drawId)
    if (!dr) { if (onProgress) onProgress({ draw: i + 1, totalDraws: ids.length, done: false }); continue }

    // Delete stale samples for this draw, then re-simulate with real ordering.
    await supabase.from('health_band_samples').delete().eq('draw_id', drawId)
    const baseDraw = await loadDraw(dr)
    const orderedIds = await orderedConfirmedIds(drawId)
    const samples = await simulateDraw(baseDraw, drawId, profs, orderedIds, false)
    await upsertSamples(samples)
    sampleCount += samples.length
    if (onProgress) onProgress({ draw: i + 1, totalDraws: ids.length, done: false })
  }

  await recomputeAllBands()
  const durationMs = Date.now() - t0
  if (onProgress) onProgress({ done: true, durationMs, sampleCount, totalDraws: ids.length })
  return { durationMs, sampleCount, totalDraws: ids.length }
}

// ── LIVE PER-MATCH UPDATE ──
// Called after each match confirmation (live mode). Recomputes only the active
// draw's contribution to band n; historical samples at n are already stored.
export async function updateBandAtN(n, activeDraw, userIds) {
  const t0 = Date.now()
  const orderedIds = await orderedConfirmedIds(activeDraw.db_id)
  const set = new Set(orderedIds.slice(0, n))
  const allPicks = await loadAllPicksForDraw(activeDraw.db_id)
  const picksByUser = groupPicksByUser(allPicks)

  const samples = []
  for (const uid of userIds) {
    const userPicks = picksByUser[uid] || []
    if (!hasRealOriginalPicks(userPicks)) continue
    const userDraw = assembleDrawForUser(activeDraw, userPicks)
    const { maxHealthPts, reachableHealthPts } = calcHealthAtMatchSet(userDraw, set)
    const health_pct = maxHealthPts > 0 ? reachableHealthPts / maxHealthPts * 100 : 0
    samples.push({ n, draw_id: activeDraw.db_id, user_id: uid, health_pct, is_synthetic: false })
  }
  await upsertSamples(samples)
  await recomputeBandForN(n)
  return { durationMs: Date.now() - t0 }
}

// ── REVERT (undoWinner) ──
// Re-simulates the active draw at position n using synthetic ordering (the pre-undo
// state), re-stamps samples as synthetic, recomputes band n only.
export async function revertBandAtN(n, activeDraw, userIds) {
  const t0 = Date.now()
  const orderedIds = syntheticOrderedConfirmedIds(activeDraw)
  const set = new Set(orderedIds.slice(0, n))
  const allPicks = await loadAllPicksForDraw(activeDraw.db_id)
  const picksByUser = groupPicksByUser(allPicks)

  const samples = []
  for (const uid of userIds) {
    const userPicks = picksByUser[uid] || []
    if (!hasRealOriginalPicks(userPicks)) continue
    const userDraw = assembleDrawForUser(activeDraw, userPicks)
    const { maxHealthPts, reachableHealthPts } = calcHealthAtMatchSet(userDraw, set)
    const health_pct = maxHealthPts > 0 ? reachableHealthPts / maxHealthPts * 100 : 0
    samples.push({ n, draw_id: activeDraw.db_id, user_id: uid, health_pct, is_synthetic: true })
  }
  await upsertSamples(samples)
  await recomputeBandForN(n)
  return { durationMs: Date.now() - t0 }
}

// ── READ ──
// Returns Map<n, {lo, hi}>. Empty Map if the table is empty (callers fall back
// to the static 25/90 band).
export async function loadHealthBands() {
  const map = new Map()
  const { data, error } = await supabase.from('health_bands').select('n, lo, hi')
  if (error) return map
  ;(data || []).forEach(r => map.set(r.n, { lo: r.lo, hi: r.hi }))
  return map
}
