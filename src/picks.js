// Pick cascade logic — ported from reference, extended with Supabase save

import { state, activeDraw } from './state.js'
import { isBackupPick } from './scoring.js'
import { isMatchLocked } from './lock.js'
import { supabase } from './supabase.js'
import { buildDrawView } from './draw-view.js'

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

// ── FORWARD MATCH-PICK PROPAGATION (raw-field writers only) ──
// Slot occupancy / elimination / labels are NOT touched here — that is all derived
// by buildDrawView(). These two helpers only move the user's `matchPick` along the
// bracket so the stored picks stay identical to the old behavior (Option 1):
//   • cascadeMatchPickForward — copies the active pick into later matches, passing
//     through empty/eliminated slots, stopping at a different confirmed player.
//   • clearMatchPickForward   — removes a matchPick that's been replaced/withdrawn,
//     stopping as soon as a later match no longer carries that name.

export function cascadeMatchPickForward(d, ri, mi) {
  let r = ri, m = mi
  while (true) {
    const next = getNextSlot(d, r, m)
    if (!next) break
    const nm = d.rounds[next.nri].matches[next.nmi]
    if (nm.winner) break
    const pickName = d.rounds[r].matches[m].matchPick
    const slot = nm[next.side]
    const slotName = slot?.name
    const isBlocking = slotName && !slot?.elim && slotName !== pickName
    if (isBlocking || !pickName) break
    nm.matchPick = pickName
    r = next.nri; m = next.nmi
  }
}

export function clearMatchPickForward(d, ri, mi, name) {
  let r = ri, m = mi
  while (true) {
    const next = getNextSlot(d, r, m)
    if (!next) break
    const nm = d.rounds[next.nri].matches[next.nmi]
    if (nm.winner) break
    if (nm.matchPick !== name) break
    nm.matchPick = null
    r = next.nri; m = next.nmi
  }
}

// ── SAVE PICK TO SUPABASE ──
export async function savePickToSupabase(m, drawId) {
  if (!state.currentUser) return
  if (!m.db_id) return  // match not yet in DB

  const { error } = await supabase.from('picks').upsert({
    user_id: state.currentUser.id,
    draw_id: drawId,
    match_id: m.db_id,
    match_pick: m.matchPick ?? null,
    original_pick: m.originalPick ?? null,
    original_pick_result: m.originalPickResult ?? null,
    match_pick_result: m.matchPickResult ?? null,
    high_confidence: m.highConfidence ?? false,
    edited_after_lock: m.editedAfterLock ?? false,
    notes: m.notes ?? null,
  }, { onConflict: 'user_id,match_id' })

  if (error) throw error
}

// Save matchPick for all future unconfirmed matches (for backup pick cascade persistence)
async function saveCascadeToSupabase(d, ri, mi) {
  let r = ri, m = mi
  const saves = []
  while (true) {
    const next = getNextSlot(d, r, m)
    if (!next) break
    const nm = d.rounds[next.nri].matches[next.nmi]
    if (nm.winner) break
    if (nm.db_id) saves.push(savePickToSupabase(nm, d.db_id))
    r = next.nri; m = next.nmi
  }
  await Promise.all(saves)
}

// ── PICK CONFIRM MODAL ──
// Returns a Promise that resolves true (confirmed) or false (cancelled).
function showPickConfirm(playerName) {
  return new Promise(resolve => {
    const modal = document.getElementById('pick-confirm-modal')
    document.getElementById('pcm-name').textContent = playerName
    modal.style.display = 'flex'
    function cleanup(result) {
      modal.style.display = 'none'
      confirmBtn.removeEventListener('click', onConfirm)
      cancelBtn.removeEventListener('click', onCancel)
      resolve(result)
    }
    const confirmBtn = document.getElementById('pcm-confirm')
    const cancelBtn  = document.getElementById('pcm-cancel')
    function onConfirm() { cleanup(true) }
    function onCancel()  { cleanup(false) }
    confirmBtn.addEventListener('click', onConfirm)
    cancelBtn.addEventListener('click', onCancel)
  })
}

