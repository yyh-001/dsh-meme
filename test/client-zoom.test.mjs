import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 点图放大:点聊天里的图 → 全屏遮罩,滚轮缩放、双击复位、Esc 或点背景关闭。
 *
 * installMemeZoom 是纯函数(收 doc 参数、返回卸载函数),所以这里搭的是一个
 * 「能记录监听、能手动派发事件」的假 document,直接从 __test 里拿函数来喂,
 * 不用去骗 apply()。
 */

// ---------- 假 DOM ----------
let docListeners = []
const bodyEl = {
  tagName: 'BODY', style: {}, attrs: {}, children: [], textContent: '',
  appendChild(child) { child.parentNode = this; this.children.push(child); return child },
  removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parentNode = null; return child },
  setAttribute(k, v) { this.attrs[k] = String(v) },
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
  addEventListener() {}, removeEventListener() {},
}

const makeEl = (tag) => ({
  tagName: String(tag || '').toUpperCase(),
  style: {}, dataset: {}, attrs: {}, children: [], parentNode: null,
  textContent: '', src: '', alt: '', inFlow: false, _ls: [],
  appendChild(child) { child.parentNode = this; this.children.push(child); return child },
  removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parentNode = null; return child },
  setAttribute(k, v) { this.attrs[k] = String(v) },
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
  addEventListener(type, fn) { this._ls.push({ type, fn }) },
  removeEventListener(type, fn) { this._ls = this._ls.filter((l) => l.fn !== fn) },
  fire(type, event) { for (const l of this._ls.filter((l) => l.type === type)) l.fn(event) },
  // 认两个容器标记:老版 data-chat-flow / 新版 data-chat-flow-key
  closest(sel) { return this.inFlow && String(sel).includes('data-chat-flow') ? {} : null },
})

