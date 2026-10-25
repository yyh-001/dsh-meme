import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * issue #53 回归:
 * 1. send_meme 候选(JSON hits)带 path/library 出处信息——用户问「这图哪来的」
 *    模型答得上;但用户可见的候选行仍不含路径,Web 模式发图仍只写 [表情: 描述]。
 * 2. 搜索没命中时,换词建议给真实分类统计(按张数),不再只甩静态情绪字典。
 * 3. meme_list / meme_update 维护工具:只读清单(按库/分类/关键词筛,path 前缀
 *    约定与 send_meme 候选一致)+ 改元数据(至少一项,只改索引)。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-i53-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })
const settingsFile = join(home, '.dsh', 'dsh-expression.json')
const setSettings = (patch) => writeFileSync(settingsFile, JSON.stringify(patch || {}))

const memesMod = await import('../memes.js')

const packsDir = join(home, '.dsh', 'meme-packs')
const seedPack = (id, rows) => {
  const dir = join(packsDir, id)
  memesMod.ensurePackAt(dir, { id, name: '图库-' + id })
  const w = memesMod.openIndexWriter(dir)
  try {
    for (const [rel, tag, caption, keywords] of rows) {
      w.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(rel, tag, rel.split('/').pop(), caption, keywords, Date.now(), Date.now())
    }
  } finally { w.close() }
  return dir
}
const mainDir = seedPack('main-pack', [
  ['memes/happy/a.jpg', 'happy', '开心到飞起', '开心 高兴'],
  ['memes/happy/b.jpg', 'happy', '开心到冒泡', '开心 冒泡'],
  ['memes/sad/c.jpg', 'sad', '好无语啊', '无语'],
])
const otherDir = seedPack('other-pack', [
  ['memes/happy/x.gif', 'happy', '别家的开心', '开心'],
])

function createHost() {
  const handlers = []
  const tools = []
  const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
  const ctx = {
    effect(body) { return body() },
    on() { return () => {} },
    get(name) { return name === 'webServer' ? webServer : undefined },
    tools: { register(tool) { tools.push(tool) } },
    agentDefaultModel: null,
  }
  return { ctx, handlers, tools }
}

const host = createHost()
const mod = await import('../index.js')
mod.apply(host.ctx, { memeRoot: mainDir })
const sendMeme = host.tools.find((t) => t.name === 'send_meme')
const memeList = host.tools.find((t) => t.name === 'meme_list')
const memeUpdate = host.tools.find((t) => t.name === 'meme_update')
assert.ok(sendMeme, 'send_meme 应注册')
assert.ok(memeList, 'meme_list 应注册(#53)')
assert.ok(memeUpdate, 'meme_update 应注册(#53)')

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const webExec = () => ({
  agent: {
    session: {
      id: 's1', header: { id: 's1', cwd: home },
      snapshotEvents: () => [
        { seq: 1, type: 'turn/start', data: { turn: 0 } },
        { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId: UUID }, content: [{ type: 'text', text: '嗨' }] } },
      ],
    },
  },
})

const rowOf = (packId, rel) => {
  const w = memesMod.openIndexWriter(join(packsDir, packId))
  try { return w.prepare('SELECT tag, caption, keywords FROM memes WHERE path = ?').get(rel) } finally { w.close() }
}

test('#53-1 Web 候选 JSON 带 path/library 出处,用户可见行不含路径', async () => {
  setSettings({})
  const r = await sendMeme.execute({ tag: 'happy', limit: 4 }, webExec())
  assert.equal(r.ok, true, r.message)
  assert.ok(r.hits.length > 0)
  assert.ok(r.hits.every((h) => typeof h.path === 'string' && h.path.length > 0), 'hits 带 path')
  assert.ok(r.hits.every((h) => typeof h.library === 'string' && h.library.length > 0), 'hits 带所属图库')
  assert.match(r.libraryHint || r.message, /[\s\S]*/)
  assert.doesNotMatch(r.message, /path=/, '用户可见候选行不含路径')
  assert.match(r.message, /出处信息/, '发图说明讲清 path/library 只是出处')
})

