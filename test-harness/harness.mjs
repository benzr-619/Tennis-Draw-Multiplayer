// Baseline harness for the bracket data-model rewrite (audit parts A/B/D).
// Drives the REAL picks.js walk functions and the REAL data.js loadDraw
// (with ../src/supabase.js redirected to fake-supabase.mjs by stub-loader.mjs).
// Snapshots draw state + stats to a golden text file so we can prove the
// post-refactor behavior is byte-identical.

import './dom-stub.mjs'
import { FakeEl } from './dom-stub.mjs'
import { state } from '../src/state.js'
import {
  handlePickClick, applyWinner, undoWinner,
  withdrawalClearForward,
} from '../src/picks.js'
import { calcStats } from '../src/scoring.js'
import { loadDraw } from '../src/data.js'
import { placeCard } from '../src/bracket.js'

const cb = { renderStats: () => {}, renderBracket: () => {} }
const out = []
function log(s = '') { out.push(s) }

// ── snapshot serializer ────────────────────────────────────────────────
function slot(s) {
  if (!s || !s.name) return '·'
  return s.name + (s.seed ? `(${s.seed})` : '') + (s.elim ? '✗ELIM' : '')
}
// ── render-facts extractor: drive the REAL placeCard and read what it paints ──
function flatten(el, acc = []) {
  acc.push(el)
  ;(el.children || []).forEach(c => flatten(c, acc))
  return acc
}
function renderFacts(d, m, ri, mi) {
  const wrap = new FakeEl('div')
  state.draws = state.draws // noop, keep ref
  placeCard(d, m, ri, mi, 0, 0, wrap)
  const card = wrap.children[0]
  if (!card) return '    RENDER (no card)'
  const all = flatten(card)
  const rows = all.filter(e => typeof e.className === 'string' && /(^|\s)pr(\s|$)/.test(e.className))
  const rowStrs = rows.map(r => {
    const nameEl = (r.children || []).find(c => c.className === 'pr-name')
    const nm = nameEl ? nameEl.textContent : '?'
    const extra = (r.children || []).some(c => c.className === 'pr-backup-ok-icon') ? '✓' : ''
    return `{${r.className.trim()}|${nm}${extra}}`
  })
  const labels = all.filter(e => typeof e.className === 'string' && e.className.includes('mc-orig-elim'))
    .map(l => `{${l.className.trim()}|${l.textContent}}`)
  return `    RENDER card="${card.className.trim()}" rows=${rowStrs.join(' ')} labels=${labels.join(' ') || '-'}`
}

function snap(label, d) {
  log(`──── ${label} ────  (locked=${d.locked})`)
  d.rounds.forEach((r, ri) => {
    r.matches.forEach((m, mi) => {
      const bits = [
        `r${ri}m${mi}`,
        `[${slot(m.p1)} / ${slot(m.p2)}]`,
        `mp=${m.matchPick ?? '-'}`,
        `op=${m.originalPick ?? '-'}`,
        `opr=${m.originalPickResult ?? '-'}`,
        `mpr=${m.matchPickResult ?? '-'}`,
        `win=${m.winner ?? '-'}`,
        m.editedAfterLock ? 'EDITED' : '',
      ].filter(Boolean)
      log('  ' + bits.join('  '))
      log(renderFacts(d, m, ri, mi))
    })
  })
  const st = calcStats(d)
  log(`  STATS filled=${st.filled} total=${st.total} cOrig=${st.cOrig} wOrig=${st.wOrig} ` +
      `cBackup=${st.cBackup} wBackup=${st.wBackup} base=${st.baseScore} skill=${st.skillBonus} ` +
      `cDrawOrig=${st.cDrawOrig} wDrawOrig=${st.wDrawOrig} maxH=${st.maxHealthPts} reachH=${st.reachableHealthPts}`)
  log()
}

// ── build an empty 8-player draw (3 rounds) ────────────────────────────
function emptyMatch(db_id) {
  return {
    db_id,
    p1: { name: '', seed: '' }, p2: { name: '', seed: '' },
    matchPick: null, originalPick: null,
    originalPickResult: null, matchPickResult: null,
    highConfidence: false, editedAfterLock: false, notes: '',
    winner: null, score: '',
  }
}
function r1Match(db_id, n1, s1, n2, s2) {
  const m = emptyMatch(db_id)
  m.p1 = { name: n1, seed: s1 }; m.p2 = { name: n2, seed: s2 }
  return m
}
function buildDraw() {
  return {
    db_id: 'draw1', slam: 'RG', draw: 'MS', year: 2026, locked: false, is_active: true,
    rounds: [
      { label: 'R1', matches: [
        r1Match('r0m0', 'A', '1', 'B', ''),
        r1Match('r0m1', 'C', '', 'D', '4'),
        r1Match('r0m2', 'E', '3', 'F', ''),
        r1Match('r0m3', 'G', '', 'H', '2'),
      ]},
      { label: 'R2', matches: [ emptyMatch('r1m0'), emptyMatch('r1m1') ] },
      { label: 'F',  matches: [ emptyMatch('r2m0') ] },
    ],
  }
}

// commissioner lock: snapshot originalPick = matchPick for every match
function lockDraw(d) {
  d.locked = true
  d.rounds.forEach(r => r.matches.forEach(m => { m.originalPick = m.matchPick }))
}

