import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { MemesStore, keywordTokens, searchRows } from '../memes.js'

// ---- fixture:一张小索引,覆盖「情绪桶 + 关键词」两种搜法 ----
const dir = mkdtempSync(join(tmpdir(), 'dsh-meme-search-'))
const db = new DatabaseSync(join(dir, 'index.db'))
db.exec('CREATE TABLE memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
const insert = db.prepare('INSERT INTO memes VALUES (?, ?, ?, ?, ?, ?, ?)')
insert.run('memes/happy/cat.jpg', 'happy', 'cat.jpg', '猫猫比心', '猫 可爱 比心', 1, 1)
insert.run('memes/happy/ok.jpg', 'happy', 'ok.jpg', '好耶', '开心 好耶', 1, 1)
insert.run('memes/angry/cat-fury.jpg', 'angry', 'cat-fury.jpg', '气鼓鼓的猫', '生气 猫 暴躁', 1, 1)
insert.run('memes/daily/sleep.jpg', 'sleep', 'sleep.jpg', '摸鱼睡觉', '摸鱼 睡觉 上班', 1, 1)
insert.run('memes/confused/why.jpg', 'confused', 'why.jpg', '一脸懵逼', '困惑 问号', 1, 1)
db.close()

const rows = [
  { path: 'memes/happy/cat.jpg', tag: 'happy', file_name: 'cat.jpg', caption: '猫猫比心', keywords: '猫 可爱 比心' },
  { path: 'memes/happy/ok.jpg', tag: 'happy', file_name: 'ok.jpg', caption: '好耶', keywords: '开心 好耶' },
  { path: 'memes/angry/cat-fury.jpg', tag: 'angry', file_name: 'cat-fury.jpg', caption: '气鼓鼓的猫', keywords: '生气 猫 暴躁' },
  { path: 'memes/daily/sleep.jpg', tag: 'sleep', file_name: 'sleep.jpg', caption: '摸鱼睡觉', keywords: '摸鱼 睡觉 上班' },
  { path: 'memes/confused/why.jpg', tag: 'confused', file_name: 'why.jpg', caption: '一脸懵逼', keywords: '困惑 问号' },
]
const paths = (r) => r.memes.map((m) => m.path)
const store = new MemesStore(dir)

test('keywordTokens 按标点切词、小写、去重', () => {
  assert.deepEqual(keywordTokens(' 猫, 生气、猫;CAT/猫 '), ['猫', '生气', 'cat'])
  assert.deepEqual(keywordTokens('   '), [])
})

test('searchRows 命中 caption', () => {
  assert.deepEqual(paths(searchRows(rows, '比心')), ['memes/happy/cat.jpg'])
})

test('searchRows 命中关键词与文件名(英文小写)', () => {
  assert.deepEqual(paths(searchRows(rows, '摸鱼')), ['memes/daily/sleep.jpg'])
  assert.deepEqual(paths(searchRows(rows, 'cat')).sort(), ['memes/angry/cat-fury.jpg', 'memes/happy/cat.jpg'])
})

test('searchRows 多个词:全部命中的优先,不返回只命中一个的', () => {
  // 「猫」命中 happy/cat 与 angry/cat-fury,再加「生气」只有 angry 那张全中
  assert.deepEqual(paths(searchRows(rows, '猫 生气')), ['memes/angry/cat-fury.jpg'])
})

test('searchRows 整词没命中时拆 2-gram 兜底(生气猫 → 生气)', () => {
  assert.deepEqual(paths(searchRows(rows, '生气猫')), ['memes/angry/cat-fury.jpg'])
})

test('searchRows 没命中返回空列表但保留分词结果', () => {
  const miss = searchRows(rows, '不存在的词')
  assert.deepEqual(miss.memes, [])
  assert.deepEqual(miss.tokens, ['不存在的词'])
  assert.deepEqual(searchRows(rows, '   ').memes, [])
})

test('searchRows 同一档内随机:反复搜同一个词能换一批', () => {
  const seen = new Set()
  for (let i = 0; i < 40; i++) seen.add(paths(searchRows(rows, '猫', 1))[0])
  assert.equal(seen.size, 2, '猫相关的两张图都应该有机会被抽到')
})

test('searchRows limit 截断', () => {
  assert.equal(searchRows(rows, '猫', 1).memes.length, 1)
  assert.equal(searchRows(rows, '猫', 8).memes.length, 2)
})

test('MemesStore.search 带 tag 时只在那个情绪桶里搜', () => {
  assert.deepEqual(paths(store.search('猫', 8, 'angry')), ['memes/angry/cat-fury.jpg'])
  assert.deepEqual(paths(store.search('猫', 8, 'happy')), ['memes/happy/cat.jpg'])
  // 细 tag(sleep)也能当范围,和面板 list(tag) 一致
  assert.deepEqual(paths(store.search('摸鱼', 8, 'sleep')), ['memes/daily/sleep.jpg'])
  assert.deepEqual(paths(store.search('猫', 8, 'sleep')), [], '范围不对时不给桶外的图')
})

test('MemesStore.search 不带 tag 时全库搜,并带上情绪字典', () => {
  const hit = store.search('猫', 8)
  assert.deepEqual(paths(hit).sort(), ['memes/angry/cat-fury.jpg', 'memes/happy/cat.jpg'])
  assert.deepEqual(hit.tags, ['happy', 'angry', 'sad', 'shy', 'confused', 'daily'])
  assert.equal(hit.query, '猫')
})

test('MemesStore.search 空 query 不倒库', () => {
  assert.deepEqual(store.search('', 8).memes, [])
  assert.deepEqual(store.search('  ', 8).memes, [])
})

test.after(() => store.close())
