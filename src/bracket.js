// Bracket renderer — ported verbatim from reference, adapted for Supabase pick saving

import { state, activeDraw } from './state.js'
import { isBackupPick } from './scoring.js'
import { handlePickClick, applyWinner, undoWinner, savePickToSupabase, withdrawalClearForward, updatePlayerNameForward } from './picks.js'
import { supabase } from './supabase.js'
import { renderStats } from './stats.js'

const CW = 180, CH = 62, GAP = 20, COL = 200

export function renderBracket() {
  const body = document.getElementById('bracket-body')
  if (!body) return
  body.innerHTML = ''
  const d = activeDraw()
  if (!d || !d.rounds || !d.rounds.length) {
    body.innerHTML = `
      <div class="bracket-empty">
        <div class="bracket-empty-icon">🎾</div>
        <div class="bracket-empty-title">No draw uploaded yet.</div>
        <div class="bracket-empty-sub">The commissioner will upload the draw when it's available.</div>
      </div>`
    return
  }
  const rounds = d.rounds
  const r1 = rounds[0].matches
  const total = r1.length, half = Math.ceil(total / 2), q = Math.ceil(half / 2)
  const drawRounds = rounds.length - 1
  const VGAP = 32, CELL = CH + VGAP, Q_SEP = 28, QQ_SEP = 18

  function r1YCenter(idx) {
    let y = idx * CELL + CH / 2
    if (idx >= q) y += QQ_SEP
    if (idx >= half) y += Q_SEP
    if (idx >= half + q) y += QQ_SEP
    return y
  }
  function matchYCenter(ri, mi) {
    const f = mi * Math.pow(2, ri), l = (mi + 1) * Math.pow(2, ri) - 1
    return (r1YCenter(f) + r1YCenter(l)) / 2
  }

  const lastR1Y = r1YCenter(total - 1)
  const totalH = lastR1Y + CH / 2 + 16
  const CHAMP_W = 140
  const totalW = drawRounds * COL - GAP + GAP + CW + GAP + CHAMP_W + 20

  const wrap = document.createElement('div')
  wrap.className = 'bracket-svg-wrap'
  wrap.style.cssText = `width:${totalW}px;height:${totalH}px;position:relative`

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', totalW); svg.setAttribute('height', totalH)
  svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible'

  const connColor = '#c8c4bb'

  function addLine(x1, y1, x2, y2) {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2)
    l.setAttribute('stroke', connColor); l.setAttribute('stroke-width', '1'); svg.appendChild(l)
  }

  function drawSep(y, dashed) {
    const lw = drawRounds * COL - GAP
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', 0); line.setAttribute('x2', lw); line.setAttribute('y1', y); line.setAttribute('y2', y)
    line.setAttribute('stroke', dashed ? '#c8c4bb' : '#b0aa9f')
    line.setAttribute('stroke-width', dashed ? '1' : '1.5')
    if (dashed) line.setAttribute('stroke-dasharray', '5,4')
    svg.appendChild(line)
  }
  function sepY(idx) { return (r1YCenter(idx - 1) + CH / 2 + r1YCenter(idx) - CH / 2) / 2 }
  drawSep(sepY(q), true); drawSep(sepY(half), false); drawSep(sepY(half + q), true)

  const sectionDefs = [{ label: 'Top Half · Q1', mi: 0 }, { label: 'Top Half · Q2', mi: q }, { label: 'Bottom Half · Q3', mi: half }, { label: 'Bottom Half · Q4', mi: half + q }]
  sectionDefs.forEach(s => {
    const lbl = document.createElement('div')
    lbl.style.cssText = `position:absolute;left:0;font-family:var(--mono);font-size:8px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3);white-space:nowrap;top:${r1YCenter(s.mi) - CH / 2 - 13}px`
    lbl.textContent = s.label; wrap.appendChild(lbl)
  })

  for (let ri = 0; ri < drawRounds; ri++) {
    const x = ri * COL
    rounds[ri].matches.forEach((m, mi) => {
      const cy = matchYCenter(ri, mi), y = cy - CH / 2
      placeCard(d, m, ri, mi, x, y, wrap)
      if (ri < drawRounds - 1) {
        const rx = x + CW, midX = rx + GAP / 2
        const pcy = matchYCenter(ri + 1, Math.floor(mi / 2))
        addLine(rx, cy, midX, cy)
        if (mi % 2 === 0) { addLine(midX, cy, midX, matchYCenter(ri, mi + 1)) }
        addLine(midX, pcy, (ri + 1) * COL, pcy)
      }
    })
  }

  const finX = drawRounds * COL, finCY = totalH / 2, finY = finCY - CH / 2
  const finMatch = rounds[rounds.length - 1].matches[0]
  if (finMatch) {
    placeCard(d, finMatch, rounds.length - 1, 0, finX, finY, wrap)
    const sfRi = drawRounds - 1
    if (rounds[sfRi] && rounds[sfRi].matches.length >= 2) {
      const sfX = (drawRounds - 1) * COL, midX = sfX + CW + GAP / 2
      const sf0 = matchYCenter(sfRi, 0), sf1 = matchYCenter(sfRi, 1)
      addLine(sfX + CW, sf0, midX, sf0); addLine(sfX + CW, sf1, midX, sf1)
      addLine(midX, sf0, midX, sf1); addLine(midX, finCY, finX, finCY)
    }
  }

  // Champion box
  const champX = finX + CW + GAP, champY = finCY - 36
  const champDiv = document.createElement('div'); champDiv.className = 'champ-box'
  champDiv.style.cssText = `left:${champX}px;top:${champY}px;position:absolute`
  const champLbl = document.createElement('div'); champLbl.className = 'champ-label'; champLbl.textContent = 'Champion'
  const champNm = document.createElement('div'); champNm.className = 'champ-name'
  champNm.textContent = (finMatch && (finMatch.winner || finMatch.pick)) || '—'
  champDiv.appendChild(champLbl); champDiv.appendChild(champNm); wrap.appendChild(champDiv)
  addLine(finX + CW, finCY, champX, finCY)

  // Round labels
  const labelsInner = document.getElementById('round-labels-inner')
  if (labelsInner) {
    labelsInner.innerHTML = ''
    for (let ri = 0; ri < drawRounds; ri++) {
      const l = document.createElement('div')
      l.style.cssText = 'width:180px;flex-shrink:0;text-align:center;font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3)'
      l.textContent = rounds[ri].label; labelsInner.appendChild(l)
      if (ri < drawRounds - 1) { const g = document.createElement('div'); g.style.cssText = 'width:20px;flex-shrink:0'; labelsInner.appendChild(g) }
    }
    const finLbl = document.createElement('div')
    finLbl.style.cssText = 'width:180px;flex-shrink:0;text-align:center;font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text3);padding-left:20px'
    finLbl.textContent = 'Final'; labelsInner.appendChild(finLbl)
    labelsInner.style.transform = 'translateX(0)'
  }

  const outer = document.createElement('div'); outer.style.cssText = 'display:inline-block'
  wrap.appendChild(svg); outer.appendChild(wrap); body.appendChild(outer)
}

