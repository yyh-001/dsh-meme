import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * 快捷面板点一张后的去向(issue #61)。
 *
 * 行为由设置 `pickerSendOnClick` 决定(默认开):
 * - 开:拼好 `[表情: 描述]` 立即提交,保持老的一键发图;
 * - 关:只把标记插到草稿光标处,不提交,用户自己按回车;
 *   宿主公开的 `captureInsertion` + `insertText` 可用时不会覆盖整段草稿,
 *   拿不到或 phase 冻结时退回 `setDraft` 追加,草稿不丢。
 *
 * 历史 bug(仍然要钉住):`MemeBoard` 不能读 `props.input.draft` —— 宿主给
 * `conversation.input.*` slot 的 props 里只有 `inputActions`(见 dsh-client-ui-conversation
 * 的 `uiSession.provide({ hooks: ["conversation","input"], props: ["inputActions"] })`),
 * 实时草稿必须走 `useInput` 钩子。读错属性 ⇒ 草稿恒为空 ⇒ 覆盖用户输入。
 */

let stateCells = []
let passIndex = 0
let pendingEffects = []
let mockPickerSendOnClick = true

const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
  useState(initial) {
    const i = passIndex++
    if (!(i in stateCells)) stateCells[i] = typeof initial === 'function' ? initial() : initial
    return [stateCells[i], (v) => { stateCells[i] = typeof v === 'function' ? v(stateCells[i]) : v }]
  },
  useEffect(fn) { pendingEffects.push(fn) },
  useLayoutEffect(fn) { pendingEffects.push(fn) },
  useRef(v) { return { current: v } },
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
  // 真实宿主里这个钩子订阅输入状态;测试里只要返回当前 store 值即可
  useSyncExternalStore(_subscribe, get) { return get() },
}

const makeEl = () => ({
  textContent: '', style: {}, dataset: {}, appendChild() {}, remove() {}, setAttribute() {},
  replaceWith() {}, click() {}, insertBefore() {}, closest: () => null, addEventListener() {},
  removeEventListener() {},
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
  addEventListener() {},
  removeEventListener() {},
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

const memes = [
  { path: 'memes/happy/a.jpg', tag: 'happy', file_name: 'a.jpg', caption: '甲', keywords: '', url: '/dsh-memes/p1/memes/happy/a.jpg' },
]
globalThis.fetch = async (url) => {
  const u = String(url)
  const reply = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) })
  if (u.includes('/dsh-memes-api')) {
    return reply({
      ok: true, total: memes.length, tags: ['happy'], packId: 'p1',
      packs: [{ id: 'p1', name: '包一', count: 1 }], memes,
      pickerSendOnClick: mockPickerSendOnClick,
    })
  }
  return reply({ ok: false, error: 'unexpected ' + u })
}

await import('../client.js')

const walk = (node, fn) => {
  if (node == null || typeof node === 'boolean') return
  if (Array.isArray(node)) { for (const n of node) walk(n, fn); return }
  if (typeof node !== 'object') return
  fn(node)
  for (const kid of node.kids || []) walk(kid, fn)
}
const run = (el) => (typeof el.type === 'function' ? el.type(el.props) : el)
const flush = async () => {
  for (const fn of pendingEffects.slice()) fn()
  pendingEffects = []
  await new Promise((ok) => setTimeout(ok, 0))
  await new Promise((ok) => setTimeout(ok, 0))
}

/**
 * 装一遍插件(每次 apply 都有独立的内部 store),打开面板并渲染出表情格。
 * @param useInput 宿主注入的实时输入钩子;传 undefined 模拟老宿主
 * @param extra 追加到 inputActions 上的动作(insertText/captureInsertion 等)
 * @param sendOnClick 设置「点图直接发送」:false = 只放进草稿
 */
const openPicker = async (useInput, extra = {}, sendOnClick = false) => {
  mockPickerSendOnClick = sendOnClick
  stateCells = []
  passIndex = 0
  pendingEffects = []
  const calls = []
  const inputActions = {
    setDraft: (text) => calls.push({ kind: 'setDraft', text }),
    submit: () => calls.push({ kind: 'submit' }),
    ...extra,
  }
  const slots = {
    registered: [],
    inject(_name, fn) { fn() },
    register(meta, render) { this.registered.push({ meta, render }) },
  }
  globalThis.__dshMeme.apply({ get: (name) => (name === 'slots' ? slots : undefined), effect: () => {} })
  const find = (name, id = 'meme-picker') => slots.registered.find((r) => r.meta.name === name && r.meta.id === id)

  // 面板默认是关的（MemeBoard 在 !open 时直接 return null）⇒ 先点触发按钮打开它
  const trigger = find('conversation.input.left')
  assert.ok(trigger, '应注册 conversation.input.left')
  passIndex = 0
  const buttonTree = run(trigger.render({ useInput }))
  let button = null
  walk(buttonTree, (n) => { if (!button && n.props && typeof n.props.onClick === 'function') button = n })
  assert.ok(button, '应能拿到 😊 触发按钮')
  button.props.onClick({ preventDefault() {}, stopPropagation() {} })

  // 渲染面板：第一次跑挂载 effect（fetch 表情），第二次拿到有数据的那棵树
  const overlay = find('conversation.input.overlay')
  assert.ok(overlay, '应注册 conversation.input.overlay')
  const props = { inputActions, useInput }
  passIndex = 0
  run(overlay.render(props))
  await flush()
  passIndex = 0
  const board = run(overlay.render(props))

  let cell = null
  walk(board, (n) => { if (!cell && n.props && n.props.className === 'mp-cell') cell = n })
  assert.ok(cell, '面板里应渲染出表情格')
  return { cell, calls, board }
}

