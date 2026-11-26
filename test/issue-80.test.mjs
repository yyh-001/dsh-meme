/**
 * issue #80 回归测试:send_meme 返回里「发图」说明排在 hits 之前,Web 模式
 * hits[] 每项带现成可复制的 `token`(`[表情: 描述]`,与候选行逐字一致)。
 *
 * 背景:模型先读 hits JSON、后读 message 时,容易拿 caption 自己手拼标记并跳过
 * 末尾的说明。修复后:
 * - 成功返回对象的键序改成 message 在 hits 之前(keyword / mood 两条分支);
 * - Web 模式 hits 增加 token(半角冒号 + 空格),与 lines() 候选行逐字一致;
 * - 非 Web 渠道(纯文字 / dsh-im / OneBot / companion QQ 两步模式)严禁出现
 *   token,也不能泄露 [表情: ...] 候选行——那边方括号只是普通文本,会把描述
 *   泄露到聊天里;
 * - 工具描述 / IMAGE_MODE_RULE / AGENTS.md 不再说「结果末尾」。
 *
 * 图库用临时目录里的独立包(DSH_MEME_HOME 隔离),这样可以精确构造
 * 空 caption、null caption、超 80 字符截断等边界数据,不碰仓库里的真实图库。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-issue80-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
// OneBot 账本路径跟宿主 dshHome 走:显式指到临时目录,避免读到开发机上的真实账本
process.env.DSH_HOME = join(home, '.dsh')
mkdirSync(join(home, '.dsh'), { recursive: true })
const settingsFile = join(home, '.dsh', 'dsh-expression.json')

const mod = await import('../index.js')
const { ensurePackAt } = await import('../memes.js')

// ---- 临时图库:一个最小包 + 精确构造的索引行 ----

const PACK_ID = 'issue80-test'
const PACK_NAME = 'Issue80 测试库'
const packRoot = join(home, '.dsh', 'meme-packs', PACK_ID)
ensurePackAt(packRoot, { id: PACK_ID, name: PACK_NAME, description: 'issue #80 回归测试图库' })

/** 超过 80 字符的描述:captionOf 会截到 80,token 必须跟着截断后的 caption 走 */
const LONG_CAPTION = '很长的描述'.repeat(25) // 125 字

const ROWS = [
  // 正常 caption,同时当关键词命中用例
  { path: 'memes/happy/cat-normal.jpg', tag: 'happy', file_name: 'cat-normal.jpg', caption: '比心猫猫', keywords: '猫 比心' },
  // 边界:caption 为空字符串 → 回退 file_name
  { path: 'memes/happy/cat-empty.jpg', tag: 'happy', file_name: 'cat-empty.jpg', caption: '', keywords: '' },
  // 边界:caption 为 null(索引里缺描述)→ 回退 file_name
  { path: 'memes/happy/cat-null.jpg', tag: 'happy', file_name: 'cat-null.jpg', caption: null, keywords: '' },
  // 边界:caption 超 80 字符 → 截断
  { path: 'memes/happy/cat-long.jpg', tag: 'happy', file_name: 'cat-long.jpg', caption: LONG_CAPTION, keywords: '' },
  // 关键词不命中、按 query 推断情绪(daily)时用的行
  { path: 'memes/daily/fish.jpg', tag: 'daily', file_name: 'fish.jpg', caption: '摸鱼中', keywords: '' },
]

for (const row of ROWS) {
  const abs = join(packRoot, row.path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, Buffer.from([0xff, 0xd8, 0xff, 0xd9])) // 内容无关,只要文件存在
}
{
  const db = new DatabaseSync(join(packRoot, 'index.db'))
  try {
    const insert = db.prepare(
      'INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    for (const row of ROWS) {
      insert.run(row.path, row.tag, row.file_name, row.caption, row.keywords || '', Date.now(), Date.now())
    }
  } finally {
    db.close()
  }
}

/** 直接写设置文件:插件每次请求都重读,等价于面板里点保存;packId 固定成本用例的图库 */
const setSettings = (patch = {}) => writeFileSync(settingsFile, JSON.stringify({ packId: PACK_ID, ...patch }))

// ---- 宿主 mock 与工具 ----

function createHost(extraGet = {}) {
  const handlers = []
  const onHandlers = {}
  const tools = []
  const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
  const ctx = {
    effect(body) { return body() },
    on(name, fn) { (onHandlers[name] ||= []).push(fn) },
    get(name) {
      if (name === 'webServer') return webServer
      if (Object.prototype.hasOwnProperty.call(extraGet, name)) return extraGet[name]
      return undefined
    },
    tools: { register(tool) { tools.push(tool) } },
    agentDefaultModel: null,
  }
  mod.apply(ctx, { memeRoot: packRoot })
  return {
    ctx,
    tools,
    onHandlers,
    sendMeme: tools.find((t) => t.name === 'send_meme'),
    assemble: onHandlers['system-prompt/assemble']?.[0],
  }
}

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const WEB_SESSION_ID = 'session-issue80-web'
const ONEBOT_SESSION_ID = '22109686-120f-9f40-d05e-4efce7f6c7df'

