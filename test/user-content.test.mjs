import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

/**
 * 用户收藏的入库与保全(聊天反馈的四连问题):
 *
 * 1. 手动塞进图库目录的图片不显示 —— 列表只读 index.db,磁盘扫描没有入口。
 *    修法:scanPack 管理接口 + 面板「扫描新增」按钮,walkPackImages/scanRowFor 入库。
 * 2. 聊天附件里的 GIF 被 AI 学图后变成单帧 —— 宿主附件服务入库时把图片规范化成
 *    单帧 8-bit sRGB(dsh-attachment-local verifyNormalizedImage),原始字节进不来,
 *    插件侧无法还原。修法:learn_meme 检测「附件名 .gif 但字节不是 GIF」时在结果里
 *    明确告知,并给保真路径(面板上传 / 放进目录后扫描——原始字节原样落盘)。
 * 3. 插件更新清空收藏 —— 上传/学图写进 memes.root,默认是插件包内的内置图库,
 *    npm/pnpm 更新整个替换包目录。修法:写入目标分离(isInsidePluginPackage →
 *    「我的收藏」稳定图库,自动启用),启动时按出厂基线把内置库里的后加文件搬出去。
 * 4. 上传弹窗分类下拉只列现有分类 —— 补标准情绪,空库也能直接选。
 *
 * 这里覆盖纯函数(scanRowFor/walkPackImages/ensurePackAt/movePackEntries)与
 * scanPack / upload 重定向 / learn_meme 压平提示的管理接口路径。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-user-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const {
  scanRowFor, walkPackImages, ensurePackAt, movePackEntries, isInsidePluginPackage,
} = await import('../memes.js')

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')])

// ---------- 纯函数 ----------

test('scanRowFor:目录首段是分类,memes/ 前缀剥掉,非法/散图归 misc,path 保持磁盘原样', () => {
  assert.deepEqual(scanRowFor('memes/happy/a.jpg'), { path: 'memes/happy/a.jpg', tag: 'happy', file_name: 'a.jpg', caption: 'a' })
  assert.deepEqual(scanRowFor('happy/a.jpg'), { path: 'happy/a.jpg', tag: 'happy', file_name: 'a.jpg', caption: 'a' })
  assert.deepEqual(scanRowFor('sticker.gif'), { path: 'sticker.gif', tag: 'misc', file_name: 'sticker.gif', caption: 'sticker' })
  assert.deepEqual(scanRowFor('新建文件夹/b.webp'), { path: '新建文件夹/b.webp', tag: 'misc', file_name: 'b.webp', caption: 'b' })
  assert.deepEqual(scanRowFor('memes\\sleep\\c.png'), { path: 'memes/sleep/c.png', tag: 'sleep', file_name: 'c.png', caption: 'c' })
})

test('walkPackImages:递归收图,跳过 index.db/manifest/隐藏目录,扩展名过滤', () => {
  const dir = join(home, 'walk-pack')
  ensurePackAt(dir, { id: 'walk-pack', name: 'w' })
  const put = (rel, bytes = PNG) => {
    const p = join(dir, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, bytes)
  }
  put('memes/happy/keep.jpg')       // 已入索引的
  put('memes/happy/new.gif')        // 手动塞的动图
  put('work/deep/nested.webp')      // 任意子目录
  put('loose.png')                  // 散在根目录
  put('notes.txt')                  // 非图片:不收
  put('.hidden/x.jpg')              // 隐藏目录:不收
  assert.deepEqual(walkPackImages(dir), [
    'loose.png', 'memes/happy/keep.jpg', 'memes/happy/new.gif', 'work/deep/nested.webp',
  ])
})

test('ensurePackAt:建 manifest+空索引,已存在不动(幂等)', () => {
  const dir = join(home, 'idem-pack')
  ensurePackAt(dir, { id: 'idem-pack', name: 'A' })
  ensurePackAt(dir, { id: 'idem-pack', name: 'B' })
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.name, 'A', '第二次不覆盖')
})

test('isInsidePluginPackage:插件包内为真,包外为假(写入目标分离的判据)', () => {
  assert.equal(isInsidePluginPackage(join(repoRoot, 'memes', 'dafeiyu-001')), true)
  assert.equal(isInsidePluginPackage(join(home, 'some-pack')), false)
})

test('movePackEntries:文件+索引行搬到 memes/<tag>/,源删除,撞名加缀,缺失记 missing', () => {
  const src = join(home, 'move-src')
  const dst = join(home, 'move-dst')
  ensurePackAt(src, { id: 'move-src', name: 'S' })
  ensurePackAt(dst, { id: 'move-dst', name: 'D' })
  const { openIndexWriter } = memesMod
  const put = (root, rel, tag, caption = '', fileless = false) => {
    if (!fileless) {
      const p = join(root, rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, PNG)
    }
    openIndexWriter(root).prepare('INSERT INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(rel, tag, rel.split('/').pop(), caption, '', Date.now(), Date.now())
  }
  put(src, 'memes/happy/a.jpg', 'happy', '开心')
  put(src, 'b.gif', 'misc', '散图')
  put(src, 'memes/gone.jpg', 'happy', '', true) // 只有索引行,文件不存在
  // 目标已有同名文件 → 搬运要改名
  const clash = join(dst, 'memes/happy/a.jpg')
  mkdirSync(dirname(clash), { recursive: true })
  writeFileSync(clash, PNG)

  const r = movePackEntries(src, dst, ['memes/happy/a.jpg', 'b.gif', 'memes/gone.jpg', 'nope.jpg'])
  assert.deepEqual(r.missing.sort(), ['memes/gone.jpg', 'nope.jpg'].sort())
  assert.equal(r.moved.length, 2)
  assert.equal(existsSync(join(src, 'memes/happy/a.jpg')), false, '源文件已移走')
  assert.equal(existsSync(join(src, 'b.gif')), false)
  // 撞名:a.jpg → a_时间戳.jpg;描述保留
  const dstRows = openIndexWriter(dst).prepare('SELECT path, tag, caption FROM memes ORDER BY path').all()
  const movedA = dstRows.find((row) => /memes\/happy\/a_\d+\.jpg$/.test(row.path))
  assert.ok(movedA, '撞名文件加了时间缀: ' + JSON.stringify(dstRows.map((x) => x.path)))
  assert.equal(movedA.tag, 'happy')
  assert.equal(movedA.caption, '开心', '描述跟着搬')
  assert.ok(dstRows.some((row) => row.path === 'memes/misc/b.gif'), '散图归 misc')
  // 源索引行已删
  const srcLeft = openIndexWriter(src).prepare('SELECT path FROM memes').all()
  assert.deepEqual(srcLeft.map((x) => x.path), ['memes/gone.jpg'], '只剩缺文件的孤儿行')
})

// ---------- 管理接口 ----------

const memesMod = await import('../memes.js')

function createHost() {
  const handlers = []
  const tools = []
  const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
  const ctx = {
    effect(body) { return body() },
    on() { return () => {} },
    get(name) { return name === 'webServer' ? webServer : (name === 'attachments' ? { readImage: async () => attachment } : undefined) },
    tools: { register(tool) { tools.push(tool) } },
    agentDefaultModel: null,
  }
  return { ctx, handlers, tools }
}

let attachment = null

const host = createHost()
const mod = await import('../index.js')
// 先建包再 apply:memeRoot 指向不存在的目录会被 resolveActiveRoot 回落成插件包内的
// 内置图库,后面的断言就全错了(历史注释:isPackDir 只认有 index.db 的目录)。
ensurePackAt(join(home, 'api-pack'), { id: 'api-pack', name: '接口测试图库' })
mod.apply(host.ctx, { memeRoot: join(home, 'api-pack') })
const api = host.handlers.find((h) => h.path === '/dsh-memes-api')
assert.ok(api, '应注册管理 API')
const learn = host.tools.find((t) => t.name === 'learn_meme')
assert.ok(learn, '应注册 learn_meme')

const callApi = (method, body) => new Promise((resolve_, reject) => {
  const req = new EventEmitter()
  req.method = method
  req.url = '/'
  req.headers = { host: '127.0.0.1:3999' }
  const res = {
    statusCode: null, body: null,
    writeHead(status) { res.statusCode = status },
    end(b) { res.body = String(b); resolve_(res) },
  }
  api.handler(req, res).catch(reject)
  process.nextTick(() => {
    if (body) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
})
const post = (body) => callApi('POST', body)

test('scanPack:手动塞进目录的图片入库,分类取目录名;重复扫描幂等', async () => {
  const root = join(home, 'api-pack')
  const put = (rel) => {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, PNG)
  }
  // 先上传一张(改名入库、进索引),再手动塞三张没入索引的
  const uploaded = JSON.parse((await post({ op: 'upload', tag: 'happy', fileName: 'existing.jpg', dataBase64: PNG.toString('base64'), caption: '旧图' })).body)
  assert.equal(uploaded.ok, true, JSON.stringify(uploaded))
  put('memes/work/tangping.gif')
  put('shy/face.png')
  put('root-dropped.webp')

  const first = JSON.parse((await post({ op: 'scanPack' })).body)
  assert.equal(first.ok, true)
  assert.equal(first.added, 3, '三张新图入库: ' + first.message)
  assert.match(first.message, /3 张新图/)

  const second = JSON.parse((await post({ op: 'scanPack' })).body)
  assert.equal(second.added, 0, '已入库的不再重复收')

  const { MemesStore } = memesMod
  const store = new MemesStore(root)
  const rows = store.list().memes
  store.close()
  const byPath = Object.fromEntries(rows.map((r) => [r.path, r]))
  assert.ok(byPath['memes/work/tangping.gif'], '子目录图按原路径入库')
  assert.equal(byPath['memes/work/tangping.gif'].tag, 'work', '分类取目录名')
  assert.equal(byPath['shy/face.png'].tag, 'shy')
  assert.equal(byPath['root-dropped.webp'].tag, 'misc', '根目录散图归 misc')
  assert.equal(byPath['root-dropped.webp'].caption, 'root-dropped', '描述兜底取文件名')
  assert.equal(byPath['memes/work/tangping.gif'].keywords, '')
})

test('learn_meme:附件名 .gif 但字节已被压平 → 结果里告知并给保真路径', async () => {
  attachment = { data: PNG, ref: { mediaType: 'image/webp', name: 'dancing-cat.gif' } }
  const exec = { agent: { inbox: { nextTurn: [{ content: [{ type: 'image', attachment: { attachmentId: 'att-1' } }] }] } } }
  const r = await learn.execute({ tag: 'happy' }, exec)
  assert.equal(r.ok, true, r.message)
  assert.match(r.message, /压成单帧/)
  assert.match(r.message, /扫描新增|面板上传/)
})

test('learn_meme:真 GIF 字节(URL 分支下载原始字节)不提示压平', async () => {
  attachment = { data: Buffer.concat([Buffer.from('GIF89a'), Buffer.from('gif-body')]), ref: { mediaType: 'image/gif', name: 'ok.gif' } }
  const exec = { agent: { inbox: { nextTurn: [{ content: [{ type: 'image', attachment: { attachmentId: 'att-2' } }] }] } } }
  const r = await learn.execute({ tag: 'happy' }, exec)
  assert.equal(r.ok, true, r.message)
  assert.doesNotMatch(r.message, /压成单帧/)
})

test('upload:当前图库在插件包内时改写「我的收藏」并自动启用(升级不清空收藏)', async () => {
  // 在插件包目录里造一个临时图库(模拟内置图库的位置),上传必须落到包外。
  // 清理都带重试并容错:Windows 上刚写完的 index.db 常被杀软/索引器瞬时锁住,
  // rmSync 立刻失败;一旦硬失败留下残留,下一次运行的 pre-clean 会级联挂掉。
  const volatileDir = join(repoRoot, 'memes', '.volatile-test')
  const rmrf = (dir) => {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* 锁没放开就算了,下次运行再清 */ }
  }
  rmrf(volatileDir)
  ensurePackAt(volatileDir, { id: 'volatile-test', name: '易失图库' })
  const volatileHost = createHost()
  try {
    mod.apply(volatileHost.ctx, { memeRoot: volatileDir })
    const volatileApi = volatileHost.handlers.find((h) => h.path === '/dsh-memes-api')
    const res = await new Promise((resolve_, reject) => {
      const req = new EventEmitter()
      req.method = 'POST'; req.url = '/'; req.headers = { host: '127.0.0.1:3999' }
      const r = { statusCode: null, body: null, writeHead(s) { r.statusCode = s }, end(b) { r.body = String(b); resolve_(r) } }
      volatileApi.handler(req, r).catch(reject)
      process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify({ op: 'upload', tag: 'happy', fileName: 'keep.gif', dataBase64: Buffer.from('GIF89a-body').toString('base64') }))); req.emit('end') })
    })
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true, res.body)
    assert.match(body.meme.url, /\/dsh-memes\/dsh-meme-user\//, 'URL 带稳定图库前缀')
    assert.match(body.message || '', /我的收藏/, '提示已重定向')
    // 文件在包外,插件包目录里没有新文件
    const userDir = join(home, '.dsh', 'meme-packs', 'dsh-meme-user')
    assert.ok(existsSync(join(userDir, 'memes', 'happy')), '收藏落包外目录')
    const inVolatile = walkPackImages(volatileDir)
    assert.equal(inVolatile.length, 0, '易失图库保持只读')
    // 「我的收藏」已自动启用
    assert.ok(body.packs.some((p) => p.id === 'dsh-meme-user' && p.enabled === true), JSON.stringify(body.packs.map((p) => [p.id, p.enabled])))
  } finally {
    rmrf(volatileDir)
  }
})

after(() => {
  try { rmSync(join(repoRoot, 'memes', '.volatile-test'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* 锁没放开就算了 */ }
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // adminDb 对包外图库是常驻连接(openIndexWriter 的设计),进程不退就删不掉
    // temp home;留给系统清理临时目录,不算失败。
  }
})
