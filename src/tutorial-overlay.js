// Tutorial coach-mark overlay — a single fixed tooltip, pinned to the same spot
// (vertically centered, right side of the viewport) for every step. Earlier versions
// tried to move/point the tooltip at whatever each step was discussing (an arrow
// following a target element, or sliding around the bracket to dodge overlapping
// match cards) — found that the jumping around between steps was itself confusing,
// worse than just not pointing at anything. A fixed spot is simple and predictable:
// the player always knows where to look for the next instruction. No dimming/
// spotlight either — an earlier version drew a dark cutout (or a thin ring) around
// a target, but any fixed highlight rect has to bound ALL relevant visual content,
// including things that overflow their own element's box (e.g. the displaced-pick
// label that floats above a match card via a negative offset — see
// .claude/rules/bracket-rendering.md). See .claude/rules/tutorial.md.

let _tooltip = null

function _ensureEl() {
  if (_tooltip) return _tooltip
  _tooltip = document.createElement('div')
  _tooltip.className = 'tutorial-tooltip tutorial-pinned'
  document.body.appendChild(_tooltip)
  return _tooltip
}

/**
 * Renders one coach-mark step. Call again (same tooltip element reused) to advance —
 * no accumulation, no teardown/rebuild needed between steps.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.body           plain text or a small HTML snippet (mockup)
 * @param {number} opts.index          0-based step index, for the progress dots
 * @param {number} opts.total
 * @param {string} [opts.primaryLabel] defaults to 'Next' (or 'Done' on the last step)
 * @param {Function} opts.onPrimary
 * @param {Function} [opts.onBack]     omit to hide the Back button
 * @param {Function} opts.onSkip
 * @param {boolean} [opts.primaryDisabled] true = render the primary button (still
 *   labeled Next/Done as normal) greyed out and inert until setPrimaryReady() is called.
 */
export function renderTutorialStep(opts) {
  const tooltip = _ensureEl()
  const { title, body, index, total, primaryLabel, onPrimary, onBack, onSkip, primaryDisabled = false } = opts

  tooltip.innerHTML = `
    <button class="tutorial-close" title="Close tutorial">×</button>
    <div class="tutorial-tooltip-title"></div>
    <div class="tutorial-tooltip-body"></div>
    <div class="tutorial-controls">
      <div class="tutorial-dots">${Array.from({ length: total }, (_, i) =>
        `<span class="tutorial-dot${i === index ? ' active' : ''}"></span>`).join('')}</div>
      <div class="tutorial-btn-row">
        ${onBack ? '<button class="tutorial-btn tutorial-btn-ghost tutorial-back-btn">Back</button>' : ''}
        <button class="tutorial-btn tutorial-next-btn"></button>
      </div>
    </div>`

  tooltip.querySelector('.tutorial-tooltip-title').textContent = title
  const bodyEl = tooltip.querySelector('.tutorial-tooltip-body')
  if (opts.bodyHTML) bodyEl.innerHTML = opts.bodyHTML
  else bodyEl.textContent = body

  const nextBtn = tooltip.querySelector('.tutorial-next-btn')
  nextBtn.classList.add(primaryDisabled ? 'tutorial-btn-ghost' : 'tutorial-btn-primary')
  nextBtn.disabled = primaryDisabled
  nextBtn.textContent = primaryLabel || (index === total - 1 ? 'Done' : 'Next')
  nextBtn.addEventListener('click', onPrimary)
  tooltip.querySelector('.tutorial-close').addEventListener('click', onSkip)
  if (onBack) tooltip.querySelector('.tutorial-back-btn').addEventListener('click', onBack)
}

/** Unlocks a gated primary button (rendered with primaryDisabled: true) in place — label stays whatever it already was (Next/Done), only the enabled state changes. */
export function setPrimaryReady() {
  if (!_tooltip) return
  const btn = _tooltip.querySelector('.tutorial-next-btn')
  if (!btn) return
  btn.disabled = false
  btn.classList.remove('tutorial-btn-ghost')
  btn.classList.add('tutorial-btn-primary')
}

export function removeTutorialOverlay() {
  if (!_tooltip) return
  _tooltip.remove()
  _tooltip = null
}
