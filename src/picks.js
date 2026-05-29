// Pick cascade logic — ported from reference, extended with Supabase save

import { state, activeDraw } from './state.js'
import { isBackupPick } from './scoring.js'
import { supabase } from './supabase.js'

// ── HELPERS ──
export function findSeed(d, name) {
  for (const r of d.rounds) for (const m of r.matches) {
    if (m.p1.name === name && m.p1.seed) return m.p1.seed
    if (m.p2.name === name && m.p2.seed) return m.p2.seed
  }
  return ''
}

export function getNextSlot(d, ri, mi) {
  const nri = ri + 1
  if (nri >= d.rounds.length) return null
  return { nri, nmi: Math.floor(mi / 2), side: mi % 2 === 0 ? 'p1' : 'p2' }
}

function placePickInNextRound(d, ri, mi) {
  const m = d.rounds[ri].matches[mi]
  const next = getNextSlot(d, ri, mi)
  if (next) {
    const nm = d.rounds[next.nri].matches[next.nmi]
    if (!nm.winner) {
      nm[next.side] = m.pick ? { name: m.pick, seed: findSeed(d, m.pick) } : { name: '', seed: '' }
    }
  }
}

export function placePickAllRounds(d, ri, mi) {
  let r = ri, m = mi
  while (true) {
    const next = getNextSlot(d, r, m)
    if (!next) break
    const nm = d.rounds[next.nri].matches[next.nmi]
    if (nm.winner) break
    const currentInSlot = nm[next.side]?.name
    const currentMatch = d.rounds[r].matches[m]
    const pickName = currentMatch.pick
    if (currentInSlot && currentInSlot !== pickName) break
    placePickInNextRound(d, r, m)
    r = next.nri; m = next.nmi
  }
}

export function clearPickForward(d, ri, mi, name) {
  let r = ri, m = mi
  while (true) {
    const next = getNextSlot(d, r, m)
    if (!next) break
    const nm = d.rounds[next.nri].matches[next.nmi]
    if (nm.winner) break
    const side = next.side
    if (nm[side].name === name) { nm[side] = { name: '', seed: '' } }
    if (nm.pick === name) { nm.pick = null }
    r = next.nri; m = next.nmi
    if (!nm.pick && !nm[side]?.name) break
  }
}

// ── SAVE PICK TO SUPABASE ──
// Returns the pick row upserted, or throws on error
export async function savePickToSupabase(m, drawId) {
  if (!state.currentUser) return
  if (!m.db_id) return  // match not yet in DB

  const { error } = await supabase.from('picks').upsert({
    user_id: state.currentUser.id,
    draw_id: drawId,
    match_id: m.db_id,
    pick: m.pick ?? null,
    original_pick: m.originalPick ?? null,
    result: m.result ?? null,
    high_confidence: m.highConfidence ?? false,
    edited_after_lock: m.editedAfterLock ?? false,
  }, { onConflict: 'user_id,match_id' })

  if (error) throw error
}

// ── CLICK HANDLER ──
export async function handlePickClick(ri, mi, p, { renderStats, renderBracket }) {
  const d = activeDraw()
  if (!d) return
  const m = d.rounds[ri].matches[mi]
  if (m.winner) return

  // If locked and match is locked, block
  const drawLocked = d.locked
  const isWithdrawalRepick = drawLocked && m.editedAfterLock

  if (drawLocked && m.result && !isBackupPick(m) && !m.editedAfterLock) return

  if (isWithdrawalRepick) {
    m.pick = m.pick === p.name ? null : p.name
    m.originalPick = m.pick
    if (m.pick) {
      m.editedAfterLock = false
      placePickAllRounds(d, ri, mi)
    }
  } else if (drawLocked) {
    m.pick = m.pick === p.name ? null : p.name
  } else {
    const prev = m.pick
    m.pick = m.pick === p.name ? null : p.name
    if (prev && prev !== m.pick) clearPickForward(d, ri, mi, prev)
    placePickAllRounds(d, ri, mi)
  }

  await savePickToSupabase(m, d.db_id)
  renderStats()
  renderBracket()
}

