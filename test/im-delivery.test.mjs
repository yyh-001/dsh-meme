/**
 * IM(dsh-im)发送通道测试。
 *
 * 背景:Web 聊天靠前端把 [表情: 描述] 配成图,而 dsh-im 的 QQ/微信等渠道只发
 * 模型写出的文本——标记在那边只是一行方括号文字。IM 会话的正确投递路径是
 * send_meme 给出候选的绝对路径,模型再调用 dsh-im 的 dsh_im_return_file 发原生
 * 图片。这里验证:渠道识别、IM/Web 两种候选输出、系统提示里的主动发图规则。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-im-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home

const mod = await import('../index.js')
const { imChannelOfSession } = await import('../memes.js')

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const SESSION_ID = 'session-11111111-2222-4333-8444-555555555555'

/** 一条来自 dsh-im 渠道的用户消息:rpcId = <channel>-<uuid> */
function imSession(channel = 'weixin', { rpcId = channel + '-' + UUID } = {}) {
  return {
    id: SESSION_ID,
    header: { id: SESSION_ID, cwd: home },
    snapshotEvents: () => [
      { seq: 1, type: 'turn/start', data: { turn: 0 } },
      { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId }, content: [{ type: 'text', text: '在吗' }] } },
    ],
  }
}

/** 同一进程里 Web GUI 发起的会话:rpcId 是没有渠道前缀的裸 uuid */
function webSession() {
  return {
    id: SESSION_ID,
    header: { id: SESSION_ID, cwd: home },
    snapshotEvents: () => [
      { seq: 1, type: 'turn/start', data: { turn: 0 } },
      { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId: UUID }, content: [{ type: 'text', text: '在吗' }] } },
    ],
  }
}

/** 模拟宿主 ctx:dsh-im 在进程内时提供 dshIm 服务(它才有 dsh_im_return_file) */
function createHost({ im = true } = {}) {
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
      return undefined
    },
    tools: { register(tool) { tools.push(tool) } },
    agentDefaultModel: null,
  }
  return { ctx, tools, onHandlers }
}

const host = createHost()
mod.apply(host.ctx, {})
const sendMeme = host.tools.find((t) => t.name === 'send_meme')
const assemble = host.onHandlers['system-prompt/assemble']?.[0]

after(() => {
  rmSync(home, { recursive: true, force: true })
})

test('imChannelOfSession:按最后一条用户消息的 rpcId 前缀识别 IM 渠道', () => {
  assert.equal(imChannelOfSession(imSession('weixin')), 'weixin')
  assert.equal(imChannelOfSession(imSession('qq')), 'qq')
  assert.equal(imChannelOfSession(imSession('wecomapp')), 'wecomapp')
  // steer 消息也带渠道前缀
  assert.equal(imChannelOfSession(imSession('qq', { rpcId: 'qq-steer-' + UUID })), 'qq')
  // Web 的裸 uuid / 非会话对象不误报
  assert.equal(imChannelOfSession(webSession()), null)
  assert.equal(imChannelOfSession(undefined), null)
  assert.equal(imChannelOfSession({}), null)
  // 会话对象异常时不能把系统提示装配带崩
  assert.equal(imChannelOfSession({ snapshotEvents() { throw new Error('disposed') } }), null)
})

test('imChannelOfSession:旧版把渠道写进会话 id,也认;fork 不继承父会话渠道', () => {
  const legacy = { id: 'feishu-' + UUID, snapshotEvents: () => [] }
  assert.equal(imChannelOfSession(legacy), 'feishu')

  const forked = {
    id: SESSION_ID,
    header: { parentSession: 'session-parent' },
    snapshotEvents: () => [
      { seq: 1, type: 'user/message', data: { source: { kind: 'user', rpcId: 'qq-' + UUID } } },
    ],
  }
  assert.equal(imChannelOfSession(forked), null, '拿不到 inheritedEventCount 时不能继承父会话的渠道')

  const forkedWithBoundary = {
    id: SESSION_ID,
    header: { parentSession: 'session-parent' },
    inheritedEventCount: 1,
    snapshotEvents: () => [
      { seq: 1, type: 'user/message', data: { source: { kind: 'user', rpcId: 'qq-' + UUID } } },
      { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId: UUID } } },
    ],
  }
  assert.equal(imChannelOfSession(forkedWithBoundary), null, '父会话继承来的 IM 消息不算')
})

