import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

/**
 * 深度体验反馈的四个修复的回归:
 *
 * 1. 面板分类筛选/编辑下拉只列写死的 6 个情绪桶,选「开心」还会把桶内细分类
 *    (like/meow/…)混进来——浏览是给人看的,要按图库里的真实 tag 精确匹配。
 * 2. 缩略图不显示(都是 jpg):扫描入库保留原始文件名,文件名带 # 等字符时
 *    URL 被浏览器截断成 404;图片 URL 要按段百分号编码。
 * 3. ZIP 导入被拒:「ZIP 含压缩条目」——unzipStore 只认 STORE,常规打包工具
 *    默认 DEFLATE;补上 DEFLATE 解压。
 * (扫描清理失效行在 user-content.test.mjs 里覆盖)
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-panel-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })
const settingsFile = join(home, '.dsh', 'dsh-expression.json')
const setSettings = (patch) => writeFileSync(settingsFile, JSON.stringify(patch || {}))

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const memesMod = await import('../memes.js')

const packDir = join(home, '.dsh', 'meme-packs', 'panel-pack')
memesMod.ensurePackAt(packDir, { id: 'panel-pack', name: '面板测试' })
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png')])
const seedRow = (rel, tag, caption) => {
  const w = memesMod.openIndexWriter(packDir)
  try {
    w.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(rel, tag, rel.split('/').pop(), caption, '', Date.now(), Date.now())
  } finally { w.close() }
}
seedRow('memes/happy/a.jpg', 'happy', '开心')
seedRow('memes/like/b.jpg', 'like', '比心')      // happy 桶的细分类
seedRow('memes/meow/c.jpg', 'meow', '喵喵')      // happy 桶的细分类
seedRow('memes/work/d.jpg', 'work', '上班')      // 不在情绪桶里的真实分类
seedRow('memes/misc/e.jpg', 'misc', '散图')      // 扫描产生的
// 文件名带 # 的图:URL 不编码时浏览器截断 → 缩略图 404
seedRow('memes/happy/f#1.jpg', 'happy', '带井号')
for (const rel of ['memes/happy/f#1.jpg', 'memes/happy/a.jpg', 'memes/like/b.jpg', 'memes/meow/c.jpg', 'memes/work/d.jpg', 'memes/misc/e.jpg']) {
  const p = join(packDir, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, PNG)
}

const handlers = []
const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
const ctx = {
  effect(body) { return body() },
  on() { return () => {} },
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register() {} },
  agentDefaultModel: null,
}
const mod = await import('../index.js')
mod.apply(ctx, { memeRoot: packDir })
const api = handlers.find((h) => h.path === '/dsh-memes-api')
const route = handlers.find((h) => h.kind === 'prefix')
assert.ok(api && route)

const callApi = (method, url, body) => new Promise((resolve_, reject) => {
  const req = new EventEmitter()
  req.method = method; req.url = url; req.headers = { host: '127.0.0.1:3999' }
  const res = {
    statusCode: null, body: null, headers: null,
    writeHead(s, hh) { res.statusCode = s; res.headers = hh },
    end(b) { res.body = String(b); resolve_(res) },
  }
  ;(method === 'GET' ? api.handler(req, res) : api.handler(req, res)).catch(reject)
  process.nextTick(() => {
    if (body) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
})
const get = (url) => callApi('GET', url)
const post = (body) => callApi('POST', '/', body)
const callRoute = (url) => callApi('GET', url).then((r) => r) // 路由与 API 同一前缀处理?不:路由在 prefix handler

test('分类下拉返回图库里的真实 tag(按张数),不再是写死的六个情绪桶', async () => {
  const r = JSON.parse((await get('/dsh-memes-api')).body)
  assert.equal(r.ok, true)
  assert.deepEqual(r.tags.sort(), ['happy', 'like', 'meow', 'work', 'misc'].sort())
  assert.ok(!r.tags.includes('angry'), '库里没有的分类不出现')
  assert.ok(!r.tags.includes('sad'))
})

test('按分类筛选是精确匹配:选 happy 不再把 like/meow 混进来', async () => {
  const happy = JSON.parse((await get('/dsh-memes-api?tag=happy')).body)
  assert.equal(happy.total, 2, '只有两张 tag=happy(a.jpg 和 f#1.jpg)')
  assert.ok(happy.memes.every((m) => m.tag === 'happy'))
  const work = JSON.parse((await get('/dsh-memes-api?tag=work')).body)
  assert.equal(work.total, 1)
  assert.equal(work.memes[0].tag, 'work')
})

test('图片 URL 按段编码:文件名带 # 的图缩略图可加载(路由 200)', async () => {
  const r = JSON.parse((await get('/dsh-memes-api?tag=happy')).body)
  const hashed = r.memes.find((m) => m.path === 'memes/happy/f#1.jpg')
  assert.ok(hashed, '带 # 的行还在')
  assert.equal(hashed.url, '/dsh-memes/panel-pack/memes/happy/f%231.jpg', 'URL 里的 # 已编码')
  // 用编码后的 URL 打图片路由:200 且 Content-Type 正确(路由先 decodeURIComponent,#28)
  let status = null
  let headers = null
  await new Promise((done) => {
    route.handler(
      { method: 'GET', url: '/dsh-memes/panel-pack/memes/happy/f%231.jpg', headers: { host: '127.0.0.1:3999' } },
      { writeHead(s, hh) { status = s; headers = hh }, end() { done() }, },
    )
  })
  assert.equal(status, 200, '编码后的 URL 路由能命中白名单')
  assert.equal(headers['Content-Type'], 'image/jpeg')
})

/** 造一个最小 ZIP:STORE 与 DEFLATE 条目各一(central directory + local headers) */
const buildZip = (entries) => {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, data, method] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const payload = method === 8 ? deflateRawSync(data) : data
    const crc = 0 // unzipStore 不校验 CRC
    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)
    locals.push(local, payload)
    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centrals.push(central)
    offset += local.length + payload.length
  }
  const body = Buffer.concat([...locals, ...centrals])
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(body.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([body, eocd])
}

test('unzipStore:支持 DEFLATE 压缩条目(常规打包工具的默认格式)', () => {
  const zip = buildZip([
    ['stored.txt', Buffer.from('plain'), 0],
    ['deflated.bin', Buffer.from('压'.repeat(100)), 8],
  ])
  const out = mod.unzipStore(zip)
  assert.equal(out.get('stored.txt').toString(), 'plain')
  assert.equal(out.get('deflated.bin').toString(), '压'.repeat(100), 'DEFLATE 解压正确')
})

test('导入 DEFLATE 压缩的 ZIP 图库成功(此前直接抛「ZIP 含压缩条目」)', async () => {
  const zip = buildZip([
    ['manifest.json', Buffer.from(JSON.stringify({ id: 'zip-pack', name: '压缩包图库', version: '1.0.0' })), 8],
    ['memes/happy/z.png', PNG, 8],
  ])
  const r = JSON.parse((await post({ op: 'importMemePack', dataBase64: zip.toString('base64'), name: '压缩包图库' })).body)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.packId, 'zip-pack')
  const list = JSON.parse((await get('/dsh-memes-api?packId=zip-pack')).body)
  assert.equal(list.total, 1)
  assert.equal(list.memes[0].tag, 'happy')
  // 顺带:切回 panel-pack,别影响后面的用例
  setSettings({ packId: 'panel-pack', memeRoot: packDir })
})

after(() => {
  setSettings({})
  try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* 常驻连接锁住,留给系统清理 */ }
})
