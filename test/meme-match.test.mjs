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

test('matchDesc index 未加载时仍可走分词兜底', () => {
  assert.equal(T.matchDesc('无语', null, search), 'u-speechless')
  assert.equal(T.matchDesc('无语', null, null), null)
})
