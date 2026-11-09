import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * 识图模型设置(issue #67)客户端回归:
 *
 * 两个下拉框(provider / model)只是「草稿」,保存成功才落盘。这里钉住四件事:
 *   ① 未配置时两个框都在「跟随默认」,并显示实际默认模型;
 *   ② 下拉框只列宿主真实存在的 provider/model,并标注是否支持图片输入;
 *   ③ 保存被拒(只选了 provider 没选 model)时,下拉框要回到「上一次保存成功」的值,
 *      而不是留在用户刚选的草稿里 —— 否则界面显示一个从未生效的模型,
 *      而服务端仍是旧配置,用户会以为已经换了模型;
 *   ④ provider 选回「跟随默认」保存 = 回到跟随默认模型(model 自动清空)。
 *
 * 复用 client-remote-dir.test.mjs 的极简 React + 假 DOM;每个用例重新 import 一份
 * client.js(query 不同 = 新模块实例),避免模块级状态串味。
 */

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

// ---- 假 API:设置文件内容由 saved 表示;setRecognizeModel 的回复可被用例接管 ----
let saved = { recognizeProvider: '', recognizeModel: '' }
let recognizePostReply = null
const rootPayload = () => ({
  ok: true,
  memeRoot: '',
  packId: '',
  packs: [],
  enabledPacks: [],
  packsDir: '',
  companionPrompt: '',
  defaultCompanionPrompt: '内置默认提示词',
  promptEnabled: true,
  sendMode: 'auto',
  sendGear: 'auto',
  pickerSendOnClick: true,
  layoutMode: 'inline',
  allowLanAccess: false,
  pluginVersion: '9.9.9',
  remoteSubs: [],
  remoteDirUrl: [],
  remoteDirUrlSetting: '',
  configured: false,
  ...saved,
})
globalThis.fetch = async (url, init) => {
  const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null
  const reply = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) })
  if (body && body.op === 'getMemeRoot') return reply(rootPayload())
  if (body && body.op === 'getRecognizeCatalog') {
    return reply({
      ok: true,
      providers: [{
        id: 'opencode-go',
        name: 'OpenCode Go',
        models: [
          { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', image: true },
          { id: 'deepseek-chat', name: 'DeepSeek Chat', image: false },
          { id: 'mystery-model', name: '', image: null },
        ],
      }],
      defaultSelection: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
    })
  }
  // 列表/搜索:client 的 load() 会直接 setTags(res.tags),缺字段会渲染崩,给空列表
  if (!body) return reply({ ok: true, total: 0, tags: [], packs: [], memes: [], remoteSubs: [], remoteDirUrl: [], remoteDir: [] })
  if (body && body.op === 'setRecognizeModel') {
    if (recognizePostReply) return reply(recognizePostReply(body))
    saved = { recognizeProvider: body.provider, recognizeModel: body.model }
    return reply({
      ...rootPayload(),
      message: body.provider
        ? '识图模型已设为 ' + body.provider + '/' + body.model + ',下次学图/上传识图生效'
        : '识图模型已重置为跟随当前默认模型',
    })
  }
  return reply({ ok: true })
}

// ---- 展开函数组件,拿到最终元素树 ----
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
const allText = (tree) => collectText(tree, []).join(' ').replace(/\s+/g, ' ')
const findTab = (tree, label) => {
  let hit = null
  walk(tree, (n) => {
    if (hit || n.type !== 'button' || !n.props) return
    if (String(n.props.className || '').includes('mk-tab') && collectText(n, []).join('').trim() === label) hit = n
  })
  return hit
}
/** 按 title 找下拉框:provider 与 model 各占一行,靠 title 区分 */
const findSelect = (tree, titlePart) => {
  let hit = null
  walk(tree, (n) => {
    if (hit || n.type !== 'select' || !n.props) return
    if (String(n.props.title || '').includes(titlePart)) hit = n
  })
  return hit
}
/** model 那一行:下拉框 + 保存按钮 */
const findModelRow = (tree) => {
  let row = null
  walk(tree, (n) => {
    if (row || !n.props || n.props.className !== 'row') return
    const has = (n.kids || []).some((k) => k && k.type === 'select' && String((k.props || {}).title || '').includes('识图使用的模型'))
    if (has) row = n
  })
  return row
}
const optionLabels = (select) => (select.kids || []).map((k) => collectText(k, []).join(''))
const rowButton = (row, label) => (row ? (row.kids || []).find((k) => k && k.type === 'button' && collectText(k, []).join('').includes(label)) : null)

