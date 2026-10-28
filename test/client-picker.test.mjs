import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * issue #30 的一键发图面板三项改造(第 4 项「用户侧显示」在 client-decorate.test.mjs):
 *
 * ① 图库 / 情绪改成两排多选 chip:都不选 = 不筛;结果 = 文字搜索 ∩ 所选图库 ∩ 所选情绪;
 *    情绪选项只在当前图库范围内派生、按数量降序带计数,右侧实时显示共 N 张。
 * ② 缩略图悬浮预览:1.5 倍大图 + 情绪 + 描述,右侧放不下翻左边,垂直按实测高度钳制,
 *    「指针离开 当前格子 ∪ 预览框」才关。
 * ③ 面板高度自适应:底边贴输入框(原来的 absolute 锚点不动),上缘不越窗口顶,网格内部滚。
 *
 * 筛选/计数/定位全是纯函数(exports.__test),这里先把它们钉死,再用极简 React 跑一遍真实
 * 渲染,断言 chip 上的计数、搜索后的张数、清空按钮。
 */

let stateCells = []
let passIndex = 0
let pendingEffects = []

const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
  useState(initial) {
    const i = passIndex++
    if (!(i in stateCells)) stateCells[i] = typeof initial === 'function' ? initial() : initial
    return [stateCells[i], (v) => { stateCells[i] = typeof v === 'function' ? v(stateCells[i]) : v }]
  },
  useEffect(fn) { pendingEffects.push(fn) },
  useRef(v) { return { current: v } },
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
  useSyncExternalStore(_subscribe, get) { return get() },
}

const makeEl = () => ({
  textContent: '', style: {}, dataset: {}, attrs: {},
  appendChild() {}, remove() {}, setAttribute() {}, replaceWith() {}, click() {},
  insertBefore() {}, closest: () => null, addEventListener() {}, removeEventListener() {},
})
globalThis.document = {
  head: { appendChild() {} },
  body: { appendChild() {}, querySelector: () => null },
  createElement: () => makeEl(),
  createElementNS: () => makeEl(),
  createDocumentFragment: () => makeEl(),
  createTextNode: () => makeEl(),
  createTreeWalker: () => ({ nextNode: () => null }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
}
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.window = {
  location: { origin: 'http://localhost', href: '' },
  open: () => null,
  __ModuleLoader__: {
    load(def) {
      globalThis.__dshMeme = def.factory((name) => {
        if (name === 'react') return React
        throw new Error('unexpected require: ' + name)
      })
    },
  },
}

// ---- 两个图库 5 张图:url 带包前缀(和真实 /dsh-memes-api?packId=all 的响应一致) ----
const row = (pack, tag, caption, file, keywords) => ({
  path: 'memes/' + tag + '/' + file, tag, file_name: file, caption,
  keywords: keywords || '', url: '/dsh-memes/' + pack + '/memes/' + tag + '/' + file,
})
const rows = [
  row('p1', 'happy', '开心猫', 'a.jpg', '猫 比心'),
  row('p1', 'sad', '难过狗', 'b.jpg', ''),
  row('p1', 'happy', '开心鱼', 'c.jpg', ''),
  row('p2', 'happy', 'GPT吉祥物', 'd.jpg', ''),
  row('p2', 'daily', '摸鱼', 'e.jpg', ''),
]
const packs = [{ id: 'p1', name: '包一', count: 3 }, { id: 'p2', name: '包二', count: 2 }]

const fetched = []
globalThis.fetch = async (url) => {
  fetched.push(String(url))
  const reply = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) })
  if (String(url).includes('/dsh-memes-api')) return reply({ ok: true, packId: 'p1', packs, memes: rows, tags: [] })
  return reply({ ok: false, error: 'unexpected ' + url })
}

await import('../client.js')

const {
  packOfUrl, pickerTagCounts, pickerFilter, fitPanelHeight, naturalPanelHeight, panelVisibleTop, previewPosition, previewClampOffset, clampPreviewElement, inKeepZone, uniqueKeys,
} = globalThis.__dshMeme.__test

// ---------- ① 多选筛选:范围 / 计数 / 交集 ----------

