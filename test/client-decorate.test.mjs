import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * issue #22 第 2、3 条(装饰侧的两个不变式):
 *
 * ② 把 [表情: x] 换成 <img> 之后气泡的 textContent 就变了。有些插件(注入记忆条那类)靠
 *    比对 textContent 判断「消息被改过」,于是重写 DOM → img 被打回文字 → 我们再装饰,
 *    来回打回闪个不停。修法:img 后面挂一个 display:none 的 ghost span 装回原文标记,
 *    整段 textContent 与替换前逐字一致;无命中降级成描述原文时也照挂。
 * ③ 流式渲染会覆盖注入,同一个 [表情: x] 可能被装饰两次 → 同一消息行两张相同的图。
 *    修法:按「消息行 + 描述」幂等去重。
 *
 * 这两个不变式都长在 textContent 上,所以这里搭了一个能算 textContent、能跑 TreeWalker
 * 的极小 DOM——比断言「调过某个函数」结实得多。
 */

// ---------- 极小 DOM:够 decorateMemeText 用就行 ----------
const dataKey = (k) => 'data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

class TextNode {
  constructor(value) {
    this.nodeType = 3
    this.nodeValue = value
    this.parentElement = null
  }
  get textContent() { return this.nodeValue }
}

class Element {
  constructor(tag) {
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this.childNodes = []
    this.parentElement = null
    this.style = {}
    this.attrs = {}
    // 真实 DOM 里 dataset 与 data-* 属性是同一份数据,这里用 Proxy 也保持同步
    // (deleteProperty 也要跟上:孤儿标记清理走的是 delete,见 issue #26)
    const self = this
    this.dataset = new Proxy({}, {
      get: (_t, k) => (typeof k === 'string' ? self.attrs[dataKey(k)] : undefined),
      set: (_t, k, v) => { self.attrs[dataKey(k)] = String(v); return true },
      has: (_t, k) => typeof k === 'string' && dataKey(k) in self.attrs,
      deleteProperty: (_t, k) => { delete self.attrs[dataKey(k)]; return true },
    })
  }
  get textContent() { return this.childNodes.map((c) => c.textContent).join('') }
  set textContent(v) {
    this.childNodes = []
    if (String(v) !== '') this.appendChild(new TextNode(String(v)))
  }
  get firstChild() { return this.childNodes[0] || null }
  get firstElementChild() { return this.childNodes.find((c) => c.nodeType === 1) || null }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  appendChild(child) { return this._insert(child, null) }
  insertBefore(child, ref) { return this._insert(child, ref) }
  replaceWith(el) { if (this.parentElement) this.parentElement.replaceChild(el, this) }
  _insert(child, ref) {
    if (child.nodeType === 11) { for (const c of child.childNodes.slice()) this._insert(c, ref); return child }
    if (child.parentElement) child.parentElement.removeChild(child)
    const i = ref ? this.childNodes.indexOf(ref) : -1
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, child)
    child.parentElement = this
    return child
  }
  replaceChild(frag, node) {
    const i = this.childNodes.indexOf(node)
    if (i < 0) return node
    const kids = frag.nodeType === 11 ? frag.childNodes.slice() : [frag]
    for (const c of kids) if (c.parentElement) c.parentElement.removeChild(c)
    this.childNodes.splice(i, 1, ...kids)
    for (const c of kids) c.parentElement = this
    node.parentElement = null
    return node
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child)
    if (i >= 0) this.childNodes.splice(i, 1)
    child.parentElement = null
    return child
  }
  remove() { if (this.parentElement) this.parentElement.removeChild(this) }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null }
  closest(sel) {
    let el = this
    while (el) { if (matches(el, sel)) return el; el = el.parentElement }
    return null
  }
  querySelectorAll(sel) {
    const out = []
    const walk = (el) => {
      for (const c of el.childNodes) {
        if (c.nodeType !== 1) continue
        if (matches(c, sel)) out.push(c)
        walk(c)
      }
    }
    walk(this)
    return out
  }
}

