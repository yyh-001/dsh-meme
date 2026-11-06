import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

/**
 * issue #65:学图/上传存进订阅图库后,更新订阅会把收的图清掉。
 *
 * 订阅包在 ~/.dsh/meme-packs/<id>,不在插件包内,所以旧判据(只认
 * isInsidePluginPackage)不会把写入重定向到「我的收藏」;updateRemotePack /
 * installRemoteArchive 又把整个目录换成新下载的内容 → 收藏消失。
 *
 * 修复:带远程来源标记(.dsh-remote.json)或在 settings.remoteSubs 里的图库
 * 同样视为易失,写入改写「我的收藏」;扫描新增也把新文件搬过去。
 * 另外安装时写 enabledPacks 前再合并一次当前开关,避免并发安装互相覆盖。
 */

// ---- fixture:本地 HTTP 服务提供订阅 ZIP ----
const archives = new Map()
const fixture = createServer((req, res) => {
  const name = (req.url || '').split('?')[0].replace(/^\//, '').replace(/\.zip$/, '')
  const bytes = archives.get(name)
  if (!bytes) {
    res.writeHead(404)
    res.end('nope')
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(bytes.length) })
  res.end(bytes)
})
await new Promise((ok) => fixture.listen(0, '127.0.0.1', ok))
const base = 'http://127.0.0.1:' + fixture.address().port

