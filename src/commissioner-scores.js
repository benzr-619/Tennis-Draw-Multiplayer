// Commissioner — ESPN Score Feed status + unmatched-name triage.
// Lives in the Results tab (scores render on the Results bracket). Mirrors the
// Odds tab's status/refresh + unmatched-names UX (commissioner-odds.js).

import { activeDraw } from './state.js'
import { $c, escHtml } from './commissioner-shared.js'
import { supabase } from './supabase.js'

const STALE_MS = 15 * 60 * 1000 // 15 min
const FAILURE_THRESHOLD = 5

async function loadFeedStatus() {
  const { data, error } = await supabase
    .from('score_feed_status')
    .select('last_ok, last_attempt, consecutive_failures, last_error, unmatched_names')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return data || {}
}

async function loadEspnMappings() {
  const { data, error } = await supabase
    .from('espn_name_mappings')
    .select('espn_name, draw_player_name')
    .order('espn_name')
  if (error) throw error
  return data || []
}

async function saveEspnMapping(espnName, drawPlayerName) {
  const { error } = await supabase
    .from('espn_name_mappings')
    .upsert({ espn_name: espnName, draw_player_name: drawPlayerName }, { onConflict: 'espn_name' })
  if (error) throw error
}

async function deleteEspnMapping(espnName) {
  const { error } = await supabase.from('espn_name_mappings').delete().eq('espn_name', espnName)
  if (error) throw error
}

async function forceEspnRefresh() {
  const { error } = await supabase.rpc('refresh_espn_scores_now')
  if (error) throw error
}

