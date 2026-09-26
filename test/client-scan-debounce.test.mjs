import test from 'node:test'
import assert from 'node:assert/strict'

// issue #22 第 4 条:装饰扫描不能每条 mutation 都跑一遍全文档。
// 旧实现是 `new MutationObserver(() => { decorateMemeText(); decorateNavIcon() })`,
// 流式输出期间 mutation 密集,长会话(数千节点)下每次都要 createTreeWalker 走全篇 +
// 正则逐个文本节点,扫描会雪崩。改成 trailing 防抖 300ms + maxWait 1.2s 兜底。
//
// 这里钉住三件事:① 一串 mutation 只扫一次 ② mutation 不停时仍会在 maxWait 内扫
// (纯 trailing 防抖会被无限重排,页面从此不再扫描)③ 卸载后不再扫描、定时器已清。

let walkerCalls = 0
let observerCallback = null
let observerOptions = null
let disconnected = 0
let observing = false

globalThis.document = {
  head: { appendChild() {} },
  body: {},
  createElement: () => ({ textContent: '', style: {}, dataset: {}, setAttribute() {}, remove() {}, appendChild() {} }),
  createTreeWalker: () => { walkerCalls++; return { nextNode: () => null } },
  querySelector: () => null,
  querySelectorAll: () => [],
  createDocumentFragment: () => ({ appendChild() {} }),
  createTextNode: () => ({}),
}
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
// 假 observer:disconnect() 之后就真的不再投递(真实 DOM 也是这个语义),
// 否则「卸载后不再扫描」这条测的就不是插件,而是测试自己。
globalThis.MutationObserver = class {
  constructor(cb) { observerCallback = cb }
  observe(_target, options) { observing = true; observerOptions = options }
  disconnect() { observing = false; disconnected++ }
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
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, memes: [] }) })

await import('../client.js')

const effects = []
globalThis.__dshMeme.apply({ get: () => undefined, effect: (fn) => effects.push(fn) })
const dispose = effects.map((fn) => fn()).filter((fn) => typeof fn === 'function')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const mutation = (type = 'childList') => {
  if (!observing) return
  observerCallback([{ type, addedNodes: type === 'childList' ? [{}] : [], removedNodes: [] }])
}

test('mutation 成串到达时只扫一次(防抖,issue #22)', async () => {
  const before = walkerCalls
  const batch = walkerCalls
  for (let i = 0; i < 50; i++) mutation() // 同一个 tick 里 50 条,模拟流式输出的密集改动
  assert.equal(walkerCalls, before, 'observer 回调里不该同步扫描')
  await sleep(450)
  assert.equal(walkerCalls - batch, 1, '50 条 mutation 应合并成一次扫描')
})

test('mutation 持续不断时仍在 maxWait(1.2s)内扫一次,不会被无限重排', async () => {
  const before = walkerCalls
  const started = Date.now()
  for (let i = 0; i < 16; i++) { mutation(); await sleep(100) } // 每 100ms 一条,故意比防抖窗口还密
  const elapsed = Date.now() - started
  assert.ok(elapsed < 1200 + 600, '本轮应当没等太久')
  assert.ok(walkerCalls > before, '持续 mutation 期间必须至少扫过一次,否则 [表情: x] 会一路裸露且刷新也不自愈')
  await sleep(400)
  assert.ok(walkerCalls <= before + 3, '不该每条 mutation 都扫一遍(实测 ' + (walkerCalls - before) + ' 次/16 条)')
})

test('订阅里带 characterData(宿主原地改文本也要能装饰)', () => {
  assert.equal(observerOptions.childList, true)
  assert.equal(observerOptions.subtree, true)
  assert.equal(observerOptions.characterData, true)
})

test('卸载时清掉待触发的扫描定时器,断开后也不再投递', async () => {
  const before = walkerCalls
  mutation()                     // 排一次防抖扫描,但还没到点
  for (const fn of dispose) fn() // 到点之前卸载
  assert.ok(disconnected >= 1, '应断开 observer')
  await sleep(450)
  assert.equal(walkerCalls, before, '卸载时待触发的扫描定时器应被清掉')
  mutation()                     // disconnect 之后宿主不会再投递,这里模拟也不该生效
  await sleep(450)
  assert.equal(walkerCalls, before, '已卸载就不该再有扫描')
})
