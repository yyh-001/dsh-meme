import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * issue #69:插件更新工具(dsh-unlag)重建页面前会静态扫启动清单里的 client.js,
 * 要求 `__ModuleLoader__.load(...)` 的**实参位**直接是对象字面量,并从里面读出 id。
 * 之前 id/factory 藏在 IIFE 的返回值里(`load((() => { … return { id, factory } })())`),
 * 静态扫描在实参位只看到 `(() => {`,读不出任何 id,于是拒绝重建页面,
 * 提示「插件已更新,页面未重开:有插件已不在运行」。
 *
 * 修法:id 挪到实参对象字面量里(顺便删掉重复写的两行 id),IIFE 仍在,
 * 只负责脚本执行时算一次 APP_BASE 并交回 factory —— 顶层 const 仍不污染全局词法作用域。
 */

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** 从 `load(` 的实参位取出完整对象字面量;不是 `{` 开头就直接判失败。 */
function loadArgumentLiteral(src) {
  const marker = '__ModuleLoader__.load('
  const at = src.indexOf(marker)
  if (at < 0) return null
  let i = at + marker.length
  while (i < src.length && /\s/.test(src[i])) i++
  if (src[i] !== '{') return { startsWithObject: false, literal: null }
  let depth = 0
  let quote = null
  let j = i
  for (; j < src.length; j++) {
    const c = src[j]
    if (quote) {
      if (c === '\\') { j++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '/' && src[j + 1] === '/') {
      const nl = src.indexOf('\n', j)
      j = nl < 0 ? src.length : nl
      continue
    }
    if (c === '/' && src[j + 1] === '*') {
      const end = src.indexOf('*/', j + 2)
      j = end < 0 ? src.length : end + 1
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) { j++; break }
    }
  }
  return { startsWithObject: true, literal: src.slice(i, j) }
}

/** 只读对象字面量的顶层键(跳过嵌套的对象/函数体与字符串)。字符串值一并读出。 */
function topLevelEntries(literal) {
  const entries = []
  let depth = 0
  let quote = null
  for (let j = 0; j < literal.length; j++) {
    const c = literal[j]
    if (quote) {
      if (c === '\\') { j++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '/' && literal[j + 1] === '/') {
      const nl = literal.indexOf('\n', j)
      j = nl < 0 ? literal.length : nl
      continue
    }
    if (c === '/' && literal[j + 1] === '*') {
      const end = literal.indexOf('*/', j + 2)
      j = end < 0 ? literal.length : end + 1
      continue
    }
    if (c === '{' || c === '(' || c === '[') { depth++; continue }
    if (c === '}' || c === ')' || c === ']') { depth--; continue }
    if (depth !== 1) continue
    const m = /^[A-Za-z_$][\w$]*/.exec(literal.slice(j))
    if (!m) continue
    // 标识符后面紧跟 `:` 才算顶层键
    let k = j + m[0].length
    while (k < literal.length && /\s/.test(literal[k])) k++
    if (literal[k] !== ':') { j += m[0].length - 1; continue }
    let v = k + 1
    while (v < literal.length && /\s/.test(literal[v])) v++
    let value = null
    if (literal[v] === "'" || literal[v] === '"') {
      const close = literal.indexOf(literal[v], v + 1)
      if (close > v) value = literal.slice(v + 1, close)
    }
    entries.push({ key: m[0], value })
    j = k
  }
  return entries
}

test('load() 实参位是对象字面量,id 静止可读(issue #69)', () => {
  const { startsWithObject, literal } = loadArgumentLiteral(source)
  assert.equal(startsWithObject, true, 'load( 的实参必须以 { 开头,静态检查器才读得到 id')

  const entries = topLevelEntries(literal)
  const keys = entries.map((e) => e.key)
  assert.ok(keys.includes('id'), '顶层必须有 id')
  assert.ok(keys.includes('factory'), '顶层必须有 factory')
  assert.deepEqual(entries.filter((e) => e.key === 'id'), [{ key: 'id', value: 'dsh-meme' }], '顶层 id 应恰好出现一次且为 dsh-meme')
})

test('改结构后宿主仍能拿到 id / factory / 导出入口', async () => {
  const prevWindow = globalThis.window
  let def = null
  globalThis.window = {
    __ModuleLoader__: {
      load(d) { def = d },
    },
  }
  try {
    await import('../client.js?issue69=' + Date.now())
  } finally {
    if (prevWindow === undefined) delete globalThis.window
    else globalThis.window = prevWindow
  }
  assert.ok(def, '宿主 load 应收到注册对象')
  assert.equal(def.id, 'dsh-meme')
  assert.equal(typeof def.factory, 'function')
  const exports = def.factory((name) => {
    if (name === 'react') return {}
    throw new Error('unexpected require: ' + name)
  })
  assert.ok(exports && typeof exports === 'object')
  for (const key of ['apply', 'inject', '__test']) {
    assert.ok(key in exports, '导出应包含 ' + key)
  }
})

test('IIFE 作用域保护仍在:源码里没有裸顶层 const', () => {
  // load({...}) 之后立刻进入 IIFE,IIFE 内部才是 const/let;实参本身是纯字面量。
  const { startsWithObject, literal } = loadArgumentLiteral(source)
  assert.equal(startsWithObject, true)
  assert.ok(/\bfactory\s*:/.test(literal))
  assert.ok(/\(\s*\(?\s*\(\)\s*=>\s*\{/.test(literal) || /\(\(\)\s*=>\s*\{/.test(literal), 'factory 仍由 IIFE 提供')
})
