import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs'
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
const fetchedUrls = []
const fixture = createServer((req, res) => {
  fetchedUrls.push(req.url || '')
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
// 插件用 os.homedir()(Windows 上没有 HOME),测试靠 DSH_MEME_HOME 把家目录指到临时目录
process.env.DSH_MEME_HOME = home
const handlers = []
const webServer = {
  host: '127.0.0.1', port: 3999,
  register(r) { handlers.push(r) },
  tapIndex() {},
}
const onHandlers = {}
const tools = []
const ctx = {
  on(name, fn) { (onHandlers[name] ||= []).push(fn) },
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register(tool) { tools.push(tool) } },
  agentDefaultModel: null,
}
const mod = await import('../index.js')
const memesMod = await import('../memes.js')
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

test('deleteMemePack:市场下载的包也能删,删完连订阅记录一起清掉', async () => {
  // 先补一个干净的远程包并处于激活态
  currentManifest = v1
  const res = await post({ op: 'subscribeRemote', manifestUrl: base + '/manifest.json' })
  await waitJob(JSON.parse(res.body).id)
  const active = await post({ op: 'deleteMemePack', packId: 'remote-test' })
  assert.equal(active.statusCode, 400)
  assert.match(active.body, /先切到别的图库/)

  const sw = await post({ op: 'setPack', packId: 'dafeiyu-001' })
  assert.equal(JSON.parse(sw.body).ok, true)
  const del = JSON.parse((await post({ op: 'deleteMemePack', packId: 'remote-test' })).body)
  assert.equal(del.ok, true)
  assert.ok(!existsSync(packDir()))
  assert.equal(del.remoteSubs.length, 0, '订阅记录要一起清掉')
  assert.ok(!del.packs.some((p) => p.id === 'remote-test'))
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


test('createMemePack creates an empty library and protects duplicate IDs and paths', async () => {
  const invalid = await post({ op: 'createMemePack', id: '../escape', name: 'invalid' })
  assert.equal(invalid.statusCode, 400)
  const created = await post({ op: 'createMemePack', id: 'personal-test', name: '我的图包', description: '原创' })
  const data = JSON.parse(created.body)
  assert.equal(data.ok, true)
  assert.equal(data.packId, 'personal-test')
  assert.equal(data.packs.find(p => p.id === 'personal-test').count, 0)
  assert.equal(data.packs.find(p => p.id === 'personal-test').version, '1.0.0', 'payload 要带上本地版本,面板靠它判断有没有更新')
  const duplicate = await post({ op: 'createMemePack', id: 'personal-test', name: '覆盖' })
  assert.equal(duplicate.statusCode, 400)

})


test('图库导出:packId 选包导出,未知包报错,空图库不下发 ZIP', async () => {
  const exporter = handlers.find(h => h.path === '/dsh-memes-export')
  const download = (qs) => {
    const res = { status: 0, body: null, writeHead(status) { this.status = status }, end(body) { this.body = body } }
    exporter.handler({ method: 'GET', url: '/dsh-memes-export' + (qs || '') }, res)
    return res
  }
  assert.equal(download('?packId=old-pack').status, 500, '未知图库应报错')
  assert.match(String(download('?packId=personal-test').body), /空图库/)
  const upload = await post({ op: 'upload', tag: 'happy', fileName: 'test.jpg', dataBase64: imgBytes.toString('base64'), caption: '测试投稿' })
  assert.equal(JSON.parse(upload.body).ok, true)
  const result = download('?packId=personal-test')
  assert.equal(result.status, 200)
  const entries = mod.unzipStore(result.body)
  assert.ok(entries.has('index.db'))
  const manifest = JSON.parse(entries.get('manifest.json'))
  assert.equal(manifest.id, 'personal-test')
  assert.ok([...entries.keys()].some(name => name.startsWith('memes/happy/')))

  // 不切当前图库也能导出别的包(图库页每张卡片都有「导出」)
  assert.equal(JSON.parse((await post({ op: 'createMemePack', id: 'other-test', name: '另一个' })).body).ok, true)
  const other = download('?packId=personal-test')
  assert.equal(other.status, 200, '当前图库已切到 other-test,仍应能导出 personal-test')
  assert.equal(JSON.parse(mod.unzipStore(other.body).get('manifest.json')).id, 'personal-test')
})


test('browse 列出目录(选择目录走插件自己的 API)', async () => {
  const listed = JSON.parse((await post({ op: 'browse', path: home })).body)
  assert.equal(listed.ok, true)
  assert.equal(listed.path, home)
  assert.ok(listed.entries.some((e) => e.name === '.dsh' && e.path.includes('.dsh')), '应列出 .dsh 目录')
  assert.ok(listed.parent, '应给出上一级路径')
  assert.ok(listed.breadcrumbs.length >= 2, '应给出面包屑')
  // 路径不存在时退回 home,不报错
  const fallback = JSON.parse((await post({ op: 'browse', path: join(home, 'nope-not-here') })).body)
  assert.equal(fallback.ok, true)
  assert.equal(fallback.path, home)
})


test('setPromptEnabled 关掉后不再注入陪伴提示词,开启后恢复', async () => {
  const assemble = onHandlers['system-prompt/assemble'][0]
  assert.ok(assemble, '应注册 system-prompt/assemble')
  const run = async () => {
    const assembled = { sections: [] }
    return assemble({}, {}, async () => assembled)
  }
  const withPrompt = await run()
  assert.ok(withPrompt.sections.some((s) => s.name === 'dsh-expression:companion'), '默认应注入陪伴提示词')

  const off = JSON.parse((await post({ op: 'setPromptEnabled', enabled: false })).body)
  assert.equal(off.ok, true)
  assert.equal(off.promptEnabled, false)
  assert.equal((await run()).sections.length, 0, '关掉后不应再注入')

  const on = JSON.parse((await post({ op: 'setPromptEnabled', enabled: true })).body)
  assert.equal(on.promptEnabled, true)
  assert.ok((await run()).sections.some((s) => s.name === 'dsh-expression:companion'), '开回来应恢复注入')
})


test('图库开关:可同时打开多个,关掉的图库不进候选', async () => {
  const tool = tools.find((t) => t.name === 'send_meme')
  assert.ok(tool, '应注册 send_meme 工具')

  // 两个各自只有一张图的图库,候选里出现谁的 caption 就说明抽到了谁
  const a = JSON.parse((await post({ op: 'createMemePack', id: 'switch-a', name: '开关A' })).body)
  assert.equal(a.ok, true)
  await post({ op: 'upload', tag: 'happy', fileName: 'a.jpg', dataBase64: imgBytes.toString('base64'), caption: 'A图专属' })
  const b = JSON.parse((await post({ op: 'createMemePack', id: 'switch-b', name: '开关B' })).body)
  assert.equal(b.ok, true)
  await post({ op: 'upload', tag: 'happy', fileName: 'b.jpg', dataBase64: imgBytes.toString('base64'), caption: 'B图专属' })
  assert.equal(a.packs.find((p) => p.id === 'switch-a').enabled, true, '新建的图库会打开开关,已有的开关状态保留')
  assert.equal(b.packs.find((p) => p.id === 'switch-b').enabled, true, '新建的图库默认打开开关')

  // 全部关掉 = 模型没有图可用,且给出人话原因
  for (const p of b.packs) await post({ op: 'setPackEnabled', packId: p.id, enabled: false })
  const none = await tool.execute({ tag: 'happy', limit: 20 })
  assert.equal(none.ok, false)
  assert.match(none.message, /没有打开任何图库/)

  // 只开 A
  const onlyA = JSON.parse((await post({ op: 'setPackEnabled', packId: 'switch-a', enabled: true })).body)
  assert.equal(onlyA.packs.find((p) => p.id === 'switch-a').enabled, true)
  const one = await tool.execute({ tag: 'happy', limit: 20 })
  assert.equal(one.ok, true)
  assert.match(one.message, /A图专属/)
  assert.doesNotMatch(one.message, /B图专属/)

  // A + B 同时开:两个图库的候选都在
  const both = JSON.parse((await post({ op: 'setPackEnabled', packId: 'switch-b', enabled: true })).body)
  assert.deepEqual(both.enabledPacks.slice().sort(), ['switch-a', 'switch-b'].concat(both.enabledPacks.filter((id) => !['switch-a', 'switch-b'].includes(id))).sort())
  const merged = await tool.execute({ tag: 'happy', limit: 20 })
  assert.match(merged.message, /A图专属/)
  assert.match(merged.message, /B图专属/)

  // 不存在的图库应报错
  assert.equal((await post({ op: 'setPackEnabled', packId: 'nope', enabled: true })).statusCode, 400)
})


test('packDeleteDir 只放行扫描目录/插件内置目录下的图库', () => {
  const packsDir = join(home, '.dsh', 'meme-packs')
  // 用户包:正好在扫描目录下
  assert.equal(memesMod.packDeleteDir({ id: 'mine', path: join(packsDir, 'mine'), source: 'user' }, packsDir), join(packsDir, 'mine'))
  // 用户包:指向别处 / 目录名与 id 不符 → 拒绝
  assert.throws(() => memesMod.packDeleteDir({ id: 'mine', path: home, source: 'user' }, packsDir), /预期不符/)
  assert.throws(() => memesMod.packDeleteDir({ id: 'mine', path: join(packsDir, 'other'), source: 'user' }, packsDir), /预期不符/)
  // 内置包:只认插件包内 memes/<id>
  const bundled = memesMod.bundledPacksDir()
  assert.equal(memesMod.packDeleteDir({ id: 'dafeiyu-001', path: join(bundled, 'dafeiyu-001'), source: 'bundled' }, packsDir), join(bundled, 'dafeiyu-001'))
  assert.throws(() => memesMod.packDeleteDir({ id: 'dafeiyu-001', path: packsDir, source: 'bundled' }, packsDir), /预期不符/)
  // 缺信息 / 越界 id 一律拒绝
  assert.throws(() => memesMod.packDeleteDir(null, packsDir), /不完整/)
  assert.throws(() => memesMod.packDeleteDir({ id: '', path: packsDir }, packsDir), /不完整/)
  assert.throws(() => memesMod.packDeleteDir({ id: '../escape', path: join(home, 'escape'), source: 'user' }, packsDir), /预期不符/)
})


test('deleteMemePack:能删自建图库,当前/订阅的拒绝', async () => {
  // 当前图库不能删
  const active = JSON.parse((await post({ op: 'setPack', packId: 'switch-b' })).body)
  assert.equal(active.ok, true)
  const delActive = await post({ op: 'deleteMemePack', packId: 'switch-b' })
  assert.equal(delActive.statusCode, 400)
  assert.match(delActive.body, /先切到别的图库/)

  // 内置包也能删(这里只验守卫放行,不真删仓库里的 memes/*;真删会毁掉工作区)
  const bundledPath = join(memesMod.bundledPacksDir(), 'dafeiyu-001')
  assert.equal(memesMod.packDeleteDir({ id: 'dafeiyu-001', path: bundledPath, source: 'bundled' }, join(home, '.dsh', 'meme-packs')), bundledPath)

  // 市场订阅的包同样走「删除」,删完订阅记录也不该留着
  const installed = await post({
    op: 'installRemoteArchive', archiveUrl: base + '/pack.zip',
    sha256: archiveSha256, packId: 'market-test',
  })
  assert.equal(installed.statusCode, 200, installed.body)
  await post({ op: 'setPack', packId: 'switch-a' })
  const delRemote = JSON.parse((await post({ op: 'deleteMemePack', packId: 'market-test' })).body)
  assert.equal(delRemote.ok, true)
  assert.ok(!delRemote.remoteSubs.some((s) => s.id === 'market-test'))
  assert.ok(!existsSync(join(home, '.dsh', 'meme-packs', 'market-test')))

  // 切走后可以删自建图库,目录真的没了
  await post({ op: 'setPack', packId: 'switch-a' })
  const dir = join(home, '.dsh', 'meme-packs', 'switch-b')
  assert.ok(existsSync(dir), '删除前目录应存在')
  const done = JSON.parse((await post({ op: 'deleteMemePack', packId: 'switch-b' })).body)
  assert.equal(done.ok, true)
  assert.equal(existsSync(dir), false, '删除后目录应消失')
  assert.ok(!done.packs.some((p) => p.id === 'switch-b'))
  assert.ok(!done.enabledPacks.includes('switch-b'), '开关列表里不应留脏 id')
})


test('resolveActiveRoot 忽略已经不存在或没有索引的目录', () => {
  const liveDir = join(home, '.dsh', 'meme-packs', 'live-test')
  mkdirSync(liveDir, { recursive: true })
  writeFileSync(join(liveDir, 'index.db'), '')
  // 还在的目录照用
  assert.equal(memesMod.resolveActiveRoot({ memeRoot: liveDir }), liveDir)
  // 死路径(比如内置包在升级后被移除)不能交给 MemesStore,否则插件整个起不来
  const stale = join(home, '.dsh', 'meme-packs', 'official-001')
  assert.equal(memesMod.resolveActiveRoot({ memeRoot: stale, packId: 'official-001' }), memesMod.defaultMemeRoot())
  // config 兜底(patch 里的 memeRoot)同样要求是真目录
  assert.equal(memesMod.resolveActiveRoot({ memeRoot: stale }, liveDir), liveDir)
  assert.equal(memesMod.resolveActiveRoot({ memeRoot: stale }, join(home, 'nope')), memesMod.defaultMemeRoot())
})


test('拉图库目录带时间戳(挡中间层缓存)', () => {
  const hits = fetchedUrls.filter((u) => u.split('?')[0] === '/catalog.json')
  assert.ok(hits.length > 0, '本轮应该拉过图库目录')
  // 中间层(透明代理等)会缓存 JSON:不带时间戳可能一直拿旧目录
  assert.ok(hits.every((u) => /[?&]t=\d+$/.test(u)), '每次都该带时间戳: ' + JSON.stringify(hits))
})


test('目录源顺序:raw 在前(jsDelivr 的 @main 缓存会滞留旧内容)', () => {
  const urls = mod.DEFAULT_REMOTE_DIR_URLS
  assert.ok(urls.length >= 2)
  const rawIdx = urls.findIndex((u) => u.includes('githubusercontent.com') && u.includes('catalog.json'))
  const jsdIdx = urls.findIndex((u) => u.includes('jsdelivr') && u.includes('catalog.json'))
  assert.ok(rawIdx >= 0 && jsdIdx >= 0, '两个源都要在: ' + JSON.stringify(urls))
  assert.ok(rawIdx < jsdIdx, 'raw 必须排在 jsDelivr 前面,否则会一直拿到缓存里的旧 catalog')
})


test('已安装图库带本地封面路径(不再依赖远程预览图)', async () => {
  // 新建的空图库没有图 → 没有封面
  const empty = JSON.parse((await post({ op: 'createMemePack', id: 'cover-empty', name: '空封面' })).body)
  assert.equal(empty.packs.find((p) => p.id === 'cover-empty').cover, '')
  // 传一张图后应给出插件自己路由的封面地址,且指向图库内真实存在的图
  await post({ op: 'upload', tag: 'happy', fileName: 'c.jpg', dataBase64: imgBytes.toString('base64'), caption: '封面测试' })
  const filled = JSON.parse((await post({ op: 'getMemeRoot' })).body)
  const pack = filled.packs.find((p) => p.id === 'cover-empty')
  assert.match(pack.cover, /^\/dsh-memes\/cover-empty\/memes\/happy\//, '封面应走插件自己的图片路由: ' + pack.cover)
  assert.ok(existsSync(join(home, '.dsh', 'meme-packs', 'cover-empty', pack.cover.replace('/dsh-memes/cover-empty/', ''))))
  // 同一图库每次算出的封面要一致
  const again = JSON.parse((await post({ op: 'getMemeRoot' })).body)
  assert.equal(again.packs.find((p) => p.id === 'cover-empty').cover, pack.cover)
})


test('安装完的图库默认打开开关(模型直接可用)', async () => {
  // 先把所有开关关掉
  for (const p of JSON.parse((await post({ op: 'getMemeRoot' })).body).packs) {
    await post({ op: 'setPackEnabled', packId: p.id, enabled: false })
  }
  // ZIP 里的 manifest id 是 market-test,requestedId 必须一致
  const res = await post({
    op: 'installRemoteArchive', archiveUrl: base + '/pack.zip',
    sha256: archiveSha256, packId: 'market-test',
  })
  assert.equal(res.statusCode, 200, res.body)
  const out = JSON.parse(res.body)
  assert.equal(out.packId, 'market-test', '装完应切到新图库')
  assert.ok(out.enabledPacks.includes('market-test'), '装完应把开关打开: ' + JSON.stringify(out.enabledPacks))
})


test('setPackCover:手动封面覆盖自动挑的,空路径恢复默认', async () => {
  // cover-empty 由前面的用例创建;上传/列表都作用于当前图库,先切过去
  assert.equal(JSON.parse((await post({ op: 'setPack', packId: 'cover-empty' })).body).ok, true)
  const before = JSON.parse((await post({ op: 'getMemeRoot' })).body)
  const pack = before.packs.find((p) => p.id === 'cover-empty')
  assert.ok(pack, 'cover-empty 图库应存在')
  assert.ok(pack.cover, '自动封面应存在')
  assert.equal(pack.customCover, '')

  await post({ op: 'upload', tag: 'happy', fileName: 'd.jpg', dataBase64: imgBytes.toString('base64'), caption: '第二张' })
  const listed = await get('?packId=all')
  const second = listed.json.memes.find((m) => m.caption === '第二张')
  assert.ok(second, '刚上传的图应能列出来')

  const set = JSON.parse((await post({ op: 'setPackCover', packId: 'cover-empty', path: second.path })).body)
  assert.equal(set.ok, true)
  const card = set.packs.find((p) => p.id === 'cover-empty')
  assert.equal(card.customCover, second.path)
  assert.equal(card.cover, '/dsh-memes/cover-empty/' + second.path)

  // 越界 / 文件不存在 / 图库不存在都要拒绝
  assert.equal((await post({ op: 'setPackCover', packId: 'cover-empty', path: '../../secret.jpg' })).statusCode, 400)
  assert.equal((await post({ op: 'setPackCover', packId: 'cover-empty', path: 'memes/happy/nope.jpg' })).statusCode, 400)
  assert.equal((await post({ op: 'setPackCover', packId: 'nope', path: 'x.jpg' })).statusCode, 400)

  // 空路径 = 恢复默认
  const reset = JSON.parse((await post({ op: 'setPackCover', packId: 'cover-empty', path: '' })).body)
  assert.equal(reset.packs.find((p) => p.id === 'cover-empty').customCover, '')
})


test('清单没 id 时用 URL 派生 id,任务不会碰扫描目录本身', async () => {
  // normalizeRemoteManifest 会用 URL 哈希兜底出 id;这条守住的是更重要的性质:
  // 任务只在自己那个子目录里干活,绝不会动到 meme-packs 根目录
  currentManifest = { ...v1, id: '', name: '无 id 清单' }
  const packsDir = join(home, '.dsh', 'meme-packs')
  const before = readdirSync(packsDir).slice().sort()
  assert.ok(before.length > 0, '前置条件:扫描目录里应有图库')
  const res = await post({ op: 'subscribeRemote', manifestUrl: base + '/manifest.json' })
  const jobId = JSON.parse(res.body).id
  const snap = await waitJob(jobId)
  assert.match(String(snap.packId || ''), /^remote-[0-9a-f]{8}$/, '应派生出一个安全 id: ' + snap.packId)
  const after = readdirSync(packsDir).slice().sort()
  for (const name of before) assert.ok(after.includes(name), '原有图库不能被删: ' + name)
  assert.ok(after.includes(snap.packId), '新图库应作为子目录出现')
  assert.ok(existsSync(join(packsDir, snap.packId, 'index.db')))
})
