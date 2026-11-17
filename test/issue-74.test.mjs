import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

/**
 * issue #74:窗口模式下模型切换胶囊(z-index 1100 量级)会盖住悬浮预览。
 * 面板和预览是插件自己的临时浮层,必须压过宿主常驻控件;同时不能抢全屏看图
 * (2147483000)的顶。这里直接钉住 client.js 里注进样式表的三个层级。
 */
const src = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const zIndexOf = (selector) => {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*?z-index:(\\d+)')
  const hit = src.match(re)
  assert.ok(hit, '找不到选择器 ' + selector)
  return Number(hit[1])
}

test('issue #74 面板/悬浮预览的 z-index 要压过宿主常驻控件,但不抢全屏看图', () => {
  const picker = zIndexOf('.meme-picker')
  const hover = zIndexOf('.meme-picker .mp-hover')
  const zoomHit = src.match(/z-index:(2147483000)/)

  assert.ok(picker >= 2147481000, '面板本身要抬到宿主菜单(1100)之上,实际 ' + picker)
  assert.ok(hover > picker, '悬浮预览要在面板之上,实际 ' + hover + ' vs ' + picker)
  assert.ok(zoomHit, '全屏看图的 z-index 常量还在')
  assert.ok(Number(zoomHit[1]) > hover, '全屏看图仍要在预览之上,实际 ' + zoomHit[1] + ' vs ' + hover)
})