let importSeq = 0
async function loadPanel() {
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
  await import('../client.js?recognize=' + (++importSeq))
  globalThis.__dshMeme.apply({ get: (n) => (n === 'slots' ? slots : undefined), effect: () => {} })
  const panel = slots.registered.find((r) => r.meta.name === 'settings.section' && r.meta.id === 'memes')
  assert.ok(panel, '应注册 settings.section')
  const render = () => {
    hookStack = []
    return evalTree(panel.render({ ctx: {} }), 'root')
  }
  const flush = async (rounds = 10) => {
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
  return { render, flush }
}

/** 挂载 → 等首屏 getMemeRoot 落地 → 切到「设置」标签 */
async function openSettings() {
  const app = await loadPanel()
  await app.flush()
  let tree = app.render()
  const tab = findTab(tree, '设置')
  assert.ok(tab, '应有「设置」标签: ' + allText(tree).slice(0, 300))
  tab.props.onClick()
  tree = app.render()
  await app.flush(2)
  return { app, tree: app.render() }
}

test('未配置时:两个下拉框都在「跟随默认」,并展示实际默认模型', async () => {
  saved = { recognizeProvider: '', recognizeModel: '' }
  recognizePostReply = null
  const { tree } = await openSettings()
  const provider = findSelect(tree, '识图模型提供方')
  const model = findSelect(tree, '识图使用的模型')
  assert.ok(provider && model, '设置页应有 provider / model 两个下拉框')
  assert.equal(provider.props.value, '')
  assert.equal(model.props.value, '')
  assert.equal(model.props.disabled, true, '没选 provider 时 model 下拉禁用')
  const providerLabels = optionLabels(provider)
  assert.ok(providerLabels.some((l) => l.includes('跟随默认（opencode-go / deepseek-v4.1-flash）')), '应显示实际默认模型: ' + providerLabels.join(' | '))
  assert.ok(providerLabels.some((l) => l.includes('OpenCode Go（opencode-go）')), '应列出宿主 provider: ' + providerLabels.join(' | '))
  assert.ok(allText(tree).includes('跟随当前默认模型: opencode-go / deepseek-v4.1-flash'), '提示应带默认模型: ' + allText(tree).slice(0, 300))
})

test('从下拉框选 provider/model 保存成功,提示变成实际使用值', async () => {
  saved = { recognizeProvider: '', recognizeModel: '' }
  recognizePostReply = null
  const { app, tree } = await openSettings()
  findSelect(tree, '识图模型提供方').props.onChange({ target: { value: 'opencode-go' } })
  let next = app.render()
  const modelSel = findSelect(next, '识图使用的模型')
  assert.equal(modelSel.props.disabled, false)
  const labels = optionLabels(modelSel)
  assert.ok(labels.includes('请选择模型'), '选 provider 后要提示选模型: ' + labels.join(' | '))
  assert.ok(labels.some((l) => l.includes('支持图片 · DeepSeek V4.1 Flash（deepseek-v4.1-flash）')), '能力标记要在最前: ' + labels.join(' | '))
  assert.ok(labels.some((l) => l.includes('不支持图片 · DeepSeek Chat（deepseek-chat）')), '不支持图片也要标: ' + labels.join(' | '))
  assert.ok(labels.includes('mystery-model'), '能力未知的模型不标注: ' + labels.join(' | '))
  modelSel.props.onChange({ target: { value: 'deepseek-v4.1-flash' } })
  next = app.render()
  rowButton(findModelRow(next), '保存').props.onClick()
  await app.flush(2)
  next = app.render()
  assert.ok(allText(next).includes('识图模型已设为 opencode-go/deepseek-v4.1-flash'), '应有成功提示: ' + allText(next).slice(-300))
  assert.ok(allText(next).includes('AI 学图与上传识图使用 opencode-go/deepseek-v4.1-flash'), '提示应变成实际模型: ' + allText(next).slice(-300))
  assert.deepEqual(saved, { recognizeProvider: 'opencode-go', recognizeModel: 'deepseek-v4.1-flash' })
})

test('保存被拒:下拉框回到上一次保存成功的值,而不是留下草稿', async () => {
  // 已保存 opencode-go/deepseek-v4.1-flash;用户把 model 清空后保存 → 服务端 400
  saved = { recognizeProvider: 'opencode-go', recognizeModel: 'deepseek-v4.1-flash' }
  recognizePostReply = () => ({ ok: false, error: 'provider 与 model 需要同时填写,或同时留空' })
  try {
    const { app, tree } = await openSettings()
    let provider = findSelect(tree, '识图模型提供方')
    let model = findSelect(tree, '识图使用的模型')
    assert.equal(provider.props.value, 'opencode-go')
    assert.equal(model.props.value, 'deepseek-v4.1-flash')

    model.props.onChange({ target: { value: '' } })
    model = findSelect(app.render(), '识图使用的模型')
    assert.equal(model.props.value, '', '草稿阶段 model 应为空')
    rowButton(findModelRow(app.render()), '保存').props.onClick()
    await app.flush(2)
    const after = app.render()

    assert.ok(allText(after).includes('保存失败'), '应提示保存失败: ' + allText(after).slice(-300))
    assert.ok(allText(after).includes('同时填写'), '应带上服务端错误: ' + allText(after).slice(-300))
    provider = findSelect(after, '识图模型提供方')
    model = findSelect(after, '识图使用的模型')
    assert.equal(provider.props.value, 'opencode-go', 'provider 应回到已保存值')
    assert.equal(model.props.value, 'deepseek-v4.1-flash', '失败后不能停在没生效的草稿上')
    assert.ok(allText(after).includes('AI 学图与上传识图使用 opencode-go/deepseek-v4.1-flash'), '提示应与已保存配置一致: ' + allText(after).slice(-300))
    assert.deepEqual(saved, { recognizeProvider: 'opencode-go', recognizeModel: 'deepseek-v4.1-flash' }, '服务端配置不应被改动')
  } finally {
    recognizePostReply = null
  }
})

test('provider 选回「跟随默认」后保存 = 恢复跟随默认模型', async () => {
  saved = { recognizeProvider: 'opencode-go', recognizeModel: 'deepseek-v4.1-flash' }
  recognizePostReply = null
  const { app, tree } = await openSettings()
  findSelect(tree, '识图模型提供方').props.onChange({ target: { value: '' } })
  const draft = app.render()
  const provider = findSelect(draft, '识图模型提供方')
  const model = findSelect(draft, '识图使用的模型')
  assert.equal(provider.props.value, '')
  assert.equal(model.props.value, '', '切回默认时 model 要自动清空')
  assert.equal(model.props.disabled, true)
  rowButton(findModelRow(draft), '保存').props.onClick()
  await app.flush(2)
  const next = app.render()
  assert.ok(allText(next).includes('识图模型已重置为跟随当前默认模型'), '应提示已重置: ' + allText(next).slice(-300))
  assert.ok(allText(next).includes('跟随当前默认模型: opencode-go / deepseek-v4.1-flash'), '文案应回到默认: ' + allText(next).slice(-300))
  assert.deepEqual(saved, { recognizeProvider: '', recognizeModel: '' })
})
