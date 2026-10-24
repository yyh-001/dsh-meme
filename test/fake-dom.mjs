/**
 * 装饰 / 增量扫描测试共用的极小假 DOM。
 *
 * 和之前各测试文件里那份「只会算 textContent 的 DOM」相比,这一份多做三件事,
 * 目的都是让 mutation 记录走真实语义、不再手搓 synthetic record:
 *
 *   1. 每一次真实的 DOM 改动(appendChild / insertBefore / replaceChild /
 *      removeChild / textContent 覆写)都会产出一条 MutationRecord 形状的日志:
 *      { type:'childList', target:父元素, addedNodes, removedNodes }
 *      { type:'characterData', target:文本节点, addedNodes:[], removedNodes:[] }
 *      —— 装饰完自己产生的改动也会进日志,跟真实 MutationObserver 一样。
 *   2. node.isConnected 按「是否挂在 document.body 下面」计算,增量扫描靠它过滤
 *      已经被摘掉的节点。
 *   3. createTreeWalker(root) 支持任意子树(全量扫描走 body、增量扫描走新增子树),
 *      并统计每次 walker 的根与时刻,让测试能区分「全量扫了一遍」和「只扫了新增部分」。
 *
 * 用法:
 *   const dom = installFakeDom({ fetch: ... })
 *   const effects = await mountPlugin({ collectEffects: true })   // 内部 import ../client.js
 *   // 改 DOM → const records = dom.takeMutations() → dom.emit(records)
 *   // 未消费的日志会一直累积,下一轮 takeMutations() 一并取走,这与 observer 批量投递一致。
 */

export const dataKey = (k) => 'data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

let bodyEl = null

const FILTER_ACCEPT = 1

const isConnected = (node) => {
  let el = node
  while (el) {
    if (el === bodyEl) return true
    el = el.parentElement
  }
  return false
}

