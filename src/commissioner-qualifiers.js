// Commissioner — Re-upload draw PDF: diffs a re-parsed TNNS PDF against the stored
// active draw, position by position, to catch newly-placed qualifiers and late
// withdrawals. Split out from commissioner.js to keep that file under the repo's
// informal ~400-line ceiling (it was already well over before this feature).
// See .claude/rules/qualifiers.md.

import { supabase } from './supabase.js'
import { state, activeDraw } from './state.js'
import { reloadActiveDraw, drawLabel } from './data.js'
import { extractPdfText, parseTnnsText, validateParsedDraw } from './parser.js'
import { isPlaceholderName } from './player-names.js'
import { $c, escHtml } from './commissioner-shared.js'
import { applyPlayerSwap, renderResults } from './commissioner-results.js'

// ── MODULE STATE ──
let _reuploadFile = null
let _pendingDiff = null

// ── RENDER ──
export function renderReuploadSection() {
  const wrap = $c('comm-reupload-wrap')
  if (!wrap) return
  const d = activeDraw()
  if (!d) { wrap.innerHTML = ''; return }

  _reuploadFile = null
  _pendingDiff = null

  wrap.innerHTML = `
    <div class="comm-section-title" style="margin-bottom:10px">Re-upload draw PDF</div>
    <p style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.6">
      Re-parse the TNNS draw PDF for <strong>${escHtml(drawLabel(d))}</strong> to place qualifiers into
      empty slots or pick up late withdrawals. Diffed position-by-position against the stored draw —
      nothing is written until you review and confirm below.
    </p>
    <div class="drop-zone" id="reup-drop-zone">
      <div class="drop-icon">📄</div>
      <div class="drop-label" id="reup-drop-label">Drop updated PDF here or click to select</div>
      <div class="drop-hint">TNNS Live draw export</div>
    </div>
    <input type="file" id="reup-file-input" accept=".pdf" style="display:none">
    <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
      <button class="comm-btn comm-btn-primary" id="reup-parse-btn" style="display:none">Parse &amp; diff</button>
    </div>
    <div class="comm-msg" id="reup-msg"></div>
    <div id="reup-diff-wrap" style="margin-top:14px"></div>`

  _wireReuploadDropZone()
  $c('reup-parse-btn')?.addEventListener('click', handleReuploadParse)
}

function _wireReuploadDropZone() {
  const dz = $c('reup-drop-zone')
  const fi = $c('reup-file-input')
  if (!dz || !fi) return
  dz.addEventListener('click', () => fi.click())
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over') })
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'))
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (file) _handleReuploadFileSelected(file)
  })
  fi.addEventListener('change', () => { if (fi.files[0]) _handleReuploadFileSelected(fi.files[0]) })
}

function _handleReuploadFileSelected(file) {
  const label = $c('reup-drop-label')
  if (label) label.textContent = file.name
  _reuploadFile = file
  _pendingDiff = null
  const parseBtn = $c('reup-parse-btn')
  if (parseBtn) parseBtn.style.display = ''
  const diffWrap = $c('reup-diff-wrap')
  if (diffWrap) diffWrap.innerHTML = ''
  setReupMsg('')
}

