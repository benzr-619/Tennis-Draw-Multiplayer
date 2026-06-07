// Minimal fake DOM so we can import the REAL bracket.js placeCard() in Node and
// capture the actual render decisions (card classes, row classes, names, labels).
class FakeEl {
  constructor(tag) {
    this.tag = tag
    this._class = ''
    this.style = new Proxy({ _css: '' }, {
      set(t, k, v) { t[k] = v; return true },
      get(t, k) { return t[k] },
    })
    this.dataset = {}
    this.textContent = ''
    this.children = []
    this.classList = {
      add: (c) => { this._class += (this._class ? ' ' : '') + c },
      remove: () => {},
      contains: (c) => this._class.split(' ').includes(c),
    }
  }
  get className() { return this._class }
  set className(v) { this._class = v }
  set cssText(v) {}
  appendChild(c) { this.children.push(c); return c }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  removeAttribute() {}
}
// The pick-confirm popup (#pick-confirm-modal etc.) is the only place the real
// code reads elements back via getElementById. Return stub elements for just
// those IDs (everything else stays null, so no other code path changes), and
// auto-fire the confirm button's click so showPickConfirm() resolves true —
// i.e. the harness "player" always confirms the repick, which is what the
// S6b scenario expects.
const _modalIds = ['pick-confirm-modal', 'pcm-name', 'pcm-confirm', 'pcm-cancel']
const _modalEls = new Map()
function getModalEl(id) {
  if (!_modalEls.has(id)) {
    const el = new FakeEl('div')
    if (id === 'pcm-confirm') el.addEventListener = (type, fn) => { if (type === 'click') setTimeout(fn, 0) }
    _modalEls.set(id, el)
  }
  return _modalEls.get(id)
}
const document = {
  createElement: (t) => new FakeEl(t),
  createElementNS: (_ns, t) => new FakeEl(t),
  getElementById: (id) => (_modalIds.includes(id) ? getModalEl(id) : null),
  body: new FakeEl('body'),
}
globalThis.document = document
globalThis.window = { addEventListener() {}, location: { href: '' } }
globalThis.Date = Date
export { FakeEl }
