import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * issue #62:0.1.72 把「将发送」表情条注册到了 conversation.input.attachments。
 *
 * 那是宿主的 **single 槽**,宿主的附件条(ComposerAttachments)已经占了 priority 0;
 * 同优先级再注册会直接抛:
 *   single slot "conversation.input.attachments" already has a registration at priority 0
 * 结果整个客户端模块 apply 失败,表情条永远不渲染,控制台每次加载一条 error。
 *
 * 修复:改挂 conversation.input.dock(list 槽,输入框上方,和 todo / 待发队列并列)。
 * 这个测试用一套按宿主规则判定的假 slots 复现冲突,并断言 apply 不再抛错。
 */

const fakeReact = {
  createElement: (type, props) => ({ type, props }),
  Fragment: Symbol('Fragment'),
}

globalThis.document = {
  head: { appendChild() {} },
  body: {},
  createElement: () => ({ textContent: '', style: {}, dataset: {}, appendChild() {}, remove() {}, setAttribute() {}, replaceWith() {} }),
  createTreeWalker: () => ({ nextNode: () => null }),
  querySelector: () => null,
  querySelectorAll: () => [],
}
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.window = {
  location: { origin: 'http://localhost' },
  __ModuleLoader__: {
    load(def) {
      globalThis.__dshMeme = def.factory((name) => {
        if (name === 'react') return fakeReact
        throw new Error('unexpected require: ' + name)
      })
    },
  },
}
await import('../client.js')

/** 复刻宿主 slots.register 的关键判定:single 槽同优先级只能有一条,list 槽按 id 去重 */
const makeSlots = () => {
  const slots = {
    entries: [],
    inject(_name, fn) { fn() },
    register(meta, render) {
      const priority = meta.priority ?? 0
      if (meta.name === 'conversation.input.attachments') {
        const hit = this.entries.find((e) => e.meta.name === meta.name && (e.meta.priority ?? 0) === priority)
        if (hit) throw new Error('single slot "' + meta.name + '" already has a registration at priority ' + priority)
      }
      if (meta.name === 'conversation.input.dock') {
        if (meta.id === undefined) throw new Error('list slot "' + meta.name + '" requires options.id')
        const hit = this.entries.find((e) => e.meta.name === meta.name && e.meta.id === meta.id && (e.meta.priority ?? 0) === priority)
        if (hit) throw new Error('list slot "' + meta.name + '" already has an entry with id "' + meta.id + '"')
      }
      this.entries.push({ meta, render })
    },
  }
  return slots
}

test('宿主的 single 槽 attachments 已被占用时,apply 不再抛错(issue #62)', () => {
  const slots = makeSlots()
  // 宿主自带插件先注册附件条(priority 0)
  slots.register({ name: 'conversation.input.attachments', priority: 0 }, () => null)
  // 同样的位置再注册一条必须按宿主规则报错 —— 证明这套假 slots 能复现原 bug
  assert.throws(
    () => slots.register({ name: 'conversation.input.attachments', id: 'meme-draft', order: 5 }, () => null),
    /single slot .* already has a registration/,
  )
  // 修复后 apply 不应再往 single 槽挤,自然也不会抛
  assert.doesNotThrow(() => {
    globalThis.__dshMeme.apply({ get: (name) => (name === 'slots' ? slots : undefined), effect: () => {} })
  })
  const dock = slots.entries.find((e) => e.meta.name === 'conversation.input.dock' && e.meta.id === 'meme-draft')
  assert.ok(dock, '表情条应改挂 conversation.input.dock(list 槽)')
  assert.equal(dock.meta.order, 10, 'todo(0) 之后、待发队列(20) 之前')
  assert.ok(
    !slots.entries.some((e) => e.meta.name === 'conversation.input.attachments' && e.meta.id === 'meme-draft'),
    '不应再注册到宿主的 single 槽',
  )
})
