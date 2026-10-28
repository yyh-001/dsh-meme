/**
 * QQ 发图尺寸:缩图模块单测。
 *
 * 覆盖:长边归一化、静态图缩小且不改原文件、缓存复用、GIF 帧数保留、
 * 已经够小的图直接返回原路径。sharp 不可用时跳过(功能本身会回退原图)。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = mkdtempSync(join(tmpdir(), 'dsh-qq-resize-'))
process.env.DSH_MEME_HOME = home

const { normalizeQqSendEdge, resizeForQq, loadSharp } = await import('../qq-resize.js')
const sha = (buf) => createHash('sha1').update(buf).digest('hex')

after(() => {
  rmSync(home, { recursive: true, force: true })
})

test('normalizeQqSendEdge:默认 300,夹在 200-450', () => {
  assert.equal(normalizeQqSendEdge(undefined), 300)
  assert.equal(normalizeQqSendEdge(''), 300)
  assert.equal(normalizeQqSendEdge('abc'), 300)
  assert.equal(normalizeQqSendEdge(150), 200)
  assert.equal(normalizeQqSendEdge(999), 450)
  assert.equal(normalizeQqSendEdge(300), 300)
  assert.equal(normalizeQqSendEdge('400'), 400)
})

test('resizeForQq:静态图缩到长边 300,原文件不动,重复调用命中缓存', async (t) => {
  const sharp = await loadSharp()
  if (!sharp) return t.skip('sharp 不可用')
  const src = join(home, 'big.png')
  const original = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer()
  writeFileSync(src, original)
  const cacheDir = join(home, 'cache-static')

  const out1 = await resizeForQq(src, { edge: 300, cacheDir })
  assert.notEqual(out1, src)
  const meta = await sharp(out1).metadata()
  assert.ok(Math.max(meta.width, meta.height) <= 300, '长边不超过 300')
  assert.equal(meta.width, 300)
  assert.equal(meta.height, 200)
  assert.equal(sha(readFileSync(src)), sha(original), '图库原文件不能被改')

  const out2 = await resizeForQq(src, { edge: 300, cacheDir })
  assert.equal(out2, out1, '同一源文件 + 同一长边应命中缓存')
})

test('resizeForQq:GIF 缩放后帧数不变', async (t) => {
  const sharp = await loadSharp()
  if (!sharp) return t.skip('sharp 不可用')
  const frames = []
  for (const background of [{ r: 255, g: 0, b: 0, alpha: 1 }, { r: 0, g: 0, b: 255, alpha: 1 }]) {
    frames.push(await sharp({ create: { width: 400, height: 400, channels: 4, background } }).png().toBuffer())
  }
  const gif = await sharp(frames, { join: { animated: true } }).gif().toBuffer()
  const src = join(home, 'anim.gif')
  writeFileSync(src, gif)
  const before = await sharp(gif, { animated: true }).metadata()
  assert.equal(before.pages, 2)

  const out = await resizeForQq(src, { edge: 300, cacheDir: join(home, 'cache-gif') })
  assert.notEqual(out, src)
  const meta = await sharp(out, { animated: true }).metadata()
  assert.equal(meta.pages, 2, 'GIF 两帧都要保留')
  assert.ok(Math.max(meta.width, meta.pageHeight) <= 300)
})

test('resizeForQq:已经够小的图和缺失文件直接返回原路径', async (t) => {
  const sharp = await loadSharp()
  if (!sharp) return t.skip('sharp 不可用')
  const small = join(home, 'small.png')
  writeFileSync(small, await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer())
  assert.equal(await resizeForQq(small, { edge: 300, cacheDir: join(home, 'cache-small') }), small)
  const missing = join(home, 'nope.png')
  assert.equal(await resizeForQq(missing, { edge: 300, cacheDir: join(home, 'cache-missing') }), missing)
})
