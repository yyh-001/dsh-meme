import test from 'node:test'
import assert from 'node:assert/strict'

import { installFakeDom, mountPlugin } from './fake-dom.mjs'

// issue #22 第 4 条 + issue #41:装饰扫描的调度节奏。
//
// 旧实现是纯 trailing 防抖:每次 mutation 都 clearTimeout 重排。流式输出期间变动比 300ms
// 还密,定时器永远等不到触发点,全靠 maxWait 兜底,而且一次全量扫描本身还可能超过 1.2s
// (长会话里图永远比文字晚一大截)。现在的语义是「最小间隔 + 排一次不重排」:
//   · 首条变动立即扫(lastScanAt === 0 时 wait = 0),表情第一时间转图;
//   · 之后每个 SCAN_MIN_GAP(300ms)窗口最多一批,窗内变动合并到窗末尾;
//   · 持续变动时按固定节奏一批批扫,而不是一路拖到 maxWait;
//   · maxWait(1.2s)只是上界;卸载要清掉待触发定时器。
//
// 假 DOM 里每次全量扫描都会为 document.body 建一个 TreeWalker,所以「扫描时刻」就是
// 以 body 为根的 walker 记录:既能数次数,也能量间隔。

const dom = installFakeDom()
const effects = await mountPlugin({ collectEffects: true })
const dispose = effects.map((fn) => fn()).filter((fn) => typeof fn === 'function')

const sleep = dom.sleep
const bodyScanTimes = () => dom.walkerStats.records.filter((r) => r.root === dom.body).map((r) => r.at)

// 一条「结构性删除」记录:增量扫描见到它必然回退全量,所以这条记录等价于「踢一次扫描」,
// 又不会像真正改 DOM 那样引入别的副作用(这里测的是调度,不是装饰)。
const mutation = () => dom.emit([{
  type: 'childList',
  target: dom.body,
  addedNodes: [],
  removedNodes: [{ nodeType: 1, matches: () => false }],
}])

test('同一 tick 的成串变动只触发一次扫描,且 observer 回调里不同步扫描', async () => {
  dom.walkerStats.reset()
  dom.emit(Array.from({ length: 50 }, () => ({
    type: 'childList',
    target: dom.body,
    addedNodes: [],
    removedNodes: [{ nodeType: 1, matches: () => false }],
  })))
  assert.equal(dom.walkerStats.calls, 0, 'observer 回调里不该同步扫描')
  await sleep(450)
  assert.equal(dom.walkerStats.bodyCalls, 1, '50 条变动应合并成一次扫描')
})

test('持续变动时按 ~300ms 节奏分批扫描,首扫在 maxWait(1.2s)内', async () => {
  dom.walkerStats.reset()
  const started = Date.now()
  for (let i = 0; i < 16; i++) {
    mutation() // 每 100ms 一条,故意比 300ms 窗口还密
    await sleep(100)
  }
  await sleep(400) // 等最后一批的排期到点

  const at = bodyScanTimes()
  assert.ok(at.length > 0, '持续变动期间必须至少扫过一次,否则 [表情: x] 会一路裸露')
  assert.ok(at[0] - started <= 1200 + 400, '首扫应在 maxWait(1.2s)内发生,实测 ' + (at[0] - started) + 'ms')

  const gaps = at.slice(1).map((t, i) => t - at[i])
  for (const gap of gaps) {
    assert.ok(gap >= 250, '同一个 300ms 窗口最多扫一次,实测相邻间隔 ' + gaps.join(',') + 'ms')
  }
  // 1.6s 的持续变动,按 300ms 一批应有 5~7 次;旧的「一直重排」实现只会拖到 maxWait 后扫一次
  assert.ok(at.length >= 4, '持续变动应分批扫描多次,不能一直往后拖(实测 ' + at.length + ' 次)')
  assert.ok(at.length <= 9, '也不该每条变动都扫一遍(实测 ' + at.length + ' 次)')
})

test('订阅里带 childList/subtree/characterData(宿主原地改文本也要能装饰)', () => {
  assert.equal(dom.observerStats.options.childList, true)
  assert.equal(dom.observerStats.options.subtree, true)
  assert.equal(dom.observerStats.options.characterData, true)
})

test('卸载时清掉待触发的扫描定时器,断开后也不再投递', async () => {
  dom.walkerStats.reset()
  mutation() // 排一次扫描,但还没到点
  for (const fn of dispose) fn() // 到点之前卸载
  assert.ok(dom.observerStats.disconnects >= 1, '应断开 observer')
  await sleep(450)
  assert.equal(dom.walkerStats.calls, 0, '卸载时待触发的扫描定时器应被清掉')
  mutation() // disconnect 之后宿主不会再投递,这里模拟也不该生效
  await sleep(450)
  assert.equal(dom.walkerStats.calls, 0, '已卸载就不该再有扫描')
})

test('卸载后重新挂载会复位节奏:首条变动立即扫,不带上一轮的排期', async () => {
  const effects2 = await mountPlugin({ collectEffects: true })
  const dispose2 = effects2.map((fn) => fn()).filter((fn) => typeof fn === 'function')
  dom.walkerStats.reset()

  const started = Date.now()
  mutation()
  await sleep(150) // 远小于 300ms 的最小间隔
  const at = bodyScanTimes()
  assert.equal(at.length, 1, '卸载复位了 lastScanAt,重挂载后首条变动应立即扫描')
  assert.ok(at[0] - started <= 150, '首扫不该等 300ms 窗口,实测 ' + (at[0] - started) + 'ms')

  for (const fn of dispose2) fn()
})
