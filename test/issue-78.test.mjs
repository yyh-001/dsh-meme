/**
 * issue #78:陪伴模式注入的 section 缺 order,在 dsh 0.2.3-alpha.2 上让每一轮对话直接失败。
 *
 * 宿主(0.2.3-alpha.2 起)把 AssembledSection 的 order 当必填字段——system-prompt 的
 * 投影 schema 是 `order: z.number()`——并且 system/message 落入会话前要做一次无损 JSON
 * 校验。插件 push 的段没有 order 时 order 为 undefined,校验抛
 * `session event "system/message" carries non-JSON-serializable data`,整轮对话失败。
 *
 * 这里钉住三件事:
 * 1. push 的段必须带数字 order,且排在宿主内置末段 app:web-surface(10100)之后;
 * 2. 组装结果能通过无损 JSON 往返(等价于宿主落盘前的校验);
 * 3. promptEnabled=false 时不注入,规避开关仍然有效。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-issue78-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
const settingsFile = join(home, '.dsh', 'dsh-expression.json')
mkdirSync(join(home, '.dsh'), { recursive: true })
const setSettings = (patch) => writeFileSync(settingsFile, JSON.stringify(patch || {}))

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const makeSession = (rpcId) => ({
  id: 'session-issue78-' + rpcId,
  header: { id: 'session-issue78-' + rpcId, cwd: home },
  snapshotEvents: () => [
    { seq: 1, type: 'turn/start', data: { turn: 0 } },
    { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId }, content: [{ type: 'text', text: '在吗' }] } },
  ],
})
const agentOf = (sessionLike) => ({ agent: { session: sessionLike } })

function createHost() {
  const handlers = []
  const onHandlers = {}
  const tools = []
  const webServer = { host: '127.0.0.1', port: 3998, register(r) { handlers.push(r) }, tapIndex() {} }
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
const assemble = host.onHandlers['system-prompt/assemble']?.[0]
assert.ok(assemble, '应注册 system-prompt/assemble')

/** 跑一次 assemble,返回整份组装结果(宿主真实调用形态:{} + agent + next) */
const assembleOnce = async (sessionLike) => {
  const assembled = { sections: [] }
  return assemble({}, agentOf(sessionLike), async () => assembled)
}
const companionOf = async (sessionLike) => {
  const out = await assembleOnce(sessionLike)
  return out.sections.find((s) => s.name === 'dsh-expression:companion')
}

after(() => {
  setSettings({})
  rmSync(home, { recursive: true, force: true })
})

test('issue #78:注入的段带数字 order,且排在宿主末段 app:web-surface(10100)之后', async () => {
  setSettings({})
  const section = await companionOf(makeSession(UUID))
  assert.ok(section, '默认设置下应注入陪伴段')
  assert.equal(typeof section.order, 'number', 'order 必须是数字,undefined 过不了宿主的无损 JSON 校验')
  assert.ok(Number.isFinite(section.order), 'order 必须是有限数字')
  assert.ok(section.order > 10100, '应排在宿主内置末段之后,斗图指令放最后')
})

test('issue #78:组装结果可通过无损 JSON 往返(等价于宿主落盘前的校验)', async () => {
  setSettings({})
  const imSession = makeSession('weixin-' + UUID)
  const imOut = await assembleOnce(imSession)
  assert.deepEqual(JSON.parse(JSON.stringify(imOut)), imOut, '带 IM 投递规则的段也必须能无损往返')
  const imSection = imOut.sections.find((s) => s.name === 'dsh-expression:companion')
  assert.match(imSection.text, /dsh_im_return_file/, 'IM 会话仍保留原生投递写法')
  assert.equal(typeof imSection.order, 'number')
})

test('issue #78:promptEnabled=false 不注入(规避开关仍有效)', async () => {
  setSettings({ promptEnabled: false })
  assert.equal(await companionOf(makeSession(UUID)), undefined)
})
