import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * 客户端回归:图库目录「不可用 / 本地缓存」两态、发现页重试、远程封面镜像回退、
 * 设置页「图库目录源」保存 op(契约 §3 / §4.2)。
 *
 * 复用 client-render.test.mjs 的「极简 React + 假 DOM」思路,但这里多需要两样东西:
 *   1) 函数组件递归求值 —— 远程封面现在由 MemeRemoteImage 组件渲染,不展开就看不到它
 *      最终吐出的 div(也就没法断言 backgroundImage 回退到哪个镜像);
 *   2) 假 Image —— 镜像回退靠 new Image() 的 onload/onerror 驱动,不伪造就永远停在首候选。
 *
 * 每个用例都重新 `import('../client.js?scene=N')`,拿一份全新的模块状态:镜像族黑名单
 * (`remoteImageBad`)和成功缓存(`remoteImageOk`)是模块级的,共用会把场景串味。
 */

// ---- 极简 React:hook 值按「组件路径 + 调用序号」存,函数组件展开时也能保持稳定 ----
let hookStack = []
let stateCells = new Map()
let refCells = new Map()
let effectCells = new Map()
let effectQueue = []
const allocSlot = () => {
  const frame = hookStack[hookStack.length - 1]
  assert.ok(frame, 'hook 只能在组件渲染期间调用')
  return frame.key + '#' + (frame.i++)
}
const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
  useState(initial) {
    const k = allocSlot()
    if (!stateCells.has(k)) stateCells.set(k, typeof initial === 'function' ? initial() : initial)
    return [stateCells.get(k), (v) => { stateCells.set(k, typeof v === 'function' ? v(stateCells.get(k)) : v) }]
  },
  useEffect(fn, deps) {
    const k = allocSlot()
    const prev = effectCells.get(k)
    const same = !!(prev && prev.deps && deps && prev.deps.length === deps.length
      && deps.every((d, i) => Object.is(d, prev.deps[i])))
    if (same) return
    effectCells.set(k, { deps: deps ? deps.slice() : null, cleanup: prev ? prev.cleanup : null })
    effectQueue.push({ key: k, fn })
  },
  useRef(v) {
    const k = allocSlot()
    if (!refCells.has(k)) refCells.set(k, { current: v })
    return refCells.get(k)
  },
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
  useSyncExternalStore(_subscribe, get) { return get() },
}

// ---- 假 DOM(与 client-render.test.mjs 同款;故意不给 addEventListener,点图放大增强自动跳过) ----
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

// ---- 假 Image:按场景决定每个候选 URL 加载成功/失败,驱动 MemeRemoteImage 的回退 ----
let scene = {}
globalThis.Image = class FakeImage {
  constructor() { this.onload = null; this.onerror = null; this._src = '' }
  set src(value) {
    this._src = String(value)
    const outcome = typeof scene.image === 'function' ? scene.image(this._src) : 'ok'
    setTimeout(() => {
      if (outcome === 'error') {
        if (typeof this.onerror === 'function') this.onerror(new Error('image load failed: ' + this._src))
      } else if (typeof this.onload === 'function') {
        this.onload()
      }
    }, 0)
  }
  get src() { return this._src }
}

// ---- 假 API:remoteDir=1 的响应由场景决定;POST 记录 body 便于断言 op ----
const basePayload = (extra) => ({
  ok: true,
  memeRoot: '/packs/p1',
  packId: 'p1',
  packs: [{ id: 'p1', name: '包一', count: 2, source: 'user', version: '1.0.0', cover: '/dsh-memes/p1/memes/happy/a.jpg', enabled: true }],
  enabledPacks: ['p1'],
  packsDir: '/packs',
  companionPrompt: '',
  defaultCompanionPrompt: '内置默认提示词',
  promptEnabled: true,
  pluginVersion: '9.9.9',
  remoteSubs: [],
  remoteDirUrl: [],
  remoteDirUrlSetting: '',
  configured: true,
  ...extra,
})
const baseList = () => ({
  ok: true, total: 0, tags: [], packId: 'p1',
  packs: [{ id: 'p1', name: '包一', count: 2 }], memes: [], remoteSubs: [], remoteDirUrl: [],
})
const dirResponse = (over) => ({
  ok: true, remoteDir: [], remoteDirSource: '', remoteDirCached: false, remoteDirError: '', remoteDirUrlSetting: '',
  ...over,
})

let apiCalls = []
let importSeq = 0
globalThis.fetch = async (url, init) => {
  const u = String(url)
  const method = (init && init.method) || 'GET'
  let body = null
  if (init && typeof init.body === 'string') {
    try { body = JSON.parse(init.body) } catch { body = init.body }
  }
  apiCalls.push({ url: u, method, body })
  const reply = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) })
  if (u.includes('remoteDir=1')) return reply(typeof scene.remoteDir === 'function' ? scene.remoteDir() : dirResponse({ remoteDir: [] }))
  if (method === 'POST') return reply(typeof scene.post === 'function' ? scene.post(body) : basePayload())
  return reply(baseList())
}

