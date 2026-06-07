// Animate a sliding "thumb" pill behind a segmented control's buttons.
// container  — the flex row (position:relative) whose direct children are <button>s
// oldIdx     — previously selected index; -1 on first render (no animation, just place)
// newIdx     — newly selected index
export function animateSegThumb(container, oldIdx, newIdx) {
  const buttons = Array.from(container.querySelectorAll(':scope > button'))
  if (!buttons.length || newIdx < 0 || newIdx >= buttons.length) return

  const thumb = document.createElement('div')
  thumb.className = 'seg-thumb'
  container.insertBefore(thumb, container.firstChild)

  const fromIdx = (oldIdx >= 0 && oldIdx < buttons.length) ? oldIdx : newIdx
  const fromBtn = buttons[fromIdx]
  const toBtn   = buttons[newIdx]

  // Place at old position with no transition
  thumb.style.transition = 'none'
  thumb.style.left  = fromBtn.offsetLeft  + 'px'
  thumb.style.width = fromBtn.offsetWidth + 'px'

  // Slide to new position
  requestAnimationFrame(() => {
    thumb.style.transition = 'left 0.22s cubic-bezier(0.35,0,0.25,1), width 0.22s cubic-bezier(0.35,0,0.25,1)'
    thumb.style.left  = toBtn.offsetLeft  + 'px'
    thumb.style.width = toBtn.offsetWidth + 'px'
  })
}