/** rpcId 带渠道前缀 = dsh-im 会话来;裸 uuid = Web 会话;空 = QQ 注入的消息 */
const session = ({ rpcId = UUID, id = WEB_SESSION_ID } = {}) => ({
  id,
  header: { id, cwd: home },
  snapshotEvents: () => [
    { seq: 1, type: 'turn/start', data: { turn: 0 } },
    {
      seq: 2,
      type: 'user/message',
      data: {
        source: rpcId ? { kind: 'user', rpcId } : { kind: 'user' },
        content: [{ type: 'text', text: '在吗' }],
      },
    },
  ],
})
const agentOf = (s) => ({ agent: { session: s } })
const webSession = () => session()
const imSession = (channel) => session({ rpcId: channel + '-' + UUID })

/** OneBot 账本:sessionId 命中即判 OneBot 渠道(与 dsh-qq-onebot 同一把钥匙) */
const onebotStateFile = join(home, '.dsh', 'dsh-qq', 'session-state.json')
mkdirSync(dirname(onebotStateFile), { recursive: true })
writeFileSync(onebotStateFile, JSON.stringify({
  gens: {},
  turns: {},
  sessions: { 'qq:1312547902:group:868395596@iso': ONEBOT_SESSION_ID },
}))
const onebotSession = () => session({ rpcId: '', id: ONEBOT_SESSION_ID })

// ---- 断言辅助 ----

