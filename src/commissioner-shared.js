// Shared helpers for the commissioner screen modules.
// Split out 2026-06-01 (audit part E) so commissioner-draw/results/locks can share them.

export function $c(id) { return document.getElementById(id) }

export function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