// ── PLACE CARD ──
export function placeCard(d, m, ri, mi, x, y, wrap) {
  const isReadOnly = !!state.viewingUser

  let cardCls = 'mc'
  if (m.editedAfterLock) cardCls += ' st-needs-repick'
  else if (m.result === 'correct') cardCls += ' st-correct'
  else if (m.result === 'wrong') cardCls += ' st-wrong'

  const card = document.createElement('div')
  card.className = cardCls
  card.style.cssText = `left:${x}px;top:${y}px`

  function makeRow(p, side) {
    const isOrigPick = m.originalPick && m.originalPick === p.name
    const isLivePick = m.pick && m.pick === p.name
    const isBackup = isLivePick && isBackupPick(m)
    const backupWrong = isBackup && m.winner && m.winner !== p.name
    const isElim = m.winner && m.winner !== p.name && p.name && !isLivePick
    const isBroken = p.elim && !m.winner
    const origInactive = d.locked && !m.winner && isOrigPick && !isLivePick && (m.originalPick && (!m.pick || isBackupPick(m)))

    let cls = 'pr'
    if (!p.name) {
      cls += ' no-pick'
    } else if (isOrigPick && m.result === 'correct') {
      cls += ' s-orig-ok locked'
    } else if (isOrigPick && m.result === 'wrong' && !isBroken) {
      cls += ' s-orig-wrong locked'
    } else if (isBroken) {
      cls += ' s-orig-wrong'
    } else if (isBackup && backupWrong) {
      cls += ' s-backup-wrong locked'
    } else if (isBackup) {
      cls += ' s-backup'
    } else if (origInactive) {
      cls += ' s-orig-inactive'
    } else if (isOrigPick || isLivePick) {
      cls += ' s-orig'
    } else if (isElim) {
      cls += ' s-elim'
    }

    const row = document.createElement('div'); row.className = cls; row.style.position = 'relative'
    const seedEl = document.createElement('span'); seedEl.className = 'pr-seed'; seedEl.textContent = p.seed || ''
    const nameEl = document.createElement('span'); nameEl.className = 'pr-name'; nameEl.textContent = p.name || '—'
    const dotEl = document.createElement('div'); dotEl.className = 'pr-dot'
    row.appendChild(seedEl); row.appendChild(nameEl)

    // High-confidence star
    const bothConfirmed = ri === 0
      ? (m.p1.name && m.p2.name)
      : (d.rounds[ri - 1]?.matches[mi * 2]?.winner && d.rounds[ri - 1]?.matches[mi * 2 + 1]?.winner)
    if (isLivePick && bothConfirmed && !m.winner && !isReadOnly) {
      const starEl = document.createElement('button')
      starEl.className = 'pr-star' + (m.highConfidence ? ' is-high' : '')
      starEl.textContent = m.highConfidence ? '★' : '☆'
      starEl.title = m.highConfidence ? 'High confidence (click to clear)' : 'Mark as high confidence'
      starEl.addEventListener('click', async e => {
        e.stopPropagation()
        m.highConfidence = !m.highConfidence
        await savePickToSupabase(m, d.db_id)
        renderStats(); renderBracket()
      })
      row.appendChild(starEl)
    }
    row.appendChild(dotEl)

    // Edit button (R1 only, commissioner only, not read-only)
    if (ri === 0 && state.currentUser?.is_commissioner && !isReadOnly) {
      const editBtn = document.createElement('button')
      editBtn.className = 'pr-edit-btn'; editBtn.textContent = '✎'; editBtn.title = 'Edit player'
      editBtn.addEventListener('click', e => { e.stopPropagation(); openEditPlayerModal(ri, mi, side) })
      row.appendChild(editBtn)
    }

    const isResolved = cls.includes('locked')
    if (p.name && !m.winner && (!isResolved || m.editedAfterLock) && !isReadOnly) {
      row.addEventListener('click', () => handlePickClick(ri, mi, p, { renderStats, renderBracket }))
    }
    return row
  }

  const rowsWrap = document.createElement('div')
  rowsWrap.style.cssText = 'overflow:hidden;border-radius:5px 5px 0 0;flex-shrink:0'
  rowsWrap.appendChild(makeRow(m.p1, 'p1'))
  rowsWrap.appendChild(makeRow(m.p2, 'p2'))
  card.appendChild(rowsWrap)

  // Footer: score input + ✓/✗ buttons — only when draw is locked and has players
  if (d.locked && (m.p1.name || m.p2.name) && !isReadOnly) {
    const footer = document.createElement('div'); footer.className = 'mc-footer'
    const sd = document.createElement('div'); sd.className = 'mc-score'
    const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Score…'; inp.value = m.score || ''
    inp.addEventListener('change', async e => {
      m.score = e.target.value.trim()
      if (state.currentUser?.is_commissioner && m.db_id) {
        await supabase.from('matches').update({ score: m.score }).eq('id', m.db_id)
      }
    })
    inp.addEventListener('click', e => e.stopPropagation())
    sd.appendChild(inp); footer.appendChild(sd)

    const acts = document.createElement('div'); acts.className = 'mc-acts'

    const bOk = document.createElement('button')
    bOk.className = 'mc-btn' + (m.result === 'correct' ? ' is-ok' : m.winner && m.result !== 'correct' ? ' is-bad' : '')
    bOk.textContent = '✓'
    bOk.title = m.winner ? 'Undo result' : 'Mark pick as winner'
    bOk.addEventListener('click', async e => {
      e.stopPropagation()
      if (m.winner) { await undoWinner(d, ri, mi, { renderStats, renderBracket }); return }
      if (m.pick) { await applyWinner(d, ri, mi, m.pick, { renderStats, renderBracket }); return }
      openWinnerPicker(d, ri, mi, name => applyWinner(d, ri, mi, name, { renderStats, renderBracket }))
    })

    const bBad = document.createElement('button')
    bBad.className = 'mc-btn' + (m.result === 'wrong' ? ' is-bad' : m.winner && m.result !== 'wrong' ? ' is-ok' : '')
    bBad.textContent = '✗'
    bBad.title = m.winner ? 'Undo result' : 'Mark pick as loser'
    bBad.addEventListener('click', async e => {
      e.stopPropagation()
      if (m.winner) { await undoWinner(d, ri, mi, { renderStats, renderBracket }); return }
      if (m.pick) {
        const other = m.p1.name === m.pick ? m.p2.name : m.p1.name
        if (!other) { openWinnerPicker(d, ri, mi, name => applyWinner(d, ri, mi, name, { renderStats, renderBracket })); return }
        await applyWinner(d, ri, mi, other, { renderStats, renderBracket }); return
      }
      openWinnerPicker(d, ri, mi, name => applyWinner(d, ri, mi, name, { renderStats, renderBracket }))
    })

    acts.appendChild(bOk); acts.appendChild(bBad); footer.appendChild(acts)
    card.appendChild(footer)
  }

  // ── BACKUP PICK GLOW ──
  // If this match falls in an upcoming (not yet triggered) backup lock range
  // and has no pick and no result yet, glow purple to prompt the player.
  if (!isReadOnly) {
    const upcomingBackupLock = state.lockSchedules.find(ls =>
      ls.lock_type === 'backup_picks' &&
      !ls.locked_at &&
      ls.scheduled_at &&
      new Date(ls.scheduled_at) > Date.now() &&
      ls.round_index === ri &&
      (ls.match_index_start == null || mi >= ls.match_index_start) &&
      (ls.match_index_end == null || mi <= ls.match_index_end)
    )
    if (upcomingBackupLock && !m.pick && !m.winner) {
      card.classList.add('needs-backup-pick')
    }
  }

  wrap.appendChild(card)
}

