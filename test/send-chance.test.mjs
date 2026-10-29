/**
 * 发图概率测试。
 *
 * 设置页「发图概率」= 开关 + 0-100%:
 * - 关闭(默认):维持原来的陪伴提示词,AI 自己决定发不发;
 * - 开启:每轮(一条用户消息)由插件掷一次骰子,命中才允许主动发图,
 *   未命中整段换成「只回文字」规则;用户明确要图时不受限制;
 * - 只在「自动」发送方式下生效,纯文字/图片模式语义确定,不掺随机。
 *
 * 这里覆盖归一化、系统提示注入、send_meme 工具说明和 setSendChance 接口。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-chance-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
const settingsFile = join(home, '.dsh', 'dsh-expression.json')
mkdirSync(join(home, '.dsh'), { recursive: true })
/** 直接写设置文件:插件每次请求都重读,等价于面板里点保存 */
const setSettings = (patch) => writeFileSync(settingsFile, JSON.stringify(patch || {}))

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
let sessionCounter = 0
/**
 * 会话快照:rpcId 带渠道前缀 = IM 会话,裸 uuid = Web 会话。
 * 每个会话默认给独立 id,避免不同用例共用「会话 + 用户消息 seq」的抽签缓存;
 * 需要验证「新一轮重新抽签」时显式传同一个 id、换 seq。
 */
const makeSession = (rpcId, { id, seq = 2 } = {}) => {
  const sid = id || 'session-send-chance-' + (++sessionCounter)
  return {
    id: sid,
    header: { id: sid, cwd: home },
    snapshotEvents: () => [
      { seq: 1, type: 'turn/start', data: { turn: 0 } },
      { seq, type: 'user/message', data: { source: { kind: 'user', rpcId }, content: [{ type: 'text', text: '在吗' }] } },
    ],
  }
}
const webSession = (opts) => makeSession(UUID, opts)
const imSession = (opts) => makeSession('weixin-' + UUID, opts)
const agentOf = (sessionLike) => ({ agent: { session: sessionLike } })

function createHost() {
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
      return undefined
    },
    tools: { register(tool) { tools.push(tool) } },
    agentDefaultModel: null,
  }
  return { ctx, handlers, onHandlers, tools }
}

const host = createHost()
const mod = await import('../index.js')
const { normalizeSendChance, DEFAULT_SEND_CHANCE } = await import('../memes.js')
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

test('normalizeSendChance:0-100 夹紧取整,空值/非法值回默认 30', () => {
  assert.equal(DEFAULT_SEND_CHANCE, 30)
  assert.equal(normalizeSendChance(undefined), 30)
  assert.equal(normalizeSendChance(null), 30)
  assert.equal(normalizeSendChance(''), 30)
  assert.equal(normalizeSendChance('abc'), 30)
  assert.equal(normalizeSendChance(0), 0)
  assert.equal(normalizeSendChance(33.6), 34)
  assert.equal(normalizeSendChance(150), 100)
  assert.equal(normalizeSendChance(-5), 0)
  assert.equal(normalizeSendChance('50'), 50)
})

test('开关默认关:提示词维持原样,不出现抽签规则', async () => {
  setSettings({})
  const web = await promptOf(webSession())
  assert.match(web, /主动斗图/, '默认仍是主动斗图')
  assert.doesNotMatch(web, /抽签/, '没开概率就不掷骰子')
  const im = await promptOf(imSession())
  assert.match(im, /dsh_im_return_file/)
  assert.doesNotMatch(im, /抽签/)
})

test('开启 + 0%:默认提示词整段换成只回文字版,用户明确要图仍可发', async () => {
  setSettings({ sendChanceEnabled: true, sendChance: 0 })
  const web = await promptOf(webSession())
  assert.match(web, /本轮发图概率抽签未命中/)
  assert.match(web, /用文字接梗/, '未命中要求用文字接梗')
  assert.match(web, /只有用户明确要求发表情\/发图\/斗图时/, '用户明确要图不受概率限制')
  assert.doesNotMatch(web, /不要等用户开口/, '默认提示词里的「主动斗图」被整段换掉,不能和未命中规则打架')

  const im = await promptOf(imSession())
  assert.match(im, /本轮发图概率抽签未命中/)
  assert.match(im, /dsh_im_return_file/, '明确要图时仍要知道 IM 怎么发')
  assert.doesNotMatch(im, /主动用 send_meme/)
})

test('开启 + 100%:保留主动斗图规则并标注命中', async () => {
  setSettings({ sendChanceEnabled: true, sendChance: 100 })
  const web = await promptOf(webSession())
  assert.match(web, /发图概率抽签:本轮命中/)
  assert.match(web, /主动斗图/)
  assert.doesNotMatch(web, /抽签未命中/)
  const im = await promptOf(imSession())
  assert.match(im, /发图概率抽签:本轮命中/)
  assert.match(im, /dsh_im_return_file/)
})