// ---- 展开函数组件,拿到最终元素树(文本/属性都在这里断言) ----
const evalKids = (kids, path) => (kids || []).map((kid, i) => evalTree(kid, path + '/' + i))
function evalTree(node, path) {
  if (node == null || typeof node === 'boolean') return node
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map((n, i) => evalTree(n, path + '[' + i + ']'))
  if (typeof node === 'object' && typeof node.type === 'function') {
    hookStack.push({ key: path, i: 0 })
    let out
    try { out = node.type(node.props) } finally { hookStack.pop() }
    return evalTree(out, path + '/c')
  }
  if (node.type === React.Fragment) return { type: 'fragment', props: node.props || {}, kids: evalKids(node.kids, path) }
  return { type: node.type, props: node.props || {}, kids: evalKids(node.kids, path) }
}
const walk = (node, fn) => {
  if (node == null || typeof node === 'boolean') return
  if (Array.isArray(node)) { for (const n of node) walk(n, fn); return }
  if (typeof node !== 'object') return
  fn(node)
  for (const kid of node.kids || []) walk(kid, fn)
}
const collectText = (node, out) => {
  if (node == null || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const n of node) collectText(n, out); return out }
  for (const kid of node.kids || []) collectText(kid, out)
  return out
}
const textOf = (node) => collectText(node, []).join(' ')
const allText = (tree) => textOf(tree).replace(/\s+/g, ' ')
const findButton = (tree, label) => {
  let hit = null
  walk(tree, (n) => {
    if (hit || n.type !== 'button' || !n.props || typeof n.props.onClick !== 'function') return
    if (textOf(n).includes(label)) hit = n
  })
  return hit
}
const findInput = (tree, placeholderPart) => {
  let hit = null
  walk(tree, (n) => {
    if (hit || n.type !== 'input' || !n.props) return
    if (String(n.props.placeholder || '').includes(placeholderPart)) hit = n
  })
  return hit
}
const findCover = (tree) => {
  let hit = null
  walk(tree, (n) => {
    if (hit || !n.props || n.props.className !== 'mk-cover-img' || !n.props.style) return
    hit = n.props.style.backgroundImage
  })
  return hit
}
/** 设置页「图库目录源」那一行(input + 保存 + 恢复自动),别和「扫描目录」那行的同名按钮混了 */
const findDirRow = (tree) => {
  let row = null
  walk(tree, (n) => {
    if (row || !n.props || n.props.className !== 'row') return
    const kids = n.kids || []
    if (kids.some((k) => k && k.type === 'input' && String((k.props || {}).placeholder || '').includes('留空 = 自动'))) row = n
  })
  return row
}
const rowButton = (row, label) => (row ? (row.kids || []).find((k) => k && k.type === 'button' && textOf(k).includes(label)) : null)
const countDirRequests = () => apiCalls.filter((c) => c.method === 'GET' && c.url.includes('remoteDir=1')).length
const remoteDirPosts = () => apiCalls.filter((c) => c.method === 'POST' && c.body && c.body.op === 'setRemoteDirUrl')

// ---- 装载一份全新的 client.js(不同 query = 不同模块实例),返回渲染/effect 驱动 ----
async function loadPanel(sceneObj) {
  scene = sceneObj || {}
  apiCalls = []
  hookStack = []
  stateCells = new Map()
  refCells = new Map()
  effectCells = new Map()
  effectQueue = []
  const slots = {
    registered: [],
    inject(_name, fn) { fn() },
    register(meta, render) { this.registered.push({ meta, render }) },
  }
  globalThis.window.__ModuleLoader__ = {
    load(def) {
      globalThis.__dshMeme = def.factory((name) => {
        if (name === 'react') return React
        throw new Error('unexpected require: ' + name)
      })
    },
  }
  await import('../client.js?scene=' + (++importSeq))
  globalThis.__dshMeme.apply({ get: (n) => (n === 'slots' ? slots : undefined), effect: () => {} })
  const panel = slots.registered.find((r) => r.meta.name === 'settings.section' && r.meta.id === 'memes')
  assert.ok(panel, '应注册 settings.section')
  const render = () => {
    hookStack = []
    return evalTree(panel.render({ ctx: {} }), 'root')
  }
  // React 语义近似:effect 只在 deps 变化时跑;每轮清空队列 → 让 Image 的 setTimeout 回调有机会推状态
  const flush = async (rounds = 10) => {
    // React 里 effect 一定发生在一次 render 之后;这里先渲染(把新挂载组件的 effect 排进队列),
    // 否则「先 flush 后 render」的写法会漏掉 mount effect。
    render()
    for (let i = 0; i < rounds; i++) {
      const queued = effectQueue
      effectQueue = []
      for (const eff of queued) {
        const cell = effectCells.get(eff.key) || {}
        if (typeof cell.cleanup === 'function') cell.cleanup()
        const cleanup = eff.fn()
        cell.cleanup = typeof cleanup === 'function' ? cleanup : null
        effectCells.set(eff.key, cell)
      }
      await new Promise((ok) => setTimeout(ok, 0))
    }
  }
  return { slots, render, flush }
}

