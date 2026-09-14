import test from 'node:test'
import assert from 'node:assert/strict'

// issue #15:slots 的 render 回调每次重渲染都会重跑。回调里现调组件工厂
// (makeMemeButton)会造出新的组件类型,React 视作不同类型 → 卸载旧节点 + 挂载新节点,
// 宿主每次重渲染都付一遍代价。这里跑一遍真实 apply(),断言注册出去的 render
// 回调在多次调用间返回同一个组件类型。

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

const slots = {
  registered: [],
  inject(name, fn) { fn() },
  register(meta, render) { this.registered.push({ meta, render }) },
}
globalThis.__dshMeme.apply({ get: (name) => (name === 'slots' ? slots : undefined), effect: () => {} })

const find = (name) => slots.registered.find((entry) => entry.meta.name === name && entry.meta.id === 'meme-picker')

test('conversation.input.left 的组件类型跨 render 稳定(issue #15)', () => {
  const reg = find('conversation.input.left')
  assert.ok(reg, '应注册 conversation.input.left')
  const first = reg.render({ input: { draft: '' } })
  const second = reg.render({ input: { draft: '想说的话' } })
  assert.equal(typeof first.type, 'function')
  assert.equal(first.type, second.type, 'render 回调必须复用同一个组件类型,否则 React 每次重渲染都卸载重建')
})

test('conversation.input.overlay 的组件类型跨 render 稳定', () => {
  const reg = find('conversation.input.overlay')
  assert.ok(reg, '应注册 conversation.input.overlay')
  assert.equal(reg.render({}).type, reg.render({}).type)
})