async function run() {
  state.currentUser = { id: 'user1', is_commissioner: true }
  globalThis.__FAKE_DB__ = { picks: [] } // scenario phase: applyWinner per-pick loop sees none

  // ════════ SCENARIO 1 — pre-lock cascade ════════
  const d = buildDraw()
  state.draws = [d]; state.activeTab = 0; state.lockSchedules = []

  await handlePickClick(0, 0, { name: 'A' }, cb)
  await handlePickClick(0, 1, { name: 'D' }, cb)
  await handlePickClick(0, 2, { name: 'E' }, cb)
  await handlePickClick(0, 3, { name: 'H' }, cb)
  await handlePickClick(1, 0, { name: 'A' }, cb)
  await handlePickClick(1, 1, { name: 'E' }, cb)
  await handlePickClick(2, 0, { name: 'A' }, cb)
  snap('S1 pre-lock full bracket (champion A)', d)

  // pre-lock pick CHANGE: flip r0m2 E→F (clears E forward), then back to E
  await handlePickClick(0, 2, { name: 'F' }, cb)
  snap('S1b pre-lock change r0m2 E→F (clears E forward)', d)
  await handlePickClick(0, 2, { name: 'E' }, cb)   // revert; re-cascade E
  await handlePickClick(1, 1, { name: 'E' }, cb)   // re-pick r1m1 (was cleared); r2m0 pick A survived
  snap('S1c pre-lock reverted to champion A', d)

  // ════════ SCENARIO 2 — lock ════════
  lockDraw(d)
  snap('S2 after lock (originalPick snapshot)', d)

  // ════════ SCENARIO 3 — elimination (A loses R1 to B) ════════
  await applyWinner(d, 0, 0, 'B', cb)
  snap('S3 after A eliminated R1 (winner B)', d)

  // ════════ SCENARIO 4 — backup pick after elimination ════════
  // R2 m0 original pick A is dead; user backs B (the actual advancer)
  await handlePickClick(1, 0, { name: 'B' }, cb)
  snap('S4 after backup pick B in R2m0', d)

  // confirm more winners to exercise backup result + scoring
  await applyWinner(d, 0, 1, 'D', cb)   // D wins, original pick D correct
  await applyWinner(d, 1, 0, 'B', cb)   // B wins R2, backup pick B correct
  snap('S5 after D wins R1m1 and B wins R2m0', d)

  // ════════ SCENARIO 6 — withdrawal / repick ════════
  // Player H (R1 m3, user's pick, cascaded to R2m1) withdraws.
  const m3 = d.rounds[0].matches[3]
  m3.editedAfterLock = true
  withdrawalClearForward(d, 0, 3, 'H')
  snap('S6a after withdrawalClearForward(H)', d)
  // user repicks G in that match (withdrawal repick path)
  await handlePickClick(0, 3, { name: 'G' }, cb)
  snap('S6b after repick G', d)

  // ════════ SCENARIO 7 — undo a winner ════════
  await undoWinner(d, 1, 0, cb)
  snap('S7 after undoWinner R2m0', d)

  // ════════ SCENARIO 8 — data.js loadDraw reconstruction ════════
  // Stage DB rows mid-tournament: R1 winners B and D confirmed; user picked
  // A (lost) and D (won). Tests p1/p2 reconstruction + markLoserForward replay.
  globalThis.__FAKE_DB__ = {
    matches: [
      { id: 'x_r0m0', round_index: 0, match_index: 0, p1_name: 'A', p1_seed: '1', p2_name: 'B', p2_seed: '', winner: 'B', score: '' },
      { id: 'x_r0m1', round_index: 0, match_index: 1, p1_name: 'C', p1_seed: '', p2_name: 'D', p2_seed: '4', winner: 'D', score: '' },
      { id: 'x_r0m2', round_index: 0, match_index: 2, p1_name: 'E', p1_seed: '3', p2_name: 'F', p2_seed: '', winner: null, score: '' },
      { id: 'x_r0m3', round_index: 0, match_index: 3, p1_name: 'G', p1_seed: '', p2_name: 'H', p2_seed: '2', winner: null, score: '' },
      { id: 'x_r1m0', round_index: 1, match_index: 0, p1_name: null, p1_seed: null, p2_name: null, p2_seed: null, winner: null, score: '' },
      { id: 'x_r1m1', round_index: 1, match_index: 1, p1_name: null, p1_seed: null, p2_name: null, p2_seed: null, winner: null, score: '' },
      { id: 'x_r2m0', round_index: 2, match_index: 0, p1_name: null, p1_seed: null, p2_name: null, p2_seed: null, winner: null, score: '' },
    ],
    picks: [
      { match_id: 'x_r0m0', match_pick: 'A', original_pick: 'A', original_pick_result: 'wrong',   match_pick_result: 'wrong',   high_confidence: false, edited_after_lock: false, notes: '' },
      { match_id: 'x_r0m1', match_pick: 'D', original_pick: 'D', original_pick_result: 'correct', match_pick_result: 'correct', high_confidence: false, edited_after_lock: false, notes: '' },
      { match_id: 'x_r1m0', match_pick: 'A', original_pick: 'A', original_pick_result: null,        match_pick_result: null,      high_confidence: false, edited_after_lock: false, notes: '' },
      { match_id: 'x_r1m1', match_pick: 'E', original_pick: 'E', original_pick_result: null,        match_pick_result: null,      high_confidence: false, edited_after_lock: false, notes: '' },
      { match_id: 'x_r2m0', match_pick: 'A', original_pick: 'A', original_pick_result: null,        match_pick_result: null,      high_confidence: false, edited_after_lock: false, notes: '' },
    ],
  }
  const loaded = await loadDraw({ id: 'draw2', slam: 'RG', draw_type: 'MS', year: 2026, original_picks_locked: true, is_active: true })
  snap('S8 data.js loadDraw reconstruction', loaded)

  console.log(out.join('\n'))
}

run().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1) })
