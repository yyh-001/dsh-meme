/**
 * OneBot(dsh-qq-onebot)渠道测试。
 *
 * 识别方式与 dsh-qq-onebot 自己的 outbound 保持一致:只用 sessionId 反查
 * ~/.dsh/dsh-qq/session-state.json 的会话账本,不看 rpcId、不看消息从哪进来。
 * 所以在 Web 界面里给 QQ 会话发消息,同样算 OneBot 渠道(实测行为一致)。
 *
 * 命中后走标准 imMode:候选给绝对路径、不写 [表情: 描述] 标记,图片交给
 * qq_send_image(file=...);纯 Web 会话仍由前端把标记配成图。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-onebot-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home

const mod = await import('../index.js')
const { imChannelOfSession } = await import('../memes.js')

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const QQ_SESSION_ID = '22109686-120f-9f40-d05e-4efce7f6c7df'
const STATE_FILE = join(home, '.dsh', 'dsh-qq', 'session-state.json')

mkdirSync(join(home, '.dsh', 'dsh-qq'), { recursive: true })
writeFileSync(STATE_FILE, JSON.stringify({
  gens: {},
  sessions: {
    'qq:1312547902:group:868395596@iso': QQ_SESSION_ID,
    'qq:1312547902:private:1094630886@iso': 'e5a4ec05-6602-7e99-a107-082ee1ece272',
  },
  turns: {},
}))

/**
 * rpcId:
 *   ''            → QQ 注入的消息(dsh-qq-onebot 只写 source:{kind:'user'})
 *   裸 uuid        → Web 输入框发的消息(仍属于这个 QQ 会话)
 *   'qq-<uuid>'   → dsh-im 的 QQ 渠道
 */
function session({ rpcId = '', id = QQ_SESSION_ID } = {}) {
  return {
    id,
    header: { id, cwd: home },
    snapshotEvents: () => [
      { seq: 1, type: 'turn/start', data: { turn: 0 } },
      {
        seq: 2,
        type: 'user/message',
        data: {
          source: rpcId ? { kind: 'user', rpcId } : { kind: 'user' },
          content: [{ type: 'text', text: '发个表情包' }],
        },
      },
    ],
  }
}

function createHost(config = {}, { im = false, homePath = null } = {}) {
  const tools = []
  const onHandlers = {}
  const webServer = {
    host: '127.0.0.1',
    port: 3999,
    register() { return () => {} },
    tapIndex() { return () => {} },
  }
  const ctx = {
    effect(body) { return body() },
    on(name, fn) { (onHandlers[name] ||= []).push(fn) },
    get(name) {
      if (name === 'webServer') return webServer
      if (name === 'dshIm') return im ? Object.freeze({ contractVersion: 1 }) : undefined
      // 宿主把插件家目录做成函数(dsh-qq-onebot 的 homeDirOf 也是这么取的)
      if (name === 'dshHomePath' && homePath) return () => homePath
      return undefined
    },
    tools: { register(tool) { tools.push(tool) } },
    agentDefaultModel: null,
  }
  mod.apply(ctx, config)
  return {
    ctx,
    tools,
    sendMeme: tools.find((t) => t.name === 'send_meme'),
    assemble: onHandlers['system-prompt/assemble']?.[0],
  }
}

