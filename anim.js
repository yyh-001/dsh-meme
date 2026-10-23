/**
 * 动图读取:零依赖 GIF 解码 + 胶片条合成。
 *
 * 背景:DSH 的图片入库管线会把动图归一化成单帧,模型看图片时只会看到第一帧,
 * 「动」的信息在到达模型之前就丢了。dsh-meme 的 AI 学图(learn_meme / 上传弹窗的
 * AI 识别)需要看懂表情包的动作,所以这里直接在字节层把 GIF 逐帧解码,按时间均匀
 * 采样,拼成一张「胶片条」PNG 交给模型,并附上帧号/时间说明。
 *
 * 支持范围:
 * - GIF:完整解码(调色板、透明、局部帧、处置方式 disposal、交错 interlace);
 * - 动图 WebP / APNG:只识别元数据(帧数、总时长、是否循环),不做逐帧解码——
 *   这两类要 VP8 / APNG 解码器,违背本插件「零第三方运行依赖」的约定。
 *
 * 所有函数只吃 Buffer、返回 Buffer / 纯对象,不碰文件系统,也不依赖插件上下文。
 * PNG 编码用 node:zlib,不引入依赖。
 */
import { deflateSync } from 'node:zlib'

/** 胶片条长边上限(像素):再大对视觉模型没有收益,只会让附件变大 */
const STRIP_MAX_EDGE = 1600
/** 默认采样帧数 */
export const ANIM_DEFAULT_FRAMES = 8
/** 单帧画布像素上限,防超大 GIF 解码炸内存 */
const ANIM_MAX_PIXELS = 16 * 1024 * 1024
/** 超过这个帧数的动图不做逐帧解码 */
const ANIM_MAX_TOTAL_FRAMES = 2000

const u16le = (buf, off) => buf[off] | (buf[off + 1] << 8)
const u24le = (buf, off) => buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16)
const u32be = (buf, off) => ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0
const ascii = (buf, start, end) => buf.toString('latin1', start, end)

/** GIF 数据子块:每块一个长度字节 + 数据,0 结束。pos 指向第一个长度字节。 */
function skipSubBlocks(buf, pos) {
  let p = pos
  while (p < buf.length) {
    const n = buf[p++]
    if (n === 0) return p
    p += n
  }
  return p
}

/**
 * 结构扫描:不碰像素,只把 GIF 的帧表/时序/循环读出来。
 * 帧数据按子块拼好存进 frames[i].data,供真正需要采样时再解码。
 */
function scanGif(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 13) return null
  const sig = ascii(buf, 0, 6)
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null
  const width = u16le(buf, 6)
  const height = u16le(buf, 8)
  const packed = buf[10]
  const bgIndex = buf[11]
  let pos = 13
  let gct = null
  if (packed & 0x80) {
    const n = 1 << ((packed & 7) + 1)
    if (pos + n * 3 > buf.length) return null
    gct = buf.subarray(pos, pos + n * 3)
    pos += n * 3
  }
  const frames = []
  let loop = 1
  let hasLoop = false
  // 图形控制扩展只作用于紧跟着的那一帧
  let gce = { delayCs: 0, disposal: 0, transparentIndex: -1 }
  while (pos < buf.length) {
    const block = buf[pos++]
    if (block === 0x3b) break // 文件结束
    if (block === 0x21) {
      if (pos >= buf.length) break
      const label = buf[pos++]
      if (label === 0xf9) {
        const size = buf[pos]
        if (size >= 4) {
          const flags = buf[pos + 1]
          gce = {
            disposal: (flags >> 2) & 7,
            transparentIndex: flags & 1 ? buf[pos + 4] : -1,
            delayCs: buf[pos + 2] | (buf[pos + 3] << 8),
          }
        }
        pos = skipSubBlocks(buf, pos)
      } else if (label === 0xff) {
        const size = buf[pos]
        const id = ascii(buf, pos + 1, pos + 1 + size)
        const dataPos = pos + 1 + size
        if (id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') {
          // 循环块:第一个子块是 [1, loopLo, loopHi];loop=0 表示无限循环
          let p = dataPos
          while (p < buf.length) {
            const n = buf[p++]
            if (n === 0) break
            if (n >= 3 && buf[p] === 1) {
              loop = u16le(buf, p + 1)
              hasLoop = true
            }
            p += n
          }
          pos = p
        } else {
          pos = skipSubBlocks(buf, pos)
        }
      } else {
        pos = skipSubBlocks(buf, pos)
      }
    } else if (block === 0x2c) {
      if (pos + 9 > buf.length) return null
      const left = u16le(buf, pos)
      const top = u16le(buf, pos + 2)
      const w = u16le(buf, pos + 4)
      const h = u16le(buf, pos + 6)
      const ipacked = buf[pos + 8]
      pos += 9
      let palette = gct
      if (ipacked & 0x80) {
        const n = 1 << ((ipacked & 7) + 1)
        if (pos + n * 3 > buf.length) return null
        palette = buf.subarray(pos, pos + n * 3)
        pos += n * 3
      }
      if (pos >= buf.length) return null
      const minCodeSize = buf[pos++]
      const end = skipSubBlocks(buf, pos)
      // 把数据子块拼成连续字节,方便 LZW 按位读
      const parts = []
      let p = pos
      while (p < end) {
        const n = buf[p++]
        if (n === 0 || p + n > end) break
        parts.push(buf.subarray(p, p + n))
        p += n
      }
      frames.push({
        left, top, width: w, height: h,
        interlaced: (ipacked & 0x40) !== 0,
        palette,
        minCodeSize,
        data: parts.length === 1 ? parts[0] : Buffer.concat(parts),
        delayMs: gce.delayCs > 0 ? gce.delayCs * 10 : 100,
        disposal: gce.disposal,
        transparentIndex: gce.transparentIndex,
      })
      pos = end
      gce = { delayCs: 0, disposal: 0, transparentIndex: -1 }
    } else {
      // 未知块:结构不可信,按解析失败处理,让调用方回退到普通单帧识别
      return null
    }
  }
  if (frames.length === 0) return null
  let totalMs = 0
  for (const f of frames) {
    f.startMs = totalMs
    totalMs += f.delayMs
  }
  return {
    format: 'gif', width, height, bgIndex, gct,
    frames, frameCount: frames.length, totalMs,
    loop: hasLoop ? loop : 1,
    infiniteLoop: hasLoop && loop === 0,
  }
}

