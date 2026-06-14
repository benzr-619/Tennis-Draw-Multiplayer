// Mobile round-list renderer — companion to bracket-layout.js for narrow viewports.
// Renders one round's matches as a vertical list using the same placeCard callback,
// so all card painting logic (picks, odds, elim labels, backup glow) is identical to desktop.
// Consecutive match pairs are wrapped in .mc-pair with a bracket connector arm on the right.
// Section dividers (Q2 / Bottom Half / Q4) mirror the desktop bracket separators.

// Returns a map of match-index → {label, dashed} for section dividers in a round of `total` matches.
function _buildSectionDividers(total) {
  if (total < 16) return new Map()
  const half = Math.ceil(total / 2)
  const divs = new Map()
  divs.set(half, { label: 'Bottom Half', dashed: false })
  if (total >= 32) {
    const q = Math.ceil(total / 4)
    divs.set(q, { label: 'Q2', dashed: true })
    divs.set(half + q, { label: 'Q4', dashed: true })
  }
  return divs
}

export function renderBracketList(draw, ri, body, placeCard) {
  body.innerHTML = ''
  if (!draw?.rounds?.length) {
    body.innerHTML = `<div class="bracket-empty">
      <div class="bracket-empty-icon">🎾</div>
      <div class="bracket-empty-title">No draw uploaded yet.</div>
      <div class="bracket-empty-sub">The commissioner will upload the draw when it's available.</div>
    </div>`
    return
  }
  const round = draw.rounds[ri]
  if (!round) return

  const withPlayers = round.matches.filter(m => m.p1?.name || m.p2?.name).length
  const hdr = document.createElement('div')
  hdr.className = 'bl-round-hdr'
  hdr.textContent = `${round.label}${withPlayers ? ' · ' + withPlayers + ' match' + (withPlayers !== 1 ? 'es' : '') : ''}`
  body.appendChild(hdr)

  function _placeInItem(m, mi, item, posClass) {
    item.className = 'mc-list-item' + (posClass ? ' ' + posClass : '')
    placeCard(draw, m, ri, mi, 0, 0, item)
    const card = item.querySelector('.mc')
    if (card) {
      card.style.position = 'relative'
      card.style.left = ''
      card.style.top = ''
      card.style.width = '100%'
    }
  }

  const matches = round.matches
  const sectionDividers = _buildSectionDividers(matches.length)
  let i = 0

  while (i < matches.length) {
    // Insert section divider before this match index if defined
    if (sectionDividers.has(i)) {
      const { label, dashed } = sectionDividers.get(i)
      const div = document.createElement('div')
      div.className = 'bl-section-divider' + (dashed ? ' dashed' : '')
      div.innerHTML = `<div class="bl-sdiv-line"></div><span class="bl-sdiv-lbl">${label}</span><div class="bl-sdiv-line"></div>`
      body.appendChild(div)
    }

    if (i + 1 < matches.length) {
      // Pair: wrap two consecutive matches with a bracket connector arm
      const pair = document.createElement('div')
      pair.className = 'mc-pair'
      body.appendChild(pair)

      const topItem = document.createElement('div')
      _placeInItem(matches[i], i, topItem, 'mc-pair-top')
      pair.appendChild(topItem)

      const botItem = document.createElement('div')
      _placeInItem(matches[i + 1], i + 1, botItem, 'mc-pair-bot')
      pair.appendChild(botItem)

      const conn = document.createElement('div')
      conn.className = 'mc-pair-connector'
      pair.appendChild(conn)

      i += 2
    } else {
      // Standalone (odd-length round, e.g. Final has 1 match)
      const item = document.createElement('div')
      body.appendChild(item)
      _placeInItem(matches[i], i, item, null)
      i++
    }
  }

  // Position each connector using measured card midpoints after layout is painted
  requestAnimationFrame(() => {
    body.querySelectorAll('.mc-pair').forEach(pair => {
      const topCard = pair.querySelector('.mc-pair-top .mc')
      const botCard = pair.querySelector('.mc-pair-bot .mc')
      const conn = pair.querySelector('.mc-pair-connector')
      if (!topCard || !botCard || !conn) return
      const pairRect = pair.getBoundingClientRect()
      const tRect = topCard.getBoundingClientRect()
      const bRect = botCard.getBoundingClientRect()
      const topMid = tRect.top + tRect.height / 2 - pairRect.top
      const botMid = bRect.top + bRect.height / 2 - pairRect.top
      conn.style.top = topMid + 'px'
      conn.style.height = (botMid - topMid) + 'px'
    })
  })
}