// ── DIFF ──
// Position-by-position diff of the stored active draw's round-0 slots against a
// freshly re-parsed set of R1 matches. See .claude/rules/qualifiers.md for the
// bucket definitions and the three safety-gate checks applied by the caller.
function _diffAgainstStored(d, parsed) {
  const bucketA = []      // QUALIFIER PLACED: stored placeholder -> new real name
  const bucketB = []      // ROSTER CHANGE: stored real name -> new different real name
  const regressions = []  // stored real name -> new PDF reads QUALIFIER (draw can't go backwards)

  d.rounds[0].matches.forEach((m, mi) => {
    ;['p1', 'p2'].forEach(side => {
      const storedName = m[side]?.name || ''
      const newP = parsed[mi]
      const newName = side === 'p1' ? newP.p1_name : newP.p2_name
      const newSeed = side === 'p1' ? newP.p1_seed : newP.p2_seed
      const newCountry = side === 'p1' ? newP.p1_country : newP.p2_country
      const pos = mi * 2 + (side === 'p1' ? 1 : 2)

      const storedIsPlaceholder = isPlaceholderName(storedName)
      const newIsPlaceholder = isPlaceholderName(newName)

      if (newIsPlaceholder) return // still unresolved in the new PDF — leave this slot untouched

      if (storedIsPlaceholder || !storedName) {
        if (newName) bucketA.push({ mi, side, pos, oldName: storedName, newName, newSeed, newCountry })
      } else if (newName && storedName !== newName) {
        bucketB.push({ mi, side, pos, oldName: storedName, newName, newSeed, newCountry })
      }

      if (storedName && !storedIsPlaceholder && newIsPlaceholder) {
        regressions.push({ pos, storedName })
      }
    })
  })

  return { bucketA, bucketB, regressions }
}

async function handleReuploadParse() {
  const d = activeDraw(); if (!d) return
  const file = _reuploadFile; if (!file) return
  const btn = $c('reup-parse-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Parsing…' }
  setReupMsg('')
  $c('reup-diff-wrap').innerHTML = ''

  try {
    const text = await extractPdfText(file)
    const parsed = parseTnnsText(text)
    const validation = validateParsedDraw(parsed)
    if (!validation.ok) throw new Error(validation.error)

    const diff = _diffAgainstStored(d, parsed)

    // Safety gates — refuse and apply nothing if any trips.
    if (diff.regressions.length) {
      const positions = diff.regressions.map(r => r.pos).join(', ')
      throw new Error(`Refusing to apply: position(s) ${positions} currently hold a real player but the new PDF reads QUALIFIER there. The draw can't go backwards — check you uploaded the right file.`)
    }
    if (diff.bucketB.length > 8) {
      throw new Error(`Refusing to apply: ${diff.bucketB.length} positions with a real stored name changed to a different real name (expected at most 8 for late withdrawals). This looks like the wrong draw was uploaded.`)
    }

    _pendingDiff = diff
    renderDiffConfirmation(diff)
    setReupMsg(`Parsed OK — ${diff.bucketA.length} qualifier placement(s), ${diff.bucketB.length} roster change(s). Review below, then confirm.`, 'success')
  } catch (err) {
    _pendingDiff = null
    setReupMsg('Error: ' + err.message, 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Parse & diff' }
  }
}

function renderDiffConfirmation(diff) {
  const wrap = $c('reup-diff-wrap')
  if (!wrap) return

  if (!diff.bucketA.length && !diff.bucketB.length) {
    wrap.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--text3)">No differences found — nothing to apply.</div>'
    return
  }

  function section(title, items) {
    if (!items.length) return ''
    const rows = items.map(c => `
      <div style="display:flex;gap:8px;padding:5px 0;border-top:1px solid var(--border);font-size:12px;align-items:baseline">
        <span style="color:var(--text3);font-family:var(--mono);font-size:10px;flex-shrink:0">#${c.pos}</span>
        <span style="flex:1">${escHtml(c.oldName || '(empty)')} → <strong>${escHtml(c.newName)}</strong></span>
      </div>`).join('')
    return `<div style="margin-bottom:14px">
      <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);margin-bottom:4px">${title} (${items.length})</div>
      ${rows}
    </div>`
  }

  wrap.innerHTML = section('Qualifier placed', diff.bucketA) + section('Roster change', diff.bucketB)
    + '<button class="comm-btn comm-btn-primary" id="reup-confirm-btn" style="margin-top:8px">Apply changes</button>'

  $c('reup-confirm-btn')?.addEventListener('click', handleConfirmReupload)
}