/** LZW 解码:GIF 的变长码(LSB-first),码表最大 4096 项。 */
function lzwDecode(data, minCodeSize, pixelCount) {
  const out = new Uint8Array(pixelCount)
  let outPos = 0
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  let codeSize = minCodeSize + 1
  let nextCode = endCode + 1
  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  const firstChar = new Uint8Array(4096)
  for (let i = 0; i < clearCode; i++) {
    prefix[i] = -1
    suffix[i] = i
    firstChar[i] = i
  }
  const stack = new Uint8Array(4097)
  let bitBuf = 0
  let bitCnt = 0
  let pos = 0
  let prev = -1
  while (outPos < pixelCount) {
    while (bitCnt < codeSize) {
      if (pos >= data.length) return out
      bitBuf |= data[pos++] << bitCnt
      bitCnt += 8
    }
    const code = bitBuf & ((1 << codeSize) - 1)
    bitBuf >>>= codeSize
    bitCnt -= codeSize
    if (code === clearCode) {
      codeSize = minCodeSize + 1
      nextCode = endCode + 1
      prev = -1
      continue
    }
    if (code === endCode) break
    let sp = 0
    let c = code
    if (c >= nextCode) {
      // 特殊情形:编码器刚加入的码,解码器还没建好它
      if (prev < 0) break
      stack[sp++] = firstChar[prev]
      c = prev
    }
    while (c >= 0 && sp < stack.length) {
      stack[sp++] = suffix[c]
      c = prefix[c]
    }
    while (sp > 0 && outPos < pixelCount) out[outPos++] = stack[--sp]
    if (prev >= 0 && nextCode < 4096) {
      prefix[nextCode] = prev
      suffix[nextCode] = firstChar[code >= nextCode ? prev : code]
      firstChar[nextCode] = firstChar[prev]
      nextCode++
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++
    }
    prev = code
  }
  return out
}

/** 交错 GIF 的 4 个 pass:解码顺序 → 实际行号 */
const INTERLACE_PASSES = [[0, 8], [4, 8], [2, 4], [1, 2]]

/**
 * 解码指定帧(必须按顺序解码到目标帧,只保留目标的 RGBA)。
 * 处置方式:
 * - 0/1:保留当前画布;
 * - 2:把该帧矩形恢复成背景色(透明 GIF 恢复透明);
 * - 3:恢复成画该帧之前的画布。
 */