test('packOfUrl 从图片 url 反推出图库 id', () => {
  assert.equal(packOfUrl('/dsh-memes/p1/memes/happy/a.jpg'), 'p1')
  assert.equal(packOfUrl('http://127.0.0.1:3999/dsh-memes/dafeiyu-001/memes/daily/x.png'), 'dafeiyu-001')
  assert.equal(packOfUrl(''), '')
  assert.equal(packOfUrl('/other/path/a.jpg'), '')
})

test('情绪计数只在所选图库范围内派生,按数量降序', () => {
  assert.deepEqual(pickerTagCounts(rows, []).map((t) => t.tag + ':' + t.count), ['happy:3', 'daily:1', 'sad:1'])
  // 同数量按 tag 名稳定排序(daily < sad)
  assert.deepEqual(pickerTagCounts(rows, ['p1']).map((t) => t.tag + ':' + t.count), ['happy:2', 'sad:1'])
  assert.deepEqual(pickerTagCounts(rows, ['p2']).map((t) => t.tag + ':' + t.count), ['daily:1', 'happy:1'])
})

test('结果 = 文字搜索 ∩ 所选图库 ∩ 所选情绪;两者都不选 = 不筛', () => {
  assert.equal(pickerFilter(rows, [], [], '').length, 5, '都不选 = 全部')
  assert.equal(pickerFilter(rows, ['p2'], [], '').length, 2, '只看所选图库')
  assert.equal(pickerFilter(rows, [], ['happy'], '').length, 3, '只看所选情绪')
  assert.equal(pickerFilter(rows, ['p1', 'p2'], ['happy'], '').length, 3, '多选图库取并集')
  assert.equal(pickerFilter(rows, ['p1'], ['happy'], '').length, 2, '图库 ∩ 情绪')
  assert.equal(pickerFilter(rows, ['p2'], ['happy'], '猫').length, 0, '三层都命中才算:「猫」只在 p1 里')
})

test('文字搜索:空格分词全命中,描述/关键词/图名都算', () => {
  assert.equal(pickerFilter(rows, [], [], '开心').length, 3, '打了「开心」= happy 桶(标签的中文显示也参与),其中两条是描述里就有')
  assert.equal(pickerFilter(rows, [], [], '开心 猫').length, 1, '多个词要全命中')
  assert.equal(pickerFilter(rows, [], [], '比心').length, 1, '关键词也参与')
  assert.equal(pickerFilter(rows, [], [], 'b.jpg').length, 1, '文件名也参与')
  assert.equal(pickerFilter(rows, [], [], '开心 不存在的词').length, 0)
})

test('格子 key:url 撞车(两个图库收同一张图)也要唯一,否则 React 协调会错乱', () => {
  // 实测现象:筛到 2 张后网格里还剩两百多个旧格子 —— key 撞车时 React 删不干净
  const dupes = [rows[0], rows[0], rows[3], rows[0]]
  const keys = uniqueKeys(dupes)
  assert.equal(new Set(keys).size, keys.length, 'key 必须唯一')
  assert.deepEqual(keys, [rows[0].url + '#1', rows[0].url + '#2', rows[3].url + '#1', rows[0].url + '#3'])
})

// ---------- ③ 面板高度自适应 ----------

test('面板高度:自然高度与可用空间取小,兜一个最小高度', () => {
  assert.equal(fitPanelHeight(1000, 400), 400, '放不下就顶到可用高度,内容在网格里滚')
  assert.equal(fitPanelHeight(300, 1000), 300, '放得下就用自然高度,不空撑')
  assert.equal(fitPanelHeight(40, 1000), 180, '太矮时兜最小高度')
  assert.equal(fitPanelHeight(0, 0), 180, '量不到就退回最小高度(JS 增强失败也不能塌)')
  assert.equal(fitPanelHeight(1000, 400, 220), 400, '最小高度可覆盖')
})

