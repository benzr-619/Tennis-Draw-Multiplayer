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
  setAttribute() {}
  removeAttribute() {}
}
const document = {
  createElement: (t) => new FakeEl(t),
  createElementNS: (_ns, t) => new FakeEl(t),
  getElementById: () => null,
  body: new FakeEl('body'),
}
globalThis.document = document
globalThis.window = { addEventListener() {}, location: { href: '' } }
globalThis.Date = Date
export { FakeEl }
