import test from 'node:test'
import assert from 'node:assert/strict'

import { installFakeDom, mountPlugin } from './fake-dom.mjs'

/**
 * issue #41:增量扫描专项。
 *
 * 背景:以前每来一条流式消息都要对 document.body 做一次 TreeWalker 全量扫描,长会话里
 * 每 300ms 扫几万个文本节点。现在 observer 把 MutationRecord 交回来,只扫变动子树;
 * 只有「结构性删除」(删掉的不是我们自己注入的 img/ghost)或单轮记录过多时才回退全量。
 *
 * 这里的假 DOM 会记录真实 MutationRecord,并统计每个 TreeWalker 的根,所以能用
 * 「以 document.body 为根的 walker 次数」直接证明走的是增量而不是全量。
 */

const dom = installFakeDom({
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      memes: [{ path: 'memes/happy/a.jpg', tag: 'happy', file_name: 'a.jpg', caption: '开心', keywords: '' }],
    }),
  }),
})
const { body, Element, TextNode } = dom

await mountPlugin()

/**
 * 把这一轮的 DOM 改动投给 observer,再等过一次最小扫描间隔(SCAN_MIN_GAP=300ms)。
 * 返回本轮之后以 body 为根的 walker 次数变化由调用方用 before/after 断言。
 */
const scan = async () => {
  const records = dom.takeMutations()
  if (records.length > 0) dom.emit(records)
  await dom.drain()
  await dom.sleep(380)
  await dom.drain()
}
const imgsIn = (el) => el.querySelectorAll('img[data-meme-img]')

const bubble = (marker) => {
  const flow = new Element('div')
  flow.setAttribute('data-chat-flow', '1')
  const row = new Element('div')
  row.setAttribute('data-time-hover-root', '1')
  const p = new Element('p')
  const text = new TextNode(marker)
  p.appendChild(text)
  row.appendChild(p)
  flow.appendChild(row)
  body.appendChild(flow)
  return { flow, row, p, text }
}

