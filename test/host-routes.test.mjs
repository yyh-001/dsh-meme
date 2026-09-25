import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * 回归(issue #20):把插件关掉再打开(或热重载)时，第二次挂载曾直接抛
 * `webserver: duplicate exact route "/dsh-memes-api"`，之后每次关-开都失败，
 * 只能重启 dsh。
 *
 * 原因:index.js 里 4 处 `webServer.register(...)` 与 1 处 `tapIndex(...)` 是直接调用的，
 * 注册出来的 disposer 没人接管；宿主 @deepseek-ai/dsh-host-webserver 的 register()
 * 在 (kind, path) 重复时是**抛错**、不是复用，而插件卸载时又不会自动摘路由
 * （对比 ctx.tools.register 内部会把 disposer 挂到 cordis effect 上，所以工具没这个问题）。
 *
 * 修法:`ctx.effect(() => webServer.register(route))`——官方插件都是这么写的
 * （dsh-host-open-in-app / dsh-client-modules / dsh-webhook-github …），
 * 卸载时 cordis 跑 disposer 把路由删掉。
 *
 * 本测试的 mock 刻意按真实宿主实现:register 重复即抛错、返回 disposer；
 * ctx.effect 收集 disposer 供"卸载"时回放。
 */

process.env.DSH_MEME_HOME = mkdtempSync(join(tmpdir(), 'dsh-meme-routes-'))

const routes = new Map() // `${kind} ${path}` → route
const taps = []

const webServer = {
  host: '127.0.0.1',
  port: 3999,
  register(route) {
    const key = route.kind + ' ' + route.path
    if (routes.has(key)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
    routes.set(key, route)
    return () => { routes.delete(key) }
  },
  tapIndex(transform) {
    if (taps.includes(transform)) throw new Error('webserver: duplicate index transform')
    taps.push(transform)
    return () => {
      const i = taps.indexOf(transform)
      if (i >= 0) taps.splice(i, 1)
    }
  },
}

/** 卸载时按登记顺序倒着跑,和 cordis 一致 */
let effects = []
const unload = () => {
  for (const dispose of effects.reverse()) {
    if (typeof dispose === 'function') dispose()
  }
  effects = []
}
const ctx = {
  effect(body) {
    const dispose = body()
    effects.push(dispose)
    return () => dispose && dispose()
  },
  on() { return () => {} },
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register() { return () => {} } },
  agentDefaultModel: null,
}

const mod = await import('../index.js')

const EXPECTED = [
  'prefix /dsh-memes',
  'exact /dsh-memes-api',
  'exact /dsh-memes-export',
  'exact /memes-panel',
]

test('首次挂载:4 条路由 + tapIndex 都注册上了', () => {
  mod.apply(ctx, {})
  assert.deepEqual([...routes.keys()].sort(), [...EXPECTED].sort())
  assert.equal(taps.length, 1, '小图 CSS 的 tapIndex 应注册一次')
})

test('卸载后路由全部摘掉(不留垃圾,也不依赖进程重启)', () => {
  unload()
  assert.deepEqual([...routes.keys()], [], '卸载后不应还有路由')
  assert.deepEqual(taps, [], '卸载后不应还有 index transform')
})

test('再次挂载不抛 duplicate route —— 关掉再打开能正常用(issue #20)', () => {
  // 修复前:这里会抛 webserver: duplicate exact route "/dsh-memes-api"
  mod.apply(ctx, {})
  assert.deepEqual([...routes.keys()].sort(), [...EXPECTED].sort())
  assert.equal(taps.length, 1)
})

test('反复关-开多次都稳(issue 里说"只取决于第几次挂载",所以多来几轮)', () => {
  for (let i = 0; i < 3; i++) {
    unload()
    assert.deepEqual([...routes.keys()], [])
    mod.apply(ctx, {})
    assert.deepEqual([...routes.keys()].sort(), [...EXPECTED].sort())
  }
  unload()
})