test('面板高度:视口占比上限压住「窗口多高就长多高」(用户要的半屏高)', () => {
  // 窗口 1000 高、底边 864 时可用 776,但 46% = 460 才是最终高度 —— 半屏左右既能多看图,
  // 也不会把对话整个顶掉。三者取小,cap 最小就听 cap。
  assert.equal(fitPanelHeight(3928, 776, 180, 460), 460)
  assert.equal(fitPanelHeight(300, 776, 180, 460), 300, '自然高度更小时仍然听自然高度')
  assert.equal(fitPanelHeight(3928, 240, 180, 460), 240, '可用空间更小时仍然听可用空间')
  assert.equal(fitPanelHeight(3928, 776, 180, 0), 776, 'cap 非正数视为不设上限')
  assert.equal(fitPanelHeight(3928, 776, 180, Infinity), 776, '默认不设上限')
  assert.equal(fitPanelHeight(3928, 776, 180, 90), 180, 'cap 比最小高度还小时,最小高度优先(不能塌)')
})

test('自然高度不靠撤 max-height 去量,网格的滚动位置不会被夹到顶(issue #33)', () => {
  // 复刻 bug 现场:旧 fitPanel 把 max-height 撤成 none 再量高,网格的可用高度就等于整块内容高
  // (clientHeight 424 → 5156),滚动区间归零 → 浏览器把 scrollTop 夹到 0,还原也回不来。
  // 这个假网格会在 panel.style.maxHeight 被写时照着复现那次夹取。
  const grid = { scrollHeight: 5156, clientHeight: 424, scrollTop: 3000 }
  const panel = {
    style: {},
    getBoundingClientRect: () => ({ height: 625 }),
    querySelector: (sel) => (sel === '.mp-grid' ? grid : null),
  }
  Object.defineProperty(panel.style, 'maxHeight', {
    get: () => '',
    set: () => { grid.clientHeight = grid.scrollHeight; grid.scrollTop = 0 },
  })
  // 自然高度 = 外框高度 + 网格里被藏起来的那截(5156 - 424 = 4732)
  assert.equal(naturalPanelHeight(panel), 625 + 4732)
  assert.equal(grid.scrollTop, 3000, '量高不能写样式:一写就会把滚动位置夹到顶')
  assert.equal(grid.clientHeight, 424)
  // 网格不在(加载中 / 空 / 无匹配):面板没被压,外框高度本身就是自然高度
  assert.equal(naturalPanelHeight({ getBoundingClientRect: () => ({ height: 180 }), querySelector: () => null }), 180)
})

test('面板可见起点:宿主顶栏盖住的那段不算可用高度(issue #33 后续)', () => {
  // 真机实测:窗口高 1000、面板底边 864,面板长到 848 时顶边落到 y=16;
  // 宿主自己的标题栏(min-height:76px)画在面板上面,把面板盖住 0~76 这一段,
  // 其中正是搜索框 + 筛选开关那一行 —— 用户看到的就是「顶部没了」。
  const covered = (barBottom) => (y) => y >= barBottom
  // 顶栏 76:可见起点 76(顶栏下沿);再留 12px 呼吸间距 → 可用高度 = 864 - 88 = 776
  assert.equal(panelVisibleTop(16, 864, covered(76)), 76)
  assert.equal(864 - (panelVisibleTop(16, 864, covered(76)) + 12), 776)
  // 盖住的边界落在哪就是哪(二分精确到 1px,不再被固定步长带偏)
  assert.equal(panelVisibleTop(16, 864, covered(157)), 157)
  assert.equal(panelVisibleTop(200, 864, covered(76)), 200, '顶栏没挡到面板:可见起点就是面板顶边')
  // 没被挡时不加间距 —— 否则面板会白白矮 12px 且永远长不回来
  assert.equal(864 - panelVisibleTop(200, 864, covered(76)), 664)
  // 面板被整个盖住:可见起点塌到底边 → 可用高度 0,交给 fitPanelHeight 兜最小高度,不出负数
  assert.equal(panelVisibleTop(16, 60, () => false), 60)
  assert.equal(fitPanelHeight(3928, 60 - panelVisibleTop(16, 60, () => false)), 180, '全被盖住就兜最小高度,不出负数')
  // 退化区间(底边不高于顶边)不炸
  assert.equal(panelVisibleTop(80, 60, () => true), 60)
})

// ---------- ② 悬浮预览定位 / 关闭时机 ----------