const execWith = (s) => ({ agent: { session: s } })
const noWebMark = (msg) => assert.doesNotMatch(msg, /\d+\. \[表情: /, 'OneBot 候选行不能是 Web 标记')

after(() => {
  rmSync(home, { recursive: true, force: true })
})

test('OneBot 不走 rpcId 前缀表;dsh-im 的渠道识别不受影响', () => {
  assert.equal(imChannelOfSession(session()), null, 'QQ 注入的消息没有 rpcId')
  assert.equal(imChannelOfSession(session({ rpcId: UUID })), null, 'Web 裸 uuid 也不算 dsh-im 渠道')
  assert.equal(imChannelOfSession(session({ rpcId: 'qq-' + UUID })), 'qq')
})

test('QQ 注入的一轮:不给 [表情:],候选给路径,指令让模型调 qq_send_image', async () => {
  const host = createHost()
  assert.ok(host.sendMeme)
  const result = await host.sendMeme.execute({ tag: 'happy', limit: 3 }, execWith(session()))
  assert.equal(result.ok, true)
  assert.match(result.message, /qq_send_image\(file=\.\.\.\)/)
  assert.match(result.message, /QQ\(OneBot\)/)
  assert.match(result.message, /path=/)
  noWebMark(result.message)
  assert.match(result.message, /不要写 \[表情: /)
  assert.doesNotMatch(result.message, /dsh_im_return_file/)
  assert.ok(result.hits.length > 0)
  for (const hit of result.hits) {
    assert.ok(hit.path, '每条候选都要给 path')
    assert.ok(existsSync(hit.path), 'path 必须真实存在: ' + hit.path)
  }
})

test('★ 从 Web 输入框给同一个 QQ 会话发消息,照样识别为 OneBot 渠道', async () => {
  const host = createHost()
  const result = await host.sendMeme.execute({ tag: 'happy', limit: 2 }, execWith(session({ rpcId: UUID })))
  assert.equal(result.ok, true)
  assert.match(result.message, /qq_send_image\(file=\.\.\.\)/)
  noWebMark(result.message)
})

test('关键词搜图分支同样走 OneBot 投递', async () => {
  const host = createHost()
  const result = await host.sendMeme.execute({ query: '猫', limit: 2 }, execWith(session()))
  assert.equal(result.ok, true)
  assert.match(result.message, /qq_send_image\(file=\.\.\.\)/)
  noWebMark(result.message)
})

test('不在 QQ 会话账本里的会话:即使没有 rpcId 也退回 Web 标记模式', async () => {
  const host = createHost()
  const result = await host.sendMeme.execute(
    { tag: 'happy', limit: 2 },
    execWith(session({ id: 'not-a-qq-session' })),
  )
  assert.equal(result.ok, true)
  assert.match(result.message, /\d+\. \[表情: /)
  assert.doesNotMatch(result.message, /qq_send_image/)
})

test('纯 Web 会话(裸 uuid + 不在账本)仍由前端配图', async () => {
  const host = createHost()
  const result = await host.sendMeme.execute(
    { tag: 'happy', limit: 2 },
    execWith(session({ rpcId: UUID, id: 'web-only-session' })),
  )
  assert.match(result.message, /\[表情: \.\.\.\] 整段原样写进回复/)
  assert.doesNotMatch(result.message, /qq_send_image/)
})

test('dsh-im 会话仍走 dsh_im_return_file,优先级高于账本', async () => {
  const host = createHost({}, { im: true })
  const result = await host.sendMeme.execute({ tag: 'happy', limit: 2 }, execWith(session({ rpcId: 'qq-' + UUID })))
  assert.match(result.message, /dsh_im_return_file\(path=\.\.\.\)/)
  assert.doesNotMatch(result.message, /qq_send_image/)
  noWebMark(result.message)
})

test('onebotDelivery=off 关闭渠道,QQ 会话退回 Web 标记模式', async () => {
  const host = createHost({ onebotDelivery: 'off' })
  const result = await host.sendMeme.execute({ tag: 'happy', limit: 2 }, execWith(session()))
  assert.match(result.message, /\d+\. \[表情: /)
  assert.doesNotMatch(result.message, /qq_send_image/)
})

test('onebotToolName / onebotFileParam 可配置(适配 qqbot_send_file)', async () => {
  const host = createHost({ onebotToolName: 'qqbot_send_file', onebotFileParam: 'file_path' })
  const result = await host.sendMeme.execute({ tag: 'happy', limit: 2 }, execWith(session()))
  assert.match(result.message, /qqbot_send_file\(file_path=\.\.\.\)/)
  assert.doesNotMatch(result.message, /qq_send_image\(file=/)
})

test('★ 账本路径取宿主 dshHomePath,不是 dsh-meme 的 dshHome()', async () => {
  // 生产里 HOME=/workspace,dsh-meme 的设置在 /workspace/.dsh,
  // 但 dsh-qq-onebot 的账本在宿主给的插件家目录下,两者不是一个目录。
  const qqHome = join(home, 'qq-home')
  mkdirSync(qqHome, { recursive: true })
  writeFileSync(join(qqHome, 'session-state.json'), JSON.stringify({
    sessions: { 'qq:1:group:2': QQ_SESSION_ID },
  }))
  const host = createHost({}, { homePath: qqHome })
  const result = await host.sendMeme.execute({ tag: 'happy', limit: 2 }, execWith(session()))
  assert.match(result.message, /qq_send_image\(file=\.\.\.\)/)

  // 宿主没提供这个服务时,退回 DSH_HOME / ~/.dsh/dsh-qq(本测试用的就是这个)
  const bare = createHost()
  const bareResult = await bare.sendMeme.execute({ tag: 'happy', limit: 2 }, execWith(session()))
  assert.match(bareResult.message, /qq_send_image\(file=\.\.\.\)/)
})

test('onebotStateFile 可覆盖账本路径', async () => {
  const alt = join(home, 'alt-state.json')
  writeFileSync(alt, JSON.stringify({ sessions: { 'qq:1:group:2': QQ_SESSION_ID } }))
  const host = createHost({ onebotStateFile: alt })
  const result = await host.sendMeme.execute({ tag: 'happy', limit: 2 }, execWith(session()))
  assert.match(result.message, /qq_send_image\(file=\.\.\.\)/)
})

test('纯文字模式不发图,也不要求调用任何图片工具', async () => {
  const settingsFile = join(home, '.dsh', 'dsh-expression.json')
  writeFileSync(settingsFile, JSON.stringify({ sendMode: 'text' }))
  try {
    const host = createHost()
    const result = await host.sendMeme.execute({ tag: 'happy', limit: 2 }, execWith(session()))
    assert.equal(result.ok, true)
    assert.doesNotMatch(result.message, /qq_send_image/)
    assert.match(result.message, /不要调用任何图片投递工具/)
  } finally {
    rmSync(settingsFile, { force: true })
  }
})

test('system-prompt 给 QQ 会话注入 OneBot 投递规则,纯 Web 会话不注入', async () => {
  const host = createHost()
  assert.ok(host.assemble)
  const run = (s) => host.assemble({}, { agent: { session: s } }, async () => ({ sections: [] }))
  const qq = await run(session())
  assert.equal(qq.sections.length, 1)
  assert.match(qq.sections[0].text, /QQ\(OneBot\)/)
  assert.match(qq.sections[0].text, /qq_send_image\(file=/)
  assert.match(qq.sections[0].text, /不要写 \[表情: /)

  const web = await run(session({ rpcId: UUID, id: 'web-only-session' }))
  assert.doesNotMatch(web.sections[0].text, /qq_send_image/)
})
