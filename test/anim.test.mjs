import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'

import {
  ANIM_DEFAULT_FRAMES,
  detectAnimation,
  decodeGifFrames,
  buildAnimationFilmstrip,
  animationModelNote,
  encodePng,
} from '../anim.js'
import { ANIM_FIXTURES } from './fixtures-anim.mjs'

/**
 * 动图读取的核心约定:
 * - 只做纯 JS 解码(零第三方依赖,GIF 支持抽帧;WebP/APNG 只读元数据);
 * - GIF 解码结果必须与 Pillow 逐字节一致(fixtures-anim.mjs 里存的是 Pillow 解码帧的 SHA-256);
 * - 胶片条是给模型看的「时间轴」:采样帧要按时间顺序、布局稳定、说明文字要说清帧序。
 */

const bufOf = (name) => Buffer.from(ANIM_FIXTURES[name].b64, 'base64')
const sha256 = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex')

function parsePng(buf) {
  assert.ok(Buffer.isBuffer(buf), 'PNG 应是 Buffer')
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG 签名不对')
  let pos = 8
  let width = 0
  let height = 0
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.subarray(pos + 4, pos + 8).toString('latin1')
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
    } else if (type === 'IDAT') {
      idat.push(data)
    }
    pos += 12 + len
  }
  return { width, height, raw: inflateSync(Buffer.concat(idat)) }
}

test('detectAnimation:GIF 动图带完整帧表,单帧 GIF / 静态图返回 null', () => {
  const basic = detectAnimation(bufOf('basic2'))
  assert.ok(basic)
  assert.equal(basic.format, 'gif')
  assert.equal(basic.width, 4)
  assert.equal(basic.height, 4)
  assert.equal(basic.frameCount, 2)
  assert.equal(basic.totalMs, 300)
  assert.equal(basic.loop, 0)
  assert.equal(basic.infiniteLoop, true)
  assert.equal(basic.decodable, true)
  assert.equal(basic.frames.length, 2)
  assert.equal(basic.frames[0].startMs, 0)
  assert.equal(basic.frames[1].startMs, 50)

  // 单帧 GIF 不是动图:直接走原来的单帧识图
  assert.equal(detectAnimation(bufOf('interlaced')), null)

  // 普通 PNG(无 acTL)/JPEG/随机字节都不是动图
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-body')])
  assert.equal(detectAnimation(png), null)
  assert.equal(detectAnimation(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), null)
  assert.equal(detectAnimation(Buffer.from('definitely not an animation')), null)
  assert.equal(detectAnimation(Buffer.alloc(0)), null)
  assert.equal(detectAnimation(null), null)
})

test('detectAnimation:动图 WebP / APNG 只读元数据,不逐帧解码', () => {
  const webp = detectAnimation(bufOf('animwebp'))
  assert.ok(webp)
  assert.equal(webp.format, 'webp')
  assert.equal(webp.frameCount, 2)
  assert.equal(webp.width, 10)
  assert.equal(webp.height, 8)
  assert.equal(webp.totalMs, 460)
  assert.equal(webp.infiniteLoop, true)
  assert.equal(webp.decodable, false)

  const apng = detectAnimation(bufOf('apng'))
  assert.ok(apng)
  assert.equal(apng.format, 'png')
  assert.equal(apng.frameCount, 2)
  assert.equal(apng.totalMs, 460)
  assert.equal(apng.loop, 0)
  assert.equal(apng.infiniteLoop, true)
  assert.equal(apng.decodable, false)
})

test('decodeGifFrames:GIF 逐帧 RGBA 与 Pillow 解码结果逐字节一致', () => {
  for (const name of ['basic2', 'transparent', 'dispose', 'dispose3', 'partial', 'tenframes']) {
    const fixture = ANIM_FIXTURES[name]
    const buf = bufOf(name)
    const meta = detectAnimation(buf)
    assert.ok(meta, name + ' 应被识别为动图')
    const indices = Array.from({ length: fixture.frameCount }, (_, i) => i)
    const decoded = decodeGifFrames(buf, indices)
    assert.ok(decoded, name + ' 应能解码')
    assert.equal(decoded.frames.length, fixture.frameCount, name + ' 帧数不对')
    for (const frame of decoded.frames) {
      assert.equal(frame.width, fixture.width)
      assert.equal(frame.height, fixture.height)
      const expected = fixture.framesSha[frame.index]
      assert.equal(frame.rgba.length, fixture.width * fixture.height * 4)
      assert.equal(sha256(frame.rgba), expected, name + ' 第 ' + frame.index + ' 帧像素与 Pillow 不一致')
    }
  }
})

