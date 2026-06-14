// Commissioner — Odds tab.
// Displays odds fetch status, unmatched API names for triage, and existing name mappings.
// All writes are commissioner-gated (RLS enforced server-side; checked client-side too).

import { state, activeDraw } from './state.js'
import { $c, escHtml } from './commissioner-shared.js'
import {
  loadOddsRaw, loadNameMappings, saveNameMapping, deleteNameMapping,
  getUnmatchedApiNames, forceOddsRefresh, normaliseName,
} from './odds.js'

// ── RENDER ENTRY ──

export async function renderOddsTab() {
  const wrap = $c('comm-pane-odds')
  if (!wrap) return
  wrap.innerHTML = '<div style="color:var(--text3);font-family:var(--mono);font-size:12px;padding:20px 0">Loading…</div>'

  const d = activeDraw()
  if (!d) {
    wrap.innerHTML = '<div style="color:var(--text3);font-family:var(--mono);font-size:12px;padding:20px 0">No draw loaded. Upload a draw first.</div>'
    return
  }

  try {
    const [rawRows, mappings] = await Promise.all([
      loadOddsRaw(d.db_id),
      loadNameMappings(),
    ])

    // Collect all draw player names from R1
    const drawPlayerNames = []
    d.rounds[0]?.matches.forEach(m => {
      if (m.p1?.name) drawPlayerNames.push(m.p1.name)
      if (m.p2?.name) drawPlayerNames.push(m.p2.name)
    })

    const unmatched = getUnmatchedApiNames(rawRows, mappings, drawPlayerNames)
    const lastFetch = rawRows.length > 0 ? new Date(rawRows[0].fetched_at).toLocaleString() : null

    wrap.innerHTML = ''

    // ── Status + refresh ──
    const statusSection = document.createElement('div')
    statusSection.className = 'comm-section'
    statusSection.innerHTML = `
      <div class="comm-section-title" style="margin-bottom:10px">Odds Status</div>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <span style="font-size:13px;color:var(--text2)">
          Last fetch: <span style="color:var(--text);font-family:var(--mono);font-size:12px">${lastFetch ?? '—'}</span>
        </span>
        <span style="font-size:13px;color:var(--text2)">
          Events in odds_raw: <span style="color:var(--text);font-family:var(--mono);font-size:12px">${rawRows.length}</span>
        </span>
        <button class="comm-btn comm-btn-primary" id="odds-refresh-btn">Force refresh now</button>
      </div>
      <div class="comm-msg" id="odds-status-msg" style="margin-top:8px"></div>`
    wrap.appendChild(statusSection)

    document.getElementById('odds-refresh-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('odds-refresh-btn')
      const msg = document.getElementById('odds-status-msg')
      if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…' }
      try {
        await forceOddsRefresh()
        if (msg) { msg.className = 'comm-msg success'; msg.textContent = 'Odds refreshed successfully.' }
        await renderOddsTab()
      } catch (err) {
        if (msg) { msg.className = 'comm-msg error'; msg.textContent = 'Error: ' + err.message }
        if (btn) { btn.disabled = false; btn.textContent = 'Force refresh now' }
      }
    })

    // ── Unmatched names (triage) ──
    const triageSection = document.createElement('div')
    triageSection.className = 'comm-section'
    const triageHdr = document.createElement('div')
    triageHdr.innerHTML = `<div class="comm-section-title" style="margin-bottom:6px">Unmatched API Names</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.7">
        These names came from The Odds API but couldn't be auto-matched to draw players.
        Assign each to a player to enable odds on their matches.
      </div>`
    triageSection.appendChild(triageHdr)

    if (unmatched.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--text3)'
      empty.textContent = unmatched.length === 0 && rawRows.length === 0
        ? 'No odds data yet — odds are fetched every 3 hours while a draw is active, or use Force refresh above.'
        : 'All API names matched.'
      triageSection.appendChild(empty)
    } else {
      const grid = document.createElement('div')
      grid.style.cssText = 'display:flex;flex-direction:column;gap:6px'

      unmatched.forEach(apiName => {
        const row = document.createElement('div')
        row.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap'
        row.dataset.apiName = apiName

        const apiLabel = document.createElement('span')
        apiLabel.style.cssText = 'font-family:var(--mono);font-size:12px;color:var(--text);flex:0 0 200px;min-width:140px'
        apiLabel.textContent = apiName

        const arrow = document.createElement('span')
        arrow.style.cssText = 'color:var(--text3);font-size:12px'
        arrow.textContent = '→'

        const sel = document.createElement('select')
        sel.className = 'comm-input'
        sel.style.cssText = 'flex:1;min-width:180px;max-width:260px;font-size:12px'
        sel.innerHTML = `<option value="">— pick a player —</option>`
        drawPlayerNames.forEach(pName => {
          const opt = document.createElement('option')
          opt.value = pName
          opt.textContent = pName
          // Pre-select if normalised names match (shouldn't usually happen since they're in unmatched, but handles edge cases)
          if (normaliseName(pName) === normaliseName(apiName)) opt.selected = true
          sel.appendChild(opt)
        })

        const saveBtn = document.createElement('button')
        saveBtn.className = 'comm-btn comm-btn-primary'
        saveBtn.textContent = 'Save'
        saveBtn.addEventListener('click', async () => {
          if (!sel.value) return
          saveBtn.disabled = true
          try {
            await saveNameMapping(apiName, sel.value)
            row.style.opacity = '0.4'
            row.innerHTML = `<span style="font-family:var(--mono);font-size:11px;color:var(--green)">✓ ${escHtml(apiName)} → ${escHtml(sel.value)}</span>`
          } catch (err) {
            saveBtn.disabled = false
            const errEl = document.createElement('span')
            errEl.style.cssText = 'font-size:11px;color:var(--red)'
            errEl.textContent = err.message
            row.appendChild(errEl)
          }
        })

        row.appendChild(apiLabel)
        row.appendChild(arrow)
        row.appendChild(sel)
        row.appendChild(saveBtn)
        grid.appendChild(row)
      })
      triageSection.appendChild(grid)
    }
    wrap.appendChild(triageSection)

    // ── Existing mappings ──
    const mappingsSection = document.createElement('div')
    mappingsSection.className = 'comm-section'
    const mappingsHdr = document.createElement('div')
    mappingsHdr.innerHTML = `<div class="comm-section-title" style="margin-bottom:10px">Saved Name Mappings (${mappings.length})</div>`
    mappingsSection.appendChild(mappingsHdr)

    if (mappings.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--text3)'
      empty.textContent = 'No mappings saved yet.'
      mappingsSection.appendChild(empty)
    } else {
      let showAllMappings = false
      const mappingWrap = document.createElement('div')

      const renderMappingRows = () => {
        mappingWrap.innerHTML = ''
        const list = showAllMappings ? mappings : mappings.slice(0, 8)
        list.forEach(m => {
          const row = document.createElement('div')
          row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:5px 0;border-top:1px solid var(--border)'
          row.innerHTML = `
            <span style="flex:1;font-family:var(--mono);font-size:11px;color:var(--text2)">${escHtml(m.api_name)}</span>
            <span style="color:var(--text3);font-size:11px">→</span>
            <span style="flex:1;font-size:12px;color:var(--text)">${escHtml(m.draw_player_name)}</span>`
          const delBtn = document.createElement('button')
          delBtn.className = 'comm-btn comm-btn-danger'
          delBtn.style.fontSize = '11px'
          delBtn.textContent = 'Delete'
          delBtn.addEventListener('click', async () => {
            delBtn.disabled = true
            try {
              await deleteNameMapping(m.api_name)
              await renderOddsTab()
            } catch (err) {
              delBtn.disabled = false
            }
          })
          row.appendChild(delBtn)
          mappingWrap.appendChild(row)
        })
        if (mappings.length > 8) {
          const toggle = document.createElement('div')
          toggle.style.cssText = 'padding:6px 0;font-family:var(--mono);font-size:10px;color:var(--text3);cursor:pointer;border-top:1px solid var(--border)'
          toggle.textContent = showAllMappings ? 'Show less ↑' : `Show all ${mappings.length} ↓`
          toggle.addEventListener('click', () => { showAllMappings = !showAllMappings; renderMappingRows() })
          mappingWrap.appendChild(toggle)
        }
      }
      renderMappingRows()
      mappingsSection.appendChild(mappingWrap)
    }
    wrap.appendChild(mappingsSection)

  } catch (err) {
    wrap.innerHTML = `<div style="color:var(--red);font-size:13px;padding:20px 0">Error loading odds data: ${escHtml(err.message)}</div>`
  }
}
