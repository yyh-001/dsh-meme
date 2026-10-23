/**
 * 给其它插件用的只读取图服务（`dshMeme`）测试。
 *
 * 背景：外部插件（B站评论区发图、其它 agent 工具）以前只能自己读 index.db，
 * 拿到的只是数据行，用不上本插件的跨图库检索/情绪桶/告警。现在把「查/挑」作为
 * 服务暴露给同进程插件：`ctx.get('dshMeme').pick({ query, tag })` → 绝对路径。
 * 这里验证：服务注册、契约字段、检索/挑图返回绝对路径、失败不瞎塞图。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'

// 用临时 home，避免读到开发机的真实图库/设置；内置图库（memes/dafeiyu-001）会兜底。
const home = mkdtempSync(join(tmpdir(), 'dsh-meme-service-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home

const mod = await import('../index.js')

function createHost() {
  const provided = new Map()
  const tools = []
  const onHandlers = {}
  const ctx = {
    effect(body) { return body() },
    on(name, fn) { (onHandlers[name] ||= []).push(fn) },
    get() { return undefined },
    provide(name, value) { provided.set(name, value); return () => provided.delete(name) },
    tools: { register(tool) { tools.push(tool) } },
    agentDefaultModel: null,
  }
  return { ctx, provided, tools, onHandlers }
}

const host = createHost()
mod.apply(host.ctx, {})
const service = host.provided.get('dshMeme')

after(() => {
  rmSync(home, { recursive: true, force: true })
})

test('apply 后注册 dshMeme 服务，图库列表是只读元数据', () => {
  assert.ok(service, 'apply 之后应提供 dshMeme 服务')
  assert.equal(service.contractVersion, 1)
  assert.ok(Object.isFrozen(service), '服务对象应冻结（防止调用方改坏）')
  const packs = service.packs()
  assert.ok(Array.isArray(packs) && packs.length > 0)
  const bundled = packs.find((p) => p.id === 'dafeiyu-001')
  assert.ok(bundled, '内置图库 dafeiyu-001 应可见')
  assert.ok(bundled.count > 0)
  assert.ok(isAbsolute(bundled.path))
})

test('search：按关键词检索，每条结果都有绝对路径且文件真实存在', () => {
  const r = service.search({ query: '干饭', limit: 3 })
  assert.equal(r.ok, true)
  assert.ok(Array.isArray(r.memes) && r.memes.length > 0, '「干饭」应能搜到内置图库的图')
  for (const m of r.memes) {
    assert.ok(isAbsolute(m.path), 'path 必须是绝对路径')
    assert.ok(existsSync(m.path), 'path 必须真实存在')
    assert.equal(typeof m.tag, 'string')
    assert.equal(typeof m.caption, 'string')
  }
})

test('search：只给情绪桶时按桶随机抽', () => {
  const r = service.search({ tag: 'happy', limit: 2 })
  assert.equal(r.ok, true)
  assert.ok(r.memes.length > 0)
  // happy 是情绪桶，桶内细 tag 可能是 happy/like/meow/… —— 只要落在桶内即可
  assert.ok(r.memes.every((m) => ['happy', 'like', 'meow', 'givemoney', 'color'].includes(m.tag)))
})

test('pick：关键词命中时给单张绝对路径 + 元数据', () => {
  const r = service.pick({ query: '干饭' })
  assert.equal(r.ok, true)
  assert.ok(isAbsolute(r.path))
  assert.ok(existsSync(r.path))
  assert.equal(r.tag, 'daily')
  assert.ok(r.pack, '应能标出图来自哪个图库')
})

test('pick：只给情绪桶也能挑到', () => {
  const r = service.pick({ tag: 'angry' })
  assert.equal(r.ok, true)
  assert.ok(['angry', 'fool', 'baka'].includes(r.tag), 'angry 是情绪桶，桶内细 tag 都算')
  assert.ok(existsSync(r.path))
})

test('pick：没命中时返回 ok:false + reason/tags，不强行塞一张', () => {
  const r = service.pick({ query: 'zzzzqqqq' })
  assert.equal(r.ok, false)
  assert.equal(typeof r.reason, 'string')
  assert.match(r.reason, /zzzzqqqq/)
  assert.ok(Array.isArray(r.tags) && r.tags.length > 0, '应把可用情绪桶/分类回给调用方')
})
