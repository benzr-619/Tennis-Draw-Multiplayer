// Shared helpers between bracket.js and viewer-bracket.js card painters.

// ESPN score strings mark the server with a literal '*' (e.g. "5*-3") — render it as
// a small dot at the top-right of the preceding digit instead of the raw character.
export function appendScoreWithServeDot(el, scoreStr) {
  const parts = scoreStr.split('*')
  parts.forEach((part, i) => {
    el.appendChild(document.createTextNode(part))
    if (i < parts.length - 1) {
      const dot = document.createElement('span')
      dot.className = 'mc-serve-dot'
      el.appendChild(dot)
    }
  })
}
