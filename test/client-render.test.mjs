import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * 渲染冒烟测试:用一个极简 React + 假 DOM 真的执行 MemePanel 的函数体,把三个标签页
 * 和「编辑」进去的图库详情页都渲染一遍。
 *
 * 为什么需要它:`node --check` 只查语法;client-slots 那条只跑到 apply(),不会进 render。
 * 而渲染路径上的崩溃(TDZ 引用后声明的 const、访问 undefined 的属性、拼错的名字)
 * 表现就是设置页整页空白——出过一次(在 cards 里引用了后面才声明的 curPack)。
 */

// ---- 极简 React:useState 的值存在共享 cell 里,好让第二次渲染看到 effect 写入的数据 ----
let stateCells = []
let passIndex = 0
let pendingEffects = []
const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
  useState(initial) {
    const i = passIndex++
    if (!(i in stateCells)) stateCells[i] = typeof initial === 'function' ? initial() : initial
    return [stateCells[i], (v) => { stateCells[i] = typeof v === 'function' ? v(stateCells[i]) : v }]
  },
  useEffect(fn) { pendingEffects.push(fn) },
  useRef(v) { return { current: v } },
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
  useSyncExternalStore(_subscribe, get) { return get() },
}

const makeEl = () => ({
  textContent: '', style: {}, dataset: {}, appendChild() {}, remove() {}, setAttribute() {},
  replaceWith() {}, click() {}, insertBefore() {}, closest: () => null, addEventListener() {},
})
globalThis.document = {
  head: { appendChild() {} },
  body: { appendChild() {}, querySelector: () => null },
  createElement: () => makeEl(),
  createElementNS: () => makeEl(),
  createDocumentFragment: () => makeEl(),
  createTextNode: () => makeEl(),
  createTreeWalker: () => ({ nextNode: () => null }),
  querySelector: () => null,
  querySelectorAll: () => [],
}
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.window = {
  location: { origin: 'http://localhost', href: '' },
  open: () => null,
  __ModuleLoader__: {
    load(def) {
      globalThis.__dshMeme = def.factory((name) => {
        if (name === 'react') return React
        throw new Error('unexpected require: ' + name)
      })
    },
  },
}

// ---- 假 API:返回一份带数据的面板 payload,让卡片/列表真的渲染出来 ----
const packPayload = () => ({
  ok: true,
  memeRoot: '/packs/p1',
  packId: 'p1',
  packs: [{
    id: 'p1', name: '包一', count: 2, source: 'user', version: '1.0.0',
    cover: '/dsh-memes/p1/memes/happy/a.jpg', enabled: true,
  }],
  enabledPacks: ['p1'],
  packsDir: '/packs',
  companionPrompt: '',
  defaultCompanionPrompt: '内置默认提示词',
  promptEnabled: true,
  remoteSubs: [],
  remoteDirUrl: [],
  configured: true,
})
const memes = [
  { path: 'memes/happy/a.jpg', tag: 'happy', file_name: 'a.jpg', caption: '甲', keywords: '', url: '/dsh-memes/p1/memes/happy/a.jpg' },
  { path: 'memes/happy/b.jpg', tag: 'happy', file_name: 'b.jpg', caption: '乙', keywords: '', url: '/dsh-memes/p1/memes/happy/b.jpg' },
]
const remoteDir = [{
  id: 'p2', name: '远程包', version: '2.0.0', count: 5, archiveUrl: 'https://example.com/p2.zip',
  preview: 'https://raw.githubusercontent.com/o/r/main/previews/p2.jpg', keywords: ['测试'],
}]
const apiHit = []
globalThis.fetch = async (url, init) => {
  const u = String(url)
  apiHit.push(u)
  const reply = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) })
  if (u.includes('remoteDir=1')) return reply({ ok: true, remoteDir })
  if (u.includes('/dsh-memes-api') && (!init || init.method !== 'POST')) {
    return reply({ ok: true, total: memes.length, tags: ['happy'], packId: 'p1', packs: [{ id: 'p1', name: '包一', count: 2 }], memes, remoteSubs: [], remoteDirUrl: [] })
  }
  if (u.includes('/dsh-memes-api')) return reply(packPayload())
  return reply({ ok: false, error: 'unexpected ' + u })
}

await import('../client.js')

// ---- 收集注册出来的面板 ----
const slots = {
  registered: [],
  inject(_name, fn) { fn() },
  register(meta, render) { this.registered.push({ meta, render }) },
}
globalThis.__dshMeme.apply({ get: (name) => (name === 'slots' ? slots : undefined), effect: () => {} })
const panel = slots.registered.find((r) => r.meta.name === 'settings.section' && r.meta.id === 'memes')
assert.ok(panel, '应注册 settings.section')

