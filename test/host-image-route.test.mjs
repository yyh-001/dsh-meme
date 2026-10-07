import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

/**
 * issue #28:图片路由未对 req.url 解码 → 图库里只要有非 ASCII 路径(中文目录/文件名),
 * 该图库**所有**图 404。浏览器发的路径是百分号编码的(%E4%B8%AD…),而白名单来自
 * index.db 里的原始路径(未编码),不先解码永远对不上:
 *   GET /dsh-memes/<pack>/memes/DeepSeek娘/079.webp      → 200
 *   GET /dsh-memes/<pack>/memes/DeepSeek%E5%A8%98/079.webp → 404
 * 同一磁盘文件只差编码与否,一 200 一 404。修法:路由入口 decodeURIComponent,
 * 畸形转义(%E5%A 这类手打的)按 404 兜底,不能抛 500;ASCII 路径行为不变。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-route-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
const packsDir = join(home, '.dsh', 'meme-packs')

const mkPack = (dir, id, rows) => {
  for (const [rowPath, caption, bytes] of rows) {
    mkdirSync(dirname(join(dir, rowPath)), { recursive: true })
    writeFileSync(join(dir, rowPath), bytes)
  }
  const db = new DatabaseSync(join(dir, 'index.db'))
  db.exec('CREATE TABLE memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
  for (const [rowPath, caption] of rows) {
    db.prepare('INSERT INTO memes VALUES (?,?,?,?,?,?,?)').run(rowPath, 'happy', rowPath.split('/').pop(), caption, caption, 1, 1)
  }
  db.close()
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, name: id, version: '1.0.0' }))
}

// 包内路径含中文目录+中文文件名;包 id 本身也是中文的,顺带钉住解码后的包前缀匹配
mkPack(join(packsDir, 'cn-pack'), 'cn-pack', [
  ['memes/中文分类/图一.jpg', '中文路径图', Buffer.from('CN-IMAGE-1')],
  ['memes/happy/plain.jpg', 'ASCII 路径图', Buffer.from('ASCII-IMAGE')],
])
mkPack(join(packsDir, '中文包'), '中文包', [
  ['memes/happy/b.jpg', '中文包的图', Buffer.from('CN-PACK-IMAGE')],
])

const handlers = []
const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
const ctx = {
  effect(body) { return body() },
  on() { return () => {} },
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register() { return () => {} } },
  agentDefaultModel: null,
}

const mod = await import('../index.js')
mod.apply(ctx, {})
const route = handlers.find((h) => h.kind === 'prefix')
assert.ok(route, 'prefix 路由应已注册')

const callRoute = (url) => {
  let status = null
  let body = null
  route.handler({ method: 'GET', url, headers: {} }, {
    writeHead(s) { status = s },
    end(b) { body = b },
  })
  return { status, body }
}

const CN = encodeURIComponent('中文分类') // %E4%B8%AD%E6%96%87%E5%88%86%E7%B1%BB
const IMG = encodeURIComponent('图一')
const PACK = encodeURIComponent('中文包')

test('issue #28 决定性对照:同一文件,百分号编码路径从 404 变 200', () => {
  const r = callRoute(`/dsh-memes/cn-pack/memes/${CN}/${IMG}.jpg`)
  assert.equal(r.status, 200, '编码过的中文路径必须能命中 index.db 里的原始路径')
  assert.equal(Buffer.from(r.body).toString(), 'CN-IMAGE-1')
})

test('未编码直发的原始 UTF-8 路径同样命中(有的客户端不转码)', () => {
  const r = callRoute(`/dsh-memes/cn-pack/memes/中文分类/图一.jpg`)
  assert.equal(r.status, 200)
  assert.equal(Buffer.from(r.body).toString(), 'CN-IMAGE-1')
})

test('ASCII 路径行为不变(解码是恒等变换,不能影响存量图库)', () => {
  const r = callRoute('/dsh-memes/cn-pack/memes/happy/plain.jpg')
  assert.equal(r.status, 200)
  assert.equal(Buffer.from(r.body).toString(), 'ASCII-IMAGE')
})

test('解码后的包前缀匹配:中文包 id 也能找到包', () => {
  const r = callRoute(`/dsh-memes/${PACK}/memes/happy/b.jpg`)
  assert.equal(r.status, 200, '包 id 含中文时,编码请求同样要能命中')
  assert.equal(Buffer.from(r.body).toString(), 'CN-PACK-IMAGE')
})

test('畸形转义按 404 兜底,不能抛 500/崩掉路由', () => {
  const r = callRoute(`/dsh-memes/cn-pack/memes/${CN.slice(0, -3)}.jpg`) // 截断的 %E5%A
  assert.equal(r.status, 404)
})

test('白名单语义不变:解码后不在 index.db 里的路径仍然 404', () => {
  assert.equal(callRoute(`/dsh-memes/cn-pack/memes/${CN}/不存在.jpg`).status, 404)
  assert.equal(callRoute('/dsh-memes/cn-pack/memes/%2E%2E/escape.jpg').status, 404, '../ 编码绕过也要挡在白名单上')
})