// ---- 选择器:只支持装饰代码真正用到的形式(标签、[attr]、[attr="v"]、逗号分组) ----
const matchesOne = (el, part) => {
  const m = /^([a-z]*)((?:\[[^\]]*\])*)$/i.exec(String(part).trim())
  if (!m) return false
  const [, tag, attrPart] = m
  if (tag && el.tagName !== tag.toUpperCase()) return false
  for (const a of attrPart.match(/\[[^\]]*\]/g) || []) {
    const inner = a.slice(1, -1)
    const eq = inner.indexOf('=')
    if (eq < 0) { if (el.getAttribute(inner) === null) return false; continue }
    const want = inner.slice(eq + 1).replace(/^["']|["']$/g, '')
    if (el.getAttribute(inner.slice(0, eq)) !== want) return false
  }
  return true
}
const matchesSelector = (el, sel) => String(sel).split(',').some((part) => matchesOne(el, part))

// ---- mutation 日志:只有 target 挂在 body 下时 observer 才看得到 ----
const mutationLog = []
const pushMutation = (record) => { mutationLog.push(record) }

// ---- 观测统计 ----
export const walkerStats = {
  calls: 0,
  records: [], // { root, at }:每建一个 TreeWalker 记一条
  get bodyCalls() { return this.records.filter((r) => r.root === bodyEl).length },
  reset() { this.calls = 0; this.records = [] },
}

export const observerStats = {
  options: null,
  disconnects: 0,
  instances: [],
  reset() { this.options = null; this.disconnects = 0 },
}

const liveObservers = new Set()
class FakeMutationObserver {
  constructor(cb) { this.cb = cb; this.active = false; observerStats.instances.push(this) }
  observe(_target, options) { this.active = true; observerStats.options = options; liveObservers.add(this) }
  disconnect() { this.active = false; observerStats.disconnects++; liveObservers.delete(this) }
  takeRecords() { return [] }
}

export function emitMutations(records) {
  for (const observer of [...liveObservers]) if (observer.active) observer.cb(records)
}

// ---- 节点 ----
export class TextNode {
  constructor(value) {
    this.nodeType = 3
    this._value = String(value)
    this.parentElement = null
  }
  get isConnected() { return isConnected(this) }
  get nodeValue() { return this._value }
  set nodeValue(v) {
    const next = String(v)
    if (next === this._value) return
    this._value = next
    if (this.isConnected) pushMutation({ type: 'characterData', target: this, addedNodes: [], removedNodes: [] })
  }
  get textContent() { return this._value }
  set textContent(v) { this.nodeValue = v }
}

export class Element {
  constructor(tag) {
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this.childNodes = []
    this.parentElement = null
    this.style = {}
    this.attrs = {}
    // dataset 与 data-* 同一份数据;孤儿标记清理走 delete,所以 deleteProperty 也要跟上
    const self = this
    this.dataset = new Proxy({}, {
      get: (_t, k) => (typeof k === 'string' ? self.attrs[dataKey(k)] : undefined),
      set: (_t, k, v) => { self.attrs[dataKey(k)] = String(v); return true },
      has: (_t, k) => typeof k === 'string' && dataKey(k) in self.attrs,
      deleteProperty: (_t, k) => { delete self.attrs[dataKey(k)]; return true },
    })
  }
  get isConnected() { return isConnected(this) }
  get textContent() { return this.childNodes.map((c) => c.textContent).join('') }
  set textContent(v) {
    const next = String(v)
    const oldKids = this.childNodes.slice()
    if (oldKids.length === 0 && next === '') return
    for (const c of oldKids) c.parentElement = null
    this.childNodes = []
    const added = []
    if (next !== '') {
      const t = new TextNode(next)
      t.parentElement = this
      this.childNodes.push(t)
      added.push(t)
    }
    // React 的 textContent 覆写:一整批换 children,元素上的属性(dataset)原样保留
    if (this.isConnected) pushMutation({ type: 'childList', target: this, addedNodes: added, removedNodes: oldKids })
  }
  get firstChild() { return this.childNodes[0] || null }
  get firstElementChild() { return this.childNodes.find((c) => c.nodeType === 1) || null }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null }
  matches(sel) { return matchesSelector(this, sel) }
  closest(sel) {
    let el = this
    while (el) { if (matchesSelector(el, sel)) return el; el = el.parentElement }
    return null
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  querySelectorAll(sel) {
    const out = []
    const walk = (el) => {
      for (const c of el.childNodes) {
        if (c.nodeType !== 1) continue
        if (matchesSelector(c, sel)) out.push(c)
        walk(c)
      }
    }
    walk(this)
    return out
  }
  appendChild(child) { return this._insert(child, null) }
  insertBefore(child, ref) { return this._insert(child, ref) }
  _insert(node, ref) {
    const kids = node.nodeType === 11 ? node.childNodes.slice() : [node]
    for (const c of kids) if (c.parentElement) c.parentElement.removeChild(c)
    const i = ref ? this.childNodes.indexOf(ref) : -1
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, ...kids)
    for (const c of kids) c.parentElement = this
    if (kids.length > 0 && this.isConnected) {
      pushMutation({ type: 'childList', target: this, addedNodes: kids.slice(), removedNodes: [] })
    }
    return node
  }
  replaceChild(node, old) {
    const i = this.childNodes.indexOf(old)
    if (i < 0) return old
    const kids = node.nodeType === 11 ? node.childNodes.slice() : [node]
    for (const c of kids) if (c.parentElement && c.parentElement !== this) c.parentElement.removeChild(c)
    this.childNodes.splice(i, 1, ...kids)
    for (const c of kids) c.parentElement = this
    old.parentElement = null
    // 真实 MutationRecord:replaceChild(fragment, old) 记为「加了 fragment 的子节点、删了 old」
    if (this.isConnected) pushMutation({ type: 'childList', target: this, addedNodes: kids.slice(), removedNodes: [old] })
    return old
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child)
    if (i >= 0) this.childNodes.splice(i, 1)
    child.parentElement = null
    if (i >= 0 && this.isConnected) pushMutation({ type: 'childList', target: this, addedNodes: [], removedNodes: [child] })
    return child
  }
  remove() { if (this.parentElement) this.parentElement.removeChild(this) }
  replaceWith(el) { if (this.parentElement) this.parentElement.replaceChild(el, this) }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null }
  hasAttribute(k) { return k in this.attrs }
  removeAttribute(k) { delete this.attrs[k] }
}

