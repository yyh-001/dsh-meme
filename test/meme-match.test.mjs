import test from 'node:test'
import assert from 'node:assert/strict'

// 加载浏览器模块格式的 client.js:伪造 window.__ModuleLoader__ 与 require('react')
const fakeReact = {}
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      globalThis.__dshMeme = def.factory((name) => {
        if (name === 'react') return fakeReact
        throw new Error('unexpected require: ' + name)
      })
    },
  },
}
await import('../client.js')
const T = globalThis.__dshMeme.__test

const rows = [
  { caption: '开心到飞起', keywords: '开心 高兴 哈哈', file_name: 'a.jpg', url: 'u-happy' },
  { caption: '好无语啊', keywords: '无语 无言', file_name: 'b.jpg', url: 'u-speechless' },
  { caption: '看不太懂，瞎编一个应付下用户先', keywords: '不懂 瞎编', file_name: 'c.jpg', url: 'u-confused' },
]
const search = T.buildMemeSearch(rows, (r) => r.url)

test('foldCaption 折叠弯引号与空白', () => {
  assert.equal(T.foldCaption('\u201c开心\u201d\u300c无语\u300d  \n'), '"开心""无语"')
})

test('looseCaption 去引号去空白', () => {
  assert.equal(T.looseCaption(' \u201c好 无语\u201d '), '好无语')
})

test('splitDescTokens 按标点切词、滤短词、长词优先', () => {
  assert.deepEqual(T.splitDescTokens('恍然大悟,原来是这个意思!'), ['原来是这个意思', '恍然大悟'])
  assert.deepEqual(T.splitDescTokens('好 a 的'), [])
})

test('buildMemeSearch 产出折叠+紧凑 haystack 与分词', () => {
  const row = search[1]
  assert.equal(row.url, 'u-speechless')
  assert.ok(row.hay.includes('无语 无言'))
  assert.ok(row.hay.includes('无语无言'))
  assert.ok(row.tokens.includes('无语'))
})

test('matchDesc 精确命中 caption', () => {
  const index = new Map([['开心到飞起', 'u-happy']])
  assert.equal(T.matchDesc('开心到飞起', index, search), 'u-happy')
})

test('matchDesc 折叠引号后命中', () => {
  const curly = '\u201c开心到飞起\u201d'
  const index = new Map([[T.foldCaption(curly), 'u-happy']])
  assert.equal(T.matchDesc(curly, index, search), 'u-happy')
})

test('matchDesc 分词兜底:描述是 caption 子串', () => {
  assert.equal(T.matchDesc('无语', null, search), 'u-speechless')
})

test('matchDesc 分词兜底:双向包含(太无语了 ↔ 无语)', () => {
  assert.equal(T.matchDesc('太无语了', null, search), 'u-speechless')
})

test('matchDesc 分词兜底:命中关键词', () => {
  assert.equal(T.matchDesc('不懂', null, search), 'u-confused')
})

test('matchDesc 无命中返回 null(issue #8:模型自编描述且库中无相近图)', () => {
  assert.equal(T.matchDesc('恍然大悟,原来是这个意思!', null, search), null)
})

test('matchDesc 模糊匹配按实际命中长度排序,不被排在前面的短词截走(#39)', () => {
  const candidates = T.buildMemeSearch([
    { caption: '害羞', url: 'old' },
    { caption: '脸红得不敢看人', url: 'new' },
  ], (r) => r.url)
  for (const list of [candidates, [...candidates].reverse()]) {
    assert.equal(T.matchDesc('害羞，脸红得不敢看人', null, list), 'new')
    assert.equal(T.matchDesc('害羞脸红得不敢看人', null, list), 'new', '双向包含按实际重叠长度打分')
  }
  assert.equal(T.matchDesc('害羞，脸红得不敢看人', new Map([['害羞，脸红得不敢看人', 'exact']]), candidates), 'exact')
})

