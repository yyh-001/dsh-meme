import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * issue #77:首次打开选图面板时高度被压到 180px,切一次筛选(或关掉再开)才恢复。
 *
 * 根因是 `topLimitRef` 缓存只按自然高度 nat 失效:进入动画/数据未就绪时
 * `elementFromPoint` 量到的「顶栏下沿」偏大,`avail` 变成负数,面板卡在最小高度;
 * 动画结束后 nat 没变,于是继续复用这个坏值。修法是关闭面板、进入动画结束
 * (onAnimationEnd / 260ms 兜底 / 900ms 数据兜底)时都清空缓存,让 fitPanel 重测。
 *
 * 这里直接钉住这几个清理点,防止以后调动画/缓存时把 issue #77 带回来。
 */
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const section = (start, end) => {
  const at = client.indexOf(start)
  assert.ok(at >= 0, `找不到片段起点: ${start}`)
  const stop = client.indexOf(end, at)
  assert.ok(stop > at, `找不到片段终点: ${end}`)
  return client.slice(at, stop)
}

test('issue #77:关面板时清空顶栏下沿缓存,重开不能复用上次的坏值', () => {
  const closeEffect = section('React.useEffect(() => {\n        if (open) return', '      }, [open])')
  assert.match(closeEffect, /topLimitRef\.current = null/, '关闭 effect 必须清空 topLimitRef')
})

test('issue #77:进入动画结束(animationend 与 260ms 兜底)都清缓存后重测', () => {
  assert.match(client, /animGuardRef\.current = false\n\s*clearTimeout\(animTimerRef\.current\)\n\s*\/\/ issue #77[\s\S]*?topLimitRef\.current = null\n\s*fitPanel\(\)/, 'onAnimationEnd 必须先清缓存再 fitPanel')
  assert.match(client, /animTimerRef\.current = setTimeout\([\s\S]*?animGuardRef\.current = false\n\s*if \(!openRef\.current\) return\n\s*\/\/ issue #77[\s\S]*?topLimitRef\.current = null\n\s*fitPanel\(\)/, '260ms 兜底也必须先清缓存再 fitPanel')
})

test('issue #77:900ms 数据兜底也会重测顶栏下沿', () => {
  assert.match(client, /animWaitRef\.current = setTimeout\([\s\S]*?topLimitRef\.current = null\n\s*fitPanel\(\)\n\s*startEnter\(\)/, '900ms 兜底必须先清缓存再 fitPanel')
})

test('issue #77:mp-pre 期间测量时临时恢复 pointer-events,否则 elementFromPoint 跳过面板会量偏', () => {
  const fn = section('const measureTopLimit = (panel, bottom, nat) => {', 'topLimitRef.current = { limit, nat }')
  assert.match(fn, /panel\.style\.pointerEvents = 'auto'/, '测量期间要临时打开命中测试')
  assert.match(fn, /panel\.style\.pointerEvents = prevPE/, '测完必须还原')
  assert.match(fn, /panel\.style\.maxHeight = prevMax/, '临时高度也要在 finally 里还原')
})