// 预热:第一次命中会懒加载表情索引,加载完成后插件自己全量补装饰一次。
// 把这次单独做掉,后续用例的「body 根 walker 次数」才是干净的增量证据。
{
  const warm = bubble('预热 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(warm.row).length, 1, '预热扫描应完成索引加载并装饰')
  dom.reset()
}

test('① 新增气泡只扫新增子树,不创建以 document.body 为根的 TreeWalker', async () => {
  dom.reset()
  const { row } = bubble('新增 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(row).length, 1, '新增气泡要被装饰')
  assert.equal(dom.walkerStats.bodyCalls, 0, '增量路径不该对 document.body 做全量扫描')
  assert.equal(dom.walkerStats.calls, 1, '只该为新增子树创建一个 TreeWalker')
})

test('② 删除普通元素时回退全量扫描,下一轮恢复增量', async () => {
  dom.reset()
  const a = bubble('甲 [表情: 开心]')
  const b = bubble('乙 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(a.row).length, 1)
  assert.equal(imgsIn(b.row).length, 1)

  const before = dom.walkerStats.bodyCalls
  b.flow.remove() // 删掉的是宿主结构(不是我们注入的图/ghost)→ 插件分不清,只能回退全量
  await scan()
  assert.equal(dom.walkerStats.bodyCalls, before + 1, '结构性删除应回退全量扫描')
  assert.equal(imgsIn(a.row).length, 1, '回退后幸存的装饰不能被破坏')

  // 回退只发生在那一轮:forceFullScan 已复位,下一轮又是增量
  const afterFallback = dom.walkerStats.bodyCalls
  const c = bubble('丙 [表情: 开心]')
  await scan()
  assert.equal(dom.walkerStats.bodyCalls, afterFallback, '回退一轮后应恢复增量')
  assert.equal(imgsIn(c.row).length, 1)
})

test('③ characterData 流式补全 [表情: x] 不触发全量扫描', async () => {
  dom.reset()
  const { row, p, text } = bubble('正在输入')
  await scan()
  assert.equal(imgsIn(row).length, 0, '还没出现完整标记,不装饰')

  const before = dom.walkerStats.bodyCalls
  text.nodeValue = '正在输入 [表情: 开心]' // 流式吐字:只改文本节点
  await scan()
  assert.equal(imgsIn(row).length, 1, '文本补全后要装饰')
  assert.equal(dom.walkerStats.bodyCalls, before, 'characterData 只扫目标子树,不该回退全量')
  assert.equal(p.textContent, '正在输入 [表情: 开心]')
})

test('④ #26 textContent 覆写后增量自愈(不触发全量)', async () => {
  dom.reset()
  const { row, p } = bubble('覆写 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(row).length, 1)

  const before = dom.walkerStats.bodyCalls
  p.textContent = '覆写 [表情: 开心]' // React 覆写:ghost 被抹、标记还在
  await scan()
  assert.equal(imgsIn(row).length, 1, '重新装饰后与幸存图去重,仍是一张')
  assert.ok(p.querySelectorAll('span[data-meme-hidden]')[0], 'ghost 回来了')
  assert.equal(p.textContent, '覆写 [表情: 开心]')
  assert.equal(dom.walkerStats.bodyCalls, before, '局部覆写应走增量,不该回退全量')
})

test('⑤ 隐藏残留回显也走增量(掏空气泡写回普通文本)', async () => {
  dom.reset()
  const { row, p } = bubble('[表情: 开心]')
  await scan()
  assert.equal(p.style.display, 'none', '可见文本被掏空,气泡隐藏')
  assert.equal(p.getAttribute('data-meme-empty'), '1')

  const before = dom.walkerStats.bodyCalls
  p.textContent = '现在有普通文字了' // React 写回普通文本
  await scan()
  assert.equal(p.style.display, '', '写回可见文本后要回显')
  assert.equal(p.getAttribute('data-meme-empty'), null, '空标记摘掉')
  assert.equal(p.getAttribute('data-meme-decorated'), null, '孤儿装饰标记摘掉')
  assert.equal(imgsIn(row).length, 1, '行首幸存的图不受影响')
  assert.equal(dom.walkerStats.bodyCalls, before, '回显是增量清理,不该回退全量')
})

test('⑥ 单轮 MutationRecord 超过上限(2000)时回退全量', async () => {
  dom.reset()
  const { row } = bubble('甲 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(row).length, 1)

  const before = dom.walkerStats.bodyCalls
  dom.takeMutations() // 丢掉装饰自己产生的日志,保证下面这批是唯一输入
  const records = Array.from({ length: 2001 }, () => ({
    type: 'childList',
    target: body,
    addedNodes: [],
    removedNodes: [{ nodeType: 1, matches: () => true }],
  }))
  dom.emit(records)
  await dom.sleep(380)
  await dom.drain()
  assert.equal(dom.walkerStats.bodyCalls, before + 1, '记录过多应回退全量扫描')
  assert.equal(imgsIn(row).length, 1, '全量扫描后已有装饰保持幂等')
})

test('⑦ 注入的 img 带 loading=lazy / decoding=async', async () => {
  dom.reset()
  const { row } = bubble('懒加载 [表情: 开心]')
  await scan()
  const img = imgsIn(row)[0]
  assert.ok(img, '应装饰出图')
  assert.equal(img.loading, 'lazy', '图片要懒加载,别让历史消息一屏全拉')
  assert.equal(img.decoding, 'async', '解码放异步,别阻塞渲染')
})

test('⑧ 增量路径里去重仍然生效(被重装饰触发时)', async () => {
  dom.reset()
  const { row, p } = bubble('双图 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(row).length, 1)

  // 流式竞态:React 又插了一张同描述的图,紧接着覆写了文本(一次性 patch 到下一轮扫描)
  const dup = new Element('img')
  dup.setAttribute('src', 'http://localhost/dsh-memes/memes/happy/a.jpg')
  dup.dataset.memeImg = '开心'
  row.appendChild(dup)
  p.textContent = '双图 [表情: 开心]' // 抹掉 ghost → 触发重装饰 → 增量路径才会去重

  const before = dom.walkerStats.bodyCalls
  await scan()
  assert.equal(imgsIn(row).length, 1, '重装饰后应把重复图摘掉')
  assert.equal(p.textContent, '双图 [表情: 开心]', '去重只摘图,不动 ghost/textContent')
  assert.equal(dom.walkerStats.bodyCalls, before, '去重不该引入全量扫描')
})

test('⑨ 宿主往被藏起的中间层补可见文本时,增量扫描要整串祖先解藏(P1)', async () => {
  dom.reset()
  // verifier 的 P1:只含 [表情: x] 的 <p> 装饰后,可见文本被掏空的中间层会 display:none
  // + data-meme-empty(hide walk 只走到行容器)。宿主之后往 p 里追加可见文本(流式吐字/编辑),
  // 增量清理的作用域只在变动点子树内、碰不到祖先——必须从变动点向上解藏,否则新文字永久不可见,
  // 只能等下一次全量扫描才回来。
  const flow = new Element('div')
  flow.setAttribute('data-chat-flow', '1')
  const row = new Element('div')
  row.setAttribute('data-time-hover-root', '1')
  const userRow = new Element('div')
  const userStack = new Element('div')
  const bubbleEl = new Element('div')
  const p = new Element('p')
  const text = new TextNode('[表情: 开心]')
  p.appendChild(text)
  bubbleEl.appendChild(p)
  userStack.appendChild(bubbleEl)
  userRow.appendChild(userStack)
  row.appendChild(userRow)
  flow.appendChild(row)
  body.appendChild(flow)

  await scan()
  assert.equal(imgsIn(row).length, 1, '先装饰出图')
  const hidden = [p, bubbleEl, userStack, userRow]
  for (const el of hidden) {
    assert.equal(el.style.display, 'none', '可见文本被掏空的中间层要藏起来')
    assert.equal(el.getAttribute('data-meme-empty'), '1', '要打上可恢复的空标记')
  }
  assert.notEqual(row.style.display, 'none', '行容器本身不藏(图已经提到行首)')

  dom.takeMutations() // 丢掉上一轮装饰自己产生的日志
  const before = dom.walkerStats.bodyCalls
  p.appendChild(new TextNode('现在有正文了')) // 宿主真实 DOM 追加,observer 会交回 childList 记录
  await scan()

  for (const el of hidden) {
    assert.equal(el.style.display, '', '补了可见文本后,整串祖先都要解藏')
    assert.equal(el.getAttribute('data-meme-empty'), null, '空标记要摘掉')
  }
  assert.equal(p.textContent, '[表情: 开心]现在有正文了', '新文本要真的可见')
  assert.equal(imgsIn(row).length, 1, '行首的图不受影响')
  assert.equal(dom.walkerStats.bodyCalls, before, '解藏是增量行为,不该回退全量扫描')
})

test('⑩ 纯追加新消息不做容器级清理(不查整段历史的 data-meme-decorated,P2)', async () => {
  dom.reset()
  // verifier 的 P2:新消息行 append 进流容器时,MutationRecord.target 是整个历史容器;
  // 若每个 record 都对 target 跑 cleanupMemeMarkers,就会 querySelectorAll 历史里所有装饰标记
  // → O(历史),增量就白做了。纯追加(removedNodes 为空)没有孤儿标记要清,不该有这次查询。
  const flow = new Element('div')
  flow.setAttribute('data-chat-flow', '1')
  body.appendChild(flow)
  const rows = []
  for (let i = 0; i < 3; i++) {
    const row = new Element('div')
    row.setAttribute('data-time-hover-root', '1')
    const p = new Element('p')
    p.appendChild(new TextNode(`历史 ${i} [表情: 开心]`))
    row.appendChild(p)
    flow.appendChild(row)
    rows.push(row)
  }
  await scan()
  for (const row of rows) assert.equal(imgsIn(row).length, 1, '历史消息先装饰好')

  dom.takeMutations() // 丢掉装饰自己的日志
  const seenCleanupQueries = []
  const realQuerySelectorAll = flow.querySelectorAll.bind(flow)
  flow.querySelectorAll = (selector) => {
    if (String(selector).includes('data-meme-decorated')) seenCleanupQueries.push(String(selector))
    return realQuerySelectorAll(selector)
  }

  const before = dom.walkerStats.bodyCalls
  const newRow = new Element('div')
  newRow.setAttribute('data-time-hover-root', '1')
  const newP = new Element('p')
  newP.appendChild(new TextNode('新消息 [表情: 开心]'))
  newRow.appendChild(newP)
  flow.appendChild(newRow) // 纯 append:record.target 是 flow,removedNodes 为空
  await scan()

  assert.deepEqual(seenCleanupQueries, [], '纯追加不该对历史容器做 data-meme-decorated 清理查询(O(历史))')
  assert.equal(imgsIn(newRow).length, 1, '新消息照常装饰')
  assert.equal(dom.walkerStats.bodyCalls, before, '仍是增量,不回退全量')
})

