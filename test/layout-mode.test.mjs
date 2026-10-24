import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * 表情排布设置(issue #50):设置页「表情排布」下拉框,inline = 图文并排(默认,
 * 行为同旧版)/ stacked = 图独占一行在上、正文按正常宽度铺开在下。
 * 切换只给消息行元素翻 data-meme-layout 属性,排布交给 CSS,不动行布置 JS;
 * 默认并排不打属性,已有用户观感不变。
 *
 * 这里覆盖 host 的设置读写(normalizeLayoutMode / setLayoutMode / payload 带
 * layoutMode)和前端的状态翻转(setMemeLayoutMode 即时翻新已渲染的行、新装饰
 * 的行也按当前模式打属性)。
 */

// ---------- host 侧 ----------

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-layout-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })
const settingsFile = join(home, '.dsh', 'dsh-expression.json')
const setSettings = (patch) => writeFileSync(settingsFile, JSON.stringify(patch || {}))

function createHost() {
  const handlers = []
  const tools = []
  const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
  const ctx = {
    effect(body) { return body() },
    on() { return () => {} },
    get(name) { return name === 'webServer' ? webServer : undefined },
    tools: { register(tool) { tools.push(tool) } },
    agentDefaultModel: null,
  }
  return { ctx, handlers, tools }
}

const host = createHost()
const mod = await import('../index.js')
const { normalizeLayoutMode, LAYOUT_MODES } = await import('../memes.js')
mod.apply(host.ctx, {})
const api = host.handlers.find((h) => h.path === '/dsh-memes-api')
assert.ok(api, '应注册管理 API')

const callApi = (method, url, body) => new Promise((resolve, reject) => {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3999' }
  const res = {
    statusCode: null, body: null,
    writeHead(status) { res.statusCode = status },
    end(b) { res.body = String(b); resolve(res) },
  }
  api.handler(req, res).catch(reject)
  process.nextTick(() => {
    if (body) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
})
const post = (body) => callApi('POST', '/', body)
const get = (url) => callApi('GET', url)

test('normalizeLayoutMode:只认 inline/stacked,其余一律回 inline', () => {
  assert.deepEqual(LAYOUT_MODES, ['inline', 'stacked'])
  assert.equal(normalizeLayoutMode('inline'), 'inline')
  assert.equal(normalizeLayoutMode('stacked'), 'stacked')
  assert.equal(normalizeLayoutMode(undefined), 'inline', '默认并排,不改已有观感')
  assert.equal(normalizeLayoutMode(''), 'inline')
  assert.equal(normalizeLayoutMode('并排'), 'inline')
})

test('payload 默认 layoutMode=inline;setLayoutMode 保存后立即生效', async () => {
  setSettings({})
  const initial = JSON.parse((await post({ op: 'getMemeRoot' })).body)
  assert.equal(initial.layoutMode, 'inline', '没设置过时默认并排')
  assert.equal(initial.sendMode, 'auto', '原有设置字段不受影响')

  const saved = JSON.parse((await post({ op: 'setLayoutMode', layoutMode: 'stacked' })).body)
  assert.equal(saved.ok, true)
  assert.equal(saved.layoutMode, 'stacked')
  assert.match(saved.message, /独占一行/)
  const after = JSON.parse((await post({ op: 'getMemeRoot' })).body)
  assert.equal(after.layoutMode, 'stacked', '保存持久化到设置文件')

  const back = JSON.parse((await post({ op: 'setLayoutMode', layoutMode: 'inline' })).body)
  assert.equal(back.layoutMode, 'inline')

  const bad = await post({ op: 'setLayoutMode', layoutMode: 'grid' })
  assert.equal(bad.statusCode, 400)
  assert.match(JSON.parse(bad.body).error, /inline \/ stacked/)
})

test('索引 GET 响应带 layoutMode:设置页不开,装饰器也能拿到排布', async () => {
  setSettings({ layoutMode: 'stacked' })
  const all = JSON.parse((await get('/dsh-memes-api?packId=all')).body)
  assert.equal(all.layoutMode, 'stacked')
  const single = JSON.parse((await get('/dsh-memes-api')).body)
  assert.equal(single.layoutMode, 'stacked')
  setSettings({})
})

// ---------- 前端侧(假 DOM,装饰路径) ----------

const { installFakeDom, mountPlugin } = await import('./fake-dom.mjs')

const dom = installFakeDom({
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      memes: [{ path: 'memes/happy/a.jpg', tag: 'happy', file_name: 'a.jpg', caption: '开心', keywords: '' }],
    }),
  }),
})
const { body, Element, TextNode } = dom
await mountPlugin()
await dom.drain()

const T = globalThis.__dshMeme.__test

const bubble = (marker) => {
  const flow = new Element('div')
  flow.setAttribute('data-chat-flow', '1')
  const row = new Element('div')
  row.setAttribute('data-chat-flow-key', 'r1')
  row.setAttribute('data-chat-flow-kind', 'user')
  const p = new Element('p')
  p.appendChild(new TextNode(marker))
  row.appendChild(p)
  flow.appendChild(row)
  body.appendChild(flow)
  return { flow, row, p }
}

const scan = async () => {
  const records = dom.takeMutations()
  if (records.length > 0) dom.emit(records)
  await dom.drain()
  await dom.sleep(350) // 过最小扫描间隔(SCAN_MIN_GAP=300)
  await dom.drain()
}

test('默认并排:装饰后行元素不带 data-meme-layout(观感与旧版一致)', async () => {
  const { row } = bubble('收到 [表情: 开心] 了')
  await scan()
  assert.equal(row.querySelectorAll('img[data-meme-img]').length, 1)
  assert.equal(row.getAttribute('data-meme-layout'), null)
})

test('切到独占一行:已渲染的行即时翻新,新装饰的行直接带属性(issue #50)', async () => {
  T.setMemeLayoutMode('stacked')
  const old = body.querySelectorAll('img[data-meme-img]')[0]
  const oldRow = old.closest('[data-chat-flow-key]')
  assert.equal(oldRow.getAttribute('data-meme-layout'), 'stacked', '设置页切换后存量行立即翻新')

  const { row } = bubble('再来 [表情: 开心]')
  await scan()
  assert.equal(row.querySelectorAll('img[data-meme-img]').length, 1)
  assert.equal(row.getAttribute('data-meme-layout'), 'stacked', '新装饰的行按当前模式打属性')
})

test('切回并排:属性摘掉,行为回到默认', async () => {
  T.setMemeLayoutMode('inline')
  for (const img of body.querySelectorAll('img[data-meme-img]')) {
    const row = img.closest('[data-chat-flow-key]')
    assert.equal(row.getAttribute('data-meme-layout'), null)
  }
})

test('排布样式已注入(stacked 的 CSS 规则存在)', async () => {
  const styles = [...body.querySelectorAll('style'), ...(globalThis.document && globalThis.document.head ? globalThis.document.head.querySelectorAll('style') : [])]
  const css = styles.map((s) => s.textContent || '').join('\n')
  assert.match(css, /\[data-meme-layout="stacked"\]/, 'stacked 排布规则要在样式表里')
})

after(() => {
  setSettings({})
  rmSync(home, { recursive: true, force: true })
})