test('自定义提示词:原文保留,未命中只在末尾补规则', async () => {
  setSettings({ companionPrompt: '我的自定义斗图规则XYZ', sendChanceEnabled: true, sendChance: 0 })
  const web = await promptOf(webSession())
  assert.match(web, /我的自定义斗图规则XYZ/, '不能改写用户原文')
  assert.match(web, /发图概率抽签:本轮未命中/)
  assert.match(web, /只有用户明确要求发表情\/发图\/斗图时/)
})

test('纯文字 / 图片发送方式下概率不生效', async () => {
  setSettings({ sendChanceEnabled: true, sendChance: 0, sendMode: 'text' })
  const text = await promptOf(webSession())
  assert.match(text, /纯文字/)
  assert.match(text, /不要发图片/)
  assert.doesNotMatch(text, /抽签/, '纯文字本来就是不发,不需要抽签')

  setSettings({ sendChanceEnabled: true, sendChance: 0, sendMode: 'image' })
  const image = await promptOf(webSession())
  assert.match(image, /真的发出去/)
  assert.doesNotMatch(image, /抽签/, '图片模式要求每次都发,不能被概率拦')
})

test('每轮只抽一次:同一轮多次装配结果一致,新用户消息重新抽', async () => {
  setSettings({ sendChanceEnabled: true, sendChance: 50 })
  const original = Math.random
  try {
    // 0.9 -> 90 >= 50 未命中;若同一轮重掷会读到 0.0 变成命中
    let calls = 0
    Math.random = () => (++calls === 1 ? 0.9 : 0.0)
    const first = await promptOf(webSession({ id: 'session-turn-cache' }))
    const again = await promptOf(webSession({ id: 'session-turn-cache' }))
    assert.match(first, /抽签未命中/, '第一次抽签未命中')
    assert.match(again, /抽签未命中/, '同一轮第二步不能重掷')
    assert.equal(calls, 1, '同一轮只消费一次随机数')

    // 同会话新用户消息(seq 变了)= 新一轮,重新抽签
    Math.random = () => 0.0
    const nextTurn = await promptOf(webSession({ id: 'session-turn-cache', seq: 4 }))
    assert.match(nextTurn, /发图概率抽签:本轮命中/, '新消息应该重新抽签')
  } finally {
    Math.random = original
  }
})

test('send_meme 工具说明与抽签结果一致', async () => {
  setSettings({ sendChanceEnabled: true, sendChance: 0 })
  const web = await runTool(webSession())
  assert.equal(web.ok, true)
  assert.match(web.message, /本轮发图概率抽签未命中/, 'Web 工具结果要压制主动发图')
  assert.match(web.message, /只有用户明确要求/, '明确要图例外要写清')

  const im = await runTool(imSession())
  assert.equal(im.ok, true)
  assert.match(im.message, /本轮发图概率抽签未命中/)
  assert.match(im.message, /dsh_im_return_file/, '明确要图时仍给出投递方式')

  setSettings({ sendChanceEnabled: true, sendChance: 100 })
  const hit = await runTool(webSession())
  assert.equal(hit.ok, true)
  assert.doesNotMatch(hit.message, /抽签未命中/)
  assert.match(hit.message, /\[表情:/)
})

test('setSendChance:开关/概率写进设置并回完整 payload,越界夹紧', async () => {
  setSettings({})
  const initial = JSON.parse((await post({ op: 'getMemeRoot' })).body)
  assert.equal(initial.sendChanceEnabled, false, '默认关闭')
  assert.equal(initial.sendChance, 30, '默认概率 30%')

  const on = JSON.parse((await post({ op: 'setSendChance', enabled: true, chance: 150 })).body)
  assert.equal(on.ok, true)
  assert.equal(on.sendChanceEnabled, true)
  assert.equal(on.sendChance, 100, '超过 100 夹到 100')
  assert.match(on.message, /100%/)

  const zero = JSON.parse((await post({ op: 'setSendChance', enabled: true, chance: 0 })).body)
  assert.equal(zero.sendChance, 0)
  assert.match(zero.message, /0%/, '0% 要说清只在明确要图时发')

  const off = JSON.parse((await post({ op: 'setSendChance', enabled: false, chance: 60 })).body)
  assert.equal(off.sendChanceEnabled, false)
  assert.equal(off.sendChance, 60, '关掉开关时保留概率值,下次打开沿用')
  assert.match(off.message, /已关闭发图概率/)

  const prompt = await promptOf(webSession())
  assert.doesNotMatch(prompt, /抽签/, '关掉后立即恢复原提示词')
})

test('陪伴提示词整体关闭时,发图概率也不注入', async () => {
  setSettings({ promptEnabled: false, sendChanceEnabled: true, sendChance: 0 })
  assert.equal(await promptOf(webSession()), '')
})