test('发现页:目录不可用(remoteDir=null)显示错误 + 重试按钮,点击重试会重新请求', async () => {
  const app = await loadPanel({
    remoteDir: () => dirResponse({ remoteDir: null, remoteDirError: 'HTTP 503' }),
  })
  // 首次渲染:还没跑 effect,loading 态必须已经生效(不能先闪一下「不可用」)
  let tree = app.render()
  findButton(tree, '发现').props.onClick()
  tree = app.render()
  assert.ok(allText(tree).includes('正在拉取图库目录'), '拉取中应显示 loading: ' + allText(tree).slice(0, 200))

  await app.flush()
  tree = app.render()
  const text = allText(tree)
  assert.ok(text.includes('图库目录暂不可用'), '应显示不可用文案: ' + text.slice(0, 300))
  assert.ok(text.includes('HTTP 503'), '错误文案应带上 remoteDirError: ' + text.slice(0, 300))
  assert.ok(text.includes('设置 → 图库目录源'), '应引导国内用户去设置页手动指定目录源')

  const retry = findButton(tree, '重试')
  assert.ok(retry, '应提供重试按钮')
  const before = countDirRequests()
  retry.props.onClick()
  await app.flush()
  assert.equal(countDirRequests(), before + 1, '点重试应重新请求目录')
  tree = app.render()
  assert.ok(allText(tree).includes('图库目录暂不可用'), '仍然失败时保持可重试的不可用态')
})

test('发现页:remoteDirCached=true 时提示目录来自本地缓存(设置页也显示缓存态)', async () => {
  const entry = { id: 'p2', name: '远程包', version: '2.0.0', count: 5, archiveUrl: 'https://example.com/p2.zip', preview: 'https://example.com/p2.png', downloads: 3 }
  const app = await loadPanel({
    remoteDir: () => dirResponse({ remoteDir: [entry], remoteDirCached: true, remoteDirError: 'HTTP 500' }),
  })
  await app.flush()
  let tree = app.render()
  findButton(tree, '发现').props.onClick()
  tree = app.render()
  const text = allText(tree)
  assert.ok(text.includes('目录来自本地缓存'), '应提示走的是本地缓存: ' + text.slice(0, 300))
  assert.ok(text.includes('远程包'), '缓存目录里的条目仍应展示')

  // 设置页「当前源」:没有成功源 + 缓存兜底 → 显示缓存而不是「自动」
  findButton(tree, '设置').props.onClick()
  tree = app.render()
  assert.ok(allText(tree).includes('当前使用本地缓存'), '设置页应显示缓存态: ' + allText(tree).slice(0, 300))
})

test('远程封面:jsdmirror 加载失败后回退到 ghfast(新 Image 探测成功才切)', async () => {
  const raw = 'https://raw.githubusercontent.com/yyh-001/dsh-meme/main/previews/remote.png'
  const jsdmirror = 'https://cdn.jsdmirror.com/gh/yyh-001/dsh-meme@main/previews/remote.png'
  const app = await loadPanel({
    remoteDir: () => dirResponse({
      remoteDir: [{ id: 'p2', name: '远程包', version: '2.0.0', count: 5, archiveUrl: 'https://example.com/p2.zip', preview: raw, downloads: 3 }],
    }),
    // 只让 jsdmirror 挂,ghfast 能成 —— 验证按候选顺序逐个探测,而不是死等首候选
    image: (src) => (src.indexOf('cdn.jsdmirror.com') >= 0 ? 'error' : 'ok'),
  })
  await app.flush()
  let tree = app.render()
  findButton(tree, '发现').props.onClick()
  tree = app.render()
  assert.ok(allText(tree).includes('远程包'), '发现页应列出远程条目')
  assert.equal(findCover(tree), 'url("' + jsdmirror + '")', '第一帧先显示首候选(jsdmirror)')

  await app.flush(16)
  tree = app.render()
  assert.equal(findCover(tree), 'url("https://ghfast.top/' + raw + '")', 'jsdmirror 失败后应回退到 ghfast: ' + findCover(tree))
})