// 注册出去的是 () => createElement(MemePanel, {ctx});真 React 会去调这个函数组件,
// 这里照做,好让组件的函数体真的被执行(TDZ 之类的崩溃就发生在那里面)
const render = () => {
  passIndex = 0
  pendingEffects = []
  const el = panel.render({ ctx: {} })
  return typeof el.type === 'function' ? el.type(el.props) : el
}
const flush = async () => {
  for (const fn of pendingEffects.slice()) fn()
  pendingEffects = []
  await new Promise((ok) => setTimeout(ok, 0))
  await new Promise((ok) => setTimeout(ok, 0))
}
const walk = (node, fn) => {
  if (node == null || typeof node === 'boolean') return
  if (Array.isArray(node)) { for (const n of node) walk(n, fn); return }
  if (typeof node !== 'object') return
  fn(node)
  for (const kid of node.kids || []) walk(kid, fn)
}
const textOf = (node) => {
  let out = ''
  walk(node, (n) => { for (const kid of n.kids || []) if (typeof kid === 'string' || typeof kid === 'number') out += kid + ' ' })
  return out
}
const allText = (tree) => textOf(tree).replace(/\s+/g, ' ')
const findButton = (tree, label) => {
  let hit = null
  walk(tree, (n) => { if (hit || n.type !== 'button' || !n.props || typeof n.props.onClick !== 'function') return; if (textOf(n).includes(label)) hit = n })
  return hit
}
const findClickable = (tree, label) => {
  let hit = null
  walk(tree, (n) => { if (hit || !n.props || typeof n.props.onClick !== 'function') return; if (textOf(n).includes(label)) hit = n })
  return hit
}
const findCover = (tree) => {
  let hit = null
  walk(tree, (n) => { if (!hit && n.props && n.props.className === 'mk-cover' && n.props.style) hit = n.props.style.backgroundImage })
  return hit
}

test('面板三个标签页 + 图库详情页都能渲染出内容(含数据路径)', async () => {
  // 第一次渲染:数据还没回来,先确保空数据也不炸
  const empty = render()
  assert.equal(empty.type, 'div')
  assert.ok(allText(empty).includes('还没有图库'), '空数据时图库页应显示空态')

  // 跑挂载 effect,让 packs/remoteDir/memes 都拿到数据
  await flush()
  const library = render()
  let text = allText(library)
  assert.ok(text.includes('包一'), '图库页应列出图库: ' + text.slice(0, 200))
  assert.equal(findCover(library), 'url("/dsh-memes/p1/memes/happy/a.jpg")', '图库卡片封面用本地路由')
  assert.ok(findButton(library, '编辑'), '图库卡片应有编辑按钮')

  // 发现页:远程条目 + 远程封面走 jsDelivr 镜像
  const market = render()
  findButton(market, '发现').props.onClick()
  const discover = render()
  text = allText(discover)
  assert.ok(text.includes('远程包'), '发现页应列出远程条目: ' + text.slice(0, 200))
  assert.equal(findCover(discover), 'url("https://cdn.jsdelivr.net/gh/o/r@main/previews/p2.jpg")', '远程封面应换 jsDelivr 镜像')
  assert.ok(text.includes('安装'), '未安装的条目应给安装按钮')

  // 发现页点卡片 → 预览弹窗(没装的走目录里的预览图)
  const card = findClickable(render(), '远程包')
  assert.ok(card, '发现页卡片应可点开预览')
  card.props.onClick()
  const previewTree = render()
  const closeBtn = findButton(previewTree, '×')
  assert.ok(closeBtn, '预览弹窗右上角应有 × 关闭按钮')
  assert.equal(closeBtn.props.title, '关闭')
  let head = null
  walk(previewTree, (n) => { if (!head && n.props && n.props.className === 'meme-modal-head') head = n })
  assert.ok(head && head.kids.some((k) => k === closeBtn), '× 应该和标题在同一行(右上角)')
  let grid = null
  walk(previewTree, (n) => { if (!grid && n.props && n.props.className === 'mk-preview') grid = n })
  assert.ok(grid, '预览弹窗应有图片网格')
  assert.ok(allText(previewTree).includes('安装后可以看全部'), '目录预览比图库张数少时要说明安装后能看全部')

  // 设置页:提示词开关与扫描目录
  findButton(discover, '设置').props.onClick()
  const settings = render()
  text = allText(settings)
  assert.ok(text.includes('扫描目录') && text.includes('陪伴提示词'), '设置页应有扫描目录与提示词: ' + text.slice(0, 200))

  // 详情页:点「编辑」进去,这条路径以前因为 TDZ 整页空白
  findButton(settings, '图库').props.onClick()
  const library2 = render()
  findButton(library2, '编辑').props.onClick()
  await flush()
  const detail = render()
  text = allText(detail)
  assert.ok(text.includes('甲') && text.includes('乙'), '详情页应渲染出表情卡片: ' + text.slice(0, 300))
  assert.ok(findButton(detail, '图库列表'), '详情页应有返回按钮')

  // 弹窗们也要能渲染——它们各自是一大块 JSX,只有打开时才走到
  findButton(detail, '上传表情包').props.onClick()
  assert.ok(allText(render()).includes('上传表情包'), '上传弹窗应渲染')

  findButton(render(), '图库列表').props.onClick()
  findButton(render(), '新建图包库').props.onClick()
  assert.ok(allText(render()).includes('图库 ID'), '新建图包库弹窗应渲染')

  findButton(render(), '删除').props.onClick()
  assert.ok(allText(render()).includes('不可恢复'), '删除确认弹窗应渲染')

  findButton(render(), '设置').props.onClick()
  findButton(render(), '选择目录').props.onClick()
  await flush()
  assert.ok(allText(render()).includes('选择表情包目录'), '目录浏览弹窗应渲染')
})