function _agoLabel(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m ago`
}

// enterCommissioner() both calls initCommissioner() (which renders this section)
// and immediately fires a synthetic click on the Results tab (which renders it
// again) — two overlapping async calls race, and since each only clears the wrap
// synchronously at its own start, both can end up appending. This generation
// token lets a newer call invalidate a still-in-flight older one.
let _renderGen = 0

export async function renderEspnScoreFeedSection() {
  const gen = ++_renderGen
  const wrap = $c('comm-espn-wrap')
  if (!wrap) return
  wrap.innerHTML = ''

  const d = activeDraw()
  if (!d) return

  try {
    const [status, mappings] = await Promise.all([loadFeedStatus(), loadEspnMappings()])
    if (gen !== _renderGen) return // superseded by a newer render

    const section = document.createElement('div')
    section.className = 'comm-section'
    section.innerHTML = `<div class="comm-section-title" style="margin-bottom:10px">ESPN Score Feed</div>`

    const isStale = (status.consecutive_failures ?? 0) >= FAILURE_THRESHOLD
      || (status.last_ok && Date.now() - new Date(status.last_ok).getTime() > STALE_MS)
      || !status.last_ok

    const statusRow = document.createElement('div')
    statusRow.style.cssText = 'display:flex;align-items:center;gap:14px;flex-wrap:wrap'
    const pill = document.createElement('span')
    pill.style.cssText = `font-family:var(--mono);font-size:11px;padding:3px 9px;border-radius:11px;color:${isStale ? 'var(--red)' : 'var(--green)'};background:${isStale ? 'rgba(192,57,43,0.1)' : 'rgba(76,153,104,0.1)'}`
    pill.textContent = isStale
      ? `Score feed STALE${status.last_ok ? ` · last OK ${_agoLabel(status.last_ok)}` : ''}`
      : `Score feed OK · updated ${_agoLabel(status.last_ok)}`
    statusRow.appendChild(pill)

    if (status.last_error) {
      const errSpan = document.createElement('span')
      errSpan.style.cssText = 'font-size:11px;color:var(--text3);font-family:var(--mono)'
      errSpan.textContent = status.last_error
      statusRow.appendChild(errSpan)
    }

    const refreshBtn = document.createElement('button')
    refreshBtn.className = 'comm-btn comm-btn-primary'
    refreshBtn.textContent = 'Refresh scores now'
    statusRow.appendChild(refreshBtn)
    section.appendChild(statusRow)

    const msg = document.createElement('div')
    msg.className = 'comm-msg'
    msg.style.marginTop = '8px'
    section.appendChild(msg)

    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true; refreshBtn.textContent = 'Refreshing…'
      try {
        await forceEspnRefresh()
        msg.className = 'comm-msg success'; msg.textContent = 'Scores refreshed successfully.'
        await renderEspnScoreFeedSection()
      } catch (err) {
        msg.className = 'comm-msg error'; msg.textContent = 'Error: ' + err.message
        refreshBtn.disabled = false; refreshBtn.textContent = 'Refresh scores now'
      }
    })

    // ── Unmatched ESPN Names (triage) ──
    const unmatched = Array.isArray(status.unmatched_names) ? status.unmatched_names : []

    // Dropdown targets: only players whose own R1 match doesn't have a score yet.
    // Players already resolved (auto-matched or previously mapped) are pruned —
    // no point offering a name that's already been matched to a different match.
    const r0Matches = d.rounds[0]?.matches ?? []
    const drawPlayerNames = []
    r0Matches.forEach(m => {
      if (m.score) return
      if (m.p1?.name) drawPlayerNames.push(m.p1.name)
      if (m.p2?.name) drawPlayerNames.push(m.p2.name)
    })
    const r1Total = r0Matches.length
    const r1Scored = r0Matches.filter(m => m.score).length

    const triageSection = document.createElement('div')
    triageSection.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border)'

    if (unmatched.length === 0) {
      // Nothing to fix — one compact line instead of a summary line + a separate
      // "all matched" line, so the card takes minimal space in the common case.
      const oneLine = document.createElement('div')
      oneLine.style.cssText = 'font-size:12px;color:var(--text2)'
      oneLine.innerHTML = `Round 1 scores: <span style="font-family:var(--mono);color:var(--text)">${r1Scored} / ${r1Total}</span> matched
        <span style="color:var(--text3)">— all ESPN names resolved.</span>`
      triageSection.appendChild(oneLine)
    } else {
      const triageHdr = document.createElement('div')
      triageHdr.innerHTML = `<div style="font-size:12px;color:var(--text2);margin-bottom:8px;line-height:1.7">
        Round 1 scores: <span style="font-family:var(--mono);color:var(--text)">${r1Scored} / ${r1Total}</span> matched.
        The rest need a name assigned below.
      </div>`
      triageSection.appendChild(triageHdr)

      let showUnmatched = false
      const bodyWrap = document.createElement('div')

      const renderTriageBody = () => {
        bodyWrap.innerHTML = ''
        const toggle = document.createElement('div')
        toggle.style.cssText = 'font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text3);cursor:pointer;margin-bottom:8px'
        toggle.textContent = showUnmatched
          ? 'Hide unmatched ESPN names ↑'
          : `Show unmatched ESPN names (${unmatched.length}) ↓`
        toggle.addEventListener('click', () => { showUnmatched = !showUnmatched; renderTriageBody() })
        bodyWrap.appendChild(toggle)
        if (!showUnmatched) return

        const grid = document.createElement('div')
        grid.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto;padding-right:4px'

        unmatched.forEach(espnName => {
          const row = document.createElement('div')
          row.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap'

          const nameLabel = document.createElement('span')
          nameLabel.style.cssText = 'font-family:var(--mono);font-size:12px;color:var(--text);flex:0 0 200px;min-width:140px'
          nameLabel.textContent = espnName

          const arrow = document.createElement('span')
          arrow.style.cssText = 'color:var(--text3);font-size:12px'
          arrow.textContent = '→'

          const sel = document.createElement('select')
          sel.className = 'comm-input'
          sel.style.cssText = 'flex:1;min-width:180px;max-width:260px;font-size:12px'
          sel.innerHTML = `<option value="">— pick a player —</option>`
          drawPlayerNames.forEach(pName => {
            const opt = document.createElement('option')
            opt.value = pName; opt.textContent = pName
            sel.appendChild(opt)
          })

          const saveBtn = document.createElement('button')
          saveBtn.className = 'comm-btn comm-btn-primary'
          saveBtn.textContent = 'Save'
          saveBtn.addEventListener('click', async () => {
            if (!sel.value) return
            saveBtn.disabled = true
            try {
              await saveEspnMapping(espnName, sel.value)
              row.style.opacity = '0.4'
              row.innerHTML = `<span style="font-family:var(--mono);font-size:11px;color:var(--green)">✓ ${escHtml(espnName)} → ${escHtml(sel.value)}</span>`
            } catch (err) {
              saveBtn.disabled = false
              const errEl = document.createElement('span')
              errEl.style.cssText = 'font-size:11px;color:var(--red)'
              errEl.textContent = err.message
              row.appendChild(errEl)
            }
          })

          row.appendChild(nameLabel); row.appendChild(arrow); row.appendChild(sel); row.appendChild(saveBtn)
          grid.appendChild(row)
        })
        bodyWrap.appendChild(grid)
      }
      renderTriageBody()
      triageSection.appendChild(bodyWrap)
    }
    section.appendChild(triageSection)

    // ── Saved mappings ──
    if (mappings.length > 0) {
      const mapSection = document.createElement('div')
      mapSection.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border)'
      let showMappings = false
      const renderRows = () => {
        mapSection.innerHTML = ''
        const toggle = document.createElement('div')
        toggle.style.cssText = 'font-family:var(--mono);font-size:10px;color:var(--text3);cursor:pointer'
        toggle.textContent = showMappings ? 'Hide saved mappings ↑' : `Show saved mappings (${mappings.length}) ↓`
        toggle.addEventListener('click', () => { showMappings = !showMappings; renderRows() })
        mapSection.appendChild(toggle)
        if (showMappings) {
          mappings.forEach(m => {
            const row = document.createElement('div')
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:5px 0;border-top:1px solid var(--border);margin-top:6px'
            row.innerHTML = `
              <span style="flex:1;font-family:var(--mono);font-size:11px;color:var(--text2)">${escHtml(m.espn_name)}</span>
              <span style="color:var(--text3);font-size:11px">→</span>
              <span style="flex:1;font-size:12px;color:var(--text)">${escHtml(m.draw_player_name)}</span>`
            const delBtn = document.createElement('button')
            delBtn.className = 'comm-btn comm-btn-danger'
            delBtn.style.fontSize = '11px'
            delBtn.textContent = 'Delete'
            delBtn.addEventListener('click', async () => {
              delBtn.disabled = true
              try { await deleteEspnMapping(m.espn_name); await renderEspnScoreFeedSection() }
              catch { delBtn.disabled = false }
            })
            row.appendChild(delBtn)
            mapSection.appendChild(row)
          })
        }
      }
      renderRows()
      section.appendChild(mapSection)
    }

    wrap.appendChild(section)
  } catch (err) {
    wrap.innerHTML = `<div class="comm-section" style="color:var(--red);font-size:13px">Error loading score feed status: ${escHtml(err.message)}</div>`
  }
}