test('matchDesc 最长命中相同时比较命中词数,重复描述词不加分(#39)', () => {
  const candidates = T.buildMemeSearch([
    { caption: '害羞', url: 'one' },
    { caption: '害羞', keywords: '脸红', url: 'two' },
  ], (r) => r.url)
  assert.equal(T.matchDesc('害羞，害羞，脸红', null, candidates), 'two')
})

test('matchDesc index 未加载时仍可走分词兜底', () => {
  assert.equal(T.matchDesc('无语', null, search), 'u-speechless')
  assert.equal(T.matchDesc('无语', null, null), null)
})

// issue #52:内置包 keywords 含「下班」,用户包另一张图 caption="下班！！！"。
// 点击缩略图发 [表情: 下班！！！],此前单层索引里 keywords 与 caption 同权、
// 平手先到先得,内置包排前面就赢走配图 → 渲染成摸鱼躺平图。
const clashRows = [
  { caption: '摸鱼躺平，半睁眼摊着不想动', keywords: '摸鱼 躺平 下班 不想干活 大肥鱼', file_name: 'tangping.jpg', url: 'built/tangping.jpg' },
  { caption: '下班！！！', keywords: '下班 累趴', file_name: '下班！！！.jpg', url: 'user/xiaban.jpg' },
]
const clashIndex = T.buildMemeIndex(clashRows, (r) => r.url)
const clashSearch = T.buildMemeSearch(clashRows, (r) => r.url)

test('buildMemeIndex 分 caption/keyword 两层,keywords 逐词入层(#52)', () => {
  assert.equal(clashIndex.caption.get('下班！！！'), 'user/xiaban.jpg')
  assert.equal(clashIndex.caption.get('摸鱼躺平，半睁眼摊着不想动'), 'built/tangping.jpg')
  assert.equal(clashIndex.keyword.get('下班'), 'built/tangping.jpg', '同层撞词 first-wins(包顺序)')
  assert.ok(!clashIndex.caption.has('下班'), '单个检索词不进 caption 层')
})

test('matchDesc caption 精确命中压过跨包 keywords 撞词(#52)', () => {
  assert.equal(T.matchDesc('下班！！！', clashIndex, clashSearch), 'user/xiaban.jpg')
})

test('matchDesc keyword 层精确命中单词描述,不再依赖分词兜底(#52)', () => {
  assert.equal(T.matchDesc('下班', clashIndex, clashSearch), 'built/tangping.jpg')
  assert.equal(T.matchDesc('不想干活', clashIndex, clashSearch), 'built/tangping.jpg')
})

test('matchDesc 同层同 key 后注册者不隐式覆盖先注册者(#52)', () => {
  const idx = T.buildMemeIndex([
    { caption: '开心', url: 'first' },
    { caption: '开心', url: 'second' },
  ], (r) => r.url)
  assert.equal(idx.caption.get('开心'), 'first')
})

test('matchDesc 兼容旧的单层 Map 索引(仅 caption 精确)', () => {
  const index = new Map([['开心到飞起', 'u-happy']])
  assert.equal(T.matchDesc('开心到飞起', index, search), 'u-happy')
})

test('compareVersions:数值段比较、v 前缀、长度不足补 0', () => {
  const C = T.compareVersions
  assert.equal(C('1.2.0', '1.2.0'), 0)
  assert.equal(C('v1.2.0', '1.2.0'), 0)
  assert.equal(C('1.3.0', '1.2.0'), 1)
  assert.equal(C('1.2.0', '1.3.0'), -1)
  assert.equal(C('1.2', '1.2.0'), 0)
  assert.equal(C('1.10.0', '1.9.0'), 1, '按数值比而不是字符串')
  assert.equal(C('2.0.0', '1.99.99'), 1)
  assert.equal(C('1.2.0', '1.2.0-beta'), 1, '1.2.0 比 1.2.0-beta 新')
  assert.equal(C('', '1.0.0'), 0, '缺版本 = 无法判断')
  assert.equal(C('1.0.0', undefined), 0)
  assert.equal(C('beta', '1.0.0'), -1, '非数字段退化比较')
})
