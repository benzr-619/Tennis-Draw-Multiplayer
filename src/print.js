// Print — ported verbatim from reference app
// buildPrintHTML(d) receives an assembled Draw object; no async, no Supabase

import { isBackupPick } from './scoring.js'

const SLAM_CONFIG = {
  AO: { name: 'Australian Open' },
  RG: { name: 'Roland Garros' },
  WIM: { name: 'Wimbledon' },
  USO: { name: 'US Open' },
}

export function buildPrintHTML(d) {
  const cfg = SLAM_CONFIG[d.slam] || {}
  const rounds = d.rounds
  const r1 = rounds[0].matches
  const total = r1.length
  const half = Math.ceil(total / 2)
  const q = Math.ceil(half / 2)
  const drawRounds = rounds.length - 1

  const accentColors = { AO: '#1048a0', RG: '#8b2615', WIM: '#1a5c2a', USO: '#1048a0' }
  const accent = accentColors[d.slam] || '#1a1916'
  function escH(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

  const BODY_H = 381
  const R1_PER_PAGE = 32
  const PAIR_GAP = 1.6
  const unit = (BODY_H - (R1_PER_PAGE - 1) * PAIR_GAP) / R1_PER_PAGE
  const rowH = unit / 2

  function slotH(ri) {
    const n = Math.pow(2, ri)
    return n * unit + (n - 1) * PAIR_GAP
  }

  const colW = [54, 40, 32, 26, 24, 24]
  const gapW = 3

  function nameLineHTML(p, m) {
    if (!p || !p.name) return '<div style="height:' + rowH.toFixed(2) + 'mm"></div>'
    const isOrig = m.originalPick && m.originalPick === p.name
    const isPick = m.matchPick && m.matchPick === p.name
    const backup = isBackupPick(m)
    const isBackupRow = isPick && backup
    const isElim = m.winner && m.winner !== p.name
    const isCorrect = isOrig && m.originalPickResult === 'correct'
    const isWrong = isOrig && m.originalPickResult === 'wrong'
    const isBackupWrong = isBackupRow && m.winner && m.matchPick !== m.winner

    let ind = '&nbsp;', nameStyle = 'color:#1a1916', seedCol = '#bbb'
    if (isCorrect) { ind = '✓'; nameStyle = 'color:' + accent + ';font-weight:700'; seedCol = accent }
    else if (isWrong) { ind = '✗'; nameStyle = 'color:#c0392b;text-decoration:line-through'; seedCol = '#c0392b' }
    else if (isBackupRow && !isBackupWrong) { ind = '·'; nameStyle = 'color:#6b3fa0;font-style:italic'; seedCol = '#9b7bc0' }
    else if (isBackupWrong) { ind = '·'; nameStyle = 'color:#6b3fa0;font-style:italic;text-decoration:line-through'; seedCol = '#9b7bc0' }
    else if (isPick || isOrig) { ind = '▸'; nameStyle = 'font-weight:700' }
    else if (isElim) { nameStyle = 'color:#ccc' }

    return '<div style="height:' + rowH.toFixed(2) + 'mm;display:flex;align-items:center;overflow:hidden;gap:1pt">'
      + '<span style="font-size:5pt;min-width:7pt;text-align:center;flex-shrink:0;color:' + accent + '">' + ind + '</span>'
      + '<span style="font-family:monospace;font-size:5pt;color:' + seedCol + ';min-width:9pt;text-align:right;flex-shrink:0">' + escH(p.seed) + '</span>'
      + '<span style="font-family:\'Playfair Display\',Georgia,serif;font-size:7.5pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + nameStyle + '">' + escH(p.name) + '</span>'
      + '</div>'
  }

  function buildPage(startR1, endR1, pageNum, isTopHalf) {
    const r1Slice = r1.slice(startR1, endR1)
    const finMatch = rounds[rounds.length - 1] && rounds[rounds.length - 1].matches[0]
    const champName = finMatch && (finMatch.winner || finMatch.matchPick) || '—'
    const halfLabel = isTopHalf ? 'Top half' : 'Bottom half'
    const champHTML = isTopHalf
      ? '<span style="font-family:monospace;font-size:7pt;color:#888;margin-left:16pt">Champion: </span>'
        + '<span style="font-family:\'Playfair Display\',Georgia,serif;font-size:10pt;font-weight:600;color:' + accent + '">' + escH(champName) + '</span>'
      : ''
    const header = '<div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:1.5pt solid ' + accent + ';padding-bottom:3pt;margin-bottom:4pt;flex-shrink:0">'
      + '<div>'
        + '<span style="font-family:\'Playfair Display\',Georgia,serif;font-size:15pt;font-weight:600;color:' + accent + '">' + escH((cfg.name || d.slam) + ' ' + d.year) + '</span>'
        + champHTML
      + '</div>'
      + '<span style="font-family:monospace;font-size:7pt;color:#888">' + escH(d.draw) + ' · ' + halfLabel + ' · ' + pageNum + ' / 2</span>'
      + '</div>'

    let labels = '<div style="display:flex;margin-bottom:2mm;flex-shrink:0;border-bottom:0.4pt solid #ddd;padding-bottom:2pt">'
    for (let ri = 0; ri < drawRounds; ri++) {
      if (ri > 0) labels += '<div style="width:' + gapW + 'mm;flex-shrink:0"></div>'
      labels += '<div style="width:' + colW[ri] + 'mm;flex-shrink:0;font-family:monospace;font-size:5.5pt;text-transform:uppercase;letter-spacing:0.1em;color:#999;text-align:center">' + escH(rounds[ri].label) + '</div>'
    }
    labels += '</div>'

    function r1Col() {
      let html = ''
      r1Slice.forEach((m, i) => {
        if (i > 0) {
          const g = startR1 + i
          const isQ = (g === q) || (g === half + q && !isTopHalf)
          html += isQ
            ? '<div style="height:' + (PAIR_GAP + 1.5) + 'mm;display:flex;align-items:center"><div style="flex:1;border-top:0.4pt dashed #c8c4bb"></div></div>'
            : '<div style="height:' + PAIR_GAP + 'mm"></div>'
        }
        html += nameLineHTML(m.p1, m) + nameLineHTML(m.p2, m)
      })
      return html
    }

    function laterCol(ri) {
      const startMi = Math.floor(startR1 / Math.pow(2, ri))
      const endMi = Math.ceil(endR1 / Math.pow(2, ri))
      const slice = rounds[ri] ? rounds[ri].matches.slice(startMi, endMi) : []
      const sh = slotH(ri).toFixed(2)
      const isLast = ri === drawRounds - 1
      let html = ''
      slice.forEach((m, i) => {
        if (i > 0) html += '<div style="height:' + PAIR_GAP + 'mm"></div>'
        const arm = isLast ? '' : (i % 2 === 0
          ? 'border-right:0.5pt solid #ccc;border-bottom:0.5pt solid #ccc;'
          : 'border-right:0.5pt solid #ccc;border-top:0.5pt solid #ccc;')
        html += '<div style="height:' + sh + 'mm;' + arm + 'display:flex;flex-direction:column;justify-content:center;padding-right:1pt">'
        html += nameLineHTML(m.p1, m) + nameLineHTML(m.p2, m)
        html += '</div>'
      })
      return html
    }

    let body = '<div style="display:flex;align-items:stretch;flex:1;min-height:0;overflow:hidden">'
    for (let ri = 0; ri < drawRounds; ri++) {
      if (ri > 0) body += '<div style="width:' + gapW + 'mm;flex-shrink:0"></div>'
      const col = ri === 0 ? r1Col() : laterCol(ri)
      const border = ri === 0 ? 'border-right:0.4pt solid #e0ddd8;' : ''
      body += '<div style="width:' + colW[ri] + 'mm;flex-shrink:0;' + border + '">' + col + '</div>'
    }
    body += '</div>'

    return '<div style="width:277mm;height:420mm;overflow:hidden;display:flex;flex-direction:column;page-break-after:always;box-sizing:border-box;padding:10mm 10mm 8mm;background:#fff">'
      + header + labels + body + '</div>'
  }

  const fonts = '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=DM+Mono&display=swap" rel="stylesheet">'
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + escH((cfg.name || d.slam) + ' ' + d.year + ' ' + d.draw) + '</title>' + fonts
    + '<style>@page{size:A3 portrait;margin:0}*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{background:#f0eeea}'
    + '@media screen{body{padding:8mm;display:flex;flex-direction:column;gap:8mm}div[style*="page-break"]{box-shadow:0 2px 16px rgba(0,0,0,0.15)}}'
    + '</style></head><body>'
    + buildPage(0, half, 1, true)
    + buildPage(half, total, 2, false)
    + '</body></html>'
}
