// PDF parser — ported verbatim from reference app
// Used on the commissioner screen to parse TNNS Live draw PDFs

import { isPlaceholderName } from './player-names.js'

const _PDF_SRC    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const _PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
let _pdfJsPromise = null

function ensurePdfJs() {
  if (window.pdfjsLib) return Promise.resolve()
  if (_pdfJsPromise) return _pdfJsPromise
  _pdfJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = _PDF_SRC
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = _PDF_WORKER; resolve() }
    s.onerror = () => reject(new Error('Failed to load pdf.js'))
    document.head.appendChild(s)
  })
  return _pdfJsPromise
}

export async function extractPdfText(file) {
  await ensurePdfJs()
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
      const countryM = rest.match(/^([A-Z]{2,4})\s+/)
      const country = countryM ? countryM[1] : ''
      rest = rest.replace(/^[A-Z]{2,4}\s+/, '')
      // An unfilled slot (qualifying not yet complete, or a bye) has no "LAST, First"
      // name to parse. Record it as a position-keyed placeholder instead of dropping
      // it — see .claude/rules/qualifiers.md for why identity is position-keyed.
      // Matched as a PREFIX, not an exact string: TNNS PDFs can carry stray layout
      // text (e.g. a "CHAMPION"/trophy label positioned near the bracket's center)
      // that the outer capture regex swallows onto the same entry when it has no
      // digit to stop the non-greedy match at — confirmed live on the 2026 US Open
      // men's draw, where position 61 parsed as "QUALIFIER CHAMPION".
      if (/^(QUALIFIER|BYE)\b/.test(rest.trim())) {
        byPos[pos] = { seed, name: `Qualifier ${pos}`, country: '' }
        continue
      }
      const nm = rest.match(/^([A-Z][A-Z\s\-\']+),\s*([A-Za-z][a-zA-Z\-]*)/)
      if (!nm) continue
      const last = nm[1].trim().split(/[\s\-]/).map(w => w[0] + w.slice(1).toLowerCase()).join(' ')
      byPos[pos] = { seed, name: nm[2].trim() + ' ' + last, country }
    }
  }
  const matches = []
  for (let i = 1; i <= 128; i += 2) {
    const p1 = byPos[i] || { name: '', seed: '' }
    const p2 = byPos[i + 1] || { name: '', seed: '' }
    // Always push, even when both sides are empty — matches is a flat array whose
    // index maps directly to bracket position; dropping one here would silently
    // shift every subsequent match into the wrong slot (see .claude/rules/qualifiers.md).
    matches.push({ p1_name: p1.name, p1_seed: p1.seed, p1_country: p1.country || '', p2_name: p2.name, p2_seed: p2.seed, p2_country: p2.country || '' })
  }
  return matches
}

// Shared shape check for a parsed R1 match array — used both for a brand-new draw
// upload and for a re-upload diffed against a stored draw (.claude/rules/qualifiers.md).
// Returns { ok: true, placeholderCount } or { ok: false, error }.
export function validateParsedDraw(matches) {
  if (!matches || matches.length === 0) {
    return { ok: false, error: 'No matches found. Is this a TNNS Live draw PDF?' }
  }
  if (matches.length !== 64) {
    return { ok: false, error: `Expected 64 R1 matches, got ${matches.length}. Refusing to load a corrupt parse — is this a full 128-player draw PDF?` }
  }
  const positionsSeen = matches.filter(m => m.p1_name).length + matches.filter(m => m.p2_name).length
  if (positionsSeen !== 128) {
    return { ok: false, error: `Expected 128 filled positions, got ${positionsSeen}. Some slots parsed empty — check the PDF text extraction.` }
  }
  const placeholderCount = matches.reduce((n, m) =>
    n + (isPlaceholderName(m.p1_name) ? 1 : 0) + (isPlaceholderName(m.p2_name) ? 1 : 0), 0)
  return { ok: true, placeholderCount }
}

export function buildInitialRounds(r1m) {
  const r1 = r1m.map((m, i) => ({
    p1: { name: m.p1_name || '', seed: m.p1_seed || '' },
    p2: { name: m.p2_name || '', seed: m.p2_seed || '' },
    pick: null, originalPick: null, winner: null, result: null, score: '',
  }))
  return r1  // Returns flat R1 array; DB insertion handled by commissioner.js
}
