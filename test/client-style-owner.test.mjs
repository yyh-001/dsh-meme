import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * issue #32:插件的三处 <style> 以前都没打 data-plugin,于是被宿主的客户端模块系统
 * (dsh-client-modules,本机核对 0.2.0-rc.2 的 claimStyles)认给「当时正在物化的那个模块」,
 * 那个模块之后一变更(改它自己的 client.js / 热重载)就被 removeOwnedStyles 连标签删掉 ——
 * 设置页整套样式消失、重启宿主才恢复,归属还由物化顺序决定,极难复现。
 *
 * 修法:每个 style 建完就打 data-plugin="dsh-meme"(值必须等于模块注册 id)。预标记的标签
 * 谁都不会认领。本文件盯住客户端那两处;index.js 的 tapIndex 注入在 host-routes.test.mjs。
 *
 * 这里刻意复刻宿主的认领逻辑来断言:无主 style 的数量必须是 0。
 */

const appended = []
const makeEl = () => ({
  textContent: '', style: {}, dataset: {}, attrs: {},
  appendChild() {}, remove() {}, replaceWith() {}, click() {}, insertBefore() {},
  closest: () => null, addEventListener() {}, removeEventListener() {},
  setAttribute(k, v) { this.attrs[k] = String(v) },
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
})

globalThis.document = {
  head: { appendChild: (el) => appended.push(el) },
  body: {},
  createElement: () => makeEl(),
  createElementNS: () => makeEl(),
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
  __ModuleLoader__: {
    load(def) {
      globalThis.__dshMeme = def.factory((name) => {
        if (name === 'react') return { createElement: () => ({}), useState: (v) => [v, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }), useSyncExternalStore: (_s, get) => get() }
        throw new Error('unexpected require: ' + name)
      })
    },
  },
}

await import('../client.js')
globalThis.__dshMeme.apply({ get: () => undefined, effect: () => {} })

const OWNER = 'dsh-meme'

test('apply() 建的每个 <style> 都带 data-plugin=dsh-meme(issue #32)', () => {
  assert.equal(appended.length, 4, '应建四个 style:设置面板 CSS + 选图器 CSS + 点图放大光标 + 表情排布(issue #50)')
  for (const el of appended) {
    assert.equal(el.getAttribute('data-plugin'), OWNER, '<style> 必须打上模块注册 id')
  }
  assert.ok(appended[0].textContent.includes('.meme-panel'), '第一个是设置面板 CSS')
  assert.ok(appended[1].textContent.includes('.meme-picker'), '第二个是选图器 CSS')
  assert.ok(appended[2].textContent.includes('cursor:zoom-in'), '第三个是点图放大的光标提示')
  // issue #44:光标范围必须和点击判定一致 —— 只给消息内容槽里的图和本插件自己的表情图,
  // 不能再按 [data-chat-flow-key] 整行给别的插件注入的装饰图(头像等)也加 zoom-in。
  assert.ok(appended[2].textContent.includes('img[data-meme-img]'), '自己的表情图要有放大光标')
  assert.ok(appended[2].textContent.includes('[data-slot="conversation.chat.node"] img'), '消息内容槽里的图要有放大光标')
  assert.equal(appended[2].textContent.includes('[data-chat-flow]'), false, '范围不能再是整条 FlowItem 行(issue #44)')
  assert.ok(appended[3].textContent.includes('[data-meme-layout="stacked"]'), '第四个是「独占一行」排布规则(issue #50)')
})

test('没有无主 <style>:宿主的 claimStyles 认不到东西(issue #32 的根因)', () => {
  // 复刻宿主:claimStyles 会把「当下所有无主 style」认给刚物化的模块
  const unowned = appended.filter((el) => el.getAttribute('data-plugin') === null)
  assert.equal(unowned.length, 0, '有无主 style 就会被别的模块认领,之后被 removeOwnedStyles 连标签删掉')
})

test('createOwnedStyle 打的归属值与模块注册 id 一致', () => {
  const { createOwnedStyle, STYLE_OWNER_ID } = globalThis.__dshMeme.__test
  assert.equal(STYLE_OWNER_ID, OWNER, '值必须等于 __ModuleLoader__.load({ id }),宿主按同一个 id 摘标签')
  const el = createOwnedStyle('.x{}')
  assert.equal(el.getAttribute('data-plugin'), OWNER)
  assert.equal(el.textContent, '.x{}')
  assert.ok(appended.includes(el), '创建的标签要挂进 head')
})