test('#53-1 跨库时候选 library 标明出处,path 带包前缀(非激活库)', async () => {
  setSettings({ enabledPacks: ['main-pack', 'other-pack'] })
  const r = await sendMeme.execute({ query: '别家', limit: 4 }, webExec())
  assert.equal(r.ok, true, r.message)
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].path, 'other-pack/memes/happy/x.gif', '非激活库 path 带前缀(与 send 约定一致)')
  assert.match(r.hits[0].library, /other-pack/)
  setSettings({})
})

test('#53-2 搜索没命中:换词建议给真实分类统计,不是静态字典', async () => {
  setSettings({})
  const r = await sendMeme.execute({ query: '完全不存在的词组', limit: 4 }, webExec())
  assert.equal(r.ok, false)
  assert.match(r.message, /happy\(2\)/, '真实统计 happy 2 张')
  assert.match(r.message, /sad\(1\)/)
  assert.doesNotMatch(r.message, /情绪字典/, '不再只甩静态字典')
})

test('#53-3 meme_list:默认跨启用库,带 library/tag/caption/path;q/tag/packId 可筛', async () => {
  setSettings({ enabledPacks: ['main-pack', 'other-pack'] })
  const all = await memeList.execute({}, webExec())
  assert.equal(all.ok, true, all.message)
  assert.equal(all.total, 4)
  assert.equal(all.rows.length, 4)
  assert.ok(all.rows.every((r) => typeof r.library === 'string' && r.path))
  const mainRows = all.rows.filter((r) => !r.path.startsWith('other-pack/'))
  const otherRows = all.rows.filter((r) => r.path.startsWith('other-pack/'))
  assert.equal(otherRows.length, 1, '非激活库 path 带前缀')
  assert.equal(mainRows.length, 3, '激活库 path 不带包前缀')

  const byQ = await memeList.execute({ q: '无语' }, webExec())
  assert.equal(byQ.total, 4)
  assert.equal(byQ.rows.length, 1)
  assert.match(byQ.rows[0].caption, /无语/)

  const byTag = await memeList.execute({ tag: 'happy' }, webExec())
  assert.equal(byTag.rows.length, 3)

  const byPack = await memeList.execute({ packId: 'other-pack' }, webExec())
  assert.equal(byPack.rows.length, 1)
  assert.equal(byPack.rows[0].path, 'other-pack/memes/happy/x.gif')

  const bad = await memeList.execute({ packId: 'nope' }, webExec())
  assert.equal(bad.ok, false)
  setSettings({})
})

test('#53-4 meme_update:改 caption/keywords/tag,只改索引;前缀路径与无前缀都能定位', async () => {
  setSettings({ enabledPacks: ['main-pack', 'other-pack'] })
  // 激活库:无前缀相对路径
  const r1 = await memeUpdate.execute({ path: 'memes/happy/a.jpg', caption: '开心得原地起飞', keywords: '开心 起飞' }, webExec())
  assert.equal(r1.ok, true, r1.message)
  const row1 = rowOf('main-pack', 'memes/happy/a.jpg')
  assert.equal(row1.caption, '开心得原地起飞')
  assert.equal(row1.keywords, '开心 起飞')

  // 非激活库:带包前缀路径(meme_list/send_meme 候选原样)
  const r2 = await memeUpdate.execute({ path: 'other-pack/memes/happy/x.gif', tag: 'daily', caption: '别家的日常' }, webExec())
  assert.equal(r2.ok, true, r2.message)
  const row2 = rowOf('other-pack', 'memes/happy/x.gif')
  assert.equal(row2.tag, 'daily')
  assert.equal(row2.caption, '别家的日常')
  // 只改指定的字段,其它字段保留
  assert.equal(row2.keywords, '开心')

  // 校验:一个字段都不给 / 未知路径 / 非法 tag
  assert.equal((await memeUpdate.execute({ path: 'memes/happy/a.jpg' }, webExec())).ok, false)
  assert.match((await memeUpdate.execute({ path: 'memes/nope.jpg', caption: 'x' }, webExec())).message, /找不到|没有/)
  assert.match((await memeUpdate.execute({ path: 'memes/happy/a.jpg', tag: '不合法' }, webExec())).message, /tag/)
  setSettings({})
})

after(() => {
  setSettings({})
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // adminDb 对包外图库是常驻连接(openIndexWriter 的设计),进程不退就删不掉
    // temp home;留给系统清理临时目录,不算失败。
  }
})