export function decodeGifFrames(buf, indices) {
  const meta = scanGif(buf)
  if (!meta) return null
  const { width, height, frames } = meta
  if (width <= 0 || height <= 0 || width * height > ANIM_MAX_PIXELS || frames.length > ANIM_MAX_TOTAL_FRAMES) {
    return { meta, frames: [], tooLarge: true }
  }
  const want = new Set((indices || []).map((n) => Number(n)).filter((n) => n >= 0 && n < frames.length))
  const maxWant = want.size ? Math.max(...want) : -1
  const canvas = new Uint8Array(width * height * 4)
  const out = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const before = f.disposal === 3 ? canvas.slice() : null
    const idx = lzwDecode(f.data, f.minCodeSize, f.width * f.height)
    const palette = f.palette
    const palSize = palette ? (palette.length / 3) | 0 : 0
    const transparent = f.transparentIndex >= 0 ? f.transparentIndex : -1
    const draw = (srcRow, dstY) => {
      const canvasRow = (f.top + dstY) * width + f.left
      if (dstY >= f.height) return
      for (let x = 0; x < f.width; x++) {
        const v = idx[srcRow * f.width + x]
        if (v === transparent) continue
        if (v >= palSize) continue // 调色板外的索引按透明处理,不让未初始化字节污染图片
        const o = (canvasRow + x) * 4
        canvas[o] = palette[v * 3]
        canvas[o + 1] = palette[v * 3 + 1]
        canvas[o + 2] = palette[v * 3 + 2]
        canvas[o + 3] = 255
      }
    }
    if (f.interlaced) {
      let row = 0
      for (const [start, step] of INTERLACE_PASSES) {
        for (let y = start; y < f.height; y += step) draw(row++, y)
      }
    } else {
      for (let y = 0; y < f.height; y++) draw(y, y)
    }
    if (want.has(i)) {
      out.push({ index: i, rgba: canvas.slice(), width, height, startMs: f.startMs, delayMs: f.delayMs })
    }
    if (f.disposal === 2) {
      const bg = f.transparentIndex >= 0 ? null : meta.gct && meta.bgIndex * 3 + 2 < meta.gct.length
        ? [meta.gct[meta.bgIndex * 3], meta.gct[meta.bgIndex * 3 + 1], meta.gct[meta.bgIndex * 3 + 2]]
        : [0, 0, 0]
      for (let y = 0; y < f.height; y++) {
        const base = (f.top + y) * width + f.left
        if (f.top + y >= height) break
        for (let x = 0; x < f.width; x++) {
          if (f.left + x >= width) break
          const o = (base + x) * 4
          if (bg) {
            canvas[o] = bg[0]
            canvas[o + 1] = bg[1]
            canvas[o + 2] = bg[2]
            canvas[o + 3] = 255
          } else {
            canvas[o] = 0
            canvas[o + 1] = 0
            canvas[o + 2] = 0
            canvas[o + 3] = 0
          }
        }
      }
    } else if (f.disposal === 3 && before) {
      canvas.set(before)
    }
    // 只解码到最后一个需要的帧:长动图末尾的帧不必白解码一遍
    if (maxWant >= 0 && i >= maxWant) break
  }
  // 按目标顺序返回
  const byIndex = new Map(out.map((f) => [f.index, f]))
  return { meta, frames: [...want].sort((a, b) => a - b).map((i) => byIndex.get(i)).filter(Boolean) }
}

/** 按时间均匀采样:让采样点覆盖整段时间轴,而不是只覆盖前几帧。 */
function sampleIndicesByTime(meta, maxFrames) {
  const n = meta.frames.length
  const k = Math.min(maxFrames, n)
  if (k <= 1) return [0]
  const picked = []
  for (let i = 0; i < k; i++) {
    const t = (meta.totalMs * i) / (k - 1)
    let idx = 0
    while (idx + 1 < n && meta.frames[idx + 1].startMs <= t) idx++
    if (!picked.includes(idx)) picked.push(idx)
  }
  // 极端情况下(时间集中在少数帧)不足 k 帧,按索引补齐
  for (let i = 0; i < n && picked.length < k; i++) {
    if (!picked.includes(i)) picked.push(i)
  }
  return picked.sort((a, b) => a - b)
}

/** 最近邻缩放 RGBA 到长边 ≤ limit */
function scaleRgba(rgba, w, h, limit) {
  const long = Math.max(w, h)
  if (long <= limit) return { rgba, width: w, height: h }
  const ratio = limit / long
  const tw = Math.max(1, Math.round(w * ratio))
  const th = Math.max(1, Math.round(h * ratio))
  const out = new Uint8Array(tw * th * 4)
  for (let y = 0; y < th; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / th))
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / tw))
      const s = (sy * w + sx) * 4
      const o = (y * tw + x) * 4
      out[o] = rgba[s]
      out[o + 1] = rgba[s + 1]
      out[o + 2] = rgba[s + 2]
      out[o + 3] = rgba[s + 3]
    }
  }
  return { rgba: out, width: tw, height: th }
}

