import test from 'node:test'
import assert from 'node:assert/strict'

import { installFakeDom, mountPlugin } from './fake-dom.mjs'

/**
 * issue #22 第 2、3 条(装饰侧的两个不变式):
 *
 * ② 把 [表情: x] 换成 <img> 之后气泡的 textContent 就变了。有些插件(注入记忆条那类)靠
 *    比对 textContent 判断「消息被改过」,于是重写 DOM → img 被打回文字 → 我们再装饰,
 *    来回打回闪个不停。修法:img 后面挂一个 display:none 的 ghost span 装回原文标记,
 *    整段 textContent 与替换前逐字一致;无命中降级成描述原文时也照挂。
 * ③ 流式渲染会覆盖注入,同一个 [表情: x] 可能被装饰两次 → 同一消息行两张相同的图。
 *    修法:按「消息行 + 描述」幂等去重。
 *
 * 这两个不变式都长在 textContent 上。假 DOM(test/fake-dom.mjs)能算 textContent、能跑
 * TreeWalker,还会像真 MutationObserver 一样把每次 DOM 改动记成 MutationRecord——
 * 所以这里的扫描走的是插件的增量路径,和浏览器里跑的一致。
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

// ---------- 挂载插件 ----------
await mountPlugin()
await dom.drain() // 等安装完成(此时 body 还空着,索引要等第一次命中才懒加载)

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
  return { flow, row, p }
}

/**
 * 把这一轮真实的 DOM 改动投给 observer,再过掉一次扫描窗口(SCAN_MIN_GAP=300ms)。
 * forceFull:手动塞一条结构性删除记录,让插件回退全量扫描——
 *   · 手动造重复图时 observer 看不到「图是重复的」这种事实,增量路径又只在真装饰了东西
 *     之后才去重,所以那一步要显式全量;
 *   · nav 是 detached 节点,挂在上面的改动不会进 mutation 日志,同理。
 */
const scan = async ({ forceFull = false } = {}) => {
  const records = dom.takeMutations()
  if (forceFull) {
    records.push({ type: 'childList', target: body, addedNodes: [], removedNodes: [{ nodeType: 1, matches: () => false }] })
  }
  if (records.length > 0) dom.emit(records)
  await dom.drain()
  await dom.sleep(350) // 过最小扫描间隔(SCAN_MIN_GAP=300)
  await dom.drain()
}
const imgsIn = (el) => el.querySelectorAll('img[data-meme-img]')

test('② 装饰后气泡 textContent 与替换前逐字一致(ghost 原文)', async () => {
  const { row, p } = bubble('收到 [表情: 开心] 了')
  await scan()
  const imgs = imgsIn(row)
  assert.equal(imgs.length, 1, '应装饰出一张图')
  assert.equal(imgs[0].src, 'http://localhost/dsh-memes/memes/happy/a.jpg')
  assert.equal(imgs[0].dataset.memeImg, '开心', 'img 要带描述标记(去重用)')
  assert.equal(p.textContent, '收到 [表情: 开心] 了', 'textContent 必须与替换前完全一致,否则比对 textContent 的插件会打回')
  const ghost = p.querySelectorAll('span[data-meme-hidden]')[0]
  assert.ok(ghost, '应挂上 ghost span')
  assert.equal(ghost.style.cssText, 'display:none')
  assert.equal(ghost.textContent, '[表情: 开心]', 'ghost 里装原文标记')
})

test('② 无命中降级成描述原文时,textContent 同样不变', async () => {
  const { p } = bubble('[表情: 库里没有的描述]')
  await scan()
  assert.equal(p.textContent, '[表情: 库里没有的描述]', '降级后 textContent 仍要与替换前一致')
  assert.ok(p.textContent.includes('库里没有的描述'), '不该把 [表情: ] 标记裸露给用户')
  assert.equal(imgsIn(p).length, 0)
})

