import test from 'node:test'
import assert from 'node:assert/strict'

import { installFakeDom, mountPlugin } from './fake-dom.mjs'

/**
 * issue #64:DSH 挂在反代子路径(fnOS 的 /app/<id>/ 等)下时,插件自己的 HTTP 路由
 * (/dsh-memes-api、/dsh-memes/...)丢了应用前缀,全部打到站点根 → 反代的 SPA 兜底
 * 返回 index.html → 前端 `r.json()` 炸在 "Unexpected token '<'",图库页全白。
 *
 * 修法:从加载 bundle 的 <script src>(形如 <前缀>/plugins/dsh-meme/client.js?rev=…)
 * 反推前缀,所有站内绝对路径统一过 absAppPath();根路径部署前缀为空串,行为不变。
 *
 * 这里在实际 import 前把 document.currentScript 指到子路径模块地址,让整个插件实例
 * 跑在子路径部署下,断言 API、图片、装饰三条链路都带前缀。
 */

const SUB = '/app/fn-deepseek-harness'
const ORIGIN = 'http://localhost'
const rows = [
  { path: 'memes/happy/a.jpg', tag: 'happy', file_name: 'a.jpg', caption: '开心', keywords: '', url: '/dsh-memes/p1/memes/happy/a.jpg' },
]
const hits = []

const dom = installFakeDom({
  baseURI: ORIGIN + SUB + '/',
  currentScript: { src: ORIGIN + SUB + '/plugins/dsh-meme/client.js?rev=test' },
  fetch: async (url) => {
    hits.push(String(url))
    const reply = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) })
    if (String(url).includes('/dsh-memes-api')) {
      return reply({ ok: true, packId: 'p1', packs: [{ id: 'p1', name: '包一', count: 1 }], memes: rows, tags: ['happy'] })
    }
    return reply({ ok: false, error: 'unexpected ' + url })
  },
})

await mountPlugin()
const { __test } = globalThis.__dshMeme

test('detectAppBase:从 currentScript / 遗留 script / baseURI 反推前缀,深路由不瞎猜', () => {
  const base = __test.detectAppBase
  // 主路径:模块自身地址 <前缀>/plugins/<id>/client.js
  assert.equal(base({
    currentScript: { src: 'https://nas:58983' + SUB + '/plugins/dsh-meme/client.js?rev=1' },
    baseURI: 'https://nas:58983' + SUB + '/',
  }, ''), SUB)
  // 根路径部署:形态相同的地址,前缀为空
  assert.equal(base({ currentScript: { src: 'https://nas:58983/plugins/dsh-meme/client.js?rev=1' } }, ''), '')
  // 兜底:脚本已从 DOM 摘掉时,扫任何带 /plugins/ 的 script[src]
  assert.equal(base({
    currentScript: null,
    baseURI: 'https://nas:58983/',
    querySelectorAll: () => [{ src: 'https://nas:58983' + SUB + '/plugins/dsh-meme/client.js?rev=1' }],
  }, ''), SUB)
  // 再兜底:页面就在应用根(baseURI 以 / 结尾)
  assert.equal(base({ baseURI: 'https://nas:58983' + SUB + '/', querySelectorAll: () => [] }, ''), SUB)
  // 没有 baseURI / 深路由:宁可不加前缀,也不能拼出 /app/x/session/1/dsh-memes-api
  assert.equal(base({ baseURI: 'https://nas:58983' + SUB + '/session/1', querySelectorAll: () => [] }, ''), '')
  assert.equal(base(null, ''), '')
})

test('absAppPath:只给站内单斜杠路径补前缀,外部/协议相对/blob/data 原样', () => {
  const abs = __test.absAppPath
  assert.equal(__test.APP_BASE, SUB)
  assert.equal(abs('/dsh-memes-api'), SUB + '/dsh-memes-api')
  assert.equal(abs('/dsh-memes/p1/memes/happy/a.jpg'), SUB + '/dsh-memes/p1/memes/happy/a.jpg')
  // 已经带前缀的不要重复拼(前端多处会对同一地址二次过函数)
  assert.equal(abs(SUB + '/dsh-memes-api'), SUB + '/dsh-memes-api')
  // 这些都不是站内路径
  assert.equal(abs('https://raw.githubusercontent.com/o/r/main/a.jpg'), 'https://raw.githubusercontent.com/o/r/main/a.jpg')
  assert.equal(abs('//cdn.example.com/a.jpg'), '//cdn.example.com/a.jpg')
  assert.equal(abs('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  assert.equal(abs('blob:http://localhost/abc'), 'blob:http://localhost/abc')
  assert.equal(abs(''), '')
  assert.equal(abs(null), '')
})

test('API:GET/POST 都落在应用前缀下', async () => {
  const before = hits.length
  await __test.apiGet({ tag: 'happy' })
  await __test.apiPost({ op: 'ping' })
  const called = hits.slice(before)
  assert.deepEqual(called, [
    SUB + '/dsh-memes-api?tag=happy',
    SUB + '/dsh-memes-api',
  ])
  assert.ok(called.every((u) => !u.startsWith('/dsh-memes-api')), '不能再有裸根路径请求')
})

test('图片:本地图补前缀,远程镜像候选不受影响', () => {
  const { imageCandidates, imageUrl, absAppPath } = __test
  assert.equal(imageCandidates('/dsh-memes/p1/memes/happy/a.jpg')[0], SUB + '/dsh-memes/p1/memes/happy/a.jpg')
  assert.equal(imageUrl('/dsh-memes/p1/memes/happy/a.jpg'), SUB + '/dsh-memes/p1/memes/happy/a.jpg')
  const remote = imageCandidates('https://raw.githubusercontent.com/o/r/main/a.jpg')
  assert.equal(remote.length, 7, '镜像候选数量不变')
  assert.ok(remote.every((u) => u.startsWith('https://')), '远程候选保持原样')
  assert.equal(absAppPath(remote[0]), remote[0])
})

test('装饰:索引请求与内联图片都带前缀', async () => {
  const flow = new dom.Element('div')
  flow.setAttribute('data-chat-flow', '1')
  const row = new dom.Element('div')
  row.setAttribute('data-time-hover-root', '1')
  const p = new dom.Element('p')
  p.appendChild(new dom.TextNode('收到 [表情: 开心] 了'))
  row.appendChild(p)
  flow.appendChild(row)
  dom.body.appendChild(flow)

  const records = dom.takeMutations()
  if (records.length > 0) dom.emit(records)
  await dom.drain()
  await dom.sleep(350) // 过 SCAN_MIN_GAP=300ms
  await dom.drain()

  const indexHits = hits.filter((u) => u.includes('/dsh-memes-api?packId=all'))
  assert.ok(indexHits.length > 0, '装饰器应拉取全量索引')
  assert.ok(indexHits.every((u) => u === SUB + '/dsh-memes-api?packId=all'), '索引请求必须带应用前缀')

  const imgs = row.querySelectorAll('img[data-meme-img]')
  assert.equal(imgs.length, 1, '应装饰出一张图')
  assert.equal(
    imgs[0].src,
    ORIGIN + SUB + '/dsh-memes/p1/memes/happy/a.jpg',
    '内联表情图 URL 必须落在应用前缀下',
  )
})