// ---- 最小 PNG 编码器(8 位 RGBA,filter 0) ----

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** RGBA 像素 → PNG(Buffer)。窄高 / 宽扁都不做滤波,贴纸色块压缩率足够。 */
export function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- 动图格式识别(WebP / APNG 只做元数据) ----

function scanWebp(buf) {
  if (buf.length < 12) return null
  if (ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 12) !== 'WEBP') return null
  let pos = 12
  let animated = false
  let width = 0
  let height = 0
  let frames = 0
  let totalMs = 0
  let loop = 1
  while (pos + 8 <= buf.length) {
    const type = ascii(buf, pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const dataPos = pos + 8
    const dataEnd = Math.min(buf.length, dataPos + size)
    if (type === 'VP8X' && size >= 10) {
      const flags = buf[dataPos]
      animated = (flags & 0x02) !== 0
      width = 1 + u24le(buf, dataPos + 4)
      height = 1 + u24le(buf, dataPos + 7)
    } else if (type === 'ANIM' && size >= 6) {
      loop = u16le(buf, dataPos + 4)
    } else if (type === 'ANMF' && size >= 16) {
      frames++
      // ANMF 第 12 字节起是 24 位帧时长(毫秒)
      totalMs += u24le(buf, dataPos + 12)
    }
    pos = dataEnd + (size & 1)
  }
  if (!animated || frames < 2) return null
  return { format: 'webp', width, height, frameCount: frames, totalMs, loop, infiniteLoop: loop === 0, decodable: false }
}

function scanApng(buf) {
  if (buf.length < 8) return null
  if (buf[0] !== 0x89 || ascii(buf, 1, 4) !== 'PNG') return null
  let pos = 8
  let width = 0
  let height = 0
  let declaredFrames = 0
  let loop = 1
  let totalMs = 0
  let fcTLCount = 0
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = ascii(buf, pos + 4, pos + 8)
    const dataPos = pos + 8
    if (type === 'IHDR' && len >= 8) {
      width = buf.readUInt32BE(dataPos)
      height = buf.readUInt32BE(dataPos + 4)
    } else if (type === 'acTL' && len >= 8) {
      declaredFrames = buf.readUInt32BE(dataPos)
      loop = buf.readUInt32BE(dataPos + 4)
    } else if (type === 'fcTL' && len >= 26) {
      // fcTL: seq(4) w(4) h(4) x(4) y(4) delay_num(2) delay_den(2) ...
      fcTLCount++
      const num = buf.readUInt16BE(dataPos + 20)
      const den = buf.readUInt16BE(dataPos + 22)
      totalMs += den === 0 ? num * 10 : Math.round((num * 1000) / den)
    } else if (type === 'IEND') {
      break
    }
    pos = dataPos + len + 4
    if (pos <= dataPos) break
  }
  const frameCount = declaredFrames || fcTLCount
  if (frameCount < 2) return null
  return { format: 'png', width, height, frameCount, totalMs, loop, infiniteLoop: loop === 0, decodable: false }
}

/**
 * 识别动图。返回 null 表示不是动图(或不是 GIF/WebP/APNG)。
 * GIF 的 meta 里带完整帧表(帧数/每帧起始时间/总时长/是否循环)。
 */
export function detectAnimation(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 13) return null
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') {
    const gif = scanGif(buf)
    if (!gif || gif.frameCount < 2) return null
    return { ...gif, decodable: true }
  }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return scanWebp(buf)
  if (buf[0] === 0x89 && ascii(buf, 1, 4) === 'PNG') return scanApng(buf)
  return null
}

/**
 * 构建胶片条:均匀采样最多 maxFrames 帧 → 缩放 → 拼成网格 PNG。
 * 返回 { png, meta, sampled:[{index,startMs,delayMs}], cols, rows, cellWidth, cellHeight }。
 * 非 GIF 动图 / 超出安全上限时返回 null(调用方回退到单帧识别 + 元数据说明)。
 */
