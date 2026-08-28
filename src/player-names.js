// Placeholder player names for draw slots not yet filled (QUALIFIER/BYE entries
// from TNNS PDFs, before qualifying finishes). See .claude/rules/qualifiers.md.
//
// Identity (what's stored: picks.match_pick etc.) is always the position-keyed
// name `Qualifier <position>` — two empty slots in the same match need distinct
// names or picks naming them would be ambiguous. Display is separate: players
// should only ever see "Qualifier", never the position number.

const PLACEHOLDER_RE = /^Qualifier \d+$/

export function isPlaceholderName(name) {
  return PLACEHOLDER_RE.test(name || '')
}

export function displayName(name) {
  return isPlaceholderName(name) ? 'Qualifier' : name
}
