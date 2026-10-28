/**
 * QQ 发图尺寸:发送前把表情缩到 200-450px 长边。
 *
 * 背景:QQ 官方机器人没有"表情"消息类型,只能按图片上传;QQ 客户端会把
 * 大图当图片消息渲染,平板端会被拉伸满屏。缩小到 200-450px 更容易被
 * QQ 当成表情包渲染(客户端经验规则,官方文档未写明)。
 *
 * 这里只做"发送副本":图库原文件永远不动,缩好的副本落在图库目录下的
 * `.send-cache/`(qqbot_send_file 的路径白名单通常放行图库目录)。
 * 缩放依赖 sharp;dsh-im 已经自带 sharp,找不到时按原图发送,不影响发图。
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { dshHome, defaultPacksDir } from './memes.js'

/** 设置页可选的发送长边;默认 300 落在 QQ 经验区间 200-450 的中间。 */
export const QQ_SEND_EDGES = [200, 300, 400, 450]
export const QQ_SEND_DEFAULT_EDGE = 300

export function normalizeQqSendEdge(value) {
  if (value === undefined || value === null || value === '') return QQ_SEND_DEFAULT_EDGE
  const n = Number(value)
  if (!Number.isFinite(n)) return QQ_SEND_DEFAULT_EDGE
  return Math.max(200, Math.min(450, Math.round(n)))
}

let sharpPromise = null
let sharpResolved

/** undefined = 还在探测;true/false = sharp 可用/不可用。 */
export function sharpStatus() {
  if (sharpResolved === undefined) return undefined
  return sharpResolved !== null
}

/**
 * 加载 sharp:优先插件自己的 node_modules,其次找 dsh-im 所在 profile 的
 * node_modules(dsh-im 依赖 sharp,QQ 用户通常已经装了它)。
 */
export function loadSharp() {
  if (sharpPromise) return sharpPromise
  sharpPromise = (async () => {
    let found = null
    try {
      const mod = await import('sharp')
      found = mod.default || mod
    } catch { /* 插件没装 sharp,继续找 profile */ }
    if (!found) {
      try {
        const profilesDir = join(dshHome(), 'profiles')
        for (const name of await readdir(profilesDir)) {
          try {
            const req = createRequire(join(profilesDir, name, 'package.json'))
            found = req('sharp')
            if (found) break
          } catch { /* 该 profile 没装 sharp */ }
        }
      } catch { /* 没有 profiles 目录 */ }
    }
    if (!found) {
      try {
        found = createRequire(join(process.cwd(), 'package.json'))('sharp')
      } catch { /* 当前目录也没有 */ }
    }
    sharpResolved = found
    return found
  })()
  return sharpPromise
}

const warned = new Set()
function warnOnce(key, message) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn('[dsh-expression] ' + message)
}

function cacheDirOf(explicit) {
  return explicit ? resolve(explicit) : join(defaultPacksDir(), '.send-cache')
}

function sourceKey(source, srcStat, edge) {
  return createHash('sha1')
    .update([source, srcStat.size, srcStat.mtimeMs, edge].join('|'))
    .digest('hex')
    .slice(0, 24)
}

/**
 * 返回可直接交给 QQ 投递的路径。已经够小、格式不支持或 sharp 不可用时
 * 原样返回 inputPath,调用方不需要区分。
 */
