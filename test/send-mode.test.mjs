/**
 * AI 发送方式设置(auto / text / image)测试。
 *
 * 设置页「发送方式」下拉框只控制 AI 怎么发,不改前端把 [表情: 描述] 配成图的
 * 渲染逻辑:
 * - auto(默认):按渠道自动——Web 给 [表情: 描述] 标记,IM 会话给绝对路径走
 *   dsh_im_return_file(与改动前行为一致);
 * - text:纯文字,不发图——候选只给描述、不给路径,提示词压掉发图规则;
 * - image:总是发图——行为同 auto,但提示词强调挑好就必须真发出去。
 * 这里同时覆盖 send_meme 的候选/说明、系统提示注入和 setSendMode 管理接口。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-sendmode-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
const settingsFile = join(home, '.dsh', 'dsh-expression.json')
mkdirSync(join(home, '.dsh'), { recursive: true })
/** 直接写设置文件:插件每次请求都重读,等价于面板里点保存 */
const setSettings = (patch) => writeFileSync(settingsFile, JSON.stringify(patch || {}))

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
/** 一条用户消息的会话快照:rpcId 带渠道前缀 = IM 会话来,裸 uuid = Web 会话 */
const session = (rpcId) => ({
  id: 'session-send-mode',
  header: { id: 'session-send-mode', cwd: home },
  snapshotEvents: () => [
    { seq: 1, type: 'turn/start', data: { turn: 0 } },
    { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId }, content: [{ type: 'text', text: '在吗' }] } },
  ],
})
const imSession = () => session('weixin-' + UUID)
const webSession = () => session(UUID)
const agentOf = (sessionLike) => ({ agent: { session: sessionLike } })

/** mock 宿主:dsh-im 在进程内(IM 渠道能识别),可选 companionQq(QQ 两步发送) */
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
      if (name === 'dshIm') return Object.freeze({ contractVersion: 1 })
      if (Object.prototype.hasOwnProperty.call(extraGet, name)) return extraGet[name]
      return undefined
    },
    tools: { register(tool) { tools.push(tool) } },
    agentDefaultModel: null,
  }
  return { ctx, handlers, onHandlers, tools }
}

const host = createHost()
const mod = await import('../index.js')
const { normalizeSendMode, SEND_MODES } = await import('../memes.js')
mod.apply(host.ctx, {})
const sendMeme = host.tools.find((t) => t.name === 'send_meme')
const assemble = host.onHandlers['system-prompt/assemble']?.[0]
const api = host.handlers.find((h) => h.path === '/dsh-memes-api')
assert.ok(sendMeme, '应注册 send_meme 工具')
assert.ok(assemble, '应注册 system-prompt/assemble')
assert.ok(api, '应注册管理 API')