/** 从 message 里取出候选行的 [表情: ...] 文本(去掉行号),顺序与 hits 一致 */
const candidateMarkers = (message) => String(message || '')
  .split(/\r?\n/)
  .filter((line) => /^\d+\. \[表情: /.test(line))
  .map((line) => line.replace(/^\d+\. /, ''))

/** issue #80 的核心:message 必须排在 hits 前,模型才会先读「发图」说明再读候选 JSON */
const assertMessageBeforeHits = (res) => {
  const keys = Object.keys(res)
  const mi = keys.indexOf('message')
  const hi = keys.indexOf('hits')
  assert.ok(mi >= 0 && hi >= 0, '返回对象必须同时有 message 与 hits,实际键序: ' + keys.join(','))
  assert.ok(mi < hi, 'message 应排在 hits 之前,实际键序: ' + keys.join(','))
}

/** Web 候选字段:token 与 caption/path/absPath/library 并存(字段集合固定,防止意外增删) */
const WEB_HIT_KEYS = ['absPath', 'caption', 'library', 'path', 'token']

/** token 必须是半角冒号 + 空格,且与 caption 逐字一致 */
const assertTokenOf = (hit) => {
  assert.equal(hit.token, '[表情: ' + hit.caption + ']', 'token 必须与 caption 逐字一致: ' + hit.token)
  assert.match(hit.token, /^\[表情: /, 'token 要用半角冒号 + 空格')
  assert.ok(!hit.token.includes('：'), 'token 不能出现全角冒号: ' + hit.token)
}

after(() => {
  try { setSettings({}) } catch { /* 临时目录可能已删 */ }
  try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* 常驻句柄交给系统清理 */ }
})

// ---- 正常路径 ----

test('Web 关键词命中分支:message 在 hits 之前,token 与候选行逐字一致', async () => {
  setSettings({})
  const host = createHost()
  const res = await host.sendMeme.execute({ query: '比心猫猫', limit: 3 }, agentOf(webSession()))

  assert.equal(res.ok, true)
  assert.equal(res.mode, 'keyword', '命中关键词应走 keyword 分支')
  assertMessageBeforeHits(res)
  assert.equal(res.hits.length, 1)

  const hit = res.hits[0]
  assert.equal(hit.caption, '比心猫猫')
  assert.deepEqual(Object.keys(hit).sort(), WEB_HIT_KEYS, 'Web 候选字段应保持 caption/path/absPath/library/token')
  assertTokenOf(hit)

  // 与用户可见候选行逐字一致
  assert.deepEqual(candidateMarkers(res.message), res.hits.map((h) => h.token))

  // 出处字段保留,但候选行不贴路径
  assert.ok(isAbsolute(hit.path) && existsSync(hit.path), 'path 应是存在的绝对路径: ' + hit.path)
  assert.ok(isAbsolute(hit.absPath) && existsSync(hit.absPath), 'absPath 应是存在的绝对路径: ' + hit.absPath)
  assert.equal(typeof hit.library, 'string')
  assert.doesNotMatch(res.message, /path=/, 'Web 候选行不能出现 path=')
})

test('Web 情绪抽样分支:message 在 hits 之前,每条 token 与候选行逐字一致', async () => {
  setSettings({})
  const host = createHost()
  const res = await host.sendMeme.execute({ tag: 'happy', limit: 20 }, agentOf(webSession()))

  assert.equal(res.ok, true)
  assert.equal(res.mode, 'mood')
  assertMessageBeforeHits(res)
  assert.equal(res.hits.length, 4, 'happy 池里 4 张都应返回')

  for (const hit of res.hits) {
    assert.deepEqual(Object.keys(hit).sort(), WEB_HIT_KEYS)
    assertTokenOf(hit)
    assert.equal(typeof hit.caption, 'string')
    assert.ok(isAbsolute(hit.path) && existsSync(hit.path))
    assert.ok(isAbsolute(hit.absPath) && existsSync(hit.absPath))
    assert.equal(typeof hit.library, 'string')
  }
  assert.deepEqual(candidateMarkers(res.message), res.hits.map((h) => h.token))
  assert.doesNotMatch(res.message, /path=/)
})

// ---- 边界条件 ----

test('边界:caption 为空 / null 时回退 file_name,token 与回退后的 caption 一致', async () => {
  setSettings({})
  const host = createHost()
  const res = await host.sendMeme.execute({ tag: 'happy', limit: 20 }, agentOf(webSession()))

  assert.equal(res.ok, true)
  const byFile = (name) => res.hits.find((h) => h.path.endsWith(name))
  const empty = byFile('cat-empty.jpg')
  const nulled = byFile('cat-null.jpg')
  assert.ok(empty, '空 caption 的行应在候选里')
  assert.ok(nulled, 'null caption 的行应在候选里')

  assert.equal(empty.caption, 'cat-empty.jpg', '空 caption 要回退到 file_name')
  assertTokenOf(empty)
  assert.equal(nulled.caption, 'cat-null.jpg', 'null caption 要回退到 file_name')
  assertTokenOf(nulled)

  const markers = candidateMarkers(res.message)
  assert.ok(markers.includes(empty.token), '候选行要用回退后的 caption: ' + empty.token)
  assert.ok(markers.includes(nulled.token))
})

test('边界:caption 超过 80 字符被截断,token 与截断后的 caption 逐字一致', async () => {
  setSettings({})
  const host = createHost()
  const res = await host.sendMeme.execute({ tag: 'happy', limit: 20 }, agentOf(webSession()))

  assert.equal(res.ok, true)
  const long = res.hits.find((h) => h.path.endsWith('cat-long.jpg'))
  assert.ok(long, '超长 caption 的行应在候选里')

  const expected = LONG_CAPTION.slice(0, 80)
  assert.equal(expected.length, 80)
  assert.equal(long.caption.length, 80, 'caption 应截断到 80 字符')
  assert.equal(long.caption, expected, '截断后的内容要与 captionOf 规则一致')
  assertTokenOf(long)
  assert.ok(candidateMarkers(res.message).includes(long.token), '候选行要用截断后的 caption')
})

test('边界:关键词未命中退回情绪抽样时,message 仍前置且 token 正确', async () => {
  setSettings({})
  const host = createHost()
  // 「上班」是 daily 的口语词,但图库里没有哪个 caption/keywords 命中它:
  // 关键词整词未命中 → 按 query 推断情绪 daily → 抽到「摸鱼中」。
  const res = await host.sendMeme.execute({ query: '上班', limit: 5 }, agentOf(webSession()))

  assert.equal(res.ok, true)
  assert.equal(res.mode, 'mood', '关键词没命中应退回 mood 抽样')
  assert.match(res.message, /没找到图/, '应说清是关键词没命中退回来的')
  assertMessageBeforeHits(res)

  const fish = res.hits.find((h) => h.path.endsWith('fish.jpg'))
  assert.ok(fish, '退回 daily 情绪后应抽到摸鱼行')
  assertTokenOf(fish)
  assert.deepEqual(candidateMarkers(res.message), res.hits.map((h) => h.token))
})

test('边界:空 query / 仅空白 query + 合法 tag、limit=1 也返回结构一致的结果', async () => {
  setSettings({})
  const host = createHost()
  for (const args of [
    { query: '', tag: 'happy', limit: 1 },
    { query: '   ', tag: 'happy', limit: 1 },
  ]) {
    const res = await host.sendMeme.execute(args, agentOf(webSession()))
    assert.equal(res.ok, true, JSON.stringify(args) + ' 应正常返回: ' + res.message)
    assert.equal(res.mode, 'mood')
    assertMessageBeforeHits(res)
    assert.equal(res.hits.length, 1, 'limit=1 只返回一张')
    assert.deepEqual(Object.keys(res.hits[0]).sort(), WEB_HIT_KEYS)
    assertTokenOf(res.hits[0])
    assert.deepEqual(candidateMarkers(res.message), res.hits.map((h) => h.token))
  }
})

// ---- 防泄露:非 Web 渠道不能出现 token / [表情:] 候选行 ----

test('防泄露:纯文字模式(Web 与 IM 会话)hits 无 token,message 无候选标记行', async () => {
  setSettings({ sendMode: 'text' })
  const host = createHost({ dshIm: Object.freeze({ contractVersion: 1 }) })
  try {
    for (const s of [webSession(), imSession('weixin')]) {
      const res = await host.sendMeme.execute({ tag: 'happy', limit: 5 }, agentOf(s))
      assert.equal(res.ok, true)
      assert.ok(res.hits.length > 0)
      assert.ok(res.hits.every((h) => !('token' in h)), '纯文字模式不能给可复制的 token')
      assert.equal(candidateMarkers(res.message).length, 0, '纯文字模式不能出现 [表情:] 候选行')
      assert.doesNotMatch(res.message, /path=/, '纯文字模式候选不给路径')
    }
  } finally {
    setSettings({})
  }
})

test('防泄露:dsh-im 渠道(weixin / qq)hits 无 token,message 无候选标记行', async () => {
  setSettings({})
  const host = createHost({ dshIm: Object.freeze({ contractVersion: 1 }) })
  for (const channel of ['weixin', 'qq']) {
    const res = await host.sendMeme.execute({ tag: 'happy', limit: 3 }, agentOf(imSession(channel)))
    assert.equal(res.ok, true)
    assert.ok(res.hits.length > 0)
    assert.ok(res.hits.every((h) => !('token' in h)), channel + ' 渠道不能出现 token')
    assert.equal(candidateMarkers(res.message).length, 0, channel + ' 渠道不能出现 [表情:] 候选行')
    assert.match(res.message, /path=/, channel + ' 候选仍应给路径')
  }
})

test('防泄露:OneBot 会话(qq_send_image)hits 无 token,且指引投递工具', async () => {
  setSettings({})
  const host = createHost()
  const res = await host.sendMeme.execute({ tag: 'happy', limit: 3 }, agentOf(onebotSession()))

  assert.equal(res.ok, true)
  assert.match(res.message, /qq_send_image\(file=\.\.\.\)/)
  assert.ok(res.hits.length > 0)
  assert.ok(res.hits.every((h) => !('token' in h)), 'OneBot 渠道不能出现 token')
  assert.equal(candidateMarkers(res.message).length, 0, 'OneBot 渠道不能出现 [表情:] 候选行')
})

test('防泄露:companion QQ 两步模式(sendImage)hits 无 token,message 无候选标记行', async () => {
  setSettings({})
  const host = createHost({ companionQq: { sendImage() {} } })
  const res = await host.sendMeme.execute({ tag: 'happy', limit: 3 }, agentOf(webSession()))

  assert.equal(res.ok, true)
  assert.ok(res.hits.length > 0)
  assert.ok(res.hits.every((h) => !('token' in h)), 'QQ 两步模式不能出现 token')
  assert.equal(candidateMarkers(res.message).length, 0, 'QQ 两步模式不能出现 [表情:] 候选行')
  assert.match(res.message, /path=/, 'QQ 两步模式候选仍应给路径')
})

// ---- 文案一致性 ----

test('文案:send_meme 描述、IMAGE_MODE_RULE、AGENTS.md 不再说「结果末尾」', async () => {
  setSettings({ sendMode: 'image' })
  const host = createHost()
  try {
    assert.ok(host.sendMeme, '应注册 send_meme')
    assert.doesNotMatch(host.sendMeme.description, /结果末尾/, '工具描述不该再说「结果末尾」')
    assert.match(host.sendMeme.description, /结果里的「发图」说明/, '工具描述要指向结果里的说明')

    assert.ok(host.assemble, '应注册 system-prompt/assemble')
    const assembled = await host.assemble({}, agentOf(webSession()), async () => ({ sections: [] }))
    const prompt = (assembled.sections.find((s) => s.name === 'dsh-expression:companion') || {}).text || ''
    assert.match(prompt, /结果里的「发图」说明/, 'IMAGE_MODE_RULE 要指向结果里的说明')
    assert.doesNotMatch(prompt, /结果末尾/, 'IMAGE_MODE_RULE 不该再说「结果末尾」')
  } finally {
    setSettings({})
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const agentsMd = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8')
  assert.doesNotMatch(agentsMd, /结果末尾/, 'AGENTS.md 不该再说「结果末尾」')
  assert.match(agentsMd, /结果里的「发图」/, 'AGENTS.md 要指向结果里的「发图」说明')
  assert.match(agentsMd, /`token`/, 'AGENTS.md 要写明 Web 模式的 hits 带可复制的 token')
})
