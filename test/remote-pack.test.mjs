import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

// ---- fixture:本地 HTTP 服务提供清单与图片 ----
const fixtureDir = dirname(fileURLToPath(import.meta.url))
const imgBytes = readFileSync(join(fixtureDir, '..', 'memes', 'dafeiyu-001', 'memes', 'happy', 'ok.jpg'))
let currentManifest = null
let archiveBytes = Buffer.alloc(0)
let archiveSha256 = ''
const fixture = createServer((req, res) => {
  const url = (req.url || '').split('?')[0]
  if (url === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(currentManifest))
    return
  }
  if (url.startsWith('/img/')) {
    res.writeHead(200, { 'Content-Type': url.endsWith('.webp') ? 'application/octet-stream' : 'image/jpeg' })
    res.end(imgBytes)
    return
  }
  if (url === '/big.jpg') {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' })
    res.end(Buffer.alloc(8 * 1024 * 1024 + 1))
    return
  }
  if (url === '/catalog.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      schemaVersion: 1,
      packs: [{
        id: 'market-test', name: '市场测试包', version: '1.0.0', count: 1,
        archiveUrl: base + '/pack.zip', sha256: archiveSha256,
      }],
    }))
    return
  }
  if (url === '/pack.zip') {
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(archiveBytes.length) })
    res.end(archiveBytes)
    return
  }
  res.writeHead(404)
  res.end('nope')
})
await new Promise((ok) => fixture.listen(0, '127.0.0.1', ok))
const base = 'http://127.0.0.1:' + fixture.address().port