test('send_meme 在 IM 会话里给候选加绝对路径,并让模型调用 dsh_im_return_file', async () => {
  assert.match(sendMeme.description, /dsh_im_return_file/, '进程内有 dsh-im 时工具描述应说明 IM 的发送方式')
  const result = await sendMeme.execute(
    { tag: 'happy', limit: 3 },
    { agent: { session: imSession('weixin') } },
  )
  assert.equal(result.ok, true)
  assert.match(result.message, /dsh_im_return_file/)
  assert.match(result.message, /微信/)
  assert.match(result.message, /path=/)
  assert.match(result.message, /不要写 \[表情:/, '应明确告诉模型别写标记')
  assert.match(result.message, /只写普通文字/, '应要求正文只写普通文字')
  assert.match(result.message, /markdown/, '应禁止 markdown 图片')
  assert.match(result.message, /本地路径/, '应禁止把本地路径贴进回复')
  assert.match(result.message, /描述=/, 'IM 候选行不要用 [tag] 方括号样式')
  assert.doesNotMatch(result.message, /\d+\. \[表情:/, '候选行不能是 [表情: …] 标记')
  assert.doesNotMatch(result.message, /\d+\. .*\| \[[a-z-]+\]/, 'IM 候选行不要给方括号分类样式')
  assert.match(result.message, /现在就能主动发/, 'IM 里要允许主动发,不用等用户先授权')
  assert.ok(result.hits.length > 0)
  for (const hit of result.hits) {
    assert.ok(existsSync(hit.path), '候选要给真实存在的绝对路径: ' + hit.path)
    assert.equal(hit.caption, String(hit.caption).slice(0, 80))
  }

  // 关键词搜图那条分支同样要带路径(与情绪抽图共用候选渲染)
  const byKeyword = await sendMeme.execute(
    { query: '猫', limit: 2 },
    { agent: { session: imSession('qq') } },
  )
  assert.equal(byKeyword.ok, true)
  assert.ok(byKeyword.hits.every((h) => existsSync(h.path)))
  assert.match(byKeyword.message, /dsh_im_return_file/)
})

test('send_meme 在 Web 会话里保持 [表情: 描述] 标记,行文本不带路径', async () => {
  const result = await sendMeme.execute(
    { tag: 'happy', limit: 3 },
    { agent: { session: webSession() } },
  )
  assert.equal(result.ok, true)
  assert.match(result.message, /\[表情:/)
  assert.doesNotMatch(result.message, /dsh_im_return_file/)
  assert.ok(result.hits.length > 0)
  // 出处元信息(issue #53):path/library 进模型可见 JSON,用户可见的行仍只有标记
  assert.ok(result.hits.every((h) => typeof h.path === 'string' && h.path.length > 0), 'Web 候选带 path 出处(#53)')
  assert.ok(result.hits.every((h) => 'library' in h), 'Web 候选带所属图库(#53)')
  assert.doesNotMatch(result.message, /path=/, '用户可见的候选行不含路径')
})

test('系统提示:IM 会话追加原生发图规则,Web 会话保持原提示词', async () => {
  assert.ok(assemble, '应注册 system-prompt/assemble')
  const run = (context) => assemble({}, context, async () => ({ sections: [] }))

  const imPrompt = await run({ agent: { session: imSession('qq') } })
  assert.ok(imPrompt.sections.some((s) => s.name === 'dsh-expression:companion'))
  const imText = imPrompt.sections.find((s) => s.name === 'dsh-expression:companion').text
  assert.match(imText, /主动用 send_meme/, '主动斗图规则仍在')
  assert.match(imText, /dsh_im_return_file/)
  assert.match(imText, /QQ/)
  assert.match(imText, /不要写 \[表情:/)
  assert.match(imText, /markdown/, 'IM 提示要禁止正文里再放 markdown 图片/路径')
  assert.match(imText, /方括号/, 'IM 提示要禁止方括号描述标记')
  assert.match(imText, /不用等用户先授权/)

  const webPrompt = await run({ agent: { session: webSession() } })
  const webText = webPrompt.sections.find((s) => s.name === 'dsh-expression:companion').text
  assert.match(webText, /\[表情:/)
  assert.doesNotMatch(webText, /dsh_im_return_file/)
})

test('自定义陪伴提示词在 IM 会话里保留原文,只追加投递规则', async () => {
  mkdirSync(join(home, '.dsh'), { recursive: true })
  const settingsFile = join(home, '.dsh', 'dsh-expression.json')
  writeFileSync(settingsFile, JSON.stringify({ companionPrompt: '我的自定义斗图规则。' }))
  try {
    const assembled = await assemble({}, { agent: { session: imSession('telegram') } }, async () => ({ sections: [] }))
    const text = assembled.sections.find((s) => s.name === 'dsh-expression:companion').text
    assert.match(text, /^我的自定义斗图规则。/)
    assert.match(text, /dsh_im_return_file/)
    assert.match(text, /Telegram/)
    assert.match(text, /markdown/, '自定义提示词也应追加「正文别放图片/路径」的规则')
  } finally {
    writeFileSync(settingsFile, JSON.stringify({}))
  }
})

test('关掉陪伴提示词后,IM 会话也不再注入任何提示', async () => {
  mkdirSync(join(home, '.dsh'), { recursive: true })
  const settingsFile = join(home, '.dsh', 'dsh-expression.json')
  writeFileSync(settingsFile, JSON.stringify({ promptEnabled: false }))
  try {
    const assembled = await assemble({}, { agent: { session: imSession('weixin') } }, async () => ({ sections: [] }))
    assert.equal(assembled.sections.length, 0)
  } finally {
    writeFileSync(settingsFile, JSON.stringify({}))
  }
})

test('进程里没有 dsh-im 时不误报 IM:候选回到 Web 标记模式', async () => {
  const bare = createHost({ im: false })
  mod.apply(bare.ctx, {})
  const tool = bare.tools.find((t) => t.name === 'send_meme')
  assert.ok(tool)
  assert.doesNotMatch(tool.description, /dsh_im_return_file/, '没有 dsh-im 的工具描述不应提它')

  const result = await tool.execute(
    { tag: 'happy', limit: 2 },
    { agent: { session: imSession('weixin') } },
  )
  assert.equal(result.ok, true)
  assert.match(result.message, /\[表情:/)

  const handler = bare.onHandlers['system-prompt/assemble'][0]
  const assembled = await handler({}, { agent: { session: imSession('weixin') } }, async () => ({ sections: [] }))
  const text = assembled.sections.find((s) => s.name === 'dsh-expression:companion').text
  assert.doesNotMatch(text, /dsh_im_return_file/)
})