export async function resizeForQq(inputPath, { edge = QQ_SEND_DEFAULT_EDGE, cacheDir } = {}) {
  const source = resolve(String(inputPath || ''))
  const target = normalizeQqSendEdge(edge)
  const sharp = await loadSharp()
  if (!sharp) {
    warnOnce('sharp-missing', 'QQ 缩图不可用:没找到 sharp(装 dsh-im 或给 dsh-meme 装 sharp 后生效),按原图发送')
    return inputPath
  }

  let srcStat
  try { srcStat = await stat(source) } catch { return inputPath }
  if (!srcStat.isFile()) return inputPath

  const dir = cacheDirOf(cacheDir)
  const key = sourceKey(source, srcStat, target)
  try {
    const hit = (await readdir(dir)).find((name) => name.startsWith(key + '.'))
    if (hit) return join(dir, hit)
  } catch { /* 缓存目录还不存在 */ }

  let buf
  try { buf = await readFile(source) } catch { return inputPath }

  try {
    const image = sharp(buf, { animated: true, limitInputPixels: 64 * 1024 * 1024 })
    const meta = await image.metadata()
    const longest = Math.max(meta.width || 0, meta.pageHeight || meta.height || 0)
    if (!longest || longest <= target) return inputPath
    const animated = (meta.pages || 1) > 1
    const pipeline = image.resize({ width: target, height: target, fit: 'inside', withoutEnlargement: true })

    let ext
    let out
    if (animated) {
      if (meta.format === 'gif') {
        ext = 'gif'
        out = await pipeline.gif({ loop: meta.loop ?? 0 }).toBuffer()
      } else if (meta.format === 'webp') {
        ext = 'webp'
        out = await pipeline.webp({ quality: 80, loop: meta.loop ?? 0 }).toBuffer()
      } else {
        // APNG 等 sharp 无法无损写回的动图:宁可原图,也不要把动画缩丢。
        warnOnce('anim-' + meta.format, 'QQ 缩图跳过不支持的动图格式 ' + meta.format + ',按原图发送')
        return inputPath
      }
    } else if (meta.format === 'gif') {
      ext = 'gif'
      out = await pipeline.gif().toBuffer()
    } else if (meta.format === 'webp') {
      ext = 'webp'
      out = await pipeline.webp({ quality: 85 }).toBuffer()
    } else if (meta.format === 'png') {
      ext = 'png'
      out = await pipeline.png({ compressionLevel: 9 }).toBuffer()
    } else if (meta.format === 'jpeg' || meta.format === 'jpg') {
      ext = 'jpg'
      out = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer()
    } else {
      warnOnce('format-' + meta.format, 'QQ 缩图跳过不支持的格式 ' + meta.format + ',按原图发送')
      return inputPath
    }

    const outMeta = await sharp(out, { animated: true }).metadata()
    const outLongest = Math.max(outMeta.width || 0, outMeta.pageHeight || outMeta.height || 0)
    if (!out.length || outLongest > target || (animated && (outMeta.pages || 1) !== (meta.pages || 1))) {
      warnOnce('verify', 'QQ 缩图结果校验失败,按原图发送')
      return inputPath
    }

    await mkdir(dir, { recursive: true })
    const dest = join(dir, key + '.' + ext)
    const tmp = dest + '.tmp-' + process.pid + '-' + Date.now()
    await writeFile(tmp, out)
    await rename(tmp, dest)
    void pruneCache(dir)
    return dest
  } catch (error) {
    warnOnce('resize-error', 'QQ 缩图失败,按原图发送: ' + (error instanceof Error ? error.message : String(error)))
    return inputPath
  }
}

let prunePromise = null
/** 缓存只留最近 200 个,避免长期运行堆满发送副本。 */
function pruneCache(dir) {
  if (prunePromise) return prunePromise
  prunePromise = (async () => {
    try {
      const names = await readdir(dir)
      if (names.length <= 200) return
      const entries = []
      for (const name of names) {
        try {
          const info = await stat(join(dir, name))
          entries.push({ name, at: info.mtimeMs })
        } catch { /* 刚被删掉 */ }
      }
      entries.sort((a, b) => a.at - b.at)
      for (const entry of entries.slice(0, Math.max(0, entries.length - 200))) {
        try { await unlink(join(dir, entry.name)) } catch { /* 并发清理 */ }
      }
    } catch { /* 清理失败不影响发送 */ } finally {
      prunePromise = null
    }
  })()
  return prunePromise
}
