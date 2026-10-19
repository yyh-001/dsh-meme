import test, { after } from 'node:test'
import assert from 'node:assert/strict'

// 运行真实 apply/API/装饰链,只替换 DOM 与网络。每个气泡是本次新发的消息。
const nodes = []
const disposers = []
let stateCells = [], passIndex = 0, effects = []
const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
  useState(initial) {
    const i = passIndex++
    if (!(i in stateCells)) stateCells[i] = typeof initial === 'function' ? initial() : initial
    return [stateCells[i], (v) => { stateCells[i] = typeof v === 'function' ? v(stateCells[i]) : v }]
  },
  useEffect(fn) { effects.push(fn) },
  useRef: (v) => ({ current: v }), useMemo: (fn) => fn(), useCallback: (fn) => fn,
  useSyncExternalStore: (_subscribe, get) => get(),
}
globalThis.document = {
  head: { appendChild() {} }, body: {},
  createElement: (tag) => ({ tagName: tag.toUpperCase(), style: {}, dataset: {}, setAttribute() {}, remove() {} }),
  createDocumentFragment: () => ({ children: [], appendChild(c) { this.children.push(c) } }),
  createTextNode: (v) => ({ nodeValue: v }),
  createTreeWalker: () => {
    let i = 0
    return { nextNode: () => nodes[i++] || null }
  },
  querySelector: () => null, querySelectorAll: () => [],
}
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
globalThis.MutationObserver = class { constructor(cb) { globalThis.scanCallback = cb } observe() {} disconnect() {} }
globalThis.window = {
  location: { origin: 'http://localhost' },
  __ModuleLoader__: { load(def) { globalThis.plugin = def.factory(() => React) } },
}
const row = (pack, caption, file = 'haixiu.png') => ({
  caption, keywords: '害羞', file_name: file,
  url: `/dsh-memes/${pack}/memes/shy/${file}`,
})
const oldRow = row('dafeiyu-001', '害羞', 'haixiu.jpg')
const newRow = row('maid-emoji', '害羞，脸红得不敢看人')
let rows = [oldRow]
let postResult = { ok: true }
let nextGet = null
let getCalls = 0
const reply = (data) => ({ ok: true, status: 200, json: async () => data })
globalThis.fetch = async (_url, init) => {
  if (init?.method === 'POST') return reply(postResult)
  getCalls++
  if (nextGet) { const pending = nextGet; nextGet = null; return pending }
  return reply({ ok: true, memes: rows })
}
const drain = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
await import('../client.js')
const slots = {
  registered: [], inject(_name, fn) { fn() },
  register(meta, render) { this.registered.push({ meta, render }) },
}
globalThis.plugin.apply({ get: (name) => name === 'slots' ? slots : undefined, effect: (fn) => disposers.push(fn()) })
const { apiPost } = globalThis.plugin.__test
after(() => { for (const dispose of disposers) dispose() })

const bubble = (caption = newRow.caption) => {
  const parent = {
    dataset: {}, closest: () => null,
    replaceChild(frag) { this.rendered = frag.children },
  }
  nodes.push({ nodeValue: `[表情: ${caption}]`, parentElement: parent })
  return parent
}
const scan = async () => {
  globalThis.scanCallback([{ type: 'childList', addedNodes: [{}], removedNodes: [] }])
  await new Promise((resolve) => setTimeout(resolve, 350))
  await drain()
}
const src = (parent) => parent.rendered?.find((c) => c.tagName === 'IMG')?.src
const newUrl = 'http://localhost' + newRow.url

test('安装完成后无需刷新,新气泡精确匹配新图库(#39 原始案例)', async () => {
  const before = bubble()
  await scan()
  assert.equal(src(before), 'http://localhost' + oldRow.url, '旧索引会兜底到内置害羞图')
  rows = [oldRow, newRow]
  // 安装仍在进行时不清缓存;任务完成才刷新。
  const count = getCalls
  postResult = { ok: true, id: 'install-1', state: 'running' }
  await apiPost({ op: 'installRemoteArchive' })
  assert.equal(getCalls, count)
  postResult = { ok: true, id: 'install-1', state: 'done' }
  await apiPost({ op: 'remoteJobStatus', jobId: 'install-1' })
  await drain()
  const after = bubble()
  await scan()
  assert.equal(src(after), newUrl)
  const refreshed = getCalls
  await apiPost({ op: 'remoteJobStatus', jobId: 'install-1' })
  assert.equal(getCalls, refreshed, '重复完成轮询不重复刷新')
})