const matchesOne = (el, part) => {
  const m = /^([a-z]*)((?:\[[^\]]*\])*)$/i.exec(String(part).trim())
  if (!m) return false
  const [, tag, attrPart] = m
  if (tag && el.tagName !== tag.toUpperCase()) return false
  for (const a of attrPart.match(/\[[^\]]*\]/g) || []) {
    const inner = a.slice(1, -1)
    const eq = inner.indexOf('=')
    if (eq < 0) { if (el.getAttribute(inner) === null) return false; continue }
    if (el.getAttribute(inner.slice(0, eq)) !== inner.slice(eq + 1).replace(/^["']|["']$/g, '')) return false
  }
  return true
}
const matches = (el, sel) => String(sel).split(',').some((part) => matchesOne(el, part))

const body = new Element('body')
let navEl = null // decorateNavIcon 用 document.querySelector 取 nav,测试里从这里塞
globalThis.document = {
  head: { appendChild() {} },
  body,
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  createDocumentFragment: () => { const f = new Element('#fragment'); f.nodeType = 11; return f },
  createTextNode: (v) => new TextNode(String(v)),
  createTreeWalker(root, _what, { acceptNode }) {
    const all = []
    const walk = (el) => {
      for (const c of el.childNodes) {
        if (c.nodeType === 3) all.push(c)
        else if (c.nodeType === 1) walk(c)
      }
    }
    walk(root)
    let i = 0
    return { nextNode: () => { while (i < all.length) { const t = all[i++]; if (acceptNode(t) === 1) return t } return null } }
  },
  querySelector: (sel) => (sel === '[role="dialog"] nav' && navEl ? navEl : null),
  querySelectorAll: (sel) => body.querySelectorAll(sel),
}
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
globalThis.MutationObserver = class {
  constructor(cb) { globalThis.__moCb = cb }
  observe() {}
  disconnect() {}
}
globalThis.window = {
  location: { origin: 'http://localhost', href: '' },
  __ModuleLoader__: {
    load(def) {
      globalThis.__dshMeme = def.factory(() => ({
        Fragment: Symbol('Fragment'),
        createElement: () => ({}),
        useState: (v) => [v, () => {}],
        useEffect: () => {},
        useRef: (v) => ({ current: v }),
        useMemo: (fn) => fn(),
        useCallback: (fn) => fn,
      }))
    },
  },
}
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    ok: true,
    memes: [{ path: 'memes/happy/a.jpg', tag: 'happy', file_name: 'a.jpg', caption: '开心', keywords: '' }],
  }),
})

// ---------- 挂载插件 ----------
await import('../client.js')
globalThis.__dshMeme.apply({ get: () => undefined, effect: () => {} })
const drain = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await Promise.resolve() }
await drain() // 等索引拉回来 + 补装饰

const bubble = (marker) => {
  const flow = new Element('div')
  flow.setAttribute('data-chat-flow', '1')
  const row = new Element('div')
  row.setAttribute('data-time-hover-root', '1')
  const p = new Element('p')
  const text = new TextNode(marker)
  p.appendChild(text)
  row.appendChild(p)
  flow.appendChild(row)
  body.appendChild(flow)
  return { flow, row, p }
}
const scan = async () => {
  globalThis.__moCb([{ type: 'childList', addedNodes: [{}], removedNodes: [] }])
  await drain()
  await new Promise((ok) => setTimeout(ok, 350)) // 过防抖窗口(300ms)
  await drain()
}
const imgsIn = (el) => el.querySelectorAll('img[data-meme-img]')

test('② 装饰后气泡 textContent 与替换前逐字一致(ghost 原文)', async () => {
  const { row, p } = bubble('收到 [表情: 开心] 了')
  await scan()
  const imgs = imgsIn(row)
  assert.equal(imgs.length, 1, '应装饰出一张图')
  assert.equal(imgs[0].src, 'http://localhost/dsh-memes/memes/happy/a.jpg')
  assert.equal(imgs[0].dataset.memeImg, '开心', 'img 要带描述标记(去重用)')
  assert.equal(p.textContent, '收到 [表情: 开心] 了', 'textContent 必须与替换前完全一致,否则比对 textContent 的插件会打回')
  const ghost = p.querySelectorAll('span[data-meme-hidden]')[0]
  assert.ok(ghost, '应挂上 ghost span')
  assert.equal(ghost.style.cssText, 'display:none')
  assert.equal(ghost.textContent, '[表情: 开心]', 'ghost 里装原文标记')
})