// ── APPLY ──
// Bucket A's own write path (distinct from applyPlayerSwap): a qualifier placement
// preserves every user's existing pick on that slot (renamed via place_qualifiers
// below), it never clears it the way a withdrawal does — see .claude/rules/qualifiers.md
// for why this can't just reuse applyPlayerSwap.
async function _applyQualifierPlacement(d, mi, side, newName, newSeed, newCountry) {
  const m = d.rounds[0].matches[mi]
  const oldName = m[side].name
  m[side] = { name: newName, seed: newSeed, country: newCountry }

  const rosterChangedAt = new Date().toISOString()
  const update = {}
  if (side === 'p1') { update.p1_name = newName; update.p1_seed = newSeed; update.p1_country = newCountry }
  else { update.p2_name = newName; update.p2_seed = newSeed; update.p2_country = newCountry }
  update.roster_changed_at = rosterChangedAt
  update.replaced_name = oldName
  // H2H odds are relative, so filling in a real opponent invalidates both prices;
  // ELO is per-player, only the newly-placed side needs clearing.
  update.odds_p1_live = null; update.odds_p2_live = null
  update.odds_p1_locked = null; update.odds_p2_locked = null
  if (side === 'p1') update.elo_p1 = null; else update.elo_p2 = null

  await supabase.from('matches').update(update).eq('id', m.db_id)

  m.roster_changed_at = rosterChangedAt
  m.replaced_name = oldName
  m.odds_p1_live = null; m.odds_p2_live = null
  m.odds_p1_locked = null; m.odds_p2_locked = null
  if (side === 'p1') m.elo_p1 = null; else m.elo_p2 = null

  if (oldName) delete d.countryMap[oldName]
  if (newCountry) d.countryMap[newName] = newCountry

  return { old: oldName, new: newName }
}

async function handleConfirmReupload() {
  if (!state.currentUser?.is_commissioner) return
  const d = activeDraw(); if (!d) return
  const diff = _pendingDiff; if (!diff) return
  const btn = $c('reup-confirm-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Applying…' }
  setReupMsg('Applying…')

  try {
    // Bucket B — existing single-edit swap path, unchanged (see commissioner-results.js).
    for (const c of diff.bucketB) {
      await applyPlayerSwap(d, 0, c.mi, c.side, c.newName, c.newSeed, c.newCountry)
    }

    // Bucket A — write the real name into the slot for every match, then rewrite
    // every user's picks from the placeholder name to the real name in one RPC call
    // (RLS blocks the client from writing other users' pick rows directly).
    const pMap = []
    for (const c of diff.bucketA) {
      pMap.push(await _applyQualifierPlacement(d, c.mi, c.side, c.newName, c.newSeed, c.newCountry))
    }
    if (pMap.length) {
      const { error: rpcErr } = await supabase.rpc('place_qualifiers', { p_draw_id: d.db_id, p_map: pMap })
      if (rpcErr) throw rpcErr
      const placedAt = new Date().toISOString()
      const { error: drawErr } = await supabase.from('draws').update({ qualifiers_placed_at: placedAt }).eq('id', d.db_id)
      if (drawErr) throw drawErr
      d.qualifiers_placed_at = placedAt // so the immediately-following reload doesn't pass a stale value through (see reloadActiveDraw in data.js)
    }

    await reloadActiveDraw()

    const bucketACount = diff.bucketA.length, bucketBCount = diff.bucketB.length
    _pendingDiff = null
    _reuploadFile = null
    $c('reup-diff-wrap').innerHTML = ''
    const dropLabel = $c('reup-drop-label')
    if (dropLabel) dropLabel.textContent = 'Drop updated PDF here or click to select'
    const parseBtn = $c('reup-parse-btn')
    if (parseBtn) parseBtn.style.display = 'none'
    setReupMsg(`Applied — ${bucketACount} qualifier(s) placed, ${bucketBCount} roster change(s).`, 'success')

    renderResults()
    const { renderPickCompletion } = await import('./commissioner.js')
    const ad = activeDraw()
    if (ad) renderPickCompletion(ad)
  } catch (err) {
    setReupMsg('Error: ' + err.message, 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Apply changes' }
  }
}

function setReupMsg(msg, type) {
  const el = $c('reup-msg')
  if (!el) return
  el.className = 'comm-msg' + (type ? ' ' + type : '')
  el.textContent = msg
}
