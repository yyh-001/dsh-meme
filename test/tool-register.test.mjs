import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 回归(issue #51):dsh 0.2.1-rc.x 冷启动后 send_meme / learn_meme 不在 agent
 * 工具表里,插件本体、管理 API、面板、图片路由全都正常——热重挂(服务已 ACTIVE)
 * 工具立刻出现。也就是 apply 同步路径里的 ctx.tools.register 在服务未就绪时
 * 静默无效或抛错被吞。
 *
 * registerToolWhenReady 的契约:
 *   * 宿主有 ctx.inject → 注册挪进 inject(['tools']) 回调(同步路径不再调用);
 *   * 无 inject → 同步注册,抛错按指数退避重试;
 *   * duplicate 抛错 = 已注册,停止且不算失败;
 *   * 失败必须双路上报:console.error + ctx.logger.error(桌面端收走 stdout)。
 */

const { registerToolWhenReady } = await import('../index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 构造记录调用次数的 register thunk;failTimes 控制前 N 次抛什么错 */
const makeRegister = (failTimes = 0, errorFactory = () => new Error('service not ready')) => {
  const calls = []
  const fn = () => {
    calls.push(Date.now())
    if (calls.length <= failTimes) throw errorFactory(calls.length)
  }
  return { fn, calls }
}

const makeCtx = (extra = {}) => {
  const loggerErrors = []
  return {
    loggerErrors,
    effect() { return () => {} },
    logger: { error: (text) => loggerErrors.push(text) },
    ...extra,
  }
}

test('无 inject:同步注册成功,恰好一次', () => {
  const { fn, calls } = makeRegister()
  registerToolWhenReady(makeCtx(), 'send_meme', fn, { retryBaseMs: 10 })
  assert.equal(calls.length, 1)
})

test('无 inject:同步注册抛错,退避重试到成功(#51)', async () => {
  const { fn, calls } = makeRegister(2) // 前 2 次失败,第 3 次成功
  const ctx = makeCtx()
  registerToolWhenReady(ctx, 'send_meme', fn, { retryBaseMs: 20 })
  assert.equal(calls.length, 1, '先同步试一次')
  await sleep(20 + 40 + 60)
  assert.equal(calls.length, 3, '两次退避后成功')
  assert.equal(ctx.loggerErrors.length, 2, '每次失败都经 ctx.logger.error 上报')
  assert.match(ctx.loggerErrors[0], /send_meme 注册失败/)
})

test('无 inject:重试有上限,不会无限打日志', async () => {
  const { fn, calls } = makeRegister(99)
  const ctx = makeCtx()
  registerToolWhenReady(ctx, 'learn_meme', fn, { retryBaseMs: 5, retryMax: 3 })
  await sleep(5 + 10 + 20 + 60)
  assert.equal(calls.length, 4, '同步 1 次 + 退避 3 次')
  assert.equal(ctx.loggerErrors.length, 4)
})

test('duplicate 抛错视为已注册:停止重试、不算失败(#51 建议修法)', async () => {
  const { fn, calls } = makeRegister(0, () => new Error('duplicate tool: send_meme'))
  const ctx = makeCtx()
  registerToolWhenReady(ctx, 'send_meme', fn, { retryBaseMs: 10 })
  await sleep(50)
  assert.equal(calls.length, 1, '不再重试')
  assert.equal(ctx.loggerErrors.length, 0, '不上报')
})

test('宿主有 inject:注册只发生在 inject 回调里,同步路径不调用(#51 建议修法)', () => {
  const { fn, calls } = makeRegister()
  const injections = []
  const ctx = makeCtx({
    inject(deps, cb) { injections.push({ deps, cb }); return () => {} },
  })
  registerToolWhenReady(ctx, 'send_meme', fn, { retryBaseMs: 10 })
  assert.equal(calls.length, 0, '同步路径不注册')
  assert.equal(injections.length, 1)
  assert.deepEqual(injections[0].deps, ['tools'], '等的是 tools 服务')
  injections[0].cb() // 模拟 tools ACTIVE
  assert.equal(calls.length, 1)
})

test('宿主有 inject:回调里注册抛错也会经 ctx.logger.error 上报', () => {
  const { fn } = makeRegister(1)
  const ctx = makeCtx({
    inject(deps, cb) { cb(); return () => {} },
  })
  registerToolWhenReady(ctx, 'learn_meme', fn, { retryBaseMs: 10 })
  assert.equal(ctx.loggerErrors.length, 1)
  assert.match(ctx.loggerErrors[0], /learn_meme 注册失败/)
})

test('ctx.inject 本身抛错:退回同步注册 + 重试', async () => {
  const { fn, calls } = makeRegister(1)
  const ctx = makeCtx({
    inject() { throw new Error('inject unsupported args') },
  })
  registerToolWhenReady(ctx, 'send_meme', fn, { retryBaseMs: 10 })
  await sleep(30)
  assert.equal(calls.length, 2, '同步失败一次 + 退避重试成功')
  assert.ok(ctx.loggerErrors.length >= 1)
})

test('ctx.logger 缺席时只走 console.error,不连坐', () => {
  const { fn, calls } = makeRegister(0)
  const ctx = { effect() { return () => {} } } // 无 logger、无 inject
  registerToolWhenReady(ctx, 'send_meme', fn, { retryBaseMs: 10 })
  assert.equal(calls.length, 1)
})

test('插件卸载清掉待发的重试定时器(ctx.effect 收到清理函数)', async () => {
  const { fn, calls } = makeRegister(99)
  let cleanup = null
  const ctx = {
    effect(body) { const dispose = body(); cleanup = dispose; return dispose },
    logger: { error() {} },
  }
  registerToolWhenReady(ctx, 'send_meme', fn, { retryBaseMs: 15 })
  assert.equal(typeof cleanup, 'function')
  cleanup() // 模拟插件卸载:取消后续重试
  const count = calls.length
  await sleep(80)
  assert.equal(calls.length, count, '卸载后不再重试')
})
