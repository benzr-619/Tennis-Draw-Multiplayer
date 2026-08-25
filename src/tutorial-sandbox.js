// Tutorial sandbox — builds a throwaway 8-player / 3-round Draw object from a real
// completed slam. Never written back to Supabase, never touches state.draws (the
// caller is responsible for temporarily installing it there so the real
// handlePickClick/applyWinner pipeline — which reads activeDraw() — can operate on
// it). See .claude/rules/tutorial.md.

import { supabase } from './supabase.js'
import { buildDrawView } from './draw-view.js'

const SANDBOX_DRAW_ID = 'tutorial-sandbox'
const ROUND_LABELS = ['R1', 'SF', 'F']

// Plausible-looking decimal odds, seeded directly as both "live" and "locked" — this
// is a sandbox with no real odds feed and no real lock moment to snapshot at, and
// Match Yield (calcStatsAsOf in scoring.js) only scores a resolved match at all when
// odds_p1_locked/odds_p2_locked are non-null. Without this, Match Yield sits at "—"
// for the whole tutorial even once results come in. Only called for matches with real
// occupants (Round 1) — a real draw never shows odds for a matchup that doesn't exist
// yet, so blank SF/Final slots stay oddsless until they resolve into real occupants.
function _fakeOdds() {
  const a = +(1.4 + Math.random() * 2.2).toFixed(2)
  const b = +(1.4 + Math.random() * 2.2).toFixed(2)
  return { a, b }
}

function blankMatch(p1, p2) {
  const hasOccupants = !!(p1?.name || p2?.name)
  const { a, b } = hasOccupants ? _fakeOdds() : { a: null, b: null }
  return {
    db_id: null,
    p1: { name: p1?.name || '', seed: p1?.seed || '', country: p1?.country || '' },
    p2: { name: p2?.name || '', seed: p2?.seed || '', country: p2?.country || '' },
    matchPick: null, originalPick: null,
    originalPickResult: null, matchPickResult: null,
    highConfidence: false, editedAfterLock: false,
    winner: null, score: '', espn_state: null, espn_winner: null,
    roster_changed_at: null, replaced_name: null,
    odds_p1_live: a, odds_p2_live: b, odds_fetched_at: null,
    odds_p1_locked: a, odds_p2_locked: b, odds_locked_at: null,
    elo_p1: null, elo_p2: null,
  }
}

// Finds the most recently created draw whose Final (round_index 6) already has a
// winner — i.e. a fully completed slam — and returns its round-0 matches (real
// players/seeds/countries + the real historical winner of each).
async function _fetchSourceR1() {
  const { data: draws, error: de } = await supabase
    .from('draws')
    .select('id, slam, created_at')
    .order('created_at', { ascending: false })
  if (de || !draws?.length) return null

  for (const drawRow of draws) {
    const { data: finalRows } = await supabase
      .from('matches')
      .select('winner')
      .eq('draw_id', drawRow.id).eq('round_index', 6).limit(1)
    if (!finalRows?.[0]?.winner) continue

    const { data: r1Rows, error: me } = await supabase
      .from('matches')
      .select('match_index, p1_name, p1_seed, p1_country, p2_name, p2_seed, p2_country, winner')
      .eq('draw_id', drawRow.id).eq('round_index', 0)
      .order('match_index', { ascending: true })
    if (me || !r1Rows?.length) continue
    return { rows: r1Rows, slam: drawRow.slam }
  }
  return null
}

/**
 * Builds the 8-player, 3-round sandbox draw. Returns { draw, r1Winners } where
 * r1Winners is a Map<match_index, realWinnerName> for the 4 sliced Round 1 pairings
 * — the only round with a genuine historical result (later rounds are fabricated
 * pairings that never happened in the real tournament, see tutorial.md).
 * Returns null if no completed slam exists to source from (e.g. brand-new pool).
 */
export async function buildTutorialDraw() {
  const source = await _fetchSourceR1()
  if (!source) return null
  const { rows: r1Rows, slam } = source

  const slice = r1Rows.slice(0, 4)
  const r1Matches = slice.map(row => blankMatch(
    { name: row.p1_name, seed: row.p1_seed, country: row.p1_country },
    { name: row.p2_name, seed: row.p2_seed, country: row.p2_country },
  ))
  const r1Winners = new Map()
  slice.forEach((row, mi) => { if (row.winner) r1Winners.set(mi, row.winner) })

  const rounds = [
    { label: ROUND_LABELS[0], matches: r1Matches },
    { label: ROUND_LABELS[1], matches: Array.from({ length: 2 }, () => blankMatch()) },
    { label: ROUND_LABELS[2], matches: Array.from({ length: 1 }, () => blankMatch()) },
  ]

  const countryMap = {}
  r1Matches.forEach(m => {
    if (m.p1.name && m.p1.country) countryMap[m.p1.name] = m.p1.country
    if (m.p2.name && m.p2.country) countryMap[m.p2.name] = m.p2.country
  })

  const draw = {
    db_id: SANDBOX_DRAW_ID,
    slam: slam || 'WIM',
    draw: 'MS',
    year: new Date().getFullYear(),
    locked: false,
    is_active: true,
    excludeFromLeaderboard: true,
    elo_synced_at: null,
    scoring_version: 2,
    countryMap,
    rosterAlerts: [],
    rounds,
  }

  return { draw: buildDrawView(draw), r1Winners }
}

function _resultFields(m, winnerName) {
  m.winner = winnerName
  m.originalPickResult = m.originalPick ? (m.originalPick === winnerName ? 'correct' : 'wrong') : null
  m.matchPickResult = m.matchPick ? (m.matchPick === winnerName ? 'correct' : 'wrong') : null
}

/** Sets the real historical winner on one Round 1 match and re-derives the draw. */
export function revealR1Result(draw, mi, r1Winners) {
  const winnerName = r1Winners.get(mi)
  if (!winnerName) return
  const m = draw.rounds[0].matches[mi]
  if (m.winner) return
  _resultFields(m, winnerName)
  buildDrawView(draw)
}

// Better-seeded player wins (lower seed number = stronger); unseeded/no-seed data
// falls back to picking p1 — arbitrary but deterministic, fine for a fabricated
// pairing that never happened in the real tournament.
function _pickWinner(m) {
  const s1 = parseInt(m.p1.seed, 10), s2 = parseInt(m.p2.seed, 10)
  if (!isNaN(s1) && !isNaN(s2)) return s1 <= s2 ? m.p1.name : m.p2.name
  if (!isNaN(s1)) return m.p1.name
  if (!isNaN(s2)) return m.p2.name
  return m.p1.name || m.p2.name
}

/**
 * Resolves every remaining match in the draw, round by round (each round must be
 * fully decided before the next round's occupants are known via buildDrawView).
 * Used to fast-forward the sandbox to a fully completed bracket ("the rest of the
 * draw plays out" step).
 */
export function autoCompleteDraw(draw) {
  for (let ri = 0; ri < draw.rounds.length; ri++) {
    draw.rounds[ri].matches.forEach(m => {
      if (m.winner) return
      if (!m.p1.name || !m.p2.name) return
      _resultFields(m, _pickWinner(m))
    })
    buildDrawView(draw)
  }
}

export { SANDBOX_DRAW_ID }