test('② 无命中降级成描述原文时,textContent 同样不变', async () => {
  const { p } = bubble('[表情: 库里没有的描述]')
  await scan()
  assert.equal(p.textContent, '[表情: 库里没有的描述]', '降级后 textContent 仍要与替换前一致')
  assert.ok(p.textContent.includes('库里没有的描述'), '不该把 [表情: ] 标记裸露给用户')
  assert.equal(imgsIn(p).length, 0)
})

test('② ghost 不会被自己再装饰一遍(重复扫描不叠加)', async () => {
  const { row, p } = bubble('再来一张 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(row).length, 1)
  await scan()
  await scan()
  assert.equal(imgsIn(row).length, 1, 'ghost 里的标记不该被再装饰成图')
  assert.equal(p.textContent, '再来一张 [表情: 开心]')
})

test('③ 同一消息行里的重复图被幂等去重(流式竞态)', async () => {
  const { row, p } = bubble('双图 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(row).length, 1)
  // 模拟 React 覆盖注入后又装饰了一次:行里多出一张相同描述的图
  const dup = new Element('img')
  dup.setAttribute('src', 'http://localhost/dsh-memes/memes/happy/a.jpg')
  dup.dataset.memeImg = '开心'
  row.appendChild(dup)
  assert.equal(imgsIn(row).length, 2)
  await scan()
  assert.equal(imgsIn(row).length, 1, '同一行同描述的重复图应被去掉')
  await scan()
  assert.equal(imgsIn(row).length, 1, '去重必须幂等(没有重复时零副作用)')
  assert.equal(p.textContent, '双图 [表情: 开心]', '去重只摘图,不动 ghost/textContent')
})

test('③ 不同行里相同的图不算重复(各留各的)', async () => {
  const a = bubble('第一条 [表情: 开心]')
  const b = bubble('第二条 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(a.row).length, 1)
  assert.equal(imgsIn(b.row).length, 1, '两条消息各有一张,不该跨行去重')
})

test('④ 同一轮扫描里每条消息都要装饰,不能只看第一条', async () => {
  // acceptNode 里的判断以前用的是带 g 的 MEME_TEXT_RE.test():test() 会推进 lastIndex,
  // 下一个文本节点从上次命中的位置往后找 → 后面那些消息被静默跳过、一直不出图
  // (表现就是「表情有时显示不出来」,得等下一轮扫描碰巧把游标绕回 0)。
  const msgs = ['A [表情: 开心]', 'B [表情: 开心]', 'C [表情: 开心]'].map((m) => bubble(m))
  await scan()
  for (const [i, m] of msgs.entries()) {
    assert.equal(imgsIn(m.row).length, 1, '第 ' + (i + 1) + ' 条消息也该被装饰')
  }
})

test('⑤ 新版宿主的消息行标记(data-chat-flow-key)也认', async () => {
  // DSH 0.1.2 起消息行是 data-chat-flow-key(issue #22 附录,使用者实测);只认老标记
  // 的话新版上一个节点都扫不到,表情永不转图。
  const flow = new Element('div') // 老标记一个都不给
  const row = new Element('div')
  row.setAttribute('data-chat-flow-key', 'k1')
  const p = new Element('p')
  p.appendChild(new TextNode('新版 [表情: 开心]'))
  row.appendChild(p)
  flow.appendChild(row)
  body.appendChild(flow)
  await scan()
  assert.equal(imgsIn(row).length, 1, 'data-chat-flow-key 里也要能装饰并提到行首')
  assert.equal(p.textContent, '新版 [表情: 开心]')
})

// ---------- issue #26:宿主重渲染(textContent 覆写)后的自愈 ----------
// React 对纯文本 children 的更新走 textContent 覆写,注入的 img/ghost 被一起抹掉、原文
// 裸露;而 data-meme-decorated 在元素属性上不受覆写影响 → 旧逻辑见到标记就永久跳过,
// 图再也回不来,刷新页面才恢复。fake DOM 的 textContent setter 与 React 的 setTextContent
// 行为一致(整段换掉 children、属性保留),正好当覆写模拟器用。

test('⑥ 宿主覆写注入后要能自愈(img 已提到行首的几何)', async () => {
  const { row, p } = bubble('覆写 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(row).length, 1)
  p.textContent = '覆写 [表情: 开心]' // ghost 被抹、原文回来,标记还在
  assert.ok(p.getAttribute('data-meme-decorated'), '覆写不影响标记(这正是 bug 的一半)')
  await scan()
  assert.equal(imgsIn(row).length, 1, '重新装饰后与幸存图去重,仍是一张')
  assert.ok(p.querySelectorAll('span[data-meme-hidden]')[0], 'ghost 也回来了')
  assert.equal(p.textContent, '覆写 [表情: 开心]')
})

test('⑥ 装饰元素即消息行时(img 在标记元素里面),整块覆写也能自愈', async () => {
  // 使用者实测的指纹几何:消息行元素直接包着文本,decorated 元素 == row,img 也在它里面,
  // React 一覆写 img/ghost 一起没(issue #26 控制台指纹就是这种)。
  const flow = new Element('div')
  flow.setAttribute('data-chat-flow', '1')
  const row = new Element('div')
  row.setAttribute('data-chat-flow-key', 'k26')
  row.appendChild(new TextNode('行内 [表情: 开心]'))
  flow.appendChild(row)
  body.appendChild(flow)
  await scan()
  assert.equal(imgsIn(row).length, 1)
  row.textContent = '行内 [表情: 开心]' // img + ghost 一起被抹掉
  assert.equal(imgsIn(row).length, 0)
  await scan()
  assert.equal(imgsIn(row).length, 1, '孤儿标记被摘,图回来了')
  assert.ok(row.querySelectorAll('span[data-meme-hidden]')[0])
})

test('⑥ 降级装饰(无 img 只有 ghost)不算孤儿,不被反复重写', async () => {
  const { p } = bubble('[表情: 库里没有的描述]')
  await scan()
  const html = p.textContent
  const ghosts = p.querySelectorAll('span[data-meme-hidden]').length
  assert.ok(ghosts >= 2, '方括号各自藏在 ghost 里')
  await scan()
  await scan()
  assert.equal(p.querySelectorAll('span[data-meme-hidden]').length, ghosts, '清理条件必须连 ghost 一起看,否则降级结构每轮被重写')
  assert.equal(p.textContent, html)
})

test('⑥ 设置侧栏笑脸被宿主覆写后也能自愈', async () => {
  const nav = new Element('nav')
  const btn = new Element('button')
  btn.appendChild(new Element('i')) // 宿主自己的齿轮图标
  btn.appendChild(new TextNode('表情包'))
  nav.appendChild(btn)
  navEl = nav
  await scan()
  const smile = btn.querySelector('svg[data-meme-nav-icon]')
  assert.ok(smile, '齿轮应被换成笑脸,svg 要带 data-meme-nav-icon 标记')
  btn.textContent = '表情包' // 面板重渲染:注入没了,btn 上的标记还在
  assert.equal(btn.querySelector('svg[data-meme-nav-icon]'), null)
  btn.appendChild(new Element('i')) // 宿主把自己的图标又挂回来了
  btn.appendChild(new TextNode('表情包'))
  await scan()
  assert.ok(btn.querySelector('svg[data-meme-nav-icon]'), '笑脸恢复')
  assert.equal(btn.querySelectorAll('svg').length, 1, '不该出现两个图标')
  // 「没得换」的按钮(图标是 IMG)标记是 skip,不该被清理反复摘
  const imgBtn = new Element('button')
  imgBtn.appendChild(new Element('img'))
  imgBtn.appendChild(new TextNode('表情包'))
  nav.appendChild(imgBtn)
  await scan()
  assert.equal(imgBtn.getAttribute('data-meme-nav'), 'skip')
  await scan()
  assert.equal(imgBtn.getAttribute('data-meme-nav'), 'skip', 'skip 档稳定,不被清理扰动')
  navEl = null
})
