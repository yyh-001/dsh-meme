/**
 * 主动发图三档测试(取代原来的 0-100% 概率)。
 *
 * off    = 不主动发图,只在用户明确要图时发;
 * auto   = 看气氛,AI 自己决定(默认);
 * always = 每轮都发,提示词强制要求。
 *
 * 三档各配一套固定 system prompt:不掷骰子、不注入额外消息,同一档内提示词不变,
 * 不会破坏前缀缓存。这里覆盖档位解析、提示词差异、旧概率设置兼容和 setSendGear。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-gear-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
const settingsFile = join(home, '.dsh', 'dsh-expression.json')
mkdirSync(join(home, '.dsh'), { recursive: true })
/** 直接写设置文件:插件每次请求都重读,等价于面板里点保存 */
const setSettings = (patch) => writeFileSync(settingsFile, JSON.stringify(patch || {}))

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
let sessionCounter = 0
const makeSession = (rpcId, { id } = {}) => {
  const sid = id || 'session-send-gear-' + (++sessionCounter)
  return {
    id: sid,
    header: { id: sid, cwd: home },
    snapshotEvents: () => [
      { seq: 1, type: 'turn/start', data: { turn: 0 } },
      { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId }, content: [{ type: 'text', text: '在吗' }] } },
    ],
  }
}
const webSession = () => makeSession(UUID)
const imSession = () => makeSession('weixin-' + UUID)
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
const promptOf = async (sessionLike) => {
  const assembled = { sections: [] }
  const out = await assemble({}, agentOf(sessionLike), async () => assembled)
  return (out.sections.find((s) => s.name === 'dsh-expression:companion') || {}).text || ''
}

after(() => {
  setSettings({})
  rmSync(home, { recursive: true, force: true })
})

test('默认档位 auto:用默认斗图提示词,不出现强制/关闭规则', async () => {
  setSettings({})
  const web = await promptOf(webSession())
  assert.match(web, /氛围合适就主动发一张表情包/)
  assert.doesNotMatch(web, /每轮都必须主动发/)
  assert.doesNotMatch(web, /不主动发表情包/)
})

test('off:换成「不主动发,只在明确要图时发」提示词', async () => {
  setSettings({ sendGear: 'off' })
  const web = await promptOf(webSession())
  assert.match(web, /不主动发表情包/)
  assert.match(web, /明确要求发表情\/发图\/斗图时/)
  assert.doesNotMatch(web, /氛围合适就主动发/)
})

test('active:换成「发图比平时更频繁」提示词', async () => {
  setSettings({ sendGear: 'active' })
  const web = await promptOf(webSession())
  assert.match(web, /活跃模式,发图比平时更频繁/)
  assert.match(web, /大部分合适的回合都主动发/)
  assert.doesNotMatch(web, /每轮都必须主动发/)
})

test('always:换成「每轮都必须发一张」提示词', async () => {
  setSettings({ sendGear: 'always' })
  const web = await promptOf(webSession())
  assert.match(web, /每轮都必须主动发一张表情包/)
  assert.match(web, /send_meme/)
  assert.doesNotMatch(web, /氛围合适就主动发/)
})

test('兼容旧概率设置:0→off、100→always、中间值/关闭→auto;显式 sendGear 优先', async () => {
  setSettings({ sendChanceEnabled: true, sendChance: 0 })
  assert.match(await promptOf(webSession()), /不主动发表情包/)
  setSettings({ sendChanceEnabled: true, sendChance: 100 })
  assert.match(await promptOf(webSession()), /每轮都必须主动发/)
  setSettings({ sendChanceEnabled: true, sendChance: 50 })
  assert.match(await promptOf(webSession()), /氛围合适就主动发/)
  setSettings({ sendChanceEnabled: false, sendChance: 100 })
  assert.match(await promptOf(webSession()), /氛围合适就主动发/)
  setSettings({ sendGear: 'off', sendChanceEnabled: true, sendChance: 100 })
  assert.match(await promptOf(webSession()), /不主动发表情包/)
})

test('IM 会话各档都保留原生投递方式(dsh_im_return_file)', async () => {
  for (const gear of ['off', 'auto', 'active', 'always']) {
    setSettings({ sendGear: gear })
    const im = await promptOf(imSession())
    assert.match(im, /dsh_im_return_file/, gear + ' 档 IM 也要有原生投递')
  }
  setSettings({ sendGear: 'off' })
  const off = await promptOf(imSession())
  assert.match(off, /不主动发表情包/)
  setSettings({ sendGear: 'always' })
  const always = await promptOf(imSession())
  assert.match(always, /每轮都必须主动发/)
})

test('纯文字 / 图片发送方式下档位不生效', async () => {
  setSettings({ sendGear: 'always', sendMode: 'text' })
  const text = await promptOf(webSession())
  assert.match(text, /纯文字/)
  assert.match(text, /不要发图片/)
  assert.doesNotMatch(text, /每轮都必须主动发/)

  setSettings({ sendGear: 'off', sendMode: 'image' })
  const image = await promptOf(webSession())
  assert.match(image, /真的发出去/)
  assert.doesNotMatch(image, /不主动发表情包/)
})

test('setSendGear 接口:保存、回显、非法值 400', async () => {
  setSettings({})
  const saved = JSON.parse((await post({ op: 'setSendGear', gear: 'always' })).body)
  assert.equal(saved.ok, true)
  assert.equal(saved.sendGear, 'always')
  assert.match(saved.message, /每轮都发/)
  assert.match(saved.message, /新开一个会话/)
  assert.match(await promptOf(webSession()), /每轮都必须主动发/)

  const back = JSON.parse((await post({ op: 'setSendGear', gear: 'off' })).body)
  assert.equal(back.sendGear, 'off')
  assert.match(back.message, /关闭/)

  const bad = await post({ op: 'setSendGear', gear: 'sometimes' })
  assert.equal(bad.statusCode, 400)
  assert.match(JSON.parse(bad.body).error, /off \/ auto \/ active \/ always/)
  setSettings({})
})

test('关闭档:send_meme 工具结果提示不要主动发', async () => {
  setSettings({ sendGear: 'off' })
  const result = await runTool(webSession())
  assert.match(result.message, /主动发图档位为「关闭」/)
  assert.match(result.message, /明确要求/)
  setSettings({})
})
