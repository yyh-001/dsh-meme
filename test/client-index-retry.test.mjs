import test from 'node:test'
import assert from 'node:assert/strict'

// issue #22 第 1 条:索引拉取失败后必须还能重试。
// 旧实现把失败也写成 `memeIndex = new Map()` 兜底,而入口守卫是
// `if (memeIndex || memeIndexLoading) return`——空 Map 也是真值,于是守卫永久拦住重试,
// 该会话剩下的 [表情: x] 全部退化成描述文字(无报错、无提示,只能刷新恢复)。
// 这条回归测试就是钉住「失败后还能再拉起来」:失败 → 冷却 → 重试 → 恢复装饰。

// ---- 时间可控:冷却/退避都看 Date.now,直接推到未来,不必真等 ----
const realNow = Date.now
let skew = 0
Date.now = () => realNow() + skew
const advance = (ms) => { skew += ms }

// ---- 假 DOM:只实现 decorateMemeText 真正用到的那几样 ----
let walkerCalls = 0
const textNode = { nodeValue: '[表情: 开心]' }
const parent = {
  dataset: {},
  closest: (sel) => (sel === '[data-chat-flow]' ? parent : null),
  replaceChild(frag, node) { this.replaced = { frag, node } },
}
textNode.parentElement = parent

globalThis.document = {
  head: { appendChild() {} },
  body: {},
  createElement: (tag) => ({ tagName: String(tag).toUpperCase(), style: {}, dataset: {}, setAttribute() {}, remove() {} }),
  createDocumentFragment: () => ({ children: [], appendChild(c) { this.children.push(c); return c } }),
  createTextNode: (value) => ({ nodeValue: value }),
  createTreeWalker: () => {
    walkerCalls++
    let done = false
    return { nextNode: () => (done ? null : (done = true, textNode)) }
  },
  querySelector: () => null,
  querySelectorAll: () => [],
}
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
globalThis.MutationObserver = class { constructor(cb) { globalThis.__moCb = cb } observe() {} disconnect() {} }
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

// ---- 假 API:按剧本依次作答,好把「失败 → 冷却 → 重试」这条链走全 ----
const ROWS = [{ path: 'memes/happy/a.jpg', tag: 'happy', file_name: 'a.jpg', caption: '开心', keywords: '' }]
const plan = []
const calls = []
globalThis.fetch = (url, init) => {
  calls.push({ url: String(url), init })
  const mode = plan.shift() || 'ok'
  if (mode === 'throw') return Promise.reject(new Error('network down'))
  if (mode === 'http503') return Promise.resolve({ ok: false, status: 503, json: async () => ({}) })
  if (mode === 'hang') {
    return new Promise((_resolve, reject) => {
      const signal = init && init.signal
      if (signal) signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, memes: ROWS }) })
}

const warns = []
console.warn = (...args) => warns.push(args.join(' '))
const drain = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await Promise.resolve() }
// 先抓住真实的 setTimeout:下面测「挂起超时」时会临时把 globalThis.setTimeout 换成假的,
// 测试自己的等待必须走真实定时器,否则一起被吞掉 → 进程挂死。
const realSetTimeout = globalThis.setTimeout
const sleep = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms))
// 客户端里装饰扫描是防抖的(见 #22 第 4 条),所以触发一次 mutation 之后要等过防抖窗口
// 再断言——这样这条测试在「只合了本条修复」和「两条修复都合了」的树上都是绿的。
const scan = async () => {
  globalThis.__moCb([{ type: 'childList', addedNodes: [{}], removedNodes: [] }])
  await drain()
  await sleep(350)
  await drain()
}

test('索引拉取失败后可重试,挂起有超时兜底(issue #22)', async (t) => {
  // ① 插件挂载时的首次扫描就拉索引,而这次失败(后端还没起来 / 网络抖动)
  plan.push('throw')
  await import('../client.js')
  const disposers = []
  globalThis.__dshMeme.apply({ get: () => undefined, effect: (fn) => disposers.push(fn) })
  await drain()
  assert.equal(calls.length, 1, '首次扫描应拉一次索引')
  assert.equal(walkerCalls, 1, '扫描应真的走了一遍全文档 TreeWalker')
  assert.equal(parent.replaced, undefined, '索引没就绪时不该装饰(应降级成描述原文)')
  assert.equal(warns.length, 1, '失败应提示一次')
  assert.match(warns[0], /表情索引加载失败/)

  // ② 冷却期内再扫多少次都不重复发请求(退避有效)
  for (let i = 0; i < 3; i++) await scan()
  assert.equal(calls.length, 1, '冷却期内不应重复发请求')

  // ③ 冷却过后重试:这次挂起不返回,靠超时兜底 abort(超时接线必须真的存在)
  plan.push('hang')
  advance(2500)
  const timeouts = []
  const realSt = globalThis.setTimeout
  // 只拦 15s 那一个(超时兜底);其它定时器照常走真实实现——装饰扫描本身也是防抖的
  // (见 #22 第 4 条),连它一起拦掉的话扫描就永远不会发生,这条测试会假红。
  globalThis.setTimeout = (fn, ms) => {
    if (Number(ms) === 15000) { timeouts.push({ fn, ms }); return -1 }
    return realSt(fn, ms)
  }
  try {
    await scan()
    assert.equal(calls.length, 2, '冷却过后应重试')
    assert.ok(calls[1].init && calls[1].init.signal, '重试请求必须带 abort signal,否则挂起时永远等下去')
    assert.equal(timeouts.length, 1, '挂起时应挂了超时兜底')
    assert.equal(timeouts[0].ms, 15000, '超时兜底 15s')
    timeouts[0].fn() // 触发超时 → abort → 走失败分支
    await drain()
  } finally {
    globalThis.setTimeout = realSt
  }
  assert.equal(parent.replaced, undefined, '超时也算失败,仍不该装饰')
  assert.equal(warns.length, 1, '提示只打一次,别在长会话里刷屏')

  // ④ 后端起来了:冷却过后下一次扫描重试成功,正常装饰出图(退避已翻倍到 4s)
  advance(4500)
  await scan()
  assert.equal(calls.length, 3, '第 3 次应重试')
  assert.ok(parent.replaced, '索引就绪后应完成装饰')
  const img = parent.replaced.frag.children[0]
  assert.equal(img.tagName, 'IMG')
  assert.equal(img.src, 'http://localhost/dsh-memes/memes/happy/a.jpg', '应按 caption 命中正确图片')

  // ⑤ 成功之后不再重复拉索引
  await scan()
  assert.equal(calls.length, 3, '索引已就绪,不该再拉')

  for (const dispose of disposers) dispose()
})