test('设置页「图库目录源」:保存发 setRemoteDirUrl op,恢复自动发空串', async () => {
  const target = 'https://ghfast.top/https://raw.githubusercontent.com/yyh-001/dsh-meme/main/packs/catalog.json'
  // host 保存后目录响应就会带上 remoteDirUrlSetting(前端保存完会立刻重拉目录)
  let savedSetting = ''
  const app = await loadPanel({
    remoteDir: () => dirResponse({ remoteDir: [], remoteDirUrlSetting: savedSetting }),
    post: (body) => {
      if (body && body.op === 'setRemoteDirUrl') {
        savedSetting = body.remoteDirUrl
        return basePayload({
          message: body.remoteDirUrl ? '已保存图库目录源' : '已恢复自动(内置多镜像)',
          remoteDirUrlSetting: body.remoteDirUrl,
        })
      }
      return basePayload()
    },
  })
  await app.flush()
  let tree = app.render()
  findButton(tree, '设置').props.onClick()
  tree = app.render()
  assert.ok(allText(tree).includes('图库目录源'), '设置页应有「图库目录源」小节: ' + allText(tree).slice(0, 300))

  const input = findInput(tree, '留空 = 自动')
  assert.ok(input, '应提供目录源输入框')
  assert.equal(input.props.placeholder, '留空 = 自动(内置国内多镜像)', 'placeholder 应说明留空 = 自动')
  assert.equal(input.props.maxLength, 500, '输入框应限长 500(与 host 校验一致)')
  assert.equal(input.props.value, '', '默认应是空串(自动)')

  // 输入 + 保存:POST body 必须带 op 与值,成功后回显 input、提示保存成功
  findInput(app.render(), '留空 = 自动').props.onChange({ target: { value: target } })
  tree = app.render()
  const save = rowButton(findDirRow(tree), '保存')
  assert.ok(save, '应有保存按钮')
  const getBefore = countDirRequests()
  save.props.onClick()
  await app.flush()
  const posts = remoteDirPosts()
  assert.equal(posts.length, 1, '保存应发一次 setRemoteDirUrl op')
  assert.equal(posts[0].body.remoteDirUrl, target, 'POST 的 remoteDirUrl 应是输入值')
  assert.equal(countDirRequests(), getBefore + 1, '保存后应立即重拉目录')
  tree = app.render()
  assert.equal(findInput(tree, '留空 = 自动').props.value, target, '保存成功后输入框应回显新值')
  assert.ok(allText(tree).includes('已保存图库目录源'), '应提示保存成功: ' + allText(tree).slice(0, 300))

  // 恢复自动:发空串,提示恢复成功
  const reset = rowButton(findDirRow(app.render()), '恢复自动')
  assert.ok(reset, '应有恢复自动按钮')
  reset.props.onClick()
  await app.flush()
  const posts2 = remoteDirPosts()
  assert.equal(posts2.length, 2, '恢复自动也应发 setRemoteDirUrl op')
  assert.equal(posts2[1].body.remoteDirUrl, '', '恢复自动应发空串')
  assert.ok(allText(app.render()).includes('已恢复自动'), '应提示已恢复自动: ' + allText(app.render()).slice(0, 300))
})

test('imageCandidates:raw GitHub 按契约 §1.1 候选顺序,非 GitHub 原样返回', async () => {
  const app = await loadPanel({ remoteDir: () => dirResponse({ remoteDir: [] }) })
  assert.ok(app)
  const { imageCandidates, imageUrl, imageProvider } = globalThis.__dshMeme.__test
  const raw = 'https://raw.githubusercontent.com/o/r/main/previews/p3.jpg'
  const gh = 'o/r@main/previews/p3.jpg'
  assert.deepEqual(imageCandidates(raw), [
    'https://cdn.jsdmirror.com/gh/' + gh,
    'https://ghfast.top/' + raw,
    'https://gh-proxy.com/' + raw,
    'https://ghproxy.net/' + raw,
    raw,
    'https://cdn.jsdelivr.net/gh/' + gh,
    'https://fastly.jsdelivr.net/gh/' + gh,
  ])
  assert.equal(imageUrl(raw), 'https://cdn.jsdmirror.com/gh/' + gh, '首候选应是国内友好的 jsdmirror')
  assert.deepEqual(imageCandidates('/dsh-memes/p1/memes/happy/a.jpg'), ['/dsh-memes/p1/memes/happy/a.jpg'], '本地路由没有镜像可换')
  assert.deepEqual(imageCandidates(''), [], '空串没有候选')
  assert.equal(imageProvider('https://ghfast.top/' + raw), 'ghfast')
  assert.equal(imageProvider(raw), 'raw')
  assert.equal(imageProvider('/dsh-memes/x.jpg'), '', '本地路由不属于任何镜像族')
})