export function buildAnimationFilmstrip(buf, options = {}) {
  const meta = detectAnimation(buf)
  if (!meta || meta.format !== 'gif' || meta.decodable !== true) return null
  if (meta.width * meta.height > ANIM_MAX_PIXELS || meta.frames.length > ANIM_MAX_TOTAL_FRAMES) return null
  const maxFrames = Math.max(1, Math.min(16, Number(options.maxFrames) || ANIM_DEFAULT_FRAMES))
  const indices = sampleIndicesByTime(meta, maxFrames)
  const decoded = decodeGifFrames(buf, indices)
  if (!decoded || !decoded.frames || decoded.frames.length === 0) return null
  const k = decoded.frames.length
  const cols = k <= 1 ? 1 : k <= 4 ? 2 : k <= 6 ? 3 : 4
  const rows = Math.ceil(k / cols)
  const pad = 6
  const maxEdge = Math.max(640, Math.min(4096, Number(options.maxEdge) || STRIP_MAX_EDGE))
  const cellLimit = Math.max(160, Math.min(768, Math.floor(maxEdge / cols) - pad * 2))
  const scaled = decoded.frames.map((f) => scaleRgba(f.rgba, f.width, f.height, cellLimit))
  const cellWidth = Math.max(...scaled.map((s) => s.width))
  const cellHeight = Math.max(...scaled.map((s) => s.height))
  const stripWidth = cols * cellWidth + (cols + 1) * pad
  const stripHeight = rows * cellHeight + (rows + 1) * pad
  const strip = new Uint8Array(stripWidth * stripHeight * 4)
  // 浅灰底:GIF 的透明区域在 PNG 里是透明的,铺浅灰让模型看清轮廓
  for (let i = 0; i < stripWidth * stripHeight; i++) {
    strip[i * 4] = 240
    strip[i * 4 + 1] = 240
    strip[i * 4 + 2] = 240
    strip[i * 4 + 3] = 255
  }
  scaled.forEach((cell, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x0 = pad + col * (cellWidth + pad) + Math.floor((cellWidth - cell.width) / 2)
    const y0 = pad + row * (cellHeight + pad) + Math.floor((cellHeight - cell.height) / 2)
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) {
        const s = (y * cell.width + x) * 4
        const o = ((y0 + y) * stripWidth + (x0 + x)) * 4
        const a = cell.rgba[s + 3]
        if (a === 0) continue
        if (a === 255) {
          strip[o] = cell.rgba[s]
          strip[o + 1] = cell.rgba[s + 1]
          strip[o + 2] = cell.rgba[s + 2]
        } else {
          // 半透明像素按 alpha 合成到浅灰底
          const alpha = a / 255
          strip[o] = Math.round(cell.rgba[s] * alpha + 240 * (1 - alpha))
          strip[o + 1] = Math.round(cell.rgba[s + 1] * alpha + 240 * (1 - alpha))
          strip[o + 2] = Math.round(cell.rgba[s + 2] * alpha + 240 * (1 - alpha))
        }
        strip[o + 3] = 255
      }
    }
  })
  return {
    png: encodePng(stripWidth, stripHeight, strip),
    meta,
    sampled: decoded.frames.map((f) => ({ index: f.index, startMs: f.startMs, delayMs: f.delayMs })),
    cols, rows, cellWidth, cellHeight,
  }
}

/**
 * 给模型看的动图说明。strip 存在时描述胶片条布局+帧时序并要求描述动作;
 * strip 为 null 时(动图 WebP / APNG)说明只看到第一帧。
 */
export function animationModelNote(meta, strip) {
  if (!meta || !meta.format) return ''
  const label = meta.format === 'gif' ? 'GIF' : meta.format === 'webp' ? 'WebP' : 'APNG'
  const loopText = meta.loop === 0 ? '无限循环播放' : (meta.loop || 1) === 1 ? '只播放一次' : '循环播放 ' + meta.loop + ' 次'
  const duration = meta.totalMs > 0 ? '总时长 ' + Math.round(meta.totalMs) + ' ms,' : ''
  const lines = ['这是一张 ' + label + ' 动图:共 ' + meta.frameCount + ' 帧,' + duration + loopText + '。']
  if (strip) {
    const sampled = strip.sampled
      .map((f) => '第 ' + f.index + ' 帧(开始于 ' + Math.round(f.startMs) + ' ms,持续 ' + f.delayMs + ' ms)')
      .join('、')
    lines.push('你接下来看到的这张大图是同一段动画的胶片条:' +
      strip.cols + ' 列 × ' + strip.rows + ' 行,从左到右、从上到下按时间顺序排列,' +
      '依次是 ' + sampled + '。')
    lines.push('相邻格子之间不是连续帧,中间还有没采样的帧——看不到的动作不等于没发生。' +
      '请按这段时序描述整段动画的动作/动效(例如「猫疯狂摇头」「鱼弹跳着靠近」),' +
      'tag 仍按情绪分类,caption 写清动作并注明「动图」,keywords 带上动作词。')
  } else {
    lines.push('当前只能逐帧读取 GIF 动图,这张 ' + label + ' 动图无法展开,' +
      '你看到的是第一帧;请按第一帧描述,但可以注明它是动图。')
  }
  return lines.join('\n')
}
