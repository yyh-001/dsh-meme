import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { EventEmitter } from 'node:events'

/**
 * issue #23:嵌套导入的子库取不到图。
 *
 * 现场是这样来的:设置页把「图库目录」指到了**某个图库目录自己**(「选择目录」很容易点到
 * 包文件夹),之后导入的图库就嵌在那个包里面 → `memes/<主库>/<子库>/index.db`。而
 * scanPacks() 只扫扫描目录的直接子目录,于是:
 *   - 子库扫不到 → 它的图 404(描述能对上、图对不上,用户很难查)
 *   - 更迷惑的是**主库自己也从列表里消失**(它不再是扫描目录的子目录)
 *
 * 这里钉住三层:
 *   ① setPacksDir 拒绝把包目录当扫描目录 → 从源头不再产生这种布局
 *   ② scanPacks 容忍磁盘上已有的:扫描目录自己是包也算上,包下再嵌一层也收
 *   ③ 图片路由:认出来是包前缀就必须找到那个包,找不到显式 404,不再静默按当前图库拼路径
 * 外加 packDeleteDir 要能删掉嵌套包(不然列表里列着却删不动)。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-nested-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
const packsDir = join(home, '.dsh', 'meme-packs')

const mkPack = (dir, id, rowPath, caption, bytes) => {
  mkdirSync(join(dir, 'memes', 'happy'), { recursive: true })
  const db = new DatabaseSync(join(dir, 'index.db'))
  db.exec('CREATE TABLE memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
  db.prepare('INSERT INTO memes VALUES (?,?,?,?,?,?,?)').run(rowPath, 'happy', rowPath.split('/').pop(), caption, caption, 1, 1)
  db.close()
  writeFileSync(join(dir, rowPath), bytes)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, name: id, version: '1.0.0' }))
}

// 平级的主库 + 嵌在主库里面的子库(历史现场)
const mainDir = join(packsDir, 'main-pack')
mkPack(mainDir, 'main-pack', 'memes/happy/main.jpg', '主库图', Buffer.from('MAINIMAGE'))
const subDir = join(mainDir, 'sub-pack')
mkPack(subDir, 'sub-pack', 'memes/happy/sub.jpg', '子库图', Buffer.from('SUBIMAGE'))

const handlers = []
const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
const ctx = {
  effect(body) { return body() },
  on() { return () => {} },
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register() { return () => {} } },
  agentDefaultModel: null,
}

const memesMod = await import('../memes.js')
const mod = await import('../index.js')
mod.apply(ctx, {})

const api = handlers.find((h) => h.path === '/dsh-memes-api')
const route = handlers.find((h) => h.kind === 'prefix')

const getJson = (qs = '') => new Promise((ok) => {
  const req = new EventEmitter()
  req.method = 'GET'
  req.url = '/' + qs
  req.headers = { host: '127.0.0.1:3999' }
  const res = { statusCode: null, writeHead(s) { res.statusCode = s }, end(b) { res.body = String(b); ok(res) } }
  api.handler(req, res).catch(() => ok(res))
})
const post = (body) => new Promise((ok) => {
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/'
  req.headers = { host: '127.0.0.1:3999' }
  const res = { statusCode: null, writeHead(s) { res.statusCode = s }, end(b) { res.body = String(b); ok(res) } }
  api.handler(req, res).catch(() => ok(res))
  process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') })
})
const getImg = (url) => new Promise((ok) => {
  const req = new EventEmitter()
  req.method = 'GET'
  req.url = url
  req.headers = {}
  const res = { statusCode: null, writeHead(s) { res.statusCode = s }, end(b) { res.body = String(b); ok(res) } }
  route.handler(req, res)
})

test('② scanPacks 能扫到嵌套子库(以及扫描目录自己就是包时的主库)', () => {
  const ids = memesMod.scanPacks(packsDir).map((p) => p.id)
  assert.ok(ids.includes('main-pack'), '平级主库应在列表里: ' + ids.join(','))
  assert.ok(ids.includes('sub-pack'), '嵌在主库里的子库也应被扫到: ' + ids.join(','))
  // 嵌套那层不能把目录里的普通文件也当成包
  assert.ok(!ids.includes('memes') && !ids.includes('index.db'), '不该把包里的文件当图库: ' + ids.join(','))
})

test('② 扫描目录自己就是包时,那个包也不能从列表里消失', () => {
  const ids = memesMod.scanPacks(mainDir).map((p) => p.id)
  assert.ok(ids.includes('main-pack'), '扫描目录本身是包时要收进来: ' + ids.join(','))
  assert.ok(ids.includes('sub-pack'), '嵌在里面的子库也要收: ' + ids.join(','))
})

test('① setPacksDir 拒绝把包目录当扫描目录(嵌套的来源)', async () => {
  const res = JSON.parse((await post({ op: 'setPacksDir', packsDir: mainDir })).body)
  assert.equal(res.ok, false)
  assert.match(res.error, /本身就是一个图库/, '要告诉用户为什么不行: ' + res.error)
  const after = JSON.parse((await getJson()).body)
  assert.notEqual(after.packsDir, mainDir, '被拒绝时不该写进设置')
})

test('③ 嵌套子库的图能取到(url 前缀能解析到包) ', async () => {
  const res = await getImg('/dsh-memes/sub-pack/memes/happy/sub.jpg')
  assert.equal(res.statusCode, 200, '子库扫到之后它的图就该 200')
  assert.equal(res.body, 'SUBIMAGE')
})

test('③ 未知包前缀显式 404,不再静默按当前图库拼路径', async () => {
  const res = await getImg('/dsh-memes/no-such-pack/memes/happy/main.jpg')
  assert.equal(res.statusCode, 404)
  assert.match(res.body, /未知图库 no-such-pack/, '要说清是哪个包找不到: ' + res.body)
})

test('③ 旧格式(不带包前缀)仍按当前图库取图', async () => {
  const sw = JSON.parse((await post({ op: 'setPack', packId: 'main-pack' })).body)
  assert.equal(sw.ok, true, sw.error || '')
  const res = await getImg('/dsh-memes/memes/happy/main.jpg')
  assert.equal(res.statusCode, 200, '不带前缀的老 url 必须还能用')
  assert.equal(res.body, 'MAINIMAGE')
})

test('② 列表里能切到嵌套子库(packId=all 也会带上它的图)', async () => {
  const list = JSON.parse((await getJson()).body)
  assert.ok(list.packs.some((p) => p.id === 'sub-pack'), '设置页应能看到子库: ' + list.packs.map((p) => p.id).join(','))
  const all = JSON.parse((await getJson('?packId=all')).body)
  assert.ok(all.memes.some((m) => m.url === '/dsh-memes/sub-pack/memes/happy/sub.jpg'), '子库的图应进前端配图索引')
})

test('packDeleteDir:嵌套包可删(仍在扫描目录子树内),越界与扫描目录本身拒绝', () => {
  assert.equal(memesMod.packDeleteDir({ id: 'sub-pack', path: subDir, source: 'user' }, packsDir), subDir)
  assert.equal(memesMod.packDeleteDir({ id: 'main-pack', path: mainDir, source: 'user' }, packsDir), mainDir)
  assert.throws(() => memesMod.packDeleteDir({ id: 'x', path: home, source: 'user' }, packsDir), /预期不符/)
  assert.throws(() => memesMod.packDeleteDir({ id: 'meme-packs', path: packsDir, source: 'user' }, packsDir), /改到上级目录/)
  assert.throws(() => memesMod.packDeleteDir({ id: 'sub-pack', path: subDir, source: 'bundled' }, packsDir), /预期不符/)
})