// ---- 启动插件(mock 宿主) ----
const home = mkdtempSync(join(tmpdir(), 'dsh-meme-remote-'))
process.env.HOME = home
const handlers = []
const webServer = {
  host: '127.0.0.1', port: 3999,
  register(r) { handlers.push(r) },
  tapIndex() {},
}
const ctx = {
  on() {},
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register() {} },
  agentDefaultModel: null,
}
const mod = await import('../index.js')
const archiveWork = mkdtempSync(join(tmpdir(), 'dsh-meme-archive-fixture-'))
const archiveDbPath = join(archiveWork, 'index.db')
const archiveDb = new DatabaseSync(archiveDbPath)
archiveDb.exec('CREATE TABLE memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
archiveDb.prepare('INSERT INTO memes VALUES (?, ?, ?, ?, ?, ?, ?)').run('memes/happy/test.jpg', 'happy', 'test.jpg', '市场测试', '测试', 1, 1)
archiveDb.close()
archiveBytes = mod.zipStore([
  { name: 'index.db', data: readFileSync(archiveDbPath) },
  { name: 'manifest.json', data: Buffer.from(JSON.stringify({ id: 'market-test', name: '市场测试包', version: '1.0.0' })) },
  { name: 'memes/happy/test.jpg', data: imgBytes },
])
archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex')
mod.apply(ctx, { remoteDirUrl: base + '/catalog.json' })
const api = handlers.find((h) => h.path === '/dsh-memes-api')
const route = handlers.find((h) => h.kind === 'prefix')

const callApi = (method, body, headers = {}) => new Promise((resolve, reject) => {
  const req = new EventEmitter()
  req.method = method
  req.url = '/'
  req.headers = { host: '127.0.0.1:3999', ...headers }
  const chunks = []
  const res = {
    statusCode: null, body: null,
    writeHead(s) { res.statusCode = s },
    end(b) { res.body = String(b); resolve(res) },
  }
  api.handler(req, res).catch(reject)
  process.nextTick(() => {
    if (body) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
})
const post = (body, headers) => callApi('POST', body, headers)
const get = async (qs = '') => {
  const req = new EventEmitter()
  req.method = 'GET'
  req.url = '/' + qs
  req.headers = { host: '127.0.0.1:3999' }
  const res = {
    statusCode: null, body: null,
    writeHead(s) { res.statusCode = s },
    end(b) { res.body = String(b) },
  }
  await new Promise((ok) => { res.end = (b) => { res.body = String(b); ok() }; api.handler(req, res).catch(() => {}) })
  return { statusCode: res.statusCode, json: JSON.parse(res.body) }
}
const waitJob = async (jobId, timeoutMs = 20000) => {
  const t0 = Date.now()
  for (;;) {
    const res = await post({ op: 'remoteJobStatus', jobId })
    const snap = JSON.parse(res.body)
    if (snap.state !== 'running') return snap
    if (Date.now() - t0 > timeoutMs) throw new Error('job timeout: ' + JSON.stringify(snap))
    await new Promise((ok) => setTimeout(ok, 60))
  }
}
const packDir = () => join(home, '.dsh', 'meme-packs', 'remote-test')
const dbRows = () => {
  const db = new DatabaseSync(join(packDir(), 'index.db'), { readOnly: true })
  try { return db.prepare('SELECT path, tag, caption FROM memes ORDER BY path').all() } finally { db.close() }
}

const v1 = {
  id: 'remote-test',
  name: '远程测试包',
  description: 'fixture',
  memes: [
    { url: base + '/img/a.jpg', tag: 'happy', caption: '测试开心', keywords: '开心', file: 'a.jpg' },
    { url: base + '/img/bad.jpg', tag: '日常', caption: '无效分类会被跳过' },
    { url: base + '/img/c.jpg', tag: 'confused', file: '../escape.jpg' },
    { url: base + '/img/d.webp', tag: 'sad' },
  ],
}
const v2 = {
  ...v1,
  version: 'v2',
  memes: [
    { ...v1.memes[0], caption: '测试开心2' },
    v1.memes[1],
    v1.memes[2],
    v1.memes[3],
    { url: base + '/img/e.jpg', tag: 'shy', caption: '新增害羞' },
  ],
}

test('subscribeRemote 拒绝非 http(s) 清单地址', async () => {
  const res = await post({ op: 'subscribeRemote', manifestUrl: 'file:///etc/passwd' })
  assert.equal(res.statusCode, 400)
  assert.match(res.body, /http\(s\)/)
})

test('发现页目录兼容 { packs: [] } ZIP 市场格式', async () => {
  const res = await get('?remoteDir=1')
  assert.equal(res.statusCode, 200)
  assert.equal(res.json.remoteDir.length, 1)
  assert.equal(res.json.remoteDir[0].id, 'market-test')
  assert.equal(res.json.remoteDir[0].archiveUrl, base + '/pack.zip')
})

test('subscribeRemote 全流程:下载建包建索引并自动切换', async () => {
  currentManifest = v1
  const res = await post({ op: 'subscribeRemote', manifestUrl: base + '/manifest.json' })
  assert.equal(res.statusCode, 200)
  const boot = JSON.parse(res.body)
  assert.equal(boot.ok, true)
  assert.equal(boot.total, 3) // 无效分类条目在规范化时跳过
  const snap = await waitJob(boot.id)
  assert.equal(snap.state, 'done', JSON.stringify(snap))
  assert.equal(snap.done, 3)
  assert.equal(snap.failed, 0)
  assert.ok(snap.warnings.some((w) => w.includes('跳过无效分类')), '无效分类应有警告')

  // 落盘结构
  assert.ok(existsSync(join(packDir(), 'index.db')))
  assert.ok(existsSync(join(packDir(), 'manifest.json')))
  assert.ok(existsSync(join(packDir(), '.dsh-remote.json')))
  // 路径穿越文件名被压成 basename,不会逃出包目录
  assert.ok(existsSync(join(packDir(), 'memes', 'confused', 'escape.jpg')))
  assert.ok(!existsSync(join(packDir(), '..', 'escape.jpg')) || !existsSync(join(home, '.dsh', 'meme-packs', 'escape.jpg')))
  // 索引:3 条有效(无效分类跳过)
  const rows = dbRows()
  assert.equal(rows.length, 3)
  assert.ok(rows.some((r) => r.path === 'memes/happy/a.jpg' && r.caption === '测试开心'))
  // 无 file 字段的条目按 URL 哈希生成 webp 文件名
  assert.ok(rows.some((r) => /^memes\/sad\/[0-9a-f]{12}\.webp$/.test(r.path)), JSON.stringify(rows))
  assert.ok(existsSync(join(packDir(), rows.find((r) => r.tag === 'sad').path)))

  // GET 带订阅信息,包列表里能看到
  const list = await get('?packId=all')
  assert.equal(list.json.remoteSubs.length, 1)
  assert.equal(list.json.remoteSubs[0].id, 'remote-test')
  assert.ok(list.json.packs.some((p) => p.id === 'remote-test'))
  // 自动切换生效
  assert.equal(list.json.packId, 'remote-test')
})

test('图片路由能服务下载的远程图', async () => {
  const p = new Promise((ok) => {
    const res = {
      statusCode: null, body: null,
      writeHead(s) { res.statusCode = s },
      end(b) { res.body = b; ok(res) },
    }
    const req = new EventEmitter()
    req.method = 'GET'
    req.url = '/dsh-memes/remote-test/memes/happy/a.jpg'
    req.headers = {}
    route.handler(req, res)
  })
  const res = await p
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.length, imgBytes.length)
})

test('重复提交同一清单自动转为增量更新(不重复下载)', async () => {
  const res = await post({ op: 'subscribeRemote', manifestUrl: base + '/manifest.json' })
  const snap = await waitJob(JSON.parse(res.body).id)
  assert.equal(snap.state, 'done', JSON.stringify(snap))
  assert.equal(snap.mode, 'update')
  assert.equal(snap.added, 0)
  assert.equal(snap.updated, 3)
  assert.equal(dbRows().length, 3)
})

test('updateRemotePack:清单变更时新增+刷新元数据', async () => {
  currentManifest = v2
  const res = await post({ op: 'updateRemotePack', id: 'remote-test' })
  assert.equal(res.statusCode, 200)
  const snap = await waitJob(JSON.parse(res.body).id)
  assert.equal(snap.state, 'done', JSON.stringify(snap))
  assert.equal(snap.mode, 'update')
  assert.equal(snap.added, 1)
  assert.equal(dbRows().length, 4)
  assert.ok(dbRows().some((r) => r.path === 'memes/happy/a.jpg' && r.caption === '测试开心2'))
  assert.ok(dbRows().some((r) => r.tag === 'shy' && r.caption === '新增害羞')) // 无 file 字段 → 哈希文件名
  // GET 里的订阅版本号已刷新
  const list = await get()
  assert.equal(list.json.remoteSubs[0].version, 'v2')
})

test('updateRemotePack:未知订阅报错', async () => {
  const res = await post({ op: 'updateRemotePack', id: 'no-such-sub' })
  assert.equal(res.statusCode, 400)
})

test('同名但非远程下载的包会被拒绝,不覆盖', async () => {
  const other = join(home, '.dsh', 'meme-packs', 'remote-test')
  rmSync(join(other, '.dsh-remote.json'))
  const noId = { name: '冒名包', memes: [{ url: base + '/img/a.jpg', tag: 'happy' }] }
  currentManifest = noId
  const res = await post({ op: 'subscribeRemote', manifestUrl: base + '/manifest.json', packId: 'remote-test' })
  const boot = JSON.parse(res.body)
  const snap = await waitJob(boot.id)
  assert.equal(snap.state, 'error')
  assert.match(snap.message, /同名图库/)
  assert.equal(dbRows().length, 4, '原包数据不受影响')
})

test('超限图片计入失败,任务不崩', async () => {
  const swBefore = await post({ op: 'setPack', packId: 'dafeiyu-001' })
  assert.equal(JSON.parse(swBefore.body).ok, true)
  rmSync(packDir(), { recursive: true, force: true }) // 清掉上一轮残留,避开同名拦截
  const big = { id: 'remote-test', name: '大图包', memes: [{ url: base + '/big.jpg', tag: 'happy', file: 'big.jpg' }] }
  currentManifest = big
  const res = await post({ op: 'subscribeRemote', manifestUrl: base + '/manifest.json' })
  const snap = await waitJob(JSON.parse(res.body).id)
  assert.equal(snap.failed, 1)
  assert.ok(snap.errors[0].includes('大小超限'))
  const swAfter = await post({ op: 'setPack', packId: 'dafeiyu-001' })
  assert.equal(JSON.parse(swAfter.body).ok, true)
  rmSync(packDir(), { recursive: true, force: true })
})

test('removeRemoteSub:使用中的包拒绝删除,切走后可删', async () => {
  // 先补一个干净的远程包并处于激活态
  currentManifest = v1
  const res = await post({ op: 'subscribeRemote', manifestUrl: base + '/manifest.json' })
  await waitJob(JSON.parse(res.body).id)
  const active = await post({ op: 'removeRemoteSub', id: 'remote-test', deleteFiles: true })
  assert.equal(active.statusCode, 400)
  assert.match(active.body, /正在使用/)

  const sw = await post({ op: 'setPack', packId: 'dafeiyu-001' })
  assert.equal(JSON.parse(sw.body).ok, true)
  const del = await post({ op: 'removeRemoteSub', id: 'remote-test', deleteFiles: true })
  assert.equal(JSON.parse(del.body).ok, true)
  assert.equal(JSON.parse(del.body).removedFiles, true)
  assert.ok(!existsSync(packDir()))
  const list = await get()
  assert.equal(list.json.remoteSubs.length, 0)
  assert.ok(!list.json.packs.some((p) => p.id === 'remote-test'))
})

test('非远程包不能走 removeRemoteSub 删除', async () => {
  const res = await post({ op: 'removeRemoteSub', id: 'dafeiyu-001', deleteFiles: true })
  assert.equal(res.statusCode, 400)
  assert.match(res.body, /未找到订阅/)
})

test('installRemoteArchive:下载、校验并安装市场 ZIP', async () => {
  const res = await post({
    op: 'installRemoteArchive', archiveUrl: base + '/pack.zip',
    sha256: archiveSha256, packId: 'market-test',
  })
  assert.equal(res.statusCode, 200, res.body)
  const out = JSON.parse(res.body)
  assert.equal(out.ok, true)
  assert.equal(out.packId, 'market-test')
  assert.equal(out.total, 1)
  const dir = join(home, '.dsh', 'meme-packs', 'market-test')
  assert.ok(existsSync(join(dir, 'index.db')))
  assert.ok(existsSync(join(dir, 'memes', 'happy', 'test.jpg')))
  const sidecar = JSON.parse(readFileSync(join(dir, '.dsh-remote.json'), 'utf8'))
  assert.equal(sidecar.sourceType, 'archive')
  assert.equal(sidecar.sha256, archiveSha256)
  assert.ok(out.remoteSubs.some((s) => s.id === 'market-test' && s.archiveUrl === base + '/pack.zip'))
})

test('installRemoteArchive:SHA-256 不一致时拒绝且不覆盖', async () => {
  const before = readFileSync(join(home, '.dsh', 'meme-packs', 'market-test', 'index.db'))
  const res = await post({
    op: 'installRemoteArchive', archiveUrl: base + '/pack.zip',
    sha256: '0'.repeat(64), packId: 'market-test',
  })
  assert.equal(res.statusCode, 400)
  assert.match(res.body, /SHA-256 校验失败/)
  const afterBytes = readFileSync(join(home, '.dsh', 'meme-packs', 'market-test', 'index.db'))
  assert.deepEqual(afterBytes, before)
})

after(() => {
  fixture.close()
  rmSync(archiveWork, { recursive: true, force: true })
})