// 图片属性:代码里是 img.src = ... / img.loading = 'lazy' 这种反射赋值
for (const prop of ['src', 'alt', 'title', 'loading', 'decoding']) {
  Object.defineProperty(Element.prototype, prop, {
    get() { return prop in this.attrs ? this.attrs[prop] : '' },
    set(v) { this.attrs[prop] = String(v) },
  })
}

// ---- document / window ----
const defaultFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, memes: [] }),
})

const drain = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await Promise.resolve() }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const makeReact = () => ({
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
})

export function installFakeDom(options = {}) {
  bodyEl = new Element('body')
  const headEl = new Element('head')
  const state = {
    nav: options.nav || null,             // decorateNavIcon 用 document.querySelector('[role="dialog"] nav') 取
    fetch: options.fetch || defaultFetch,
    querySelector: options.querySelector || null,
  }
  const walkerRoots = () => walkerStats.records.map((r) => r.root)

  globalThis.document = {
    head: headEl,
    body: bodyEl,
    createElement: (tag) => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag),
    createDocumentFragment: () => { const f = new Element('#fragment'); f.nodeType = 11; return f },
    createTextNode: (v) => new TextNode(String(v)),
    createTreeWalker(root, _what, filter) {
      walkerStats.calls++
      walkerStats.records.push({ root, at: Date.now() })
      const texts = []
      const walk = (el) => {
        for (const c of el.childNodes || []) {
          if (c.nodeType === 3) texts.push(c)
          else if (c.nodeType === 1) walk(c)
        }
      }
      walk(root)
      let i = 0
      return {
        nextNode() {
          while (i < texts.length) {
            const node = texts[i++]
            if (!filter || typeof filter.acceptNode !== 'function') return node
            if (filter.acceptNode(node) === FILTER_ACCEPT) return node
          }
          return null
        },
      }
    },
    querySelector: (sel) => (state.querySelector ? state.querySelector(sel) : (sel === '[role="dialog"] nav' && state.nav ? state.nav : null)),
    querySelectorAll: (sel) => bodyEl.querySelectorAll(sel),
  }
  globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.window = {
    location: { origin: 'http://localhost', href: '' },
    __ModuleLoader__: { load(def) { globalThis.__dshMeme = def.factory(() => makeReact()) } },
  }
  globalThis.fetch = (...args) => state.fetch(...args)
  // 兼容旧测试直接调用 __moCb;新测试建议用 dom.emit()/dom.takeMutations()
  globalThis.__moCb = (records) => emitMutations(records)

  const dom = {
    body: bodyEl,
    head: headEl,
    state,
    Element,
    TextNode,
    walkerStats,
    observerStats,
    emit: emitMutations,
    takeMutations: () => mutationLog.splice(0),
    peekMutations: () => mutationLog.slice(),
    walkerRoots,
    drain,
    sleep,
    reset() {
      for (const child of bodyEl.childNodes) child.parentElement = null
      bodyEl.childNodes = []
      mutationLog.length = 0
      walkerStats.reset()
    },
  }
  return dom
}

/**
 * 挂载插件(import 只发生一次)。返回 ctx.effect 收集到的回调数组:
 *   const disposers = effects.map((fn) => fn()).filter((fn) => typeof fn === 'function')
 * 装饰用例大多不关心卸载,可以 collectEffects=false(默认,不调用也不收集)。
 */
export async function mountPlugin({ collectEffects = false } = {}) {
  const effects = []
  await import('../client.js')
  globalThis.__dshMeme.apply({
    get: () => undefined,
    effect: (fn) => { if (collectEffects) effects.push(fn) },
  })
  return effects
}