// ── WINNER PICKER MODAL ──
function openWinnerPicker(d, ri, mi, cb) {
  const m = d.rounds[ri].matches[mi]
  const players = [m.p1, m.p2].filter(p => p.name)
  if (players.length === 0) { alert('No players in this match.'); return }
  if (players.length === 1) { cb(players[0].name); return }
  const modal = document.getElementById('edit-player-modal')
  document.getElementById('epm-title').textContent = 'Who won this match?'
  document.getElementById('epm-subtitle').textContent = ''
  document.getElementById('epm-inputs').style.display = 'none'
  const area = document.getElementById('epm-btn-area'); area.innerHTML = ''
  const col = document.createElement('div'); col.style.cssText = 'display:flex;flex-direction:column;gap:8px;width:100%'
  players.forEach(p => {
    const btn = document.createElement('button')
    btn.style.cssText = 'padding:10px 14px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);border-radius:7px;font-family:var(--sans);font-size:13px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:8px'
    btn.innerHTML = `<span style="font-family:var(--mono);font-size:10px;color:var(--accent);min-width:20px">${p.seed || ''}</span>${p.name}`
    btn.addEventListener('click', () => { closeModal(); cb(p.name) })
    col.appendChild(btn)
  })
  const cancel = document.createElement('button')
  cancel.style.cssText = 'padding:8px;background:none;border:1px solid var(--border2);color:var(--text2);border-radius:7px;font-size:12px;cursor:pointer'
  cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeModal)
  col.appendChild(cancel); area.appendChild(col)
  modal.style.display = 'flex'
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
  document.getElementById('edit-player-modal').style.display = 'flex'
  setTimeout(() => document.getElementById('epm-name').focus(), 50)
}

export async function confirmEditPlayer() {
  if (!editCtx) return
  const d = activeDraw(); if (!d) return
  const { ri, mi, side } = editCtx
  const m = d.rounds[ri].matches[mi]
  const oldName = m[side].name
  const newName = document.getElementById('epm-name').value.trim()
  const newSeed = document.getElementById('epm-seed').value.trim()
  m[side] = { name: newName, seed: newSeed }
  if (m.pick === oldName) m.pick = null
  if (m.originalPick === oldName) m.originalPick = null

  // Update match in DB (commissioner only)
  if (state.currentUser?.is_commissioner && m.db_id) {
    const update = {}
    if (side === 'p1') { update.p1_name = newName; update.p1_seed = newSeed }
    else { update.p2_name = newName; update.p2_seed = newSeed }
    await supabase.from('matches').update(update).eq('id', m.db_id)
  }

  if (oldName && oldName !== newName) {
    if (d.locked) {
      m.editedAfterLock = true
      withdrawalClearForward(d, ri, mi, oldName)
    } else {
      updatePlayerNameForward(d, ri, mi, oldName, newName, newSeed)
    }
  }
  closeModal(); editCtx = null
  renderStats(); renderBracket()
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