test('悬浮预览:默认浮在格子右侧;右侧放不下翻到左侧', () => {
  const cell = { left: 100, top: 100, right: 176, bottom: 176 }
  const size = { width: 176, height: 184 }
  assert.deepEqual(previewPosition(cell, size, { width: 900, height: 800 }), { left: 186, top: 98 })
  // 右边只剩一点:翻到左侧(100 - 10 - 176 = -86 → 再钳到 8)
  assert.deepEqual(previewPosition({ ...cell, left: 40, right: 116 }, size, { width: 300, height: 800 }), { left: 8, top: 98 })
})

test('悬浮预览:垂直按实测高度钳制,最下面一排不被裁掉', () => {
  const size = { width: 176, height: 184 }
  // 面板里最后一排:格子底边贴窗口底,预览要往上收(800 - 184 - 8 = 608)
  assert.equal(previewPosition({ left: 10, top: 700, right: 86, bottom: 776 }, size, { width: 900, height: 800 }).top, 608)
  // 窗口特别矮也不能跑到负坐标
  assert.equal(previewPosition({ left: 10, top: 700, right: 86, bottom: 776 }, size, { width: 900, height: 200 }).top, 8)
})

test('悬浮预览:换内容后变高,按新的实测高度往上收', () => {
  // 上一帧量到 184,这一帧实际 260(描述长了一截):仍要按 260 收
  assert.equal(previewPosition({ left: 10, top: 700, right: 86, bottom: 776 }, { width: 176, height: 260 }, { width: 900, height: 800 }).top, 532)
})

// ---------- ②-1 issue #55:浮层按「写下去之后的真实矩形」钳制 ----------

test('悬浮预览:算出来的位置越界 → 按真实矩形减回去', () => {
  const vp = { width: 900, height: 800 }
  // 已经放得下:一个像素都不动
  assert.deepEqual(previewClampOffset({ left: 100, top: 100, right: 276, bottom: 284 }, vp), { dx: 0, dy: 0, done: true })
  // 右缘 1000 越过 892(900 - 8):整体往左收 108
  assert.deepEqual(previewClampOffset({ left: 824, top: 100, right: 1000, bottom: 284 }, vp), { dx: -108, dy: 0, done: false })
  // 左缘跑到窗口外:往右推回 8
  assert.deepEqual(previewClampOffset({ left: -40, top: 100, right: 136, bottom: 284 }, vp), { dx: 48, dy: 0, done: false })
  // 下缘 900 越过 792:往上一块
  assert.deepEqual(previewClampOffset({ left: 100, top: 716, right: 276, bottom: 900 }, vp), { dx: 0, dy: -108, done: false })
  // 比视口还高的内容:上缘贴边,不再往下推(否则会跟下缘来回抖)
  assert.deepEqual(previewClampOffset({ left: 100, top: 300, right: 276, bottom: 1500 }, vp), { dx: 0, dy: -292, done: false })
  // 尺寸窗口都量不到:不动也不炸
  assert.deepEqual(previewClampOffset(null, vp), { dx: 0, dy: 0, done: true })
  assert.deepEqual(previewClampOffset({ left: 900, top: 900, right: 1000, bottom: 1000 }, { width: 0, height: 0 }), { dx: 0, dy: 0, done: true })
  // 全 0 矩形 = 还没进布局,别当成「贴左上角」去挪
  assert.deepEqual(previewClampOffset({ left: 0, top: 0, right: 0, bottom: 0 }, vp), { dx: 0, dy: 0, done: true })
})

// 假预览:真实矩形 = 写进去的 left/top × 祖先 zoom 的缩放 + 祖先 transform 造成的整体偏移。
// 两种失真叠在一起,就是 issue #55 里「越靠右越飘出去」的现场。
const fakePreview = ({ width = 176, height = 184, offsetX = 0, offsetY = 0, scale = 1 }) => {
  const box = { left: 0, top: 0 }
  return {
    box,
    style: {
      get left() { return box.left + 'px' },
      set left(v) { box.left = parseFloat(v) },
      get top() { return box.top + 'px' },
      set top(v) { box.top = parseFloat(v) },
    },
    getBoundingClientRect() {
      const left = box.left * scale + offsetX
      const top = box.top * scale + offsetY
      return { left, top, right: left + width * scale, bottom: top + height * scale }
    },
  }
}