// ── APPLY WINNER ──
export async function applyWinner(d, ri, mi, winnerName, { renderStats, renderBracket }) {
  const m = d.rounds[ri].matches[mi]
  const loserName = m.p1.name === winnerName ? m.p2.name : m.p1.name
  m.winner = winnerName
  m.result = m.originalPick ? (m.originalPick === winnerName ? 'correct' : 'wrong') : null

  const next = getNextSlot(d, ri, mi)
  if (next) {
    const nm = d.rounds[next.nri].matches[next.nmi]
    if (!nm.winner) {
      nm[next.side] = { name: winnerName, seed: findSeed(d, winnerName) }
    }
  }

  if (loserName) markLoserForward(d, ri, mi, loserName)

  // DB persistence (commissioner only)
  if (state.currentUser?.is_commissioner && m.db_id) {
    await supabase.from('matches')
      .update({ winner: winnerName, score: m.score || null })
      .eq('id', m.db_id)

    const { data: matchPicks } = await supabase
      .from('picks').select('id, pick').eq('match_id', m.db_id)
    for (const pk of (matchPicks || [])) {
      const result = pk.pick === winnerName ? 'correct' : (pk.pick ? 'wrong' : null)
      if (result !== null) {
        await supabase.from('picks').update({ result }).eq('id', pk.id)
      }
    }
    // Update local result for current user
    m.result = m.originalPick ? (m.originalPick === winnerName ? 'correct' : 'wrong') : null
  } else {
    await savePickToSupabase(m, d.db_id)
  }

  renderStats()
  renderBracket()
}

export async function undoWinner(d, ri, mi, { renderStats, renderBracket }) {
  const m = d.rounds[ri].matches[mi]
  const wasWinner = m.winner
  const wasLoser = m.p1.name === wasWinner ? m.p2.name : m.p1.name
  m.winner = null; m.result = null

  const next = getNextSlot(d, ri, mi)
  if (next && wasWinner) {
    const nm = d.rounds[next.nri].matches[next.nmi]
    if (!nm.winner && nm[next.side].name === wasWinner) {
      const origName = m.originalPick || null
      nm[next.side] = origName ? { name: origName, seed: findSeed(d, origName) } : { name: '', seed: '' }
    }
  }

  if (wasLoser) unmarkLoserForward(d, ri, mi, wasLoser)

  // DB persistence (commissioner only)
  if (state.currentUser?.is_commissioner && m.db_id) {
    await supabase.from('matches')
      .update({ winner: null, score: null }).eq('id', m.db_id)
    await supabase.from('picks')
      .update({ result: null }).eq('match_id', m.db_id)
  } else {
    await savePickToSupabase(m, d.db_id)
  }

  renderStats()
  renderBracket()
}

export function markLoserForward(d, ri, mi, loserName) {
  let r = ri, m = mi
  while (true) {
    const next = getNextSlot(d, r, m)
    if (!next) break
    const nm = d.rounds[next.nri].matches[next.nmi]
    if (nm.winner) break
    const side = next.side
    const slotName = nm[side]?.name
    if (slotName === loserName) { nm[side] = { ...nm[side], elim: true } }
    if (slotName !== loserName && nm.originalPick !== loserName) break
    r = next.nri; m = next.nmi
  }
}

export function unmarkLoserForward(d, ri, mi, loserName) {
  let r = ri, m = mi
  while (true) {
    const next = getNextSlot(d, r, m)
    if (!next) break
    const nm = d.rounds[next.nri].matches[next.nmi]
    if (nm.winner) break
    const side = next.side
    if (nm[side]?.elim && nm[side].name === loserName) {
      const { elim, ...rest } = nm[side]
      nm[side] = rest
    }
    if (nm[side]?.name !== loserName && nm.originalPick !== loserName) break
    r = next.nri; m = next.nmi
  }
}

// ── WITHDRAWAL CLEAR FORWARD ──
export function withdrawalClearForward(d, ri, mi, withdrawnName) {
  let r = ri, m = mi
  while (true) {
    const next = getNextSlot(d, r, m)
    if (!next) break
    const nm = d.rounds[next.nri].matches[next.nmi]
    let touched = false
    if (nm[next.side]?.name === withdrawnName) { nm[next.side] = { name: '', seed: '' }; touched = true }
    if (nm.pick === withdrawnName) { nm.pick = null; touched = true }
    if (nm.originalPick === withdrawnName) { nm.originalPick = null; touched = true }
    if (touched) nm.editedAfterLock = true
    if (!touched) break
    r = next.nri; m = next.nmi
  }
}

export function updatePlayerNameForward(d, ri, mi, oldName, newName, newSeed) {
  let r = ri, m = mi
  while (true) {
    const nri = r + 1; if (nri >= d.rounds.length) break
    const nmi = Math.floor(m / 2)
    const side = m % 2 === 0 ? 'p1' : 'p2'
    const nm = d.rounds[nri].matches[nmi]
    if (nm[side].name === oldName && !nm.winner) nm[side] = { name: newName || '', seed: newSeed || '' }
    if (nm.pick === oldName) nm.pick = newName || null
    if (nm.winner) break
    r = nri; m = nmi
  }
}