// ---- 插件宿主 mock + 临时家目录 ----
const home = mkdtempSync(join(tmpdir(), 'dsh-meme-issue65-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const handlers = []
const webServer = {
  host: '127.0.0.1', port: 3999,
  register(r) { handlers.push(r) },
  tapIndex() {},
}
const ctx = {
  effect(body) { return body() },
  on() {},
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register() {} },
  agentDefaultModel: null,
}
const mod = await import('../index.js')
mod.apply(ctx, {})
const api = handlers.find((h) => h.path === '/dsh-memes-api')

const callApi = (method, body) => new Promise((resolve, reject) => {
  const req = new EventEmitter()
  req.method = method
  req.url = '/'
  req.headers = { host: '127.0.0.1:3999' }
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
const post = (body) => callApi('POST', body)
const waitJob = async (jobId, timeoutMs = 20000) => {
  const t0 = Date.now()
  for (;;) {
    const snap = JSON.parse((await post({ op: 'remoteJobStatus', jobId })).body)
    if (snap.state !== 'running') return snap
    if (Date.now() - t0 > timeoutMs) throw new Error('job timeout: ' + JSON.stringify(snap))
    await new Promise((ok) => setTimeout(ok, 50))
  }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')])
const packsRoot = join(home, '.dsh', 'meme-packs')
const userDir = join(packsRoot, 'dsh-meme-user')
const packDir = (id) => join(packsRoot, id)

function makeArchive(id, name, version, rows) {
  const work = mkdtempSync(join(tmpdir(), 'dsh-meme-issue65-db-'))
  const dbPath = join(work, 'index.db')
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
  const ins = db.prepare('INSERT INTO memes VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const row of rows) ins.run(row.rel, row.tag, basename(row.rel), row.caption || '', '', 1, 1)
  db.close()
  const zip = mod.zipStore([
    { name: 'index.db', data: readFileSync(dbPath) },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ id, name, version })) },
    ...rows.map((row) => ({ name: row.rel, data: row.data || PNG })),
  ])
  rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  return { zip, sha256: createHash('sha256').update(zip).digest('hex') }
}

function installArchive(archiveName, archive, packId) {
  archives.set(archiveName, archive.zip)
  return post({
    op: 'installRemoteArchive',
    archiveUrl: base + '/' + archiveName + '.zip',
    sha256: archive.sha256,
    packId,
  }).then((res) => waitJob(JSON.parse(res.body).id))
}

const dbRows = (dir) => {
  const db = new DatabaseSync(join(dir, 'index.db'), { readOnly: true })
  try { return db.prepare('SELECT path, tag, caption FROM memes ORDER BY path').all() } finally { db.close() }
}

const upload = async (fileName) => JSON.parse((await post({
  op: 'upload', tag: 'happy', fileName, dataBase64: PNG.toString('base64'), caption: '我收的图',
})).body)

// 订阅包 v1 → v2:v2 换掉旧图、加一张新图(和真实更新一样整目录替换)
const collectV1 = makeArchive('market-collect', '订阅测试包', '1.0.0', [
  { rel: 'memes/happy/from-archive.png', tag: 'happy', caption: '包里自带的图' },
])
const collectV2 = makeArchive('market-collect', '订阅测试包', '2.0.0', [
  { rel: 'memes/happy/from-archive-v2.png', tag: 'happy', caption: '更新后的图' },
  { rel: 'memes/shy/new.png', tag: 'shy', caption: '更新新增' },
])

test('订阅包被当作易失图库:上传落到「我的收藏」,更新订阅后仍在', async () => {
  const installed = await installArchive('collect', collectV1, 'market-collect')
  assert.equal(installed.state, 'done', JSON.stringify(installed))
  assert.equal(installed.packId, 'market-collect')
  assert.ok(existsSync(join(packDir('market-collect'), '.dsh-remote.json')), '远程包应带来源标记')

  const up = await upload('mine.png')
  assert.equal(up.ok, true, JSON.stringify(up))
  assert.match(up.meme.url, /\/dsh-memes\/dsh-meme-user\//, 'URL 指向「我的收藏」')
  assert.match(up.message || '', /我的收藏/)
  assert.match(up.message || '', /订阅图库更新时会整目录替换/, '提示要说清是订阅更新,不是插件升级')
  const rel = up.meme.path
  assert.ok(existsSync(join(userDir, rel)), '收藏落在包外「我的收藏」')
  assert.ok(!existsSync(join(packDir('market-collect'), rel)), '订阅包目录里不留用户图')
  assert.ok(dbRows(userDir).some((r) => r.path === rel && r.caption === '我收的图'), '「我的收藏」索引里有这条')

  // 更新订阅:整目录替换成 v2
  const updated = await installArchive('collect', collectV2, 'market-collect')
  assert.equal(updated.state, 'done', JSON.stringify(updated))
  assert.ok(existsSync(join(packDir('market-collect'), 'memes', 'shy', 'new.png')), '订阅包确实被更新了')
  assert.ok(!existsSync(join(packDir('market-collect'), 'memes', 'happy', 'from-archive.png')), '旧内容被整目录替换')

  // 收的图还在,索引行也还在
  assert.ok(existsSync(join(userDir, rel)), '更新订阅后收藏文件不能消失')
  assert.ok(dbRows(userDir).some((r) => r.path === rel), '更新订阅后收藏索引行不能消失')

  // 订阅记录没有被更新流程破坏
  const payload = JSON.parse((await post({ op: 'getMemeRoot' })).body)
  assert.ok(payload.remoteSubs.some((s) => s.id === 'market-collect'), '订阅记录仍在')
})

test('扫描新增:订阅包里手动拷入的图也搬去「我的收藏」', async () => {
  const pack = packDir('market-collect')
  const rel = 'memes/happy/manual-drop.png'
  mkdirSync(join(pack, 'memes', 'happy'), { recursive: true })
  writeFileSync(join(pack, rel), PNG)
  const res = JSON.parse((await post({ op: 'scanPack', packId: 'market-collect' })).body)
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(res.relocated, 1, '扫描订阅包时新图要搬走')
  assert.ok(existsSync(join(userDir, rel)), '文件搬进「我的收藏」')
  assert.ok(!existsSync(join(pack, rel)), '订阅包目录里不保留')
  assert.match((res.message || ''), /订阅图库更新时会整目录替换/)
})

test('普通用户图库不受影响:上传仍写进当前图库', async () => {
  const created = JSON.parse((await post({ op: 'createMemePack', id: 'plain-pack', name: '手工图库' })).body)
  assert.equal(created.ok, true, JSON.stringify(created))
  const up = await upload('plain.png')
  assert.equal(up.ok, true, JSON.stringify(up))
  assert.doesNotMatch(up.meme.url, /dsh-meme-user/, '普通图库不该被重定向')
  assert.equal(up.message || '', '', '普通图库不带重定向提示')
  assert.ok(existsSync(join(packDir('plain-pack'), up.meme.path)), '文件写进当前图库')
  assert.ok(dbRows(packDir('plain-pack')).some((r) => r.path === up.meme.path))
})

test('两个安装并发完成:两个新图库都保持启用', async () => {
  const a = makeArchive('race-a', '并发 A', '1.0.0', [{ rel: 'memes/happy/a.png', tag: 'happy' }])
  const b = makeArchive('race-b', '并发 B', '1.0.0', [{ rel: 'memes/happy/b.png', tag: 'happy' }])
  archives.set('race-a', a.zip)
  archives.set('race-b', b.zip)
  const started = await Promise.all([
    post({ op: 'installRemoteArchive', archiveUrl: base + '/race-a.zip', sha256: a.sha256, packId: 'race-a' }),
    post({ op: 'installRemoteArchive', archiveUrl: base + '/race-b.zip', sha256: b.sha256, packId: 'race-b' }),
  ])
  const snaps = await Promise.all(started.map((res) => waitJob(JSON.parse(res.body).id)))
  assert.deepEqual(snaps.map((s) => s.state), ['done', 'done'], JSON.stringify(snaps))
  const payload = JSON.parse((await post({ op: 'getMemeRoot' })).body)
  assert.ok(payload.enabledPacks.includes('race-a'), 'A 的开关被 B 覆盖了: ' + JSON.stringify(payload.enabledPacks))
  assert.ok(payload.enabledPacks.includes('race-b'), 'B 的开关被 A 覆盖了: ' + JSON.stringify(payload.enabledPacks))
})

after(() => {
  fixture.close()
  try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* adminDb 常驻连接,交给系统清临时目录 */ }
})