const callApi = (method, body) => new Promise((resolve, reject) => {
  const req = new EventEmitter()
  req.method = method
  req.url = '/'
  req.headers = { host: '127.0.0.1:3999' }
  const res = {
    statusCode: null, body: null,
    writeHead(status) { res.statusCode = status },
    end(b) { res.body = String(b); resolve(res) },
  }
  api.handler(req, res).catch(reject)
  process.nextTick(() => {
    if (body) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
})
const post = (body) => callApi('POST', body)
const runTool = (sessionLike, args = { tag: 'happy', limit: 3 }) => sendMeme.execute(args, agentOf(sessionLike))
/** 取系统提示里的陪伴提示词段;没注入就返回空串 */
const promptOf = async (sessionLike) => {
  const assembled = { sections: [] }
  const out = await assemble({}, agentOf(sessionLike), async () => assembled)
  return (out.sections.find((s) => s.name === 'dsh-expression:companion') || {}).text || ''
}

after(() => {
  setSettings({})
  rmSync(home, { recursive: true, force: true })
})

test('normalizeSendMode:只认 auto/text/image,其余一律回 auto', () => {
  assert.deepEqual(SEND_MODES, ['auto', 'text', 'image'])
  assert.equal(normalizeSendMode('text'), 'text')
  assert.equal(normalizeSendMode('image'), 'image')
  assert.equal(normalizeSendMode('auto'), 'auto')
  assert.equal(normalizeSendMode(undefined), 'auto')
  assert.equal(normalizeSendMode(''), 'auto')
  assert.equal(normalizeSendMode('图片'), 'auto')
})

test('默认 auto:Web 给 [表情: 描述] 标记,IM 给路径并点名 dsh_im_return_file', async () => {
  setSettings({})
  const web = await runTool(webSession())
  assert.equal(web.ok, true)
  assert.match(web.message, /\[表情:/, 'Web 候选仍是标记')
  assert.doesNotMatch(web.message, /dsh_im_return_file/)
  assert.ok(web.hits.length > 0)
  // 出处信息(issue #53):path/library 进模型可见的 hits JSON(用户问「这图哪来的」
  // 答得上),但用户可见的候选行仍然只有 [表情: 描述],模型没机会把路径抄进回复。
  assert.ok(web.hits.every((h) => typeof h.path === 'string' && h.path.length > 0), 'Web 候选带 path 出处(#53)')
  assert.ok(web.hits.every((h) => 'library' in h), 'Web 候选带所属图库(#53)')
  assert.doesNotMatch(web.message, /path=/, '用户可见的候选行不含路径')
  assert.match(web.message, /出处信息/, '说明里讲清 path/library 只是出处,发图仍写标记')

  const im = await runTool(imSession())
  assert.equal(im.ok, true)
  assert.match(im.message, /dsh_im_return_file/)
  assert.match(im.message, /path=/)
  assert.ok(im.hits.every((h) => typeof h.path === 'string' && h.path.length > 0))
  assert.ok(im.hits.every((h) => 'library' in h), 'IM 候选也带所属图库(#53)')

  const webPrompt = await promptOf(webSession())
  assert.match(webPrompt, /\[表情:/, 'Web 系统提示保持原斗图规则')
  const imPrompt = await promptOf(imSession())
  assert.match(imPrompt, /dsh_im_return_file/, 'IM 系统提示保持原生发图规则')
})

test('纯文字:候选只给描述、不给路径,也不提投递工具和方括号标记', async () => {
  setSettings({ sendMode: 'text' })
  const web = await runTool(webSession())
  assert.equal(web.ok, true)
  assert.match(web.message, /纯文字/)
  // 说明文字里会写「不要写 [表情: ...]」,所以不能简单搜方括号标记;
  // 关键是不给「把 [表情: 描述] 原样写进回复」这类正向指令,并且候选里没有可照抄的标记
  assert.doesNotMatch(web.message, /把 \[表情: 描述\] 原样写进回复/, '纯文字不能给会配图的标记')
  assert.match(web.message, /不要写 \[表情:/)
  assert.doesNotMatch(web.message, /交给 dsh_im_return_file/)
  assert.doesNotMatch(web.message, /^path=/m)
  assert.ok(web.hits.length > 0)
  assert.ok(web.hits.every((h) => !('path' in h) && typeof h.caption === 'string'), '候选只有描述')

  const im = await runTool(imSession())
  assert.equal(im.ok, true)
  assert.match(im.message, /纯文字/)
  assert.doesNotMatch(im.message, /交给 dsh_im_return_file/, 'IM 也不能把图发出去')
  assert.doesNotMatch(im.message, /^path=/m)
  assert.ok(im.hits.every((h) => !('path' in h)))

  const webPrompt = await promptOf(webSession())
  assert.match(webPrompt, /纯文字/)
  assert.match(webPrompt, /不要发图片/)
  assert.doesNotMatch(webPrompt, /交给 dsh_im_return_file/)
  const imPrompt = await promptOf(imSession())
  assert.match(imPrompt, /纯文字/)
  assert.doesNotMatch(imPrompt, /交给 dsh_im_return_file/, '纯文字模式不追加 IM 投递规则')
})

test('Web 候选带 absPath,说明指引 QQ 官方机器人(qqbot_send_file)投递', async () => {
  setSettings({})
  const web = await runTool(webSession())
  assert.equal(web.ok, true)
  assert.ok(web.hits.every((h) => typeof h.absPath === 'string' && isAbsolute(h.absPath)), 'absPath 必须是绝对路径(白名单/qqbot_send_file 要的是磁盘路径)')
  assert.match(web.message, /qqbot_send_file/, '说明里点名 QQ 官方机器人的投递工具')
  assert.match(web.message, /file_path/, '参数名要对上(file_path)')
  assert.match(web.message, /sendFile\.extraRoots/, '被路径白名单拒绝时指向配置项')
  assert.match(web.message, /\[表情: \.\.\.\]|\[表情: 描述\]/, 'Web 聊天的默认路径仍是标记')
  const webPrompt = await promptOf(webSession())
  assert.match(webPrompt, /qqbot_send_file/, '主动斗图提示词同样带 qqbot 分支')
})

test('图片:强调必须真发出去,Web 标记与 IM 路径都在', async () => {
  setSettings({ sendMode: 'image' })
  const web = await runTool(webSession())
  assert.equal(web.ok, true)
  assert.match(web.message, /\[表情:/)
  assert.match(web.message, /必须真的发出去/, '图片模式要提醒不能只描述')
  assert.ok(web.hits.every((h) => typeof h.path === 'string'), 'Web 候选带 path 出处(#53)')
  assert.doesNotMatch(web.message, /path=/, '用户可见的候选行仍不含路径')

  const im = await runTool(imSession())
  assert.equal(im.ok, true)
  assert.match(im.message, /dsh_im_return_file/)
  assert.match(im.message, /path=/)

  const webPrompt = await promptOf(webSession())
  assert.match(webPrompt, /图片/)
  assert.match(webPrompt, /真的发出去/)
  const imPrompt = await promptOf(imSession())
  assert.match(imPrompt, /dsh_im_return_file/)
  assert.match(imPrompt, /真的发出去/)
})

test('setSendMode:写进设置并回完整 payload;非法值 400', async () => {
  setSettings({})
  const saved = JSON.parse((await post({ op: 'setSendMode', sendMode: 'text' })).body)
  assert.equal(saved.ok, true)
  assert.equal(saved.sendMode, 'text')
  const afterSave = await runTool(webSession())
  assert.match(afterSave.message, /纯文字/, '保存后立即生效')
  assert.ok(afterSave.hits.every((h) => !('path' in h)))

  const bad = await post({ op: 'setSendMode', sendMode: 'nope' })
  assert.equal(bad.statusCode, 400)
  const badBody = JSON.parse(bad.body)
  assert.equal(badBody.ok, false)
  assert.match(badBody.error, /auto \/ text \/ image/)

  const back = JSON.parse((await post({ op: 'setSendMode', sendMode: 'auto' })).body)
  assert.equal(back.sendMode, 'auto')
  const payload = JSON.parse((await post({ op: 'getMemeRoot' })).body)
  assert.equal(payload.sendMode, 'auto', '面板 payload 要带发送方式')
  assert.equal(payload.promptEnabled, true, '原有设置字段不受影响')
})

test('QQ 两步模式:纯文字拒绝 send,自动模式照常发', async () => {
  const qqHost = createHost({ companionQq: { sendImage() {} } })
  mod.apply(qqHost.ctx, {})
  const qqTool = qqHost.tools.find((t) => t.name === 'send_meme')
  assert.ok(qqTool, '有 companionQq 时应注册 send_meme')

  setSettings({ sendMode: 'text' })
  const textSearch = await qqTool.execute({ tag: 'happy', limit: 2 }, agentOf(webSession()))
  assert.equal(textSearch.ok, true)
  assert.match(textSearch.message, /纯文字/)
  assert.doesNotMatch(textSearch.message, /path=/, '纯文字候选不给路径')
  const refused = await qqTool.execute({ action: 'send', path: 'memes/happy/x.jpg' }, agentOf(webSession()))
  assert.equal(refused.ok, false)
  assert.match(refused.message, /纯文字/, '纯文字模式不应真的发送图片')

  setSettings({})
  const autoSearch = await qqTool.execute({ tag: 'happy', limit: 2 }, agentOf(webSession()))
  assert.match(autoSearch.message, /path=/, '自动模式 QQ 候选仍带路径')
  const autoSend = await qqTool.execute({ action: 'send', path: 'memes/happy/不存在.jpg' }, agentOf(webSession()))
  assert.equal(autoSend.ok, false)
  assert.match(autoSend.message, /未知路径/, '自动模式下 send 动作本身可用')
})

test('关掉陪伴提示词后,发送方式也不会注入任何提示', async () => {
  setSettings({ promptEnabled: false, sendMode: 'image' })
  assert.equal(await promptOf(webSession()), '')
  assert.equal(await promptOf(imSession()), '')
})
