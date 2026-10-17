import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

/**
 * 回归(issue #36):learn_meme 附件分支曾按附件元数据(mediaType / 文件名后缀)推导扩展名,
 * 不检查真实字节。元数据与实际内容不符时(如 JPEG 被标成 image/gif / 文件名 .gif),
 * 图会以 .gif 落盘;图片路由按扩展名查 MIME 表,于是这张 JPEG 以 Content-Type: image/gif 返回。
 *
 * 修法:落盘格式以魔数嗅探为准,元数据只作兜底;imageUrl 分支同样以字节为准。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-sniff-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home

// 临时图库根(带空索引):学图落盘落在临时目录,不碰仓库内置图库
const root = join(home, '.dsh', 'meme-packs', 'test-pack')
mkdirSync(root, { recursive: true })
const seed = new DatabaseSync(join(root, 'index.db'))
seed.exec('CREATE TABLE memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
seed.close()
writeFileSync(join(root, 'manifest.json'), JSON.stringify({ id: 'test-pack', name: '测试图库', version: '1.0.0' }))

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-body')])
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.from('gif-body')])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from('webp-body')])

// 测试用的「附件服务」:返回固定字节 + 可指定的元数据(元数据故意与字节不符)
let attachment = null

const tools = []
const handlers = []
const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
const ctx = {
  effect(body) { return body() },
  on() { return () => {} },
  get(name) {
    if (name === 'webServer') return webServer
    if (name === 'attachments') return { readImage: async () => attachment }
    return undefined
  },
  tools: { register(tool) { tools.push(tool) } },
  agentDefaultModel: null,
}

const mod = await import('../index.js')
mod.apply(ctx, { memeRoot: root })

const learn = tools.find((t) => t.name === 'learn_meme')
assert.ok(learn, 'learn_meme 工具应注册')
const route = handlers.find((h) => h.kind === 'prefix')
assert.ok(route, '图片路由应注册')

// 会话里有一张用户图附件,不传 attachmentId 时 learn_meme 默认收录最近一张
const exec = {
  agent: { inbox: { nextTurn: [{ content: [{ type: 'image', attachment: { attachmentId: 'att-1' } }] }] } },
}

const callRoute = (url) => {
  let status = null
  let headers = null
  route.handler({ method: 'GET', url, headers: { host: '127.0.0.1:3999' } }, {
    writeHead(s, h) { status = s; headers = h },
    end() {},
  })
  return { status, headers }
}

test('sniffImageMime:按魔数识别 jpeg/png/gif/webp,认不出返回空', () => {
  assert.equal(mod.sniffImageMime(JPEG), 'image/jpeg')
  assert.equal(mod.sniffImageMime(PNG), 'image/png')
  assert.equal(mod.sniffImageMime(GIF), 'image/gif')
  assert.equal(mod.sniffImageMime(WEBP), 'image/webp')
  assert.equal(mod.sniffImageMime(Buffer.from('not an image at all')), '')
  assert.equal(mod.sniffImageMime(Buffer.alloc(0)), '')
  assert.equal(mod.sniffImageMime(null), '')
})

test('issue #36:附件元数据说是 gif、字节是 PNG → 落盘 .png,路由返回 image/png', async () => {
  attachment = { data: PNG, ref: { mediaType: 'image/gif', name: 'learned.gif' } }
  const r = await learn.execute({ tag: 'happy' }, exec)
  assert.equal(r.ok, true, r.message)
  assert.match(r.path, /\.png$/, '扩展名必须由字节决定,而不是元数据/文件名')
  assert.deepEqual(readFileSync(join(root, r.path)), PNG, '落盘内容应与附件字节一致')

  // 图片路由按落盘扩展名查 MIME 表:修复前是 .gif → image/gif,修复后是 .png → image/png
  const served = callRoute('/dsh-memes/' + r.path)
  assert.equal(served.status, 200)
  assert.equal(served.headers['Content-Type'], 'image/png')
})

test('认不出字节时回退元数据扩展名(旧行为不丢)', async () => {
  attachment = { data: Buffer.from('legacy-bytes-nobody-sniffs'), ref: { mediaType: 'image/png', name: 'legacy.png' } }
  const r = await learn.execute({ tag: 'happy' }, exec)
  assert.equal(r.ok, true, r.message)
  assert.match(r.path, /\.png$/)
})

test('issue #36:imageUrl 响应头说 gif、字节是 JPEG → 落盘 .jpg', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'image/gif' : null) },
    arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.byteLength),
  })
  try {
    attachment = null
    const r = await learn.execute({ tag: 'happy', imageUrl: 'http://example.com/pic.gif' }, exec)
    assert.equal(r.ok, true, r.message)
    assert.match(r.path, /\.jpg$/, '响应头只是声明,字节才是真实格式')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('图库里不应出现按错误元数据落盘的 .gif(整轮下来的总检查)', () => {
  const files = readdirSync(join(root, 'memes', 'happy'))
  assert.ok(files.length >= 3)
  assert.ok(!files.some((f) => f.endsWith('.gif')), '没有一张图是 GIF 字节,不应有 .gif 落盘:' + files.join(','))
})
