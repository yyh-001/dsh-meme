import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * 回归:输入框里已经有草稿时，点快捷面板里的表情**必须把草稿带上**一起发，
 * 而不是用空内容覆盖输入框（用户报的 "发表情会把我输入的文字清空"）。
 *
 * 历史 bug：`MemeBoard` 读的是 `props.input.draft` —— 宿主给 `conversation.input.*`
 * 这两个 slot 的 props 里**只有 `inputActions`**（见 dsh-client-ui-conversation 的
 * `uiSession.provide({ hooks: ["conversation","input"], props: ["inputActions"] })`），
 * 实时草稿要通过 hooks 得到的 `useInput` 钩子读（宿主自己的输入栏就是
 * `useInput((s) => s)`）。属性不存在 ⇒ 读取结果恒为空 ⇒ `send()` 拼出
 * `'' + '[表情: …]'` 再覆盖输入框，用户的字就没了。
 *
 * 本测试用极简 React 真的把 `MemeBoard` 的函数体跑起来：先点触发按钮打开面板，
 * 再点第一个表情格，断言 `setDraft` 收到的字符串。
 */

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
  // 真实宿主里这个钩子订阅输入状态；测试里只要返回当前 store 值即可
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
    return reply({ ok: true, total: memes.length, tags: ['happy'], packId: 'p1', packs: [{ id: 'p1', name: '包一', count: 1 }], memes })
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

/** 装一遍插件（每次 apply 都有独立的内部 store），打开面板并渲染出表情格 */
const openPicker = async (useInput) => {
  stateCells = []
  passIndex = 0
  const calls = []
  const inputActions = {
    setDraft: (text) => calls.push({ kind: 'setDraft', text }),
    submit: () => calls.push({ kind: 'submit' }),
  }
  const slots = {
    registered: [],
    inject(_name, fn) { fn() },
    register(meta, render) { this.registered.push({ meta, render }) },
  }
  globalThis.__dshMeme.apply({ get: (name) => (name === 'slots' ? slots : undefined), effect: () => {} })
  const find = (name) => slots.registered.find((r) => r.meta.name === name && r.meta.id === 'meme-picker')

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
  return { cell, calls }
}

test('草稿非空时：快捷发图带上原草稿（文字在前，表情在后），不再覆盖用户的字', async () => {
  const useInput = (selector) => selector({ draft: '我想说的话' })
  const { cell, calls } = await openPicker(useInput)
  cell.props.onClick()
  await new Promise((ok) => setTimeout(ok, 0))
  const drafted = calls.filter((c) => c.kind === 'setDraft')
  assert.equal(drafted.length, 1, '应只设置一次草稿')
  assert.equal(drafted[0].text, '我想说的话\n[表情: 甲]')
  assert.ok(calls.some((c) => c.kind === 'submit'), '设置完草稿应当提交')
})

test('草稿为空时：只发 [表情: …]，不要多一个换行', async () => {
  const useInput = (selector) => selector({ draft: '' })
  const { cell, calls } = await openPicker(useInput)
  cell.props.onClick()
  await new Promise((ok) => setTimeout(ok, 0))
  const drafted = calls.filter((c) => c.kind === 'setDraft')
  assert.equal(drafted.length, 1)
  assert.equal(drafted[0].text, '[表情: 甲]')
})

test('拿不到 useInput 钩子时不崩，并退回旧行为（只发 [表情: …]）', async () => {
  const { cell, calls } = await openPicker(undefined)
  cell.props.onClick()
  await new Promise((ok) => setTimeout(ok, 0))
  const drafted = calls.filter((c) => c.kind === 'setDraft')
  assert.equal(drafted.length, 1)
  assert.equal(drafted[0].text, '[表情: 甲]')
  assert.ok(calls.some((c) => c.kind === 'submit'), '仍然要提交')
})