test('② ghost 不会被自己再装饰一遍(重复扫描不叠加)', async () => {
  // 增量扫描下这一轮的日志里还有上一轮装饰自己产生的改动,正是最容易「自己吃自己」的场景
  const { row, p } = bubble('再来一张 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(row).length, 1)
  await scan()
  await scan()
  assert.equal(imgsIn(row).length, 1, 'ghost 里的标记不该被再装饰成图')
  assert.equal(p.textContent, '再来一张 [表情: 开心]')
})

test('③ 同一消息行里的重复图被幂等去重(流式竞态)', async () => {
  const { row, p } = bubble('双图 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(row).length, 1)
  // 模拟 React 覆盖注入后又装饰了一次:行里多出一张相同描述的图
  const dup = new Element('img')
  dup.setAttribute('src', 'http://localhost/dsh-memes/memes/happy/a.jpg')
  dup.dataset.memeImg = '开心'
  row.appendChild(dup)
  assert.equal(imgsIn(row).length, 2)
  await scan({ forceFull: true })
  assert.equal(imgsIn(row).length, 1, '同一行同描述的重复图应被去掉')
  await scan({ forceFull: true })
  assert.equal(imgsIn(row).length, 1, '去重必须幂等(没有重复时零副作用)')
  assert.equal(p.textContent, '双图 [表情: 开心]', '去重只摘图,不动 ghost/textContent')
})

test('③ 不同行里相同的图不算重复(各留各的)', async () => {
  const a = bubble('第一条 [表情: 开心]')
  const b = bubble('第二条 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(a.row).length, 1)
  assert.equal(imgsIn(b.row).length, 1, '两条消息各有一张,不该跨行去重')
})

test('④ 同一轮扫描里每条消息都要装饰,不能只看第一条', async () => {
  // acceptNode 里的判断以前用的是带 g 的 MEME_TEXT_RE.test():test() 会推进 lastIndex,
  // 下一个文本节点从上次命中的位置往后找 → 后面那些消息被静默跳过、一直不出图
  // (表现就是「表情有时显示不出来」,得等下一轮扫描碰巧把游标绕回 0)。
  const msgs = ['A [表情: 开心]', 'B [表情: 开心]', 'C [表情: 开心]'].map((m) => bubble(m))
  await scan()
  for (const [i, m] of msgs.entries()) {
    assert.equal(imgsIn(m.row).length, 1, '第 ' + (i + 1) + ' 条消息也该被装饰')
  }
})

test('⑤ 新版宿主的消息行标记(data-chat-flow-key)也认', async () => {
  // DSH 0.1.2 起消息行是 data-chat-flow-key(issue #22 附录,使用者实测);只认老标记
  // 的话新版上一个节点都扫不到,表情永不转图。
  const flow = new Element('div') // 老标记一个都不给
  const row = new Element('div')
  row.setAttribute('data-chat-flow-key', 'k1')
  const p = new Element('p')
  p.appendChild(new TextNode('新版 [表情: 开心]'))
  row.appendChild(p)
  flow.appendChild(row)
  body.appendChild(flow)
  await scan()
  assert.equal(imgsIn(row).length, 1, 'data-chat-flow-key 里也要能装饰并提到行首')
  assert.equal(p.textContent, '新版 [表情: 开心]')
})

test('⑤-2 与自定义会话头像共存时,表情图插在内容槽前、头像之后(issue #58)', async () => {
  // 自定义头像插件会把 .we-avatar 插到 row.firstChild;表情图若也按 firstChild 插,
  // 就会越过头像变成 [表情][头像][气泡]。锚点应该是消息内容槽。
  const flow = new Element('div')
  flow.setAttribute('data-chat-flow', '1')
  const row = new Element('div')
  row.setAttribute('data-chat-flow-key', 'k58')
  const avatar = new Element('span')
  avatar.setAttribute('class', 'we-avatar')
  avatar.setAttribute('aria-hidden', 'true')
  row.appendChild(avatar)
  const slot = new Element('div')
  slot.setAttribute('data-slot', 'conversation.chat.node')
  const p = new Element('p')
  p.appendChild(new TextNode('头像内侧 [表情: 开心]'))
  slot.appendChild(p)
  row.appendChild(slot)
  flow.appendChild(row)
  body.appendChild(flow)
  await scan()
  const imgs = imgsIn(row)
  assert.equal(imgs.length, 1, '应装饰出一张图')
  const kids = row.childNodes.filter((n) => n.nodeType === 1)
  assert.equal(kids[0], avatar, '头像必须仍在行首')
  const imgIndex = kids.indexOf(imgs[0])
  const slotIndex = kids.indexOf(slot)
  assert.ok(imgIndex > 0 && imgIndex < slotIndex, '表情图应在头像之后、内容槽之前: ' + kids.map((n) => n.tagName + '.' + (n.getAttribute('class') || '')).join(' > '))
  assert.equal(p.textContent, '头像内侧 [表情: 开心]', 'textContent 仍要与替换前一致')
})

// ---------- issue #26:宿主重渲染(textContent 覆写)后的自愈 ----------
// React 对纯文本 children 的更新走 textContent 覆写,注入的 img/ghost 被一起抹掉、原文
// 裸露;而 data-meme-decorated 在元素属性上不受覆写影响 → 旧逻辑见到标记就永久跳过,
// 图再也回不来,刷新页面才恢复。fake DOM 的 textContent setter 与 React 的 setTextContent
// 行为一致(整段换掉 children、属性保留),正好当覆写模拟器用。

test('⑥ 宿主覆写注入后要能自愈(img 已提到行首的几何)', async () => {
  const { row, p } = bubble('覆写 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(row).length, 1)
  p.textContent = '覆写 [表情: 开心]' // ghost 被抹、原文回来,标记还在
  assert.ok(p.getAttribute('data-meme-decorated'), '覆写不影响标记(这正是 bug 的一半)')
  await scan()
  assert.equal(imgsIn(row).length, 1, '重新装饰后与幸存图去重,仍是一张')
  assert.ok(p.querySelectorAll('span[data-meme-hidden]')[0], 'ghost 也回来了')
  assert.equal(p.textContent, '覆写 [表情: 开心]')
})

test('⑥ 装饰元素即消息行时(img 在标记元素里面),整块覆写也能自愈', async () => {
  // 使用者实测的指纹几何:消息行元素直接包着文本,decorated 元素 == row,img 也在它里面,
  // React 一覆写 img/ghost 一起没(issue #26 控制台指纹就是这种)。
  const flow = new Element('div')
  flow.setAttribute('data-chat-flow', '1')
  const row = new Element('div')
  row.setAttribute('data-chat-flow-key', 'k26')
  row.appendChild(new TextNode('行内 [表情: 开心]'))
  flow.appendChild(row)
  body.appendChild(flow)
  await scan()
  assert.equal(imgsIn(row).length, 1)
  row.textContent = '行内 [表情: 开心]' // img + ghost 一起被抹掉
  assert.equal(imgsIn(row).length, 0)
  await scan()
  assert.equal(imgsIn(row).length, 1, '孤儿标记被摘,图回来了')
  assert.ok(row.querySelectorAll('span[data-meme-hidden]')[0])
})

test('⑥ 降级装饰(无 img 只有 ghost)不算孤儿,不被反复重写', async () => {
  const { p } = bubble('[表情: 库里没有的描述]')
  await scan()
  const html = p.textContent
  const ghosts = p.querySelectorAll('span[data-meme-hidden]').length
  assert.ok(ghosts >= 2, '方括号各自藏在 ghost 里')
  await scan()
  await scan()
  assert.equal(p.querySelectorAll('span[data-meme-hidden]').length, ghosts, '清理条件必须连 ghost 一起看,否则降级结构每轮被重写')
  assert.equal(p.textContent, html)
})

test('⑥ 设置侧栏笑脸被宿主覆写后也能自愈', async () => {
  // nav 是 detached 的,挂在上面的改动 observer 看不到;全量扫描才会跑到 decorateNavIcon
  const nav = new Element('nav')
  const btn = new Element('button')
  btn.appendChild(new Element('i')) // 宿主自己的齿轮图标
  btn.appendChild(new TextNode('表情包'))
  nav.appendChild(btn)
  dom.state.nav = nav
  await scan({ forceFull: true })
  const smile = btn.querySelector('svg[data-meme-nav-icon]')
  assert.ok(smile, '齿轮应被换成笑脸,svg 要带 data-meme-nav-icon 标记')
  btn.textContent = '表情包' // 面板重渲染:注入没了,btn 上的标记还在
  assert.equal(btn.querySelector('svg[data-meme-nav-icon]'), null)
  btn.appendChild(new Element('i')) // 宿主把自己的图标又挂回来了
  btn.appendChild(new TextNode('表情包'))
  await scan({ forceFull: true })
  assert.ok(btn.querySelector('svg[data-meme-nav-icon]'), '笑脸恢复')
  assert.equal(btn.querySelectorAll('svg').length, 1, '不该出现两个图标')
  // 「没得换」的按钮(图标是 IMG)标记是 skip,不该被清理反复摘
  const imgBtn = new Element('button')
  imgBtn.appendChild(new Element('img'))
  imgBtn.appendChild(new TextNode('表情包'))
  nav.appendChild(imgBtn)
  await scan({ forceFull: true })
  assert.equal(imgBtn.getAttribute('data-meme-nav'), 'skip')
  await scan({ forceFull: true })
  assert.equal(imgBtn.getAttribute('data-meme-nav'), 'skip', 'skip 档稳定,不被清理扰动')
  dom.state.nav = null
})

// ---------- 宿主 0.2.0-rc.2 源码核对出的守卫(issue #26 附加信息) ----------
// dsh-client-ui-chat:工具/步骤轨迹整行是 data-chat-flow-kind="turn-process"(宿主自己
// 枚举行时也排除);分组折叠容器 ChatGroupSeat 根上同时挂 data-chat-group-key 和
// data-chat-flow-key。老版宿主两个标记都没有,这些守卫是纯增益。

test('⑦ 轨迹行(turn-process)保持纯文本', async () => {
  const flow = new Element('div')
  flow.setAttribute('data-chat-flow', '1')
  const row = new Element('div')
  row.setAttribute('data-chat-flow-key', 'tp1')
  row.setAttribute('data-chat-flow-kind', 'turn-process')
  row.appendChild(new TextNode('轨迹 [表情: 开心]'))
  flow.appendChild(row)
  body.appendChild(flow)
  await scan()
  assert.equal(imgsIn(row).length, 0, '轨迹不该转图')
  assert.equal(row.textContent, '轨迹 [表情: 开心]', '轨迹文本原样保留')
  const { row: normal } = bubble('正常 [表情: 开心]')
  await scan()
  assert.equal(imgsIn(normal).length, 1, '同一会话里的正常消息照常装饰')
})

test('⑦ 分组容器头部的文本不装饰,组内消息行照常', async () => {
  const group = new Element('div')
  group.setAttribute('data-chat-group-key', 'g1')
  group.setAttribute('data-chat-flow-key', 'g1')
  const header = new Element('div')
  header.appendChild(new TextNode('分组头 [表情: 开心]'))
  group.appendChild(header)
  body.appendChild(group)
  await scan()
  assert.equal(imgsIn(group).length, 0, '分组头部不该转图,更不该把图提到分组顶上')
  assert.equal(header.textContent, '分组头 [表情: 开心]')
  const member = new Element('div') // 组内真正的消息行:只有 flow-key,没有 group-key
  member.setAttribute('data-chat-flow-key', 'm1')
  const p = new Element('p')
  p.appendChild(new TextNode('组内消息 [表情: 开心]'))
  member.appendChild(p)
  group.appendChild(member)
  await scan()
  assert.equal(imgsIn(member).length, 1, '组内消息行照常装饰并提到行首')
})

// ---------- 隐藏残留:掏空的气泡要能回显 ----------
test('⑧ 整条被掏空的气泡要隐藏;React 写回普通文本要能回显', async () => {
  const { row, p } = bubble('[表情: 开心]')
  await scan()
  assert.equal(p.style.display, 'none', '可见文本被掏空的中间层要隐藏')
  assert.equal(p.getAttribute('data-meme-empty'), '1')
  await scan()
  assert.equal(p.style.display, 'none', 'ghost 还在(无可见文本),保持隐藏')
  p.textContent = '现在有普通文字了' // React 覆写:注入没了,属性都还在
  await scan()
  assert.equal(p.style.display, '', '写回可见文本后要回显,不能永久不可见')
  assert.equal(p.getAttribute('data-meme-empty'), null, '标记一并摘掉')
  assert.equal(p.getAttribute('data-meme-decorated'), null, '孤儿装饰标记也摘掉')
  assert.equal(imgsIn(row).length, 1, '行首幸存的图不受影响')
})

test('⑧ 掏空气泡被写回新的表情文本:回显 + 重装饰 + 文本不变式保持', async () => {
  const { row, p } = bubble('[表情: 开心]')
  await scan()
  assert.equal(p.style.display, 'none')
  p.textContent = '看这个 [表情: 开心]'
  await scan()
  assert.equal(imgsIn(row).length, 1, '重新装饰后与幸存图去重,仍是一张')
  assert.ok(p.querySelectorAll('span[data-meme-hidden]')[0], 'ghost 回来了')
  assert.equal(p.style.display, '', '可见文本「看这个」存在,必须回显')
  assert.equal(p.textContent, '看这个 [表情: 开心]')
})

// ---------- 用户消息的表情包要跟气泡一样靠右 ----------
// 宿主(0.2.0-rc.2 源码核对)的用户/steering 行:div.userRow{display:flex;flex-direction:column;
// align-items:flex-end} 才是右对齐的来源,行元素 FlowItem 只是个普通 block。我们把图提到行首
// 之后 block 图就贴左了,自己发的表情包跑到屏幕左边(助手行本来就左对齐,所以只有用户消息看得出)。
// 按行角色补 margin-left:auto 推回右边;data-chat-flow-kind 老宿主没有,取不到就保持原样。

test('⑨ 用户 / steering 行里提到的图靠右,助手行与老宿主不受影响', async () => {
  const mk = (kind) => {
    const flow = new Element('div')
    const row = new Element('div')
    row.setAttribute('data-chat-flow-key', 'k-' + String(kind))
    if (kind !== null) row.setAttribute('data-chat-flow-kind', kind)
    const p = new Element('p')
    p.appendChild(new TextNode('贴纸 [表情: 开心]'))
    row.appendChild(p)
    flow.appendChild(row)
    body.appendChild(flow)
    return row
  }
  const rows = { user: mk('user'), steering: mk('steering'), assistant: mk('assistant-step'), legacy: mk(null) }
  await scan()
  for (const kind of ['user', 'steering']) {
    const row = rows[kind]
    const img = imgsIn(row)[0]
    assert.ok(img, kind + ' 行应装饰出图')
    assert.equal(img.parentElement, row, '图仍提到行首(掏空气泡的前提)')
    assert.equal(img.style.marginLeft, 'auto', kind + ' 行是右对齐的,图要跟气泡同侧')
  }
  assert.equal(imgsIn(rows.assistant).length, 1, '助手行照常装饰')
  assert.equal(imgsIn(rows.assistant)[0].style.marginLeft, undefined, '助手行本来就左对齐,不加外边距')
  assert.equal(imgsIn(rows.legacy).length, 1, '老宿主(无 kind 标记)照常装饰')
  assert.equal(imgsIn(rows.legacy)[0].style.marginLeft, undefined, '老宿主行为保持原样')
})