// ── CLICK HANDLER ──
export async function handlePickClick(ri, mi, p, { renderStats, renderBracket }) {
  const d = activeDraw()
  if (!d) return
  const m = d.rounds[ri].matches[mi]
  if (m.winner) return

  const drawLocked = d.locked
  const isWithdrawalRepick = drawLocked && m.editedAfterLock

  if (drawLocked && m.originalPickResult && !isBackupPick(m) && !m.editedAfterLock) return

  // Block backup picks on matches whose backup pick window is locked
  if (drawLocked && !isWithdrawalRepick && isMatchLocked(ri, mi, 'backup_picks')) return

  if (isWithdrawalRepick) {
    // Always show the confirmation popup — Cancel is how the player backs out.
    // No silent deselect: the match must have an original pick to exit needs-repick state.
    const confirmed = await showPickConfirm(p.name)
    if (!confirmed) return

    // What this match previously sent forward, captured before we overwrite it.
    const prevOrigPick = m.originalPick

    m.matchPick = p.name
    m.originalPick = p.name
    m.editedAfterLock = false
    // No cascadeMatchPickForward — future rounds derive from originalPick via buildDrawView.

    buildDrawView(d)
    await savePickToSupabase(m, d.db_id)

    // Reopen the next round only if THIS repick changed who this match sends forward —
    // i.e. the next-round matchup is now different. Offer the repick whether or not their
    // existing next-round pick is still technically valid (the opponent may have changed).
    // Keep that pick if it's still one of the two players (so inaction never loses a valid
    // pick); clear it only if it's no longer in the matchup. (buildDrawView above already
    // refreshed nm.p1/p2 to the new projection.)
    const next = getNextSlot(d, ri, mi)
    if (next && prevOrigPick !== p.name) {
      const nm = d.rounds[next.nri].matches[next.nmi]
      if (!nm.winner && nm.originalPick) {
        nm.editedAfterLock = true
        const stillValid = nm.originalPick === nm.p1?.name || nm.originalPick === nm.p2?.name
        if (!stillValid) { nm.originalPick = null; nm.matchPick = null }
        if (nm.db_id) await savePickToSupabase(nm, d.db_id)
      }
    }

    renderStats(); renderBracket()
    return
  } else if (drawLocked) {
    // Backup pick: cascade matchPick into future rounds + save all affected matches
    m.matchPick = m.matchPick === p.name ? null : p.name
    buildDrawView(d)
    await savePickToSupabase(m, d.db_id)
    renderStats()
    renderBracket()
    return
  } else {
    // Pre-lock: just record the pick; slots are derived by buildDrawView.
    const prev = m.matchPick
    m.matchPick = m.matchPick === p.name ? null : p.name
    if (prev && prev !== m.matchPick) clearMatchPickForward(d, ri, mi, prev)
  }

  buildDrawView(d)
  await savePickToSupabase(m, d.db_id)
  renderStats()
  renderBracket()
}

// ── APPLY WINNER ──
export async function applyWinner(d, ri, mi, winnerName, { renderStats, renderBracket }) {
  const m = d.rounds[ri].matches[mi]
  m.winner = winnerName
  // Set both result fields independently
  m.originalPickResult = m.originalPick ? (m.originalPick === winnerName ? 'correct' : 'wrong') : null
  m.matchPickResult    = m.matchPick    ? (m.matchPick    === winnerName ? 'correct' : 'wrong') : null

  // Re-derive advancers, eliminations, and labels from the new winner.
  buildDrawView(d)

  // DB persistence (commissioner only)
  if (state.currentUser?.is_commissioner && m.db_id) {
    await supabase.from('matches')
      .update({ winner: winnerName, score: m.score || null })
      .eq('id', m.db_id)

    const { data: matchPicks } = await supabase
      .from('picks').select('id, match_pick, original_pick').eq('match_id', m.db_id)
    for (const pk of (matchPicks || [])) {
      const origPickResult  = pk.original_pick ? (pk.original_pick === winnerName ? 'correct' : 'wrong') : null
      const matchPickResult = pk.match_pick     ? (pk.match_pick    === winnerName ? 'correct' : 'wrong') : null
      await supabase.from('picks').update({
        original_pick_result: origPickResult,
        match_pick_result:    matchPickResult,
      }).eq('id', pk.id)
    }
    // Update local result fields for current user
    m.originalPickResult = m.originalPick ? (m.originalPick === winnerName ? 'correct' : 'wrong') : null
    m.matchPickResult    = m.matchPick    ? (m.matchPick    === winnerName ? 'correct' : 'wrong') : null
  }

  renderStats()
  renderBracket()
}

export async function undoWinner(d, ri, mi, { renderStats, renderBracket }) {
  const m = d.rounds[ri].matches[mi]
  m.winner = null; m.originalPickResult = null; m.matchPickResult = null

  // Re-derive everything from the cleared result.
  buildDrawView(d)

  // DB persistence (commissioner only)
  if (state.currentUser?.is_commissioner && m.db_id) {
    await supabase.from('matches')
      .update({ winner: null, score: null }).eq('id', m.db_id)
    await supabase.from('picks')
      .update({ original_pick_result: null, match_pick_result: null }).eq('match_id', m.db_id)
  }

  renderStats()
  renderBracket()
}

// ── WITHDRAWAL CLEAR FORWARD ──
// Clears a withdrawn player out of later matches' raw fields (matchPick /
// originalPick) and flags them as needing a repick. Slot occupancy itself is
// re-derived by buildDrawView; this only touches authoritative per-match fields.
export function withdrawalClearForward(d, ri, mi, withdrawnName) {
  let r = ri, m = mi
  while (true) {
    const next = getNextSlot(d, r, m)
    if (!next) break
    const nm = d.rounds[next.nri].matches[next.nmi]
    let touched = false
    if (nm[next.side]?.name === withdrawnName) { nm[next.side] = { name: '', seed: '' }; touched = true }
    if (nm.matchPick === withdrawnName) { nm.matchPick = null; touched = true }
    if (nm.originalPick === withdrawnName) { nm.originalPick = null; touched = true }
    if (touched) nm.editedAfterLock = true
    if (!touched) break
    r = next.nri; m = next.nmi
  }
}

// Pre-lock rename: propagate a renamed player through later matchPick references.
// Slot occupancy is re-derived by buildDrawView from the renamed round-0 entry.
export function updatePlayerNameForward(d, ri, mi, oldName, newName, newSeed) {
  let r = ri, m = mi
  while (true) {
    const nri = r + 1; if (nri >= d.rounds.length) break
    const nmi = Math.floor(m / 2)
    const side = m % 2 === 0 ? 'p1' : 'p2'
    const nm = d.rounds[nri].matches[nmi]
    if (nm.matchPick === oldName) nm.matchPick = newName || null
    if (nm.winner) break
    r = nri; m = nmi
  }
}
