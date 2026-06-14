// Odds utility — data access, display formatting, name matching for Match Yield layer

import { supabase } from './supabase.js'

export const STAKE_BY_ROUND = [10, 10, 20, 20, 30, 40, 50]

// Strip diacritics, lowercase, collapse spaces. Mirrors normalise_player_name() in SQL.
export function normaliseName(name) {
  if (!name) return ''
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

// Convert decimal odds to American integer. Returns null if decimal <= 1.
export function decimalToAmerican(decimal) {
  if (!decimal || decimal <= 1) return null
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)      // underdog: +150
    : Math.round(-100 / (decimal - 1))     // favourite: -200
}

// Format American odds as string: "+150", "−200", or "—".
export function formatAmerican(decimal) {
  const am = decimalToAmerican(decimal)
  if (am === null) return '—'
  return am >= 0 ? '+' + am : '−' + Math.abs(am)
}

// Return locked odds for the picked player in a match (null if unavailable).
export function pickedLockedOdds(m) {
  if (!m.matchPick) return null
  if (m.matchPick === m.p1?.name) return m.odds_p1_locked ?? null
  if (m.matchPick === m.p2?.name) return m.odds_p2_locked ?? null
  return null
}

// Return live odds for a player slot ('p1'|'p2') in a match.
export function liveOdds(m, slot) {
  return slot === 'p1' ? (m.odds_p1_live ?? null) : (m.odds_p2_live ?? null)
}

// Format a yield number for display: "+45", "−10". Returns null for null input.
export function formatYield(yld) {
  if (yld === null || yld === undefined) return null
  return yld >= 0 ? '+' + yld : '−' + Math.abs(yld)
}

// ── DATA ACCESS ──

export async function loadOddsRaw(drawDbId) {
  const { data, error } = await supabase
    .from('odds_raw')
    .select('api_event_id, home_team, away_team, commence_time, home_decimal, away_decimal, bookmaker_count, fetched_at')
    .eq('draw_id', drawDbId)
    .order('fetched_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function loadNameMappings() {
  const { data, error } = await supabase
    .from('name_mappings')
    .select('api_name, draw_player_name, created_at')
    .order('api_name')
  if (error) throw error
  return data || []
}

export async function saveNameMapping(apiName, drawPlayerName) {
  const { error } = await supabase
    .from('name_mappings')
    .upsert({ api_name: apiName, draw_player_name: drawPlayerName }, { onConflict: 'api_name' })
  if (error) throw error
}

export async function deleteNameMapping(apiName) {
  const { error } = await supabase
    .from('name_mappings')
    .delete()
    .eq('api_name', apiName)
  if (error) throw error
}

// Return API names from rawRows that don't appear in mappings and don't auto-match
// any drawPlayerName by normalised string. Used to populate the commissioner triage list.
export function getUnmatchedApiNames(rawRows, mappings, drawPlayerNames) {
  const mappedNorm = new Set(mappings.map(m => normaliseName(m.api_name)))
  const drawNorm   = new Set(drawPlayerNames.map(normaliseName))
  const unmatched  = new Set()
  rawRows.forEach(r => {
    for (const name of [r.home_team, r.away_team]) {
      const norm = normaliseName(name)
      if (!mappedNorm.has(norm) && !drawNorm.has(norm)) unmatched.add(name)
    }
  })
  return [...unmatched].sort()
}

// Trigger a server-side odds refresh (commissioner only — RPC enforces the role check).
export async function forceOddsRefresh() {
  const { error } = await supabase.rpc('refresh_odds_now')
  if (error) throw error
}