test('悬浮预览:最右一列被祖先 transform 推出窗口,迭代后收进视口', () => {
  const vp = { width: 600, height: 700 }
  // 算出来的 left=560(贴着右缘),祖先又整体往右推 320 → 实际右缘 1056,几乎全在窗口外
  const el = fakePreview({ offsetX: 320 })
  el.style.left = '560px'
  el.style.top = '120px'
  clampPreviewElement(el, vp, 3)
  const r = el.getBoundingClientRect()
  assert.ok(r.right <= 600 - 8, '右缘要收进视口,实际 ' + r.right)
  assert.ok(r.left >= 8, '左缘不能跑出去,实际 ' + r.left)
})

test('悬浮预览:右下角那一格(又矮又靠右)上下左右都收进视口', () => {
  const vp = { width: 600, height: 400 }
  const el = fakePreview({ height: 260, offsetX: 40, offsetY: 30 })
  el.style.left = '520px'
  el.style.top = '330px'   // 算位置时按 184 高算的,实际换成 260 高的内容
  clampPreviewElement(el, vp, 3)
  const r = el.getBoundingClientRect()
  assert.ok(r.right <= 600 - 8 && r.left >= 8, '水平方向收进视口:' + r.left + '~' + r.right)
  assert.ok(r.bottom <= 400 - 8 && r.top >= 8, '垂直方向收进视口:' + r.top + '~' + r.bottom)
})

test('悬浮预览:祖先带 zoom 把坐标系放大,写进去的值和量到的位置不等价也能收进视口', () => {
  const vp = { width: 600, height: 700 }
  // zoom 1.25:left=560 在屏幕上变成 700(右缘 920),比视口还宽出去一大截
  const el = fakePreview({ scale: 1.25 })
  el.style.left = '560px'
  el.style.top = '120px'
  const before = el.getBoundingClientRect()
  assert.ok(before.right > 600, '先确认这个坐标确实在窗口外')
  clampPreviewElement(el, vp, 3)
  const r = el.getBoundingClientRect()
  assert.ok(r.right <= 600 - 8 && r.left >= 8, '缩放坐标系下也要收进视口:' + r.left + '~' + r.right)
})

test('悬浮预览:已经在视口内就不动(不引入抖动)', () => {
  const vp = { width: 900, height: 800 }
  const el = fakePreview({})
  el.style.left = '186px'
  el.style.top = '98px'
  const out = clampPreviewElement(el, vp, 3)
  assert.deepEqual(out, { left: 186, top: 98 })
})

test('停留区 = 当前格子 ∪ 预览框,带 4px 容差', () => {
  const cell = { left: 100, top: 100, right: 176, bottom: 176 }
  const preview = { left: 8, top: 300, right: 184, bottom: 484 }
  assert.equal(inKeepZone([cell, preview], 140, 140), true, '格子内')
  assert.equal(inKeepZone([cell, preview], 90, 400), true, '预览框内(从格子挪到大图不能闪掉)')
  assert.equal(inKeepZone([cell, preview], 180, 180), true, '贴边 4px 内算还在(避免抖动)')
  assert.equal(inKeepZone([cell, preview], 200, 180), false, '离开格子 ∪ 预览框就关')
  assert.equal(inKeepZone([cell, preview], 140, 250), false, '面板下半的空白区不算停留')
  assert.equal(inKeepZone([], 140, 140), false)
  assert.equal(inKeepZone([{ left: 0, top: 0, right: 0, bottom: 0 }], 0, 0), false, '退化矩形直接跳过')
})

// ---------- 渲染:chip 计数 / 共 N 张 / 清空 / 发图回归 ----------

