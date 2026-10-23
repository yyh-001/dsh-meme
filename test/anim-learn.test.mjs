import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { DatabaseSync } from 'node:sqlite'

import { encodePng } from '../anim.js'
import { ANIM_FIXTURES } from './fixtures-anim.mjs'

/**
 * 动图读取接入「AI 识图」后的端到端行为:
 * - learn_meme 不传 tag 时走 AI 识图,GIF 动图抽帧成胶片条送给模型,但图库落盘保留原始动图;
 * - 静态图行为不变(送原图);
 * - 动图 WebP/APNG 只加「这是动图」的元数据说明,图片仍送第一帧;
 * - 上传弹窗的 recognize 接口把 animation 元数据回给前端。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-anim-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home

const root = join(home, '.dsh', 'meme-packs', 'test-pack')
mkdirSync(root, { recursive: true })
const seed = new DatabaseSync(join(root, 'index.db'))
seed.exec('CREATE TABLE memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
seed.close()
writeFileSync(join(root, 'manifest.json'), JSON.stringify({ id: 'test-pack', name: '测试图库', version: '1.0.0' }))

const gifBuf = Buffer.from(ANIM_FIXTURES.basic2.b64, 'base64')
const webpBuf = Buffer.from(ANIM_FIXTURES.animwebp.b64, 'base64')
const singleGifBuf = Buffer.from(ANIM_FIXTURES.interlaced.b64, 'base64')
const pngBuf = encodePng(2, 2, new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128]))

// 附件服务:readImage 按 attachmentId 返回对应字节;saveImage 记录送进模型的那张图
const attachments = new Map()
const saved = []
const attachmentService = {
  readImage: async (ref) => attachments.get(String(ref.attachmentId)) || null,
  saveImage: async (opts) => {
    saved.push(opts)
    return { attachmentId: 'saved-' + saved.length }
  },
}

// LLM:默认模型支持图片;stream 返回固定 JSON(同时记录实际发送的消息,便于断言送了什么图)
const llmCalls = []
const llm = {
  resolveModelInfo: async () => ({ inputModalities: ['image'] }),
  resolveCallConfig: async (cfg) => ({ ...cfg }),
  prepareCall: async (base) => ({
    stream: async function* (params) {
      llmCalls.push(params)
      yield { type: 'text-delta', text: '{"tag":"happy","caption":"猫疯狂摇头(动图)","keywords":"猫 摇头 动图"}' }
    },
  }),
}

const tools = []
const handlers = []
const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
const ctx = {
  effect(body) { return body() },
  on() { return () => {} },
  get(name) {
    if (name === 'webServer') return webServer
    if (name === 'attachments') return attachmentService
    if (name === 'llm') return llm
    return undefined
  },
  tools: { register(tool) { tools.push(tool) } },
  agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'vision-test' }) },
}

const mod = await import('../index.js')
mod.apply(ctx, { memeRoot: root })

const learn = tools.find((t) => t.name === 'learn_meme')
assert.ok(learn, 'learn_meme 工具应注册')
const api = handlers.find((h) => h.kind === 'exact' && h.path === '/dsh-memes-api')
assert.ok(api, '管理 API 应注册')

const execWith = (attachmentId) => ({
  agent: { inbox: { nextTurn: [{ content: [{ type: 'image', attachment: { attachmentId } }] }] } },
})

function mockPost(body) {
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/dsh-memes-api'
  req.headers = { host: '127.0.0.1:3999' }
  setImmediate(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

async function callApi(body) {
  const res = {
    status: 0,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(chunk) { this.body = chunk == null ? null : String(chunk) },
  }
  await api.handler(mockPost(body), res)
  let parsed = null
  try { parsed = res.body ? JSON.parse(res.body) : null } catch { parsed = null }
  return { status: res.status, body: parsed }
}

test('learn_meme:自动识图给 GIF 动图抽帧成胶片条,图库仍落盘原始动图', async () => {
  attachments.set('att-gif', { data: gifBuf, ref: { mediaType: 'image/gif', name: 'cat.gif' } })
  saved.length = 0
  llmCalls.length = 0

  const r = await learn.execute({}, execWith('att-gif'))
  assert.equal(r.ok, true, r.message)
  assert.match(r.path, /\.gif$/, '图库应保留 GIF 原图')
  assert.deepEqual(readFileSync(join(root, r.path)), gifBuf, '落盘字节应与原图一致')
  assert.match(r.message, /动图 2 帧/)
  assert.match(r.message, /已抽帧给模型/)

  // 送给模型的是胶片条 PNG,而不是原 GIF
  assert.equal(saved.length, 1)
  assert.equal(saved[0].mediaType, 'image/png')
  assert.match(saved[0].name, /-frames\.png$/)
  assert.equal(saved[0].data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')

  // 提示词里要有帧序说明,模型才知道自己在看「时间轴」
  assert.equal(llmCalls.length, 1)
  const content = llmCalls[0].messages[0].content
  assert.equal(content[0].type, 'text')
  assert.match(content[0].text, /GIF 动图:共 2 帧/)
  assert.match(content[0].text, /胶片条/)
  assert.equal(content[1].type, 'image')
  assert.equal(content[1].attachment.attachmentId, 'saved-1')
})

test('learn_meme:静态 PNG 行为不变,直接送原图、消息里没有动图字样', async () => {
  attachments.set('att-png', { data: pngBuf, ref: { mediaType: 'image/png', name: 'static.png' } })
  saved.length = 0
  llmCalls.length = 0

  const r = await learn.execute({}, execWith('att-png'))
  assert.equal(r.ok, true, r.message)
  assert.match(r.path, /\.png$/)
  assert.doesNotMatch(r.message, /,动图 \d+ 帧/)

  assert.equal(saved.length, 1)
  assert.equal(saved[0].mediaType, 'image/png')
  assert.equal(saved[0].name, 'static.png')
  assert.deepEqual(saved[0].data, pngBuf, '静态图应原样送模型')

  const prompt = llmCalls[0].messages[0].content[0].text
  assert.doesNotMatch(prompt, /胶片条/)
  assert.doesNotMatch(prompt, /动图/)
})

test('learn_meme:动图 WebP 只加元数据说明,仍送第一帧且不误报「已抽帧」', async () => {
  attachments.set('att-webp', { data: webpBuf, ref: { mediaType: 'image/webp', name: 'anim.webp' } })
  saved.length = 0
  llmCalls.length = 0

  const r = await learn.execute({}, execWith('att-webp'))
  assert.equal(r.ok, true, r.message)
  assert.match(r.message, /动图 2 帧/)
  assert.doesNotMatch(r.message, /已抽帧给模型/)

  assert.equal(saved.length, 1)
  assert.equal(saved[0].mediaType, 'image/webp')
  assert.deepEqual(saved[0].data, webpBuf)

  const prompt = llmCalls[0].messages[0].content[0].text
  assert.match(prompt, /WebP 动图/)
  assert.match(prompt, /第一帧/)
})

test('learn_meme:单帧 GIF 不算动图,走原来的单帧识图', async () => {
  attachments.set('att-single', { data: singleGifBuf, ref: { mediaType: 'image/gif', name: 'one.gif' } })
  saved.length = 0

  const r = await learn.execute({}, execWith('att-single'))
  assert.equal(r.ok, true, r.message)
  assert.match(r.path, /\.gif$/)
  assert.doesNotMatch(r.message, /,动图 \d+ 帧/)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].mediaType, 'image/gif')
})

test('recognize 接口:上传 GIF 时返回 animation 元数据并送胶片条', async () => {
  saved.length = 0
  const { status, body } = await callApi({
    op: 'recognize',
    fileName: 'cat.gif',
    dataBase64: gifBuf.toString('base64'),
  })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.tag, 'happy')
  assert.deepEqual(body.animation, { format: 'gif', frameCount: 2, totalMs: 300, filmstrip: true })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].mediaType, 'image/png')
  assert.match(saved[0].name, /-frames\.png$/)
})

test('recognize 接口:静态图返回 animation=null', async () => {
  saved.length = 0
  const { status, body } = await callApi({
    op: 'recognize',
    fileName: 'still.png',
    dataBase64: pngBuf.toString('base64'),
  })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.animation, null)
  assert.equal(saved[0].mediaType, 'image/png')
  assert.equal(saved[0].name, 'still.png')
})