test('设置开启(默认)：点一张直接发送，草稿带上原有文字', async () => {
  const useInput = (selector) => selector({ draft: '我想说的话' })
  const { cell, calls } = await openPicker(useInput, {}, true)
  cell.props.onClick()
  await new Promise((ok) => setTimeout(ok, 0))
  const drafted = calls.filter((c) => c.kind === 'setDraft')
  assert.equal(drafted.length, 1)
  assert.equal(drafted[0].text, '我想说的话\n[表情: 甲]')
  assert.ok(calls.some((c) => c.kind === 'submit'), '开启时保持老的一键发图')
})

test('设置关闭：标记追加到草稿末尾，不自动发送', async () => {
  const useInput = (selector) => selector({ draft: '我想说的话' })
  const { cell, calls } = await openPicker(useInput, {}, false)
  cell.props.onClick()
  await new Promise((ok) => setTimeout(ok, 0))
  const drafted = calls.filter((c) => c.kind === 'setDraft')
  assert.equal(drafted.length, 1, '应只设置一次草稿')
  assert.equal(drafted[0].text, '我想说的话\n[表情: 甲]')
  assert.ok(!calls.some((c) => c.kind === 'submit'), '关闭后必须等用户自己发')
})

test('设置关闭 + 草稿为空：只放 [表情: …]，不要多一个换行', async () => {
  const useInput = (selector) => selector({ draft: '' })
  const { cell, calls } = await openPicker(useInput, {}, false)
  cell.props.onClick()
  await new Promise((ok) => setTimeout(ok, 0))
  const drafted = calls.filter((c) => c.kind === 'setDraft')
  assert.equal(drafted.length, 1)
  assert.equal(drafted[0].text, '[表情: 甲]')
  assert.ok(!calls.some((c) => c.kind === 'submit'), '不能自动提交')
})

test('设置关闭 + 拿不到 useInput 钩子：不崩，仍只放进草稿', async () => {
  const { cell, calls } = await openPicker(undefined, {}, false)
  cell.props.onClick()
  await new Promise((ok) => setTimeout(ok, 0))
  const drafted = calls.filter((c) => c.kind === 'setDraft')
  assert.equal(drafted.length, 1)
  assert.equal(drafted[0].text, '[表情: 甲]')
  assert.ok(!calls.some((c) => c.kind === 'submit'), '不能自动提交')
})

test('设置关闭 + 支持光标插入：走 insertText，不覆盖整段草稿', async () => {
  const useInput = (selector) => selector({ draft: '作业一摊开，脑子先关机' })
  const span = { start: 5, end: 5, draftRev: 7 }
  const seen = []
  const extra = {
    captureInsertion: () => span,
    insertText: (text, s) => { seen.push({ text, s }); return true },
  }
  const { cell, calls } = await openPicker(useInput, extra, false)
  cell.props.onClick()
  await new Promise((ok) => setTimeout(ok, 0))
  assert.deepEqual(seen, [{ text: '[表情: 甲]', s: span }], '应该在光标锚点处插入标记')
  assert.ok(!calls.some((c) => c.kind === 'setDraft'), 'insertText 成功时不该整段重写草稿')
  assert.ok(!calls.some((c) => c.kind === 'submit'), '不能自动提交')
})

test('设置关闭 + insertText 失败(phase 冻结)：回退 setDraft，仍然不提交', async () => {
  const useInput = (selector) => selector({ draft: '我想说的话' })
  const extra = {
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
    insertText: () => false,
  }
  const { cell, calls } = await openPicker(useInput, extra, false)
  cell.props.onClick()
  await new Promise((ok) => setTimeout(ok, 0))
  const drafted = calls.filter((c) => c.kind === 'setDraft')
  assert.equal(drafted.length, 1, '插入失败要退回 setDraft 追加，不能把草稿丢掉')
  assert.equal(drafted[0].text, '我想说的话\n[表情: 甲]')
  assert.ok(!calls.some((c) => c.kind === 'submit'), '不能自动提交')
})