const walk = (node, fn) => {
  if (node == null || typeof node === 'boolean') return
  if (Array.isArray(node)) { for (const n of node) walk(n, fn); return }
  if (typeof node !== 'object') return
  fn(node)
  for (const kid of node.kids || []) walk(kid, fn)
}
const textOf = (node) => {
  let out = ''
  walk(node, (n) => { for (const kid of n.kids || []) if (typeof kid === 'string' || typeof kid === 'number') out += kid + ' ' })
  return out.replace(/\s+/g, ' ').trim()
}
const run = (el) => (typeof el.type === 'function' ? el.type(el.props) : el)
const flush = async () => {
  for (const fn of pendingEffects.slice()) fn()
  pendingEffects = []
  await new Promise((ok) => setTimeout(ok, 0))
  await new Promise((ok) => setTimeout(ok, 0))
}
const byClass = (tree, cls) => {
  const out = []
  walk(tree, (n) => {
    const c = n.props && n.props.className
    if (typeof c === 'string' && c.split(/\s+/).includes(cls)) out.push(n)
  })
  return out
}
const chipWith = (tree, label) => byClass(tree, 'mp-tag').find((n) => textOf(n).includes(label))

/**
 * 把筛选区摆成想要的状态再点 chip。展开状态记在模块级(关掉面板再打开要还在),
 * 于是同一个测试文件里会互相串 —— 每个用 chip 的用例先过一道这个,别依赖执行顺序。
 */
const ensureFilters = (tree, repaint, want = true) => {
  if ((byClass(tree, 'mp-filter-row').length > 0) === want) return tree
  const tg = byClass(tree, 'mp-toggle')[0]
  assert.ok(tg, '筛选开关必须在(收起时也得有入口)')
  tg.props.onClick()
  return repaint()
}

/** 装一遍插件并打开面板,返回当前这棵树 + 重绘函数 + setDraft 记录 */
const openBoard = async () => {
  stateCells = []
  passIndex = 0
  pendingEffects = []
  const calls = []
  const inputActions = {
    setDraft: (text) => calls.push({ kind: 'setDraft', text }),
    submit: () => calls.push({ kind: 'submit' }),
  }
  const slots = {
    registered: [],
    inject(_name, fn) { fn() },
    register(meta, render) { this.registered.push({ meta, render }) },
  }
  globalThis.__dshMeme.apply({ get: (name) => (name === 'slots' ? slots : undefined), effect: () => {} })
  const find = (name) => slots.registered.find((r) => r.meta.name === name && r.meta.id === 'meme-picker')
  const props = { inputActions, useInput: (s) => s({ draft: '先说两句' }) }

  const trigger = find('conversation.input.left')
  passIndex = 0
  const buttonTree = run(trigger.render(props))
  let button = null
  walk(buttonTree, (n) => { if (!button && n.props && typeof n.props.onClick === 'function') button = n })
  button.props.onClick({ preventDefault() {}, stopPropagation() {} })

  const overlay = find('conversation.input.overlay')
  passIndex = 0
  run(overlay.render(props))
  await flush()
  const repaint = () => { passIndex = 0; return run(overlay.render(props)) }
  return { board: repaint(), repaint, calls }
}

// 注意:这个用例必须排在最前 —— 面板首次渲染的默认状态(筛选收起)只在这里是原生的,
// 之后的用例会按需把筛选区展开,而展开状态是模块级记忆的。
test('打开面板拉的是全量(packId=all),默认不筛就是跨图库全部;筛选区默认收起', async () => {
  fetched.length = 0
  const { board } = await openBoard()
  assert.ok(fetched.some((u) => u.includes('packId=all')), '多选筛选/情绪计数要全量数据:' + fetched.join(' '))
  assert.equal(byClass(board, 'mp-cell').length, 5, '两个图库的图都要出来')
  assert.equal(textOf(byClass(board, 'mp-count')[0]), '共 5 张')
  // 图库一多,两排 chip 能吃掉大半个面板;默认收起,只留一个开关
  assert.equal(byClass(board, 'mp-filter-row').length, 0, '默认不铺 chip')
  assert.equal(chipWith(board, '包一'), undefined)
  assert.equal(textOf(chipWith(board, '筛选')), '筛选 ▼', '收起时要有带方向的开关')
  assert.equal(chipWith(board, '筛选').props['aria-expanded'], 'false')
})

test('表情格不挂原生 title:否则 tooltip 会压在悬浮预览上,两个提示重着显示', async () => {
  const { board } = await openBoard()
  const cells = byClass(board, 'mp-cell')
  assert.ok(cells.length > 0, '先得有格子')
  for (const c of cells) {
    assert.equal(c.props.title, undefined, '格子上不能有 title(预览里已经有描述/文件名:' + c.props.title + ')')
  }
})

