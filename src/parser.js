// PDF parser — ported verbatim from reference app
// Used on the commissioner screen to parse TNNS Live draw PDFs

export async function extractPdfText(file) {
  const ab = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise
  let text = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i)
    const c = await pg.getTextContent()
    text += c.items.map(it => it.str).join(' ') + '\n'
  }
  return text
}

export function parseTnnsText(text) {
  const byPos = {}
  for (const line of text.split('\n')) {
    for (const e of [...line.matchAll(/(\d+)\s+(.*?)(?=\s+\d+\s+(?:[A-Z]|\d)|$)/g)]) {
      const pos = parseInt(e[1]); if (pos < 1 || pos > 128) continue
      let rest = e[2].trim(), seed = ''
      const sm = rest.match(/^(\d+)\s+(.+)$/)
      if (sm && parseInt(sm[1]) >= 1 && parseInt(sm[1]) <= 32) { seed = sm[1]; rest = sm[2].trim() }
      const mm = rest.match(/^(Q|WC|LL|PR)\s+(.+)$/); if (mm) { if (!seed) seed = mm[1]; rest = mm[2].trim() }
      const mm2 = rest.match(/^(Q|WC|LL|PR)\s+(.+)$/); if (mm2) { if (!seed) seed = mm2[1]; rest = mm2[2].trim() }
      rest = rest.replace(/^[A-Z]{2,4}\s+/, '')
      const nm = rest.match(/^([A-Z][A-Z\s\-\']+),\s*([A-Za-z][a-zA-Z\-]*)/)
      if (!nm) continue
      const last = nm[1].trim().split(/[\s\-]/).map(w => w[0] + w.slice(1).toLowerCase()).join(' ')
      byPos[pos] = { seed, name: last + ' ' + nm[2][0] + '.' }
    }
  }
  const matches = []
  for (let i = 1; i <= 128; i += 2) {
    const p1 = byPos[i] || { name: '', seed: '' }
    const p2 = byPos[i + 1] || { name: '', seed: '' }
    if (p1.name || p2.name) matches.push({ p1_name: p1.name, p1_seed: p1.seed, p2_name: p2.name, p2_seed: p2.seed })
  }
  return matches
}

export function buildInitialRounds(r1m) {
  const r1 = r1m.map((m, i) => ({
    p1: { name: m.p1_name || '', seed: m.p1_seed || '' },
    p2: { name: m.p2_name || '', seed: m.p2_seed || '' },
    pick: null, originalPick: null, winner: null, result: null, score: '',
  }))
  return r1  // Returns flat R1 array; DB insertion handled by commissioner.js
}