const docEl = {
  body: bodyEl,
  head: { appendChild() {} },
  documentElement: makeEl('html'),
  createElement: (tag) => makeEl(tag),
  createElementNS: (_ns, tag) => makeEl(tag),
  createTreeWalker: () => ({ nextNode: () => null }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(type, fn, capture) { docListeners.push({ type, fn, capture }) },
  removeEventListener(type, fn) { docListeners = docListeners.filter((l) => l.fn !== fn) },
}

const fireDoc = (type, event) => { for (const l of docListeners.filter((l) => l.type === type)) l.fn(event) }

globalThis.document = docEl
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.window = {
  location: { origin: 'http://localhost', href: '' },
  __ModuleLoader__: {
    load(def) {
      globalThis.__dshMeme = def.factory((name) => {
        if (name === 'react') {
          return {
            createElement: () => ({}), useState: (v) => [v, () => {}], useEffect: () => {},
            useRef: (v) => ({ current: v }), useSyncExternalStore: (_s, get) => get(),
          }
        }
        throw new Error('unexpected require: ' + name)
      })
    },
  },
}

await import('../client.js')
const { installMemeZoom } = globalThis.__dshMeme.__test

// ---------- 小工具 ----------
const imgInFlow = (src = 'http://localhost/dsh-memes/p/memes/happy/1.jpg', alt = '猫') => {
  const el = makeEl('img')
  el.inFlow = true
  el.src = src
  el.alt = alt
  return el
}
const imgOutside = () => { const el = makeEl('img'); el.src = 'http://localhost/other.png'; return el }
const evt = () => {
  const e = { key: '', deltaY: 0, defaultPrevented: false, stopped: false, target: null }
  e.preventDefault = () => { e.defaultPrevented = true }
  e.stopPropagation = () => { e.stopped = true }
  return e
}
const box = () => bodyEl.children.find((c) => c.getAttribute && c.getAttribute('data-meme-zoom') === '1')

beforeEach(() => {
  docListeners = []
  bodyEl.children = []
  delete docEl.__dshMemeZoom
})

test('① document 上抓到 click 与 keydown 两个捕获监听', () => {
  const dispose = installMemeZoom(docEl)
  assert.deepEqual(docListeners.map((l) => l.type).sort(), ['click', 'keydown'])
  assert.ok(docListeners.every((l) => l.capture === true), '必须走捕获阶段:聊天气泡自己也会拦事件')
  dispose()
})

test('② 点聊天流里的图:建遮罩、显示、填 src/alt,并吃掉这一下', () => {
  const dispose = installMemeZoom(docEl)
  const e = evt()
  e.target = imgInFlow()
  fireDoc('click', e)
  const b = box()
  assert.ok(b, '应建出遮罩')
  assert.equal(b.style.display, 'flex')
  assert.equal(b.children[0].src, 'http://localhost/dsh-memes/p/memes/happy/1.jpg')
  assert.equal(b.children[0].alt, '猫')
  assert.ok(e.defaultPrevented && e.stopped, '别让聊天区其它处理再吃到这一下')
  dispose()
})

test('③ 不在聊天流里的图一律不碰(输入框预览、面板缩略图)', () => {
  const dispose = installMemeZoom(docEl)
  const e = evt()
  e.target = imgOutside()
  fireDoc('click', e)
  assert.equal(box(), undefined, '不该建遮罩')
  assert.equal(e.defaultPrevented, false, '别人的点击别动')
  dispose()
})

test('④ Esc 关闭', () => {
  const dispose = installMemeZoom(docEl)
  const e = evt()
  e.target = imgInFlow()
  fireDoc('click', e)
  const b = box()
  const k = evt()
  k.key = 'Escape'
  fireDoc('keydown', k)
  assert.equal(b.style.display, 'none')
  dispose()
})

test('⑤ 点遮罩背景关闭', () => {
  const dispose = installMemeZoom(docEl)
  const e = evt()
  e.target = imgInFlow()
  fireDoc('click', e)
  const b = box()
  const click = evt()
  click.target = b
  b.fire('click', click)
  assert.equal(b.style.display, 'none')
  dispose()
})

test('⑥ 滚轮缩放,倍数钳在 0.4~6', () => {
  const dispose = installMemeZoom(docEl)
  const e = evt()
  e.target = imgInFlow()
  fireDoc('click', e)
  const b = box()
  const pic = b.children[0]
  const wheel = (dy) => { const w = evt(); w.deltaY = dy; b.fire('wheel', w); return pic.style.transform }
  assert.ok(wheel(-100).startsWith('scale(1.15'), '放大一档')
  for (let i = 0; i < 40; i++) wheel(-100)
  assert.equal(pic.style.transform, 'scale(6)', '上限 6 倍')
  for (let i = 0; i < 60; i++) wheel(100)
  assert.equal(pic.style.transform, 'scale(0.4)', '下限 0.4 倍')
  dispose()
})

test('⑦ 图片双击的两次 click 不关遮罩,随后 dblclick 复位', () => {
  const dispose = installMemeZoom(docEl)
  const e = evt()
  e.target = imgInFlow()
  fireDoc('click', e)
  const b = box()
  const w = evt()
  w.deltaY = -100
  b.fire('wheel', w)
  const click = evt()
  click.target = b.children[0]
  // 浏览器先派发两次 click,再派发 dblclick;图片上的事件会冒泡到遮罩。
  for (let i = 0; i < 2; i++) {
    fireDoc('click', click)
    b.fire('click', click)
    assert.equal(b.style.display, 'flex', '点图片应保持遮罩打开')
    assert.equal(b.children[0].style.transform, 'scale(1.15)', '单击不应复位缩放')
  }
  b.fire('dblclick', click)
  assert.equal(b.children[0].style.transform, 'scale(1)')
  assert.equal(b.style.display, 'flex', '双击复位后遮罩仍打开')
  dispose()
})

test('⑧ 重复装只装一份;卸载摘干净,还能再装回来', () => {
  const dispose = installMemeZoom(docEl)
  const again = installMemeZoom(docEl)
  assert.equal(docListeners.filter((l) => l.type === 'click').length, 1, '重复调用不该再挂一份监听')

  const e = evt()
  e.target = imgInFlow()
  fireDoc('click', e)
  assert.ok(box(), '开着的时候有遮罩')

  dispose()
  assert.equal(docListeners.length, 0, '卸载后监听要摘干净')
  assert.equal(box(), undefined, '卸载后遮罩要从 body 摘掉')
  assert.equal(docEl.__dshMemeZoom, undefined, '守卫标记要清掉,重新挂载时才能再装')

  again()
  const dispose2 = installMemeZoom(docEl)
  assert.equal(docListeners.length, 2, '重新挂载能再装一次')
  dispose2()
})