test('筛选区:点开关展开出两排 chip,再点收起;选中状态与开关上的计数都留着', async () => {
  const { board, repaint } = await openBoard()
  let tree = ensureFilters(board, repaint, false)
  const toggle = chipWith(tree, '筛选')
  toggle.props.onClick()
  tree = repaint()
  assert.equal(byClass(tree, 'mp-filter-row').length, 2, '展开后是图库 + 情绪两排')
  assert.equal(chipWith(tree, '筛选').props['aria-expanded'], 'true')
  assert.ok(chipWith(tree, '包一'), '图库 chip 带名字')
  assert.equal(textOf(chipWith(tree, '包一')), '包一 3', 'chip 上带张数')
  assert.ok(chipWith(tree, '开心'), '情绪 chip 用中文标签')
  // 收起:chip 全部撤掉,但已经选中的筛选仍然生效,开关上还要看得出选了几个
  chipWith(tree, '包二').props.onClick()
  tree = repaint()
  chipWith(tree, '筛选').props.onClick()
  tree = repaint()
  assert.equal(byClass(tree, 'mp-filter-row').length, 0, '收起后 chip 不渲染')
  assert.equal(textOf(chipWith(tree, '筛选')), '筛选 1 ▼', '开关上显示选中的筛选个数')
  assert.equal(textOf(byClass(tree, 'mp-count')[0]), '共 2 张', '收起不等于清空筛选')
  assert.equal(byClass(tree, 'mp-cell').length, 2)
})

test('图库 chip 多选:点一下只看它,再点取消;情绪 chip 跟着重新派生', async () => {
  const { board, repaint } = await openBoard()
  let tree = ensureFilters(board, repaint)
  assert.equal(textOf(chipWith(tree, '包一')), '包一 3', 'chip 上要带张数')
  chipWith(tree, '包二').props.onClick()
  const filtered = repaint()
  assert.equal(textOf(byClass(filtered, 'mp-count')[0]), '共 2 张')
  assert.equal(byClass(filtered, 'mp-cell').length, 2)
  assert.ok(chipWith(filtered, '开心'), '包二里的 happy 要用中文标签显示')
  assert.equal(chipWith(filtered, '难过'), undefined, '包里没有的情绪不该列出来')
  // 再点一次取消 → 回到全部
  chipWith(filtered, '包二').props.onClick()
  assert.equal(textOf(byClass(repaint(), 'mp-count')[0]), '共 5 张')
})

test('情绪 chip 多选 + 搜索框:两层取交集,清空一键复位', async () => {
  const { board, repaint } = await openBoard()
  let tree = ensureFilters(board, repaint)
  chipWith(tree, '难过').props.onClick()
  tree = repaint()
  assert.equal(textOf(byClass(tree, 'mp-count')[0]), '共 1 张')
  // 搜一个跟「难过」不沾边的词 → 交集为空
  byClass(tree, 'mp-search')[0].props.onChange({ target: { value: '开心' } })
  tree = repaint()
  assert.equal(textOf(byClass(tree, 'mp-count')[0]), '共 0 张')
  assert.ok(textOf(tree).includes('没有匹配的表情包'))
  // 清空:搜索 + 两排 chip 一起复位
  const clear = byClass(tree, 'mp-clear')[0]
  assert.ok(clear, '有筛选条件时才有清空按钮')
  clear.props.onClick()
  tree = repaint()
  assert.equal(textOf(byClass(tree, 'mp-count')[0]), '共 5 张')
  assert.equal(byClass(tree, 'mp-clear').length, 0, '没有筛选条件就不显示清空')
})

test('点图格照旧把草稿带上一并发送(跨图库也不变)', async () => {
  const { board, calls } = await openBoard()
  byClass(board, 'mp-cell')[0].props.onClick()
  await new Promise((ok) => setTimeout(ok, 0))
  const drafted = calls.filter((c) => c.kind === 'setDraft')
  assert.equal(drafted.length, 1)
  assert.equal(drafted[0].text, '先说两句\n[表情: 开心猫]')
  assert.ok(calls.some((c) => c.kind === 'submit'))
})
