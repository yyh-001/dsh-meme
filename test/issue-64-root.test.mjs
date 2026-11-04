import test from 'node:test'
import assert from 'node:assert/strict'

import { installFakeDom, mountPlugin } from './fake-dom.mjs'

/**
 * issue #64 的另一半:根路径部署(最常见)必须与旧版完全一致 —— 前缀为空串时
 * absAppPath() 原样返回,请求仍是 /dsh-memes-api、图片仍是 /dsh-memes/...
 * 单独一个测试文件 = 单独一个 Node 进程,APP_BASE 按本文件的环境重新推导。
 */

const ORIGIN = 'http://localhost'
const rows = [
  { path: 'memes/happy/a.jpg', tag: 'happy', file_name: 'a.jpg', caption: '开心', keywords: '', url: '/dsh-memes/p1/memes/happy/a.jpg' },
]
const hits = []

const dom = installFakeDom({
  baseURI: ORIGIN + '/',
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

test('根路径部署:前缀为空,API / 图片地址与旧版逐字一致', async () => {
  assert.equal(__test.APP_BASE, '')
  assert.equal(__test.absAppPath('/dsh-memes-api'), '/dsh-memes-api')
  assert.equal(__test.absAppPath('/dsh-memes/p1/memes/happy/a.jpg'), '/dsh-memes/p1/memes/happy/a.jpg')

  const before = hits.length
  await __test.apiGet({ tag: 'happy' })
  await __test.apiPost({ op: 'ping' })
  assert.deepEqual(hits.slice(before), ['/dsh-memes-api?tag=happy', '/dsh-memes-api'])

  assert.equal(__test.imageCandidates('/dsh-memes/p1/memes/happy/a.jpg')[0], '/dsh-memes/p1/memes/happy/a.jpg')
})

test('根路径部署:装饰出的内联图仍是 origin + /dsh-memes/...', async () => {
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
  await dom.sleep(350)
  await dom.drain()

  assert.ok(hits.includes('/dsh-memes-api?packId=all'), '索引请求仍是根路径')
  const imgs = row.querySelectorAll('img[data-meme-img]')
  assert.equal(imgs.length, 1, '应装饰出一张图')
  assert.equal(imgs[0].src, ORIGIN + '/dsh-memes/p1/memes/happy/a.jpg')
})