test('导入/删除/切换/编辑等变更后用最新索引,即使图片总数相同', async () => {
  const ops = ['importMemePack', 'createMemePack', 'deleteMemePack', 'setPack', 'setMemeRoot',
    'setPacksDir', 'setPackEnabled', 'upload', 'update', 'delete', 'deleteTag', 'updateRemotePack']
  postResult = { ok: true }
  for (const [i, op] of ops.entries()) {
    const replacement = row('replacement-' + i, newRow.caption)
    rows = [oldRow, replacement]
    await apiPost({ op })
    await drain()
    const message = bubble()
    await scan()
    assert.equal(src(message), 'http://localhost' + replacement.url, op)
  }
  rows = [oldRow]
  await apiPost({ op: 'deleteMemePack' })
  await drain()
  const message = bubble()
  await scan()
  assert.equal(src(message), 'http://localhost' + oldRow.url, '删除后不得继续引用已删图库')
})

test('失败的管理操作不清缓存,部分成功的下载完成会刷新', async () => {
  const count = getCalls
  postResult = { ok: false, error: '安装失败' }
  await apiPost({ op: 'importMemePack' })
  assert.equal(getCalls, count)
  rows = [oldRow, newRow]
  postResult = { ok: true, id: 'partial', state: 'done-with-errors' }
  await apiPost({ op: 'remoteJobStatus', jobId: 'partial' })
  await drain()
  const message = bubble()
  await scan()
  assert.equal(src(message), newUrl)
})

test('变更前的慢请求迟到或失败,都不能覆盖最新索引或重置新请求状态', async () => {
  for (const fail of [false, true]) {
    let resolveOld, rejectOld
    nextGet = new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject })
    postResult = { ok: true }
    await apiPost({ op: 'setPack' })
    rows = [oldRow, newRow]
    await apiPost({ op: 'importMemePack' })
    await drain()
    if (fail) rejectOld(new Error('old request failed'))
    else resolveOld(reply({ ok: true, memes: [oldRow] }))
    await drain()
    const message = bubble()
    await scan()
    assert.equal(src(message), newUrl)
  }
})

test('刷新期间不使用旧索引进行模糊匹配,返回后才装饰', async () => {
  let resolveGet
  nextGet = new Promise((resolve) => { resolveGet = resolve })
  await apiPost({ op: 'setPack' })
  const message = bubble()
  await scan()
  assert.equal(message.rendered, undefined)
  resolveGet(reply({ ok: true, memes: [oldRow, newRow] }))
  await drain()
  assert.equal(src(message), newUrl)
})

test('打开真实发图组件时同步最新数据,变更前的面板请求不能覆盖索引', async () => {
  // 外部学图/独立管理页未经过当前模块的 apiPost,打开 😊 仍可刷新气泡索引。
  document.addEventListener = () => {}
  document.removeEventListener = () => {}
  const trigger = slots.registered.find((r) => r.meta.name === 'conversation.input.left')
  const button = trigger.render()
  button.type(button.props).props.onClick({ preventDefault() {}, stopPropagation() {} })
  const overlay = slots.registered.find((r) => r.meta.name === 'conversation.input.overlay')
  const open = () => {
    stateCells = []; passIndex = 0; effects = []
    const el = overlay.render({ inputActions: {}, useInput: (s) => s({ draft: '' }) })
    el.type(el.props)
    for (const effect of effects) { const cleanup = effect(); if (cleanup) disposers.push(cleanup) }
  }
  rows = [oldRow, row('external', newRow.caption)]
  open()
  await drain()
  const external = bubble()
  await scan()
  assert.equal(src(external), 'http://localhost' + rows[1].url)

  let resolvePicker
  nextGet = new Promise((resolve) => { resolvePicker = resolve })
  open()
  rows = [oldRow, newRow]
  await apiPost({ op: 'importMemePack' })
  await drain()
  resolvePicker(reply({ ok: true, memes: [oldRow] }))
  await drain()
  const latest = bubble()
  await scan()
  assert.equal(src(latest), newUrl)
})

test('卸载后移除索引变更监听,不再请求或装饰', async () => {
  for (const dispose of disposers.splice(0)) dispose()
  const count = getCalls
  await apiPost({ op: 'importMemePack' })
  await drain()
  assert.equal(getCalls, count)
})