test('decodeGifFrames:按需只解目标帧,交错 GIF 的行序映射也正确', () => {
  // 只取首尾两帧,仍应与 Pillow 一致(内部要顺序解到目标帧)
  const ten = bufOf('tenframes')
  const subset = decodeGifFrames(ten, [0, 9])
  assert.deepEqual(subset.frames.map((f) => f.index), [0, 9])
  assert.equal(sha256(subset.frames[0].rgba), ANIM_FIXTURES.tenframes.framesSha[0])
  assert.equal(sha256(subset.frames[1].rgba), ANIM_FIXTURES.tenframes.framesSha[9])

  // 交错 GIF 虽是单帧(不走动图路径),解码仍必须按 interlace pass 还原行序
  const interlaced = decodeGifFrames(bufOf('interlaced'), [0])
  assert.ok(interlaced)
  assert.equal(interlaced.frames.length, 1)
  assert.equal(sha256(interlaced.frames[0].rgba), ANIM_FIXTURES.interlaced.framesSha[0])
})

test('buildAnimationFilmstrip:按时间采样并拼成网格 PNG,布局与返回字段一致', () => {
  const strip = buildAnimationFilmstrip(bufOf('tenframes'), { maxFrames: 4 })
  assert.ok(strip, '10 帧 GIF 应能生成胶片条')
  assert.equal(strip.sampled.length, 4)
  const indexes = strip.sampled.map((s) => s.index)
  assert.equal(new Set(indexes).size, 4, '采样帧不应重复')
  assert.deepEqual([...indexes].sort((a, b) => a - b), indexes, '采样帧应按时间顺序')
  assert.equal(strip.cols, 2)
  assert.equal(strip.rows, 2)
  assert.equal(strip.png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  const parsed = parsePng(strip.png)
  assert.equal(parsed.width, strip.cols * strip.cellWidth + (strip.cols + 1) * 6)
  assert.equal(parsed.height, strip.rows * strip.cellHeight + (strip.rows + 1) * 6)
  // 每行前面有 1 字节 filter(0)
  assert.equal(parsed.raw.length, parsed.height * (1 + parsed.width * 4))

  // 帧数少时列数/行数跟着收缩
  const two = buildAnimationFilmstrip(bufOf('basic2'), { maxFrames: ANIM_DEFAULT_FRAMES })
  assert.equal(two.sampled.length, 2)
  assert.equal(two.cols, 2)
  assert.equal(two.rows, 1)

  // 非 GIF 动图 / 单帧 GIF 都回退到单帧识别
  assert.equal(buildAnimationFilmstrip(bufOf('animwebp')), null)
  assert.equal(buildAnimationFilmstrip(bufOf('apng')), null)
  assert.equal(buildAnimationFilmstrip(bufOf('interlaced')), null)
})

test('animationModelNote:GIF 描述胶片条布局与帧时序,WebP/APNG 说明只看到第一帧', () => {
  const gifMeta = detectAnimation(bufOf('tenframes'))
  const strip = buildAnimationFilmstrip(bufOf('tenframes'), { maxFrames: 3 })
  const gifNote = animationModelNote(gifMeta, strip)
  assert.match(gifNote, /GIF 动图:共 10 帧/)
  assert.match(gifNote, /总时长 1000 ms/)
  assert.match(gifNote, /无限循环播放/)
  assert.match(gifNote, /胶片条/)
  assert.match(gifNote, /第 \d+ 帧/)
  assert.match(gifNote, /看不到的动作不等于没发生/)

  const webpNote = animationModelNote(detectAnimation(bufOf('animwebp')), null)
  assert.match(webpNote, /WebP 动图/)
  assert.match(webpNote, /第一帧/)
  assert.match(webpNote, /无法展开/)

  const apngNote = animationModelNote(detectAnimation(bufOf('apng')), null)
  assert.match(apngNote, /APNG 动图/)

  assert.equal(animationModelNote(null, null), '')
})

test('encodePng:2x2 RGBA 能编码成可解码的标准 PNG', () => {
  // 红、绿 / 蓝、半透明白
  const rgba = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 128,
  ])
  const png = encodePng(2, 2, rgba)
  const parsed = parsePng(png)
  assert.equal(parsed.width, 2)
  assert.equal(parsed.height, 2)
  // 每行 1 字节 filter(0)+ 8 字节 RGBA
  assert.equal(parsed.raw.length, 2 * (1 + 2 * 4))
  for (let y = 0; y < 2; y++) {
    assert.equal(parsed.raw[y * 9], 0, '每行 filter 应为 0(None)')
    for (let x = 0; x < 2; x++) {
      const src = (y * 2 + x) * 4
      const dst = y * 9 + 1 + x * 4
      assert.deepEqual([...parsed.raw.subarray(dst, dst + 4)], [...rgba.subarray(src, src + 4)])
    }
  }
})

test('detectAnimation:截断/损坏的 GIF 不抛异常,按非动图处理', () => {
  const full = bufOf('dispose')
  assert.equal(detectAnimation(full.subarray(0, 10)), null, '截断到文件头不算动图')
  assert.equal(detectAnimation(full.subarray(0, 60)), null, '截断帧数据应安全返回 null')
  // 合法 GIF 头 + 垃圾字节:要么 null,要么结构解析失败为 null,不能抛
  const junk = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40, 7)])
  const result = detectAnimation(junk)
  if (result) assert.equal(result.format, 'gif')
})
