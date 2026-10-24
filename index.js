/**
 * dsh-meme — selfloom 表情包层作为 DeepSeek Harness 的插件。
 * npm 包名 dsh-meme;插件 id 仍为 dsh-expression(兼容已有安装)。
 *
 * 图库:随插件分发 memes/dafeiyu-001(official-001 已改为市场安装);
 * 设置页扫描用户目录(~/.dsh/meme-packs)下拉切换。SQLite 索引 + memes/<tag>/。
 *
 * 发送(双通道):
 *   1. QQ 通道:消费 dsh-companion 提供的 `companionQq` 服务(sendImage/isOnline);
 *   2. Web 通道:注册 webServer 前缀路由 `/dsh-memes`,以 HTTP 提供图库图片,
 *      模型把 [表情: 描述] 写进回复,前端按描述配图。
 * 两者皆无时不注册 send_meme,避免挂空工具。
 *
 * 管理操作(上传/删除/改元数据)不移植——那是控制台的活,模型只需"选图发送"。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync, rmSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join, dirname, resolve, sep, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  MemesStore, defaultPacksDir, scanPacks, readPackMeta, isPackDir,
  resolveActiveRoot, liveStore, registerSendMemeTool, dshHome, enabledPackIds, packDeleteDir,
  searchRows, prunePackKeywords, imChannelOfSession, IM_CHANNEL_LABELS,
  SEND_MODES, normalizeSendMode, LAYOUT_MODES, normalizeLayoutMode, openIndexWriter,
} from './memes.js'
import { ANIM_DEFAULT_FRAMES, detectAnimation, buildAnimationFilmstrip, animationModelNote } from './anim.js'

// ---- 极简 ZIP(store 无压缩)读写:零依赖导出/导入图库包 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

// ---- 来源校验:HTTP 路由只接受本机回环地址来的请求 ----
// 原来的判据是 `new URL(origin).host === req.headers.host`,自己跟自己比:
// 攻击者的页面只要先用自己的域名解析、再把它切到 127.0.0.1(DNS rebinding),
// 浏览器发出的 Origin 与 Host 就同是那个域名,判据成立、请求被放行;
// 而且 GET 分支在那道校验之前就 return 了,读操作一次都没校验过。
// 这里不看 Origin(由页面自己填、可以伪造成任何值),只看 Host:
// 这个头由浏览器按**实际连接目标**写,rebinding 时它就是攻击者的域名,直接落选。
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * 请求是不是从本机回环地址来的。
 * 没有 Host 头时返回 true:HTTP/1.0 与本机 socket 直连都可能不带这个头,那种请求
 * 不是浏览器页面发的、构不成 rebinding;而浏览器**一定**会带上 Host。
 */
export function hostIsLoopback(req) {
  const raw = String((req && req.headers && req.headers.host) || '')
  if (!raw) return true
  const name = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0]
  return LOOPBACK_HOSTS.has(name.toLowerCase())
}

/** 不是回环来源就自己回 403 并返回 true,调用方直接 return */
export function denyNonLoopback(req, res) {
  if (hostIsLoopback(req)) return false
  const body = JSON.stringify({ ok: false, error: '拒绝: 只接受本机(回环地址)请求' })
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
  return true
}

/** 打包文件列表为 ZIP(store 无压缩):[{name, data}] → Buffer */
/**
 * 从 GitHub releases 里按图库 id 汇总下载量。tag 形如 <id>-v1.2.0,
 * 同一图库的多个版本相加(用户装过 1.2.0 再装 1.3.0 都算一次下载)。
 * 抽成纯函数是为了能直接喂假数据测。
 */
export function parseDownloadCounts(releases) {
  const out = {}
  for (const r of (Array.isArray(releases) ? releases : [])) {
    const tag = String((r && r.tag_name) || '')
    const id = tag.replace(/-v[\d.]+$/i, '').trim()
    if (!id || id === tag) continue
    let sum = 0
    for (const a of (Array.isArray(r && r.assets) ? r.assets : [])) sum += Number(a && a.download_count) || 0
    out[id] = (out[id] || 0) + sum
  }
  return out
}

export function zipStore(files) {
  const parts = []
  const central = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    const crc = crc32(f.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0x0800, 6)          // UTF-8 文件名
    lh.writeUInt16LE(0, 8)               // store
    lh.writeUInt32LE(0, 10)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(f.data.length, 18)
    lh.writeUInt32LE(f.data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28)
    parts.push(lh, nameBuf, f.data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x0800, 8)
    ch.writeUInt16LE(0, 10)
    ch.writeUInt32LE(0, 12)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(f.data.length, 20)
    ch.writeUInt32LE(f.data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt16LE(0, 30)
    ch.writeUInt16LE(0, 32)
    ch.writeUInt16LE(0, 34)
    ch.writeUInt16LE(0, 36)
    ch.writeUInt32LE(0, 38)
    ch.writeUInt32LE(offset, 42)
    central.push(ch, nameBuf)
    offset += lh.length + nameBuf.length + f.data.length
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...parts, ...central, eocd])
}

/** 解析 ZIP(仅 store/无压缩条目):Buffer → Map<name, Buffer> */
export function unzipStore(buf) {
  const out = new Map()
  // EOCD:从尾部找签名
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件')
  const count = buf.readUInt16LE(eocd + 10)
  let pos = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('ZIP 中央目录损坏')
    const method = buf.readUInt16LE(pos + 10)
    const compSize = buf.readUInt32LE(pos + 20)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const localOffset = buf.readUInt32LE(pos + 42)
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen)
    // local header
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const data = method === 0
      ? Buffer.from(buf.subarray(dataStart, dataStart + compSize))
      : null
    if (data === null) throw new Error('ZIP 含压缩条目(仅支持未压缩): ' + name)
    out.set(name, data)
    pos += 46 + nameLen + extraLen + commentLen
  }
  return out
}

export const name = 'dsh-expression'
export const inject = ['tools', 'webServer', 'agentDefaultModel', 'attachments']

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
}
/** 元数据/响应头里 image/<key> 的 key → MIME */
const IMAGE_KEY_MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }
/** MIME → 落盘扩展名(jpeg 统一 .jpg,与 MIME 表反向对应) */
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }

/**
 * 按魔数嗅探图片真实格式,识别不了返回 ''(调用方回退到元数据)。
 * 附件元数据(mediaType/文件名)可能与实际字节不符,而图片路由按落盘扩展名查 MIME 表,
 * 扩展名错了就会以错误的 Content-Type 返回 —— 所以落盘格式要以字节为准(issue #36)。
 */
export function sniffImageMime(buf) {
  if (!buf || buf.length < 3) return ''
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png'
  if (buf.length >= 6 && buf.toString('latin1', 0, 6).startsWith('GIF8')) return 'image/gif'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return ''
}

/** 由 MIME 反推扩展名;不在支持列表(或嗅探失败)时返回 ''。 */
function extByMime(mime) {
  return EXT_BY_MIME[String(mime || '').toLowerCase()] || ''
}

const ROUTE = '/dsh-memes'

/**
 * 内置图库目录源,按顺序试第一个能用的。
 * raw 放前面:jsDelivr 对 @main 是「按仓库缓存 12h」,push 之后它会继续吐旧内容
 * (实测带 ?t= 时间戳也绕不过它的 shield 缓存),市场改了 catalog 客户端半天看不到。
 * jsDelivr 留作 raw 被墙时的兜底,加了新 catalog 记得 purge:
 * `curl https://purge.jsdelivr.net/gh/yyh-001/dsh-meme-packs@main/catalog.json`
 */
export const DEFAULT_REMOTE_DIR_URLS = [
  'https://raw.githubusercontent.com/yyh-001/dsh-meme-packs/main/catalog.json',
  'https://cdn.jsdelivr.net/gh/yyh-001/dsh-meme-packs@main/catalog.json',
  'https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/remote-packs.json',
  'https://cdn.jsdelivr.net/gh/yyh-001/dsh-meme@main/docs/remote-packs.json',
]

/**
 * 图库目录源预设(设置页下拉框):settings.remoteDirUrl 支持
 *   ''(或 'auto') = 自动,内置多镜像竞速(默认,推荐);
 *   'official'     = 只直连官方 GitHub raw(海外或直连正常时用);
 *   'mirror'       = 只走国内加速镜像(国内直连被墙时用);
 * 仍兼容自定义 http(s) URL;patch 配置里也可以写 URL 数组。
 */
export const REMOTE_DIR_PRESETS = ['official', 'mirror']
const REMOTE_DIR_PRESET_LABELS = {
  auto: '自动(内置多镜像)',
  official: '官方源(GitHub 直连)',
  mirror: '镜像源(国内加速)',
}

/**
 * GitHub 加速镜像前缀:原样转发 raw / release 资源,内容实时(国内直连 GitHub 常被墙)。
 * 顺序是实测可用性排序;加新镜像时同步更新 remoteMirrors() 与 docs/remote-pack-spec.md。
 */
export const GITHUB_MIRROR_PREFIXES = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
]

/** jsDelivr 家族 CDN 主机(国内可用的 jsDelivr 节点),对 @main 有 12h 仓库级缓存。 */
const JSDELIVR_CDN_HOSTS = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'testingcf.jsdelivr.net', 'gcore.jsdelivr.net']
const RAW_GH_RE = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/
const RELEASE_GH_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/(.+)$/

/** jsDelivr 家族 URL → 去掉主机后的路径(如 `gh/o/r@main/p`);不是 jsDelivr 时返回 ''。 */
function jsdelivrPath(url) {
  try {
    const u = new URL(String(url || ''))
    if (!JSDELIVR_CDN_HOSTS.includes(u.host) && u.host !== 'cdn.jsdmirror.com') return ''
    const path = u.pathname.replace(/^\/+/, '')
    return path ? path + u.search : ''
  } catch { return '' }
}

/**
 * 给远端资源 URL 生成镜像候选(国内可达性优先,去重):
 * GitHub raw → jsdmirror / gh 加速前缀 / 原始直链 / jsDelivr 家族;
 * GitHub release → gh 加速前缀 / 原始直链;
 * 其它 URL 原样返回。ZIP 仍以 sha256 校验,镜像给旧文件会被拒绝,不会装错。
 * @returns {string[]} 依次尝试的地址;空/非 http(s) 返回 []
 */
export function remoteMirrors(url) {
  const raw = String(url || '').trim()
  if (!/^https?:\/\//i.test(raw)) return []
  const out = []
  const push = (u) => { if (u && !out.includes(u)) out.push(u) }
  const rawGh = RAW_GH_RE.exec(raw)
  const relGh = RELEASE_GH_RE.exec(raw)
  const jsd = jsdelivrPath(raw)
  if (rawGh) {
    const [, owner, repo, ref, path] = rawGh
    // jsdmirror 是国内 Docker/CDN 常用的 jsDelivr 节点:最快,但可能滞留 12h 内的旧文件;
    // 预览图/清单这种「同一 URL 内容基本不变」的资源用它最划算。
    push('https://cdn.jsdmirror.com/gh/' + owner + '/' + repo + '@' + ref + '/' + path)
    for (const prefix of GITHUB_MIRROR_PREFIXES) push(prefix + raw)
    push(raw)
    for (const host of JSDELIVR_CDN_HOSTS) push('https://' + host + '/gh/' + owner + '/' + repo + '@' + ref + '/' + path)
  } else if (relGh) {
    for (const prefix of GITHUB_MIRROR_PREFIXES) push(prefix + raw)
    push(raw)
  } else if (jsd) {
    push('https://cdn.jsdmirror.com/' + jsd)
    push(raw)
  } else {
    push(raw)
  }
  return out
}

/** 从实际请求成功的 URL 反推镜像提供方前缀(资产下载优先走同一条已验证可用的链路)。 */
function mirrorProviderPrefix(url) {
  const u = String(url || '')
  for (const prefix of GITHUB_MIRROR_PREFIXES) if (u.startsWith(prefix)) return prefix
  if (u.startsWith('https://cdn.jsdmirror.com/')) return 'https://cdn.jsdmirror.com/'
  for (const host of JSDELIVR_CDN_HOSTS) if (u.startsWith('https://' + host + '/')) return 'https://' + host + '/'
  if (u.startsWith('https://raw.githubusercontent.com/')) return 'https://raw.githubusercontent.com/'
  return ''
}

/**
 * 目录源的两层候选:tier0 = 原始直链 + gh 加速前缀(内容实时);tier1 = jsDelivr 家族
 * (可能滞留旧 catalog,只在 tier0 全挂时兜底)。
 */
function directoryTiers(url) {
  const raw = String(url || '').trim()
  const tier0 = []
  const tier1 = []
  const push = (arr, u) => { if (u && !tier0.includes(u) && !tier1.includes(u)) arr.push(u) }
  const rawGh = RAW_GH_RE.exec(raw)
  const relGh = RELEASE_GH_RE.exec(raw)
  const jsd = jsdelivrPath(raw)
  if (rawGh) {
    const [, owner, repo, ref, path] = rawGh
    push(tier0, raw)
    for (const prefix of GITHUB_MIRROR_PREFIXES) push(tier0, prefix + raw)
    for (const host of JSDELIVR_CDN_HOSTS) push(tier1, 'https://' + host + '/gh/' + owner + '/' + repo + '@' + ref + '/' + path)
    push(tier1, 'https://cdn.jsdmirror.com/gh/' + owner + '/' + repo + '@' + ref + '/' + path)
  } else if (relGh) {
    push(tier0, raw)
    for (const prefix of GITHUB_MIRROR_PREFIXES) push(tier0, prefix + raw)
  } else if (jsd) {
    push(tier0, 'https://cdn.jsdmirror.com/' + jsd)
    push(tier0, raw)
  } else {
    push(tier0, raw)
  }
  return { tier0, tier1 }
}

/** 给定 GitHub raw URL 的 jsDelivr 家族候选(兜底层,对 @main 有 12h 缓存)。 */
function jsdelivrFamily(rawUrl) {
  const rawGh = RAW_GH_RE.exec(String(rawUrl || '').trim())
  if (!rawGh) return []
  const [, owner, repo, ref, path] = rawGh
  const out = JSDELIVR_CDN_HOSTS.map((host) => 'https://' + host + '/gh/' + owner + '/' + repo + '@' + ref + '/' + path)
  out.push('https://cdn.jsdmirror.com/gh/' + owner + '/' + repo + '@' + ref + '/' + path)
  return out
}

/**
 * 目录源设置 → 候选分组(纯函数,便于单测)。每组 {key, tier0, tier1}:
 *   key   = 归属标识(预设名或源 URL),磁盘缓存用它判断「还属不属于当前源」;
 *   tier0 = 内容实时的一层(直链 + gh 加速),先竞速;
 *   tier1 = jsDelivr 家族兜底(可能滞留 12h 的旧目录,只在 tier0 全挂时用)。
 * @param {string} setting 设置值:''/'auto'/'official'/'mirror'/自定义 http(s) URL
 * @param {string[]|string} fallbackUrls 未设置时用的源列表(patch 配置或内置默认)
 * @returns {{key:string,tier0:string[],tier1:string[]}[]}
 */
export function directoryGroupsFor(setting, fallbackUrls = DEFAULT_REMOTE_DIR_URLS) {
  const raw = String(setting == null ? '' : setting).trim()
  const lower = raw.toLowerCase()
  const catalog = DEFAULT_REMOTE_DIR_URLS[0]
  if (!raw || lower === 'auto') {
    return [].concat(fallbackUrls || [])
      .map((u) => String(u || '').trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .map((u) => { const { tier0, tier1 } = directoryTiers(u); return { key: u, tier0, tier1 } })
  }
  // 预设的目录地址固定用 dsh-meme-packs 仓库的 catalog.json,语义明确:
  if (lower === 'official') return [{ key: 'official', tier0: [catalog], tier1: [] }]
  if (lower === 'mirror') {
    return [{
      key: 'mirror',
      // 只用国内加速:镜像原样转发 raw,内容实时
      tier0: GITHUB_MIRROR_PREFIXES.map((p) => p + catalog),
      // 镜像全挂时再用 jsDelivr 家族兜底(旧目录也比完全没有强)
      tier1: jsdelivrFamily(catalog),
    }]
  }
  if (/^https?:\/\//i.test(raw)) {
    const { tier0, tier1 } = directoryTiers(raw)
    return [{ key: raw, tier0, tier1 }]
  }
  // 非法值(手改配置文件写错):按自动处理,别让面板直接炸
  return directoryGroupsFor('', fallbackUrls)
}

/**
 * 工具注册时机兜底(issue #51)。
 *
 * dsh 0.2.1-rc.x 冷启动时,apply 同步路径里 ctx.tools 可能还没对 agent 平面生效:
 * register() 不抛错、但工具不进表(learn_meme 当时连 try/catch 都没有),市场里
 * 照样显示 live,API/面板/图片路由全都正常——直到热重挂(服务已 ACTIVE)工具才出现。
 *
 * 注册策略:
 *   * 宿主有 ctx.inject:整体挪进 inject(['tools']) 回调,tools 服务 ACTIVE 后再注册,
 *     恰好一次(这是 dsh-live-reload README 记录的 0.2.x 官方姿势:apply 阶段只 ctx.get()
 *     会静默失败,必须 inject 等依赖就绪);
 *   * 老宿主没有 inject:保持同步注册,抛错则指数退避重试;duplicate 视为已注册
 *     (第一次其实写进去了,重试撞名说明不用再挂)。
 *
 * 任何失败都补一份 ctx.logger.error:桌面端把宿主子进程的 stdout 收走,
 * console.error 用户侧一点痕迹都没有,没日志就没法报障。
 *
 * @param {object} ctx 插件上下文
 * @param {string} label 工具名(日志用)
 * @param {() => void} register 真正执行注册的 thunk(ctx.tools.register 自带生命周期挂接)
 * @param {{retryBaseMs?: number, retryMax?: number}} [options] 测试注入退避参数
 */
export function registerToolWhenReady(ctx, label, register, options = {}) {
  const retryBaseMs = typeof options.retryBaseMs === 'number' ? options.retryBaseMs : 1000
  const retryMax = typeof options.retryMax === 'number' ? options.retryMax : 5
  const report = (error, attempt) => {
    const detail = error instanceof Error ? error.message : String(error)
    const text = `[dsh-expression] ${label} 注册失败(不影响 API/面板${attempt ? `,第 ${attempt} 次重试` : ''}): ${detail}`
    console.error(text)
    try {
      if (ctx.logger && typeof ctx.logger.error === 'function') ctx.logger.error(text)
    } catch { /* logger 缺席不连坐 */ }
  }
  const safeRegister = (attempt) => {
    try {
      register()
      return true
    } catch (error) {
      if (/duplicate/i.test(String((error && error.message) || error))) return true
      report(error, attempt)
      return false
    }
  }
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['tools'], () => { safeRegister(null) })
      return
    } catch (error) { report(error, null) /* inject 挂不上:退回同步+重试 */ }
  }
  if (safeRegister(null)) return
  // 同步注册失败:指数退避重试(1s、2s、4s…),总共 retryMax 次;每次失败都上报。
  const timers = new Set()
  if (typeof ctx.effect === 'function') {
    try { ctx.effect(() => () => { for (const t of timers) clearTimeout(t); timers.clear() }, `dsh-expression: ${label} retry timers`) } catch { /* effect 缺席不连坐 */ }
  }
  let attempts = 0
  const scheduleRetry = () => {
    attempts++
    const delay = retryBaseMs * Math.pow(2, attempts - 1)
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (safeRegister(attempts)) return
      if (attempts < retryMax) scheduleRetry()
    }, delay)
    timers.add(timer)
  }
  scheduleRetry()
}

export function apply(ctx, config) {
  // 图库目录设置存 ~/.dsh(稳定,不受包升级/图库变化影响):
  // 优先级 用户设置(settings) > patch 配置(config.memeRoot) > 包内默认
  // 插件版本:反馈表单预填要用(从包内 package.json 读,不写死在代码里)
  const pluginVersion = (() => {
    try {
      const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'))
      return String(pkg.version || '').trim()
    } catch { return '' }
  })()
  const settingsFile = join(dshHome(), '.dsh', 'dsh-expression.json')
  const readSettings = () => {
    try { return JSON.parse(readFileSync(settingsFile, 'utf8')) } catch (e) { return {} }
  }
  const writeSettings = (patch) => {
    try {
      mkdirSync(join(dshHome(), '.dsh'), { recursive: true })
      writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), ...patch }, null, 2))
    } catch (e) {}
  }
  // 陪伴模式提示词:模型主动斗图。设置页可编辑覆盖(settings.companionPrompt)。
  const DEFAULT_COMPANION_PROMPT = '斗图规则:主动斗图,不要等用户开口:\n' +
    '- 聊天气氛合适就主动用 send_meme 发一张贴题的表情包,不用等用户要求,发图优先于纯文字;\n' +
    '- 发图先 search 拿候选,[表情: 描述] 里的描述必须抄候选原文,自己编的描述前端配不上图;\n' +
    '- 情绪到点、接梗、吐槽、卖萌时都主动甩图,别冷场;对方说正事/干活时克制;\n' +
    '- 发完保持简短,让图自己说话,不啰嗦不复述。'
  /**
   * dsh-im 的 IM 渠道里没有 dsh-meme 的前端配图器:[表情: 描述] 只会被当成一行
   * 方括号文字发出。所以 IM 会话要换一条投递路径——send_meme 在 IM 模式会返回
   * 候选的绝对路径,模型把它交给 dsh-im 的 dsh_im_return_file,由渠道作为原生
   * 图片消息发出。
   *
   * 这里必须显式写「主动发」:dsh-im 自己注入的说明是「用户要求收文件/图片时才
   * 调用 dsh_im_return_file」,只靠原来的主动斗图提示词,模型会以为 IM 里发不了
   * 图、或者要先等用户开口授权——这正是「先说明可以在 QQ/微信发表情才会主动发」
   * 的根因。
   *
   * 另外必须显式禁止「正文里再放一份图」:模型很爱在回复里补 markdown 图片
   * `![描述](C:\...\x.jpg)` 或 `[描述]` 来「确保能看到」,而 IM 客户端只会显示
   * 方括号里的描述文字、把本地路径原样暴露出来,图片本身还是靠原生消息送达。
   */
  const imNoInlineImageRule = (label) => '- 回复正文只写普通聊天的文字:不要写 [表情: …] 或 [任何描述] 这类方括号标记,不要写 markdown 图片(![]()),更不要把本地文件路径贴进回复——' + label + ' 里这些只会显示成难看的文字,图片会由 dsh_im_return_file 作为原生消息发出;\n'
  const imCompanionPrompt = (channel) => {
    const label = IM_CHANNEL_LABELS[channel] || 'IM'
    return '斗图规则:主动斗图,不要等用户开口:\n' +
      '- 聊天气氛合适就主动用 send_meme 拿候选,再把挑中的候选 path(绝对路径)交给 dsh_im_return_file,让它作为 ' + label + ' 原生图片消息发出,发图优先于纯文字;\n' +
      imNoInlineImageRule(label) +
      '- 也不用在正文里解释图片投递过程(不必说「图已排队/等发出」),发完保持简短,让图自己说话,不啰嗦不复述;\n' +
      '- 不用等用户先授权、先说明「可以发表情」,直接发;情绪到点、接梗、吐槽、卖萌时都主动甩图,别冷场,对方说正事/干活时克制。'
  }
  /** 用户自定义过提示词时不动原文,只在末尾补 IM 的投递方式 */
  const imCompanionRules = (channel) => {
    const label = IM_CHANNEL_LABELS[channel] || 'IM'
    return '当前对话来自 ' + label + '(IM 聊天):\n' +
      '- 发图方式是先调用 send_meme 拿候选,再把挑中的候选 path(工具结果里的绝对路径)传给 dsh_im_return_file,让它作为 ' + label + ' 原生图片消息发出;\n' +
      imNoInlineImageRule(label) +
      '- 不用等用户先授权:气氛合适就直接 send_meme → dsh_im_return_file 主动发;对方说正事/干活时克制。'
  }
  /** dsh-im 是否在进程内(它提供 dsh_im_return_file,是 IM 发图的唯一通道) */
  const hasImDelivery = () => {
    try {
      const service = ctx.get && ctx.get('dshIm')
      return service !== undefined && service !== null
    } catch { return false }
  }
  /**
   * 发送方式设置(settings.sendMode):只影响 AI 怎么发,不改前端把 [表情: 描述]
   * 渲染成图片的逻辑。auto = 按渠道自动(默认);text = 纯文字不发图;image = 总是发图。
   */
  const sendModeOf = () => normalizeSendMode(readSettings().sendMode)
  /** 纯文字模式:默认提示词里教模型写 [表情:] 标记的规则要压掉,否则前端仍会配图 */
  const TEXT_MODE_RULE = '发送方式设置为「纯文字」:不要发图片。不要写 [表情: …] 或 [任何描述] 这类方括号标记,不要调用 dsh_im_return_file,也不要把图片路径贴进回复;想斗图就用文字接梗、吐槽、卖萌。可以用 send_meme 查候选拿描述,但不要真的把图发出去。'
  /** 图片模式:在自动行为上强调「必须真发图」,不允许只描述 */
  const IMAGE_MODE_RULE = '发送方式设置为「图片」:每次用 send_meme 挑好图后都必须把图片真的发出去——Web 聊天把 [表情: 描述] 原样写进回复;IM 聊天把候选 path 交给 dsh_im_return_file。不能只写文字描述、不发图。'
  const memeRoot = resolveActiveRoot(readSettings(), config?.memeRoot)
  let memes = null
  try {
    memes = liveStore(new MemesStore(memeRoot))
  } catch (error) {
    console.error('[dsh-expression] meme store unavailable:', error && error.message)
    return
  }

  // ---- 陪伴模式:系统提示注入,模型根据对话情绪主动斗图 ----
  // 设置页可整段关掉这项注入(settings.promptEnabled === false),关掉后模型不再主动斗图。
  // IM 会话(dsh-im)追加投递规则:候选路径交给 dsh_im_return_file,不要写标记。
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const settingsNow = readSettings()
    if (settingsNow.promptEnabled === false) return assembled
    const sendMode = normalizeSendMode(settingsNow.sendMode)
    const channel = hasImDelivery() ? imChannelOfSession(context?.agent?.session) : null
    const custom = settingsNow.companionPrompt
    let text = custom || DEFAULT_COMPANION_PROMPT
    if (sendMode === 'text') {
      // 纯文字:默认提示词里的发图指令全部压掉(仍保留斗图语气),也不追加 IM 投递规则
      text = text + '\n\n' + TEXT_MODE_RULE
    } else if (channel) {
      // IM 会话:默认提示词整段换成 IM 版([表情:] 那条在 IM 里是错的);
      // 用户自定义提示词则保留原文,只在末尾补投递规则。
      text = custom ? custom + '\n\n' + imCompanionRules(channel) : imCompanionPrompt(channel)
    }
    if (sendMode === 'image') text = text + '\n\n' + IMAGE_MODE_RULE
    assembled.sections.push({ name: 'dsh-expression:companion', text })
    return assembled
  })

  // ---- Web 通道:图片 HTTP 路由(白名单,只放行索引内路径) ----
  // 容错:同一进程内路由可能已被动态版插件注册(全局共享),冲突则复用。
  // urlPrefix 用绝对 URL:前端 markdown 渲染器不显示相对路径图片。
  let urlPrefix = null
  const webServer = ctx.webServer ?? ctx.get('webServer')
  if (webServer) {
    const host = webServer.host === '0.0.0.0' ? '127.0.0.1' : webServer.host
    const base = 'http://' + host + ':' + webServer.port
    try {
      // 路由注册挂到 ctx.effect:插件被关开关/热重载时由宿主跑 disposer 摘掉路由,
      // 否则同一进程里再次 apply 会撞 duplicate route(issue #20)。
      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler(req, res) {
          if (denyNonLoopback(req, res)) return
          const rawUrl = String(req.url || '').split('?')[0]
          // 浏览器对路径里的非 ASCII 一律百分号编码,而下面的白名单来自 index.db 里的
          // 原始路径(中文目录/文件名是未编码的),不先解码的话含非 ASCII 路径的图库
          // 所有图都 404(issue #28)。解码要兜住手打的畸形转义(%E5%A 这类),失败按
          // 404 处理而不是抛 500;先行 split('?') 保证 %3F 不会被当成查询串切走。
          let pathname
          try {
            pathname = decodeURIComponent(rawUrl)
          } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('not found')
            return
          }
          const raw = pathname.startsWith(ROUTE + '/') ? pathname.slice(ROUTE.length + 1) : null
          // 带包前缀格式:/dsh-memes/<packId>/<rel>(跨包发图/配图);无前缀按当前激活包
          // (旧格式兼容:那条的 rel 固定以 memes/ 开头,所以首段是 memes 时不当包 id)。
          let root = memes.root
          let stored = raw
          if (raw) {
            const slash = raw.indexOf('/')
            const first = slash > 0 ? raw.slice(0, slash) : ''
            if (first && first !== 'memes') {
              // 认出来是包前缀就必须找到那个包。以前找不到会静默按「当前图库 + 整条 raw」拼路径,
              // 磁盘上碰巧存在同名嵌套目录时会发出另一个包的图/明明是 404 却看着像配错了图,
              // 描述和图对不上还很难查(issue #23)。宁可显式 404。
              let hit = null
              try { hit = listAllPacks().find((p) => p.id === first) } catch { /* 扫描失败 → 当找不到 */ }
              if (!hit) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
                res.end('not found: 未知图库 ' + first)
                return
              }
              root = hit.path
              stored = raw.slice(slash + 1)
            }
          }
          // 每次请求动态构建白名单:静态快照会漏掉新上传的图(历史教训:上传后 404 图片不显示)
          let allowed = null
          let routeStore = null
          try {
            routeStore = new MemesStore(root)
            allowed = new Set(routeStore.list().memes.map((m) => m.path))
          } catch {
            allowed = null
          } finally {
            if (routeStore) routeStore.close()
          }
          if (!stored || !allowed || !allowed.has(stored)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('not found')
            return
          }
          try {
            const file = join(root, stored)
            const bytes = readFileSync(file)
            const ext = stored.includes('.') ? stored.split('.').pop().toLowerCase() : ''
            res.writeHead(200, {
              'Content-Type': MIME[ext] || 'application/octet-stream',
              'Content-Length': String(bytes.byteLength),
              'Cache-Control': 'public, max-age=3600',
            })
            res.end(bytes)
          } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('not found')
          }
        },
      }), 'dsh-expression: /dsh-memes 图片路由')
    } catch (error) {
      console.log('[dsh-expression] 路由已存在,复用:', error && error.message)
    }
    urlPrefix = base + ROUTE
  }

  // ---- 模型可用的图库:设置页每张卡片一个开关,可以同时开多个 ----
  // 管理相关的 memes.* 仍只作用于「当前图库」(上传/改/删/学图),
  // send_meme 抽候选则跨所有打开的图库——这里包一层 sampler 给工具用。
  const packRows = () => {
    try { return listAllPacks() } catch { return [] }
  }
  const activePackId = () => {
    const s = readSettings()
    const packs = packRows()
    return s.packId || (packs.find((p) => resolve(p.path) === resolve(memes.root)) || {}).id || ''
  }
  const enabledIds = () => enabledPackIds(readSettings(), packRows(), activePackId())
  const sampler = {
    get root() { return memes.root },
    list: (...a) => memes.list(...a),
    replace: (...a) => memes.replace(...a),
    sampleMood(tag, query, n) {
      const ids = enabledIds()
      if (ids.length === 0) {
        const { memes: rows, tags } = memes.list()
        return { mood: resolveMoodName(tag, query, tags), memes: [], tags, reason: '当前没有打开任何图库，去设置页把要用的图库开关打开' }
      }
      if (ids.length === 1 && ids[0] === activePackId()) return memes.sampleMood(tag, query, n)
      const packs = packRows()
      const per = Math.max(1, Math.ceil(n / ids.length))
      const merged = []
      let mood = ''
      let tags = []
      for (const id of ids) {
        const hit = packs.find((p) => p.id === id)
        if (!hit) continue
        let store = null
        try {
          store = new MemesStore(hit.path)
          const one = store.sampleMood(tag, query, per)
          mood = mood || one.mood
          tags = one.tags.length ? one.tags : tags
          for (const row of one.memes) {
            // 非当前图库的路径带上包前缀,QQ 通道发图时按前缀找对图库
            merged.push(id === activePackId() ? row : { ...row, path: id + '/' + row.path })
          }
        } catch { /* 坏包跳过,不影响其他图库 */ } finally { if (store) store.close() }
      }
      if (!mood) return { mood: null, memes: [], tags }
      return { mood, memes: pickShuffled(merged, n), tags }
    },
    // 关键词搜图:和 sampleMood 一样跨所有打开的图库。先把各包的行合并(路径带包前缀),
    // 再统一排序——「所有关键词都命中」只有在合并后比才准,否则每包各自取最优,
    // 只命中一个词的弱结果会和全中的强结果混在一起。
    search(query, n, tag) {
      const ids = enabledIds()
      if (ids.length === 0) {
        const { tags } = memes.list()
        return { query: String(query || '').trim().toLowerCase(), memes: [], tags, reason: '当前没有打开任何图库，去设置页把要用的图库开关打开' }
      }
      if (ids.length === 1 && ids[0] === activePackId()) return memes.search(query, n, tag)
      const packs = packRows()
      const active = activePackId()
      const merged = []
      let tags = []
      for (const id of ids) {
        const hit = packs.find((p) => p.id === id)
        if (!hit) continue
        let store = null
        try {
          store = new MemesStore(hit.path)
          const one = store.list(tag)
          tags = one.tags.length ? one.tags : tags
          for (const row of one.memes) {
            // 非当前图库的路径带上包前缀,QQ 通道发图时按前缀找对图库
            merged.push(id === active ? row : { ...row, path: id + '/' + row.path })
          }
        } catch { /* 坏包跳过,不影响其他图库 */ } finally { if (store) store.close() }
      }
      return { ...searchRows(merged, query, n), tags }
    },
    resolveStored(stored) {
      const raw = String(stored || '')
      const slash = raw.indexOf('/')
      const first = slash > 0 ? raw.slice(0, slash) : ''
      if (first) {
        const hit = packRows().find((p) => p.id === first)
        if (hit) return resolve(join(hit.path, raw.slice(slash + 1)))
      }
      return memes.resolveStored(raw)
    },
  }
  const pickShuffled = (rows, n) => {
    const copy = rows.slice()
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp
    }
    return copy.slice(0, n)
  }
  const resolveMoodName = (tag, query, tags) => {
    // 没有可用图库时也要回一个合法情绪名(否则工具只会说「先选情绪」)
    try { return memes.sampleMood(tag, query, 1).mood } catch { return null }
  }

  // ---- 发送通道:QQ 优先,Web 兜底;Web 里再按会话来源分流到 IM 原生图片 ----
  // dsh-im 只在进程内时提供 dsh_im_return_file;这里传的是「运行时判断」而不是
  // apply 时的快照——插件装载顺序不定,dsh-im 可能比 dsh-meme 晚就绪。
  const imToolOptions = () => ({
    imChannelOf: (session) => (hasImDelivery() ? imChannelOfSession(session) : null),
    imReady: hasImDelivery(),
    sendMode: sendModeOf,
  })
  const qq = ctx.get('companionQq')
  const sendImage = qq !== undefined && typeof qq.sendImage === 'function'
    ? (path, caption) => qq.sendImage(path, caption)
    : null
  if (sendImage || urlPrefix) {
    registerToolWhenReady(ctx, 'send_meme', () => {
      registerSendMemeTool(ctx, sampler, sendImage, urlPrefix, imToolOptions())
      console.log(`[dsh-expression] send_meme 已注册(${sendImage ? 'QQ' : 'Web'}通道${!sendImage && hasImDelivery() ? '+IM' : ''},${urlPrefix || '无路由'})`)
    })
  } else {
    console.log('[dsh-expression] 无可用发送通道(需要 dsh-companion 的 QQ 或 webServer),未注册 send_meme')
  }

  // companionQq 迟到时补挂(静态插件与 companion 装载顺序不定)。
  const register = () => {
    if (sendImage || urlPrefix) return
    const qqNow = ctx.get('companionQq')
    if (qqNow !== undefined && typeof qqNow.sendImage === 'function') {
      registerToolWhenReady(ctx, 'send_meme', () => {
        registerSendMemeTool(ctx, sampler, (path, caption) => qqNow.sendImage(path, caption), urlPrefix, imToolOptions())
      })
    }
  }
  ctx.on('companionQq/available', register)

  // ---- 管理 API + 自包含管理面板(HTTP,重启不丢,任何会话可访问) ----
  // 运行时切换图库目录:校验 → 持久化设置 → 原子替换 memes/adminDb。
  // 工具/路由/API 闭包引用变量,替换后立即指向新图库,无需重启。
  // packsDirNow/listAllPacks 定义在 apply 直接作用域:图片路由(注册于
  // if(webServer) 之外)也要按包取图,块内看不到它们(历史教训)。
  const packsDirNow = () => readSettings().packsDir || defaultPacksDir()
  const listAllPacks = () => {
    const packs = scanPacks(packsDirNow())
    const root = resolve(memes.root)
    if (!packs.some((p) => resolve(p.path) === root)) {
      const meta = readPackMeta(memes.root, readSettings().packId || '_custom', 'custom')
      packs.unshift(meta)
    }
    return packs
  }
  if (webServer) {
    // 可写连接。插件包内的图库(默认内置包)不常驻:每次写临时开、写完就关,
    // 否则 Windows 上包目录被占住,pnpm 更新 rename 会 EPERM(issue #43)。
    let adminDb = openIndexWriter(memes.root)
    const packPayload = () => {
      const s = readSettings()
      const packs = listAllPacks()
      const packId = s.packId || (packs.find((p) => resolve(p.path) === resolve(memes.root)) || {}).id || ''
      const enabled = enabledPackIds(s, packs, packId)
      return {
        memeRoot: memes.root,
        packId,
        packs: packs.map((p) => ({
          ...p,
          // 本地图库的封面走插件自己的图片路由:图已经装到本地了,不该再去拉远程预览图
          cover: p.cover ? ROUTE + '/' + p.id + '/' + p.cover : '',
          enabled: enabled.includes(p.id),
        })),
        enabledPacks: enabled,
        packsDir: packsDirNow(),
        companionPrompt: readSettings().companionPrompt || '',
        defaultCompanionPrompt: DEFAULT_COMPANION_PROMPT,
        promptEnabled: readSettings().promptEnabled !== false,
        // AI 发送方式设置:auto(默认)/ text(纯文字)/ image(总是发图)
        sendMode: normalizeSendMode(s.sendMode),
        // 表情排布设置:inline = 图文并排(默认)/ stacked = 图独占一行(issue #50)
        layoutMode: normalizeLayoutMode(s.layoutMode),
        pluginVersion,
        remoteSubs: remoteSubs(),
        remoteDirUrl: remoteDirUrlList(),
        // 用户设置里的原始自定义源(空 = 自动/内置多镜像);设置页输入框用它回显
        remoteDirUrlSetting: typeof s.remoteDirUrl === 'string' ? s.remoteDirUrl : '',
        configured: !!(s.memeRoot || s.packId),
      }
    }
    const reloadMemeStore = (dir, packId) => {
      // 目录不存在则创建;没有 index.db 则初始化空图库(用户可传图/学图逐步填充)
      mkdirSync(dir, { recursive: true })
      const indexPath = join(dir, 'index.db')
      if (!existsSync(indexPath)) {
        const initDb = new DatabaseSync(indexPath)
        initDb.exec('CREATE TABLE IF NOT EXISTS memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
        initDb.close()
      }
      const next = new MemesStore(dir)
      const nextDb = openIndexWriter(dir)
      const abs = resolve(dir)
      const hit = scanPacks(packsDirNow()).find((p) => resolve(p.path) === abs)
      writeSettings({
        memeRoot: abs,
        packId: packId || (hit ? hit.id : '_custom'),
      })
      try { adminDb.close() } catch { /* 已关闭 */ }
      memes.replace(next)
      adminDb = nextDb
    }

    const validTagRe = /^[a-z0-9_-]+$/
    const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp']

    const takeImageRefs = (content, out) => {
      if (!Array.isArray(content)) return
      for (const b of content) {
        if (b && b.type === 'image' && b.attachment) out.push(b.attachment)
        if (b && b.type === 'tool-result') takeImageRefs(b.content, out)
      }
    }
    /** 会话里用户发过的图片附件。模型 prompt 里没有 attachmentId(图在 UI 里,发给模型的是像素或转写文字),学图时默认取最近一张。 */
    const userImageRefs = (exec) => {
      const out = []
      const agent = exec && exec.agent
      const inbox = agent && agent.inbox
      if (inbox) {
        for (const msg of [...(inbox.nextTurn || []), ...(inbox.nextStep || [])]) takeImageRefs(msg.content, out)
      }
      const session = agent && agent.session
      if (session && typeof session.deriveMessages === 'function') {
        for (const msg of session.deriveMessages()) {
          if (msg && msg.role === 'user') takeImageRefs(msg.content, out)
        }
      }
      return out
    }

    // ---- AI 自动学表情包:用户附件或 URL,下载收录进图库 ----
    // 与 send_meme 一样走 registerToolWhenReady:冷启动时 ctx.tools 未就绪,
    // 同步 register 静默无效,learn_meme 会跟着一起缺席(issue #51)。
    registerToolWhenReady(ctx, 'learn_meme', () => ctx.tools.register(defineTool({
      name: 'learn_meme',
      description: '把一张图片收录进表情包图库(自动学图)。' +
        '仅当用户明确要求收藏/收录/保存这张图时使用(如「收藏这个表情」「收进图库」)。' +
        '用户发表情/发图是斗图,不是收藏请求——不要自动收录,正常回应即可。' +
        '插件会自动识别图片内容(分类/描述/关键词)后存入图库;tag/caption/keywords 可选,手动指定优先。' +
        '用户刚发的图片附件:直接调用即可,不必传 attachmentId(id 不会出现在 prompt 里,默认收录最近一张用户图)。也可用 attachmentId 或 http(s) imageUrl。',
      parameters: {
        attachmentId: { type: 'string', description: '可选。对话附件 id;不传则收录最近一张用户图片' },
        imageUrl: { type: 'string', description: '可选。图片 http(s) URL,与附件二选一' },
        tag: { type: 'string', description: '手动指定分类,如 angry/happy(可选,默认自动识别)' },
        caption: { type: 'string', description: '手动指定描述(可选,默认自动识别)' },
        keywords: { type: 'string', description: '手动指定搜索关键词,空格分隔(可选,默认自动识别)' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args, exec) {
        const imageUrl = typeof args.imageUrl === 'string' ? args.imageUrl.trim() : ''
        const attachmentId = typeof args.attachmentId === 'string' ? args.attachmentId.trim() : ''
        let tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : ''
        let caption = String(args.caption || '').trim().slice(0, 200)
        let keywords = String(args.keywords || '').trim().slice(0, 200)
        try {
          let buf
          let mime
          let fileName
          let ext
          if (!imageUrl) {
            const refs = userImageRefs(exec)
            const ref = attachmentId
              ? refs.find((r) => String(r.attachmentId) === attachmentId)
              : refs[refs.length - 1]
            if (!ref) {
              return { ok: false, message: attachmentId
                ? '找不到附件 ' + attachmentId + '(必须是本次对话上传的图片)'
                : '对话里没有用户图片附件' }
            }
            const stored = await ctx.get('attachments').readImage(ref)
            buf = stored.data
            // MIME/扩展名以字节嗅探为准,附件元数据只作兜底:元数据与真实字节不符时
            // (如 JPEG 标成 image/gif)照元数据落盘会让图片路由返回错误的 Content-Type(issue #36)。
            mime = sniffImageMime(buf) || String(stored.ref.mediaType || '')
            ext = extByMime(mime)
            if (!ext) {
              const named = stored.ref.name && stored.ref.name.includes('.') ? '.' + stored.ref.name.split('.').pop().toLowerCase() : ''
              ext = IMAGE_EXTS.includes(named) ? named : '.jpg'
            }
            fileName = stored.ref.name || 'meme' + ext
          } else {
            if (!/^https?:\/\//i.test(imageUrl)) return { ok: false, message: 'imageUrl 必须是 http(s) 链接' }
            const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000), redirect: 'follow' })
            if (!res.ok) return { ok: false, message: '下载失败: HTTP ' + res.status }
            const ctype = String(res.headers.get('content-type') || '')
            const m = /image\/(jpeg|png|gif|webp)/.exec(ctype)
            const declared = m ? IMAGE_KEY_MIME[m[1]] : ''
            if (!declared) return { ok: false, message: '该 URL 不是图片(jpg/png/gif/webp)' }
            buf = Buffer.from(await res.arrayBuffer())
            if (buf.byteLength === 0 || buf.byteLength > 8 * 1024 * 1024) return { ok: false, message: '图片大小超限(≤8MB)' }
            // 响应头 Content-Type 同样只是声明:字节能嗅出来就以字节为准(issue #36,与附件分支同一处理)
            mime = sniffImageMime(buf) || declared
            ext = extByMime(mime) || '.jpg'
            fileName = imageUrl.split('/').pop() || 'meme' + ext
          }
          if (buf.byteLength === 0 || buf.byteLength > 8 * 1024 * 1024) return { ok: false, message: '图片大小超限(≤8MB)' }
          // 未指定分类时自动识图(学图即识图)
          let auto = false
          let animInfo = null
          if (!tag) {
            const sel = ctx.agentDefaultModel && typeof ctx.agentDefaultModel.currentSelection === 'function'
              ? ctx.agentDefaultModel.currentSelection() : null
            const r = await recognizeImageBytes(ctx.get('llm'), sel, buf, mime, fileName)
            auto = true
            animInfo = r.animation
            if (!tag) tag = r.tag
            if (!caption) caption = r.caption
            if (!keywords) keywords = r.keywords
          }
          if (!tag || !validTagRe.test(tag)) return { ok: false, message: '分类无效(tag 只能小写字母/数字/-/_),请手动指定 tag' }
          const name = Date.now() + '_' + Math.floor(Math.random() * 1000) + ext
          const rel = 'memes/' + tag + '/' + name
          mkdirSync(join(memes.root, 'memes', tag), { recursive: true })
          writeFileSync(join(memes.root, rel), buf)
          adminDb.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(rel, tag, name, caption, keywords, Date.now(), Date.now())
          memes.refresh()
          return { ok: true, path: rel, tag, url: ROUTE + '/' + rel, message: '已收录: [' + tag + '] ' + (caption || name) + (auto ? ' (AI 自动识别' + (animInfo ? ',动图 ' + animInfo.frameCount + ' 帧' + (animInfo.filmstrip ? ',已抽帧给模型' : '') : '') + ')' : '') + ' → ' + rel }
        } catch (error) {
          return { ok: false, message: '收录失败: ' + (error instanceof Error ? error.message : String(error)) }
        }
      },
    })))

    // ---- AI 识图核心:当前默认模型识别图片 → 分类/描述/关键词 ----
    async function recognizeImageBytes(llm, sel, buf, mime, fileName) {
      const provider = sel && sel.provider
      const model = sel && sel.model
      if (!llm || !provider || !model) throw new Error('未配置模型,无法识图')
      const info = await llm.resolveModelInfo(provider, model)
      const modalities = info && info.inputModalities
      if (!Array.isArray(modalities) || !modalities.includes('image')) {
        throw new Error('当前模型「' + model + '」不支持图片输入,无法识图')
      }
      // 先 materialize 默认配置(reasoningEffort 等),否则 stream 时配置比对不一致报错
      // (历史教训: prepared LLM call config changed before adapter dispatch)
      const base = await llm.resolveCallConfig({ provider, model, maxTokens: 4096 })
      const prepared = await llm.prepareCall(base)
      const prompt = '你是表情包分类助手。识别这张表情包图片,只输出 JSON(不要任何其他文字):\n' +
        '{"tag":"分类(小写英文,参考: angry生气 happy开心 sad难过 shy害羞 confused困惑 surprised惊讶 sleep睡觉 work上班 like喜欢 see看看 meow喵喵 speechless无语),选最贴切的一个","caption":"一句话中文描述这张图表达的情绪/梗","keywords":"3-5个中文搜索词,空格分隔"}\n'
      const anim = detectAnimation(buf)
      const strip = anim && anim.format === 'gif' ? buildAnimationFilmstrip(buf, { maxFrames: ANIM_DEFAULT_FRAMES }) : null
      const animNote = anim ? animationModelNote(anim, strip) : ''
      const textPart = { type: 'text', text: animNote ? prompt + '\n\n' + animNote : prompt }
      let imagePart
      if (strip) {
        const rawName = fileName || 'meme'
        const dot = rawName.lastIndexOf('.')
        const baseName = dot > 0 ? rawName.slice(0, dot) : 'meme'
        imagePart = { type: 'image', attachment: await ctx.get('attachments').saveImage({ data: strip.png, mediaType: 'image/png', name: baseName + '-frames.png' }) }
      } else {
        imagePart = { type: 'image', attachment: await ctx.get('attachments').saveImage({ data: buf, mediaType: mime, name: fileName }) }
      }
      let out = ''
      let reason = ''
      for await (const chunk of prepared.stream({ ...base, messages: [{ role: 'user', content: [textPart, imagePart] }] })) {
        if (chunk.type === 'text-delta') out += chunk.text
        else if (chunk.type === 'reasoning-delta') reason += chunk.text
        else if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
          throw new Error('模型调用失败: ' + (chunk.reason.failure && chunk.reason.failure.message || JSON.stringify(chunk.reason.failure)))
        }
      }
      // 思考型模型可能把 JSON 写在 reasoning 里,正文为空时兜底解析
      const m = /\{[\s\S]*\}/.exec(out) || /\{[\s\S]*\}/.exec(reason)
      if (!m) throw new Error('模型未返回有效 JSON')
      const parsed = JSON.parse(m[0])
      const tag = String(parsed.tag || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20)
      const caption = String(parsed.caption || '').trim().slice(0, 200)
      const keywords = String(parsed.keywords || '').trim().slice(0, 200)
      if (!tag) throw new Error('模型未给出分类')
      return {
        tag, caption, keywords,
        animation: anim ? { format: anim.format, frameCount: anim.frameCount, totalMs: anim.totalMs, filmstrip: !!strip } : null,
      }
    }

    // ---- 远程图库订阅:清单 JSON → 按需下载成本地包(格式见 docs/remote-pack-spec.md) ----
    // 订阅 = 服务端拉清单 + 并发下载图片 + 建索引,写入扫描目录;进度经 remoteJobStatus 轮询。
    // 已下载的包再次提交同一清单 URL 自动转为增量更新(按 .dsh-remote.json 侧车文件识别)。
    const remoteJobs = new Map() // jobId → job(内存态,重启即清;残留 .tmp 目录在插件启动时清理)
    let remoteJobSeq = 0
    const REMOTE_MANIFEST_MAX = 2 * 1024 * 1024
    const REMOTE_IMAGE_MAX = 8 * 1024 * 1024
    const REMOTE_ARCHIVE_MAX = 100 * 1024 * 1024
    const REMOTE_CONCURRENCY = 4
    const REMOTE_MAX_ITEMS = 500
    const PREVIEW_MAX = 60      // 预览弹窗最多列这么多张(清单包里可能上百张)
    const SIDECAR_NAME = '.dsh-remote.json'
    // 图库目录源:settings.remoteDirUrl > patch config.remoteDirUrl > 内置默认。
    // 每次请求现读 settings:改配置文件即刻生效,不用重启。
    // 设置值:''/'auto' = 自动多镜像;'official'/'mirror' = 预设;自定义 http(s) URL。
    const remoteDirSetting = () => {
      const value = readSettings().remoteDirUrl
      return typeof value === 'string' ? value.trim() : ''
    }
    // 原始设置 → 归一值:老配置的 'auto' 统一成 '',预设转小写;自定义 URL 原样返回
    const normalizedDirSetting = () => {
      const raw = remoteDirSetting()
      if (!raw || raw.toLowerCase() === 'auto') return ''
      const key = raw.toLowerCase()
      return REMOTE_DIR_PRESETS.includes(key) ? key : raw
    }
    const dirSourceLabel = (setting) => {
      const key = String(setting || '').trim().toLowerCase()
      if (!key || key === 'auto') return REMOTE_DIR_PRESET_LABELS.auto
      if (REMOTE_DIR_PRESETS.includes(key)) return REMOTE_DIR_PRESET_LABELS[key]
      return '自定义源:' + String(setting)
    }
    // patch 配置兜底源:可以是数组(源列表)也可以是字符串(单源)
    const fallbackDirUrls = () => {
      const value = config?.remoteDirUrl
      if (Array.isArray(value) || typeof value === 'string') return [].concat(value)
      return DEFAULT_REMOTE_DIR_URLS
    }
    // 目录候选分组:预设/自动/自定义都归一成「源 + 实时层 + 兜底层」,拉取和缓存判断共用
    const directoryGroups = () => directoryGroupsFor(normalizedDirSetting(), fallbackDirUrls())
    // 给前端/排错统一返回实际会尝试的目录 URL 数组(展开镜像链,去重)
    const remoteDirUrlList = () => {
      const out = []
      for (const group of directoryGroups()) {
        for (const u of [...group.tier0, ...group.tier1]) if (!out.includes(u)) out.push(u)
      }
      return out
    }
    const remoteSubs = () => {
      const subs = readSettings().remoteSubs
      return Array.isArray(subs) ? subs : []
    }
    let remoteDirCache = null // {at, data},60s 内复用,面板每次挂载拉一次也不怕
    let downloadCache = { at: 0, data: {}, key: '' }
    // 图库目录拉取结果元信息(给 UI:当前源 / 是否本地缓存 / 最后错误),跨请求保留
    let remoteDirMeta = { source: '', cached: false, error: '' }
    // 目录最近一次从哪条镜像链路拉到 → 后续清单/图片/ZIP 下载优先走它(别逐次重试被墙直链)
    let preferredMirrorPrefix = ''
    const REMOTE_DIR_ATTEMPT_TIMEOUT = 6000
    // 上次成功拉到的目录落盘:所有镜像都挂时至少还能看到目录、安装旧版本图库(UI 会带「本地缓存」提示)
    const catalogCacheFile = join(dshHome(), '.dsh', 'dsh-meme-catalog-cache.json')
    const withCacheBust = (u) => u + (u.includes('?') ? '&' : '?') + 't=' + Date.now()
    const shortFetchError = (error) => {
      const cause = error && error.cause
      const text = cause ? (cause.code || cause.message) : (error instanceof Error ? error.message : String(error))
      return String(text || '未知错误').slice(0, 120)
    }
    const readCatalogCache = () => {
      try {
        const raw = readFileSync(catalogCacheFile, 'utf8')
        if (raw.length > 4 * 1024 * 1024) return null
        const parsed = JSON.parse(raw)
        if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.length === 0 || !parsed.url) return null
        return parsed
      } catch { return null }
    }
    const writeCatalogCache = (source, entries, sourceUrl) => {
      try {
        mkdirSync(dirname(catalogCacheFile), { recursive: true })
        // source = 实际拉通的镜像 URL(展示用);sourceUrl = 用户配置里的那条源(下次判断缓存还属不属于当前源)
        writeFileSync(catalogCacheFile, JSON.stringify({ at: Date.now(), url: source, sourceUrl, entries }))
      } catch { /* 缓存写不进去不影响功能 */ }
    }
    /** 解析目录 JSON:支持裸数组与 { packs: [] },过滤掉没有下载地址的脏条目。 */
    const readDirectoryPayload = async (res) => {
      const raw = await res.json()
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw && raw.packs) ? raw.packs : null)
      if (!list) throw new Error('目录不是数组或 { packs: [] }')
      return list.filter((e) => e && (e.manifestUrl || e.archiveUrl))
    }
    /** 同一层候选并发竞速:谁先返回合法目录用谁,其余请求中止(被墙直链不会拖住整个面板)。 */
    const raceDirectoryUrls = async (cands, perAttemptTimeout = REMOTE_DIR_ATTEMPT_TIMEOUT) => {
      const errors = []
      if (!Array.isArray(cands) || cands.length === 0) return { ok: false, errors }
      const ctrl = new AbortController()
      const result = await Promise.any(cands.map(async (u) => {
        try {
          const res = await fetch(withCacheBust(u), {
            // 单次 6s 上限(可被总预算压低):国内直连 raw 往往一直挂着,不能等 8s 才换下一个
            signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(Math.max(1000, perAttemptTimeout))]),
            redirect: 'follow',
          })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return { ok: true, entries: await readDirectoryPayload(res), source: u }
        } catch (error) {
          errors.push(u + ' → ' + shortFetchError(error))
          throw error
        }
      })).catch(() => null)
      ctrl.abort()
      return result || { ok: false, errors }
    }
    /**
     * 资产下载(清单/图片/ZIP)的候选顺序:目录拉取成功的镜像链路排第一,其余按 remoteMirrors 顺序。
     * 国内网络下目录多半是某条加速前缀拉到的,把那条链路复用到图片下载,省掉每张图先等直链超时。
     */
    const assetMirrors = (url) => {
      const list = remoteMirrors(url)
      if (!preferredMirrorPrefix || list.length < 2) return list
      const hit = list.find((u) => u.startsWith(preferredMirrorPrefix))
      if (!hit) return list
      return [hit, ...list.filter((u) => u !== hit)]
    }
    /**
     * 下载量是活数据,不进 catalog.json:服务端代拉 GitHub releases(一个请求拿全),
     * 缓存 30 分钟。只认 archiveUrl 指向 github.com 的条目,清单热链的包没有 release
     * 可数,就不显示。失败一律当「没有数据」,不影响目录本身。
     */
    const fetchDownloadCounts = async (entries) => {
      const repos = new Set()
      for (const e of (entries || [])) {
        const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\//.exec(String((e && e.archiveUrl) || ''))
        if (m) repos.add(m[1] + '/' + m[2])
      }
      const key = [...repos].sort().join(',')
      if (!key) return {}
      // 匿名 API 额度是 60 次/小时/IP:缓存 30 分钟,一次打开发现页最多触发一次
      if (downloadCache.key === key && Date.now() - downloadCache.at < 1800000) return downloadCache.data
      const merged = {}
      for (const repo of repos) {
        try {
          const res = await fetch('https://api.github.com/repos/' + repo + '/releases?per_page=100', {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-meme' },
            signal: AbortSignal.timeout(8000),
          })
          if (!res.ok) continue
          Object.assign(merged, parseDownloadCounts(await res.json()))
        } catch { /* 拉不到就少显示一个数字 */ }
      }
      downloadCache = { at: Date.now(), data: merged, key }
      return merged
    }

    const fetchRemoteDirectory = async () => {
      if (remoteDirCache && Date.now() - remoteDirCache.at < 60000) {
        remoteDirMeta = { source: remoteDirCache.source, cached: false, error: '' }
        return remoteDirCache.data
      }
      const groups = directoryGroups()
      const errors = []
      // 总预算:源多(默认 4 条)且都被墙时,不能一条条等满 6s×2 层,12s 后直接走磁盘缓存/报错
      const startedAt = Date.now()
      const DIR_TOTAL_BUDGET = 12000
      for (const group of groups) {
        if (Date.now() - startedAt > DIR_TOTAL_BUDGET) break
        // 先竞速「内容实时」的一层(直链 + gh 加速);全挂再试 jsDelivr(可能滞留 12h 的旧目录)
        for (const tier of [group.tier0, group.tier1]) {
          const remaining = DIR_TOTAL_BUDGET - (Date.now() - startedAt)
          if (remaining <= 0) break
          const r = await raceDirectoryUrls(tier, Math.min(REMOTE_DIR_ATTEMPT_TIMEOUT, remaining))
          if (r.ok) {
            const data = { entries: r.entries, source: r.source, cached: false }
            remoteDirCache = { at: Date.now(), data, source: r.source }
            preferredMirrorPrefix = mirrorProviderPrefix(r.source) || preferredMirrorPrefix
            writeCatalogCache(r.source, r.entries, group.key)
            remoteDirMeta = { source: r.source, cached: false, error: '' }
            return data
          }
          errors.push(...r.errors)
        }
      }
      // 全部镜像失败:回退上次成功拉到的磁盘缓存(至少让用户看到目录,能装旧版本)
      const cached = readCatalogCache()
      // 缓存归属按「源分组 key」判断(自动=源 URL、预设=official/mirror);
      // 老缓存没有 sourceUrl,只能拿实际拉通的镜像 URL 比对
      if (cached && groups.some((g) => g.key === (cached.sourceUrl || cached.url))) {
        remoteDirMeta = { source: cached.url, cached: true, error: errors[0] || '' }
        return { entries: cached.entries, source: cached.url, cached: true }
      }
      remoteDirMeta = { source: '', cached: false, error: errors[0] || '目录源全部不可用' }
      return null
    }
    const jobSnapshot = (job) => ({
      id: job.id, packId: job.packId, name: job.name, mode: job.mode,
      total: job.total, done: job.done, failed: job.failed,
      added: job.added, updated: job.updated,
      state: job.state, message: job.message,
      errors: job.errors.slice(0, 5), warnings: job.warnings.slice(0, 10),
    })
    const fetchRemoteJson = async (url) => {
      if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('清单地址必须是 http(s) 链接')
      let lastError = ''
      // 清单也走镜像:国内直连 raw 拉清单同样会失败(清单下载是订阅/预览的第一步)
      for (const u of assetMirrors(url)) {
        let res
        try {
          res = await fetch(u, { signal: AbortSignal.timeout(15000), redirect: 'follow' })
        } catch (error) {
          lastError = shortFetchError(error)
          continue
        }
        if (!res.ok) {
          lastError = 'HTTP ' + res.status
          continue
        }
        let text
        try {
          text = await res.text()
        } catch (error) {
          lastError = shortFetchError(error)
          continue
        }
        // 内容层面的错误不换镜像:JSON 坏了换哪个镜像都一样
        if (text.length > REMOTE_MANIFEST_MAX) throw new Error('清单超过 2MB,拒绝处理')
        try {
          return JSON.parse(text)
        } catch {
          throw new Error('清单不是合法 JSON')
        }
      }
      throw new Error('清单下载失败: ' + (lastError || '未知错误'))
    }
    const fmtBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB')
    /**
     * 下载 ZIP 并校验。逐块读,顺便通过 onProgress(已下载字节, content-length) 汇报进度
     * —— 客户端靠它画进度条(以前用 arrayBuffer 一把梭,安装期间界面上只有一句文字)。
     */
    const fetchRemoteArchive = async (url, expectedSha256, onProgress) => {
      if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('ZIP 地址必须是 http(s) 链接')
      const expected = String(expectedSha256 || '').trim().toLowerCase()
      if (expected && !/^[0-9a-f]{64}$/.test(expected)) throw new Error('SHA-256 格式无效')
      let lastError = ''
      let lastWasShaMismatch = false
      // 镜像可能给旧文件/坏文件:sha256 不匹配就换下一个候选,全都不匹配才报损坏
      for (const u of assetMirrors(url)) {
        let res
        try {
          // 大包给足 3 分钟(上限 100MB,慢链路也够)
          res = await fetch(u, { signal: AbortSignal.timeout(180000), redirect: 'follow' })
        } catch (error) {
          lastError = shortFetchError(error)
          lastWasShaMismatch = false
          continue
        }
        if (!res.ok) {
          lastError = 'HTTP ' + res.status
          lastWasShaMismatch = false
          continue
        }
        const declared = Number(res.headers.get('content-length') || 0)
        if (declared > REMOTE_ARCHIVE_MAX) throw new Error('ZIP 超过 100MB,拒绝处理')
        const chunks = []
        let size = 0
        try {
          if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
            for await (const chunk of res.body) {
              size += chunk.length
              if (size > REMOTE_ARCHIVE_MAX) throw new Error('ZIP 大小超限(≤100MB)')
              chunks.push(Buffer.from(chunk))
              if (onProgress) onProgress(size, declared)
            }
          } else {
            const one = Buffer.from(await res.arrayBuffer())
            size = one.byteLength
            chunks.push(one)
          }
        } catch (error) {
          // 大小超限是硬错误,换镜像也一样;网络中断才可以换
          if (error instanceof Error && /大小超限/.test(error.message)) throw error
          lastError = shortFetchError(error)
          lastWasShaMismatch = false
          continue
        }
        const buf = Buffer.concat(chunks)
        if (buf.byteLength === 0 || buf.byteLength > REMOTE_ARCHIVE_MAX) throw new Error('ZIP 大小超限(≤100MB)')
        const actual = createHash('sha256').update(buf).digest('hex')
        if (expected && actual !== expected) {
          lastError = 'SHA-256 不一致'
          lastWasShaMismatch = true
          continue
        }
        return { buf, sha256: actual }
      }
      if (lastWasShaMismatch) throw new Error('ZIP SHA-256 校验失败,文件可能损坏或已被替换')
      throw new Error('ZIP 下载失败: ' + (lastError || '未知错误'))
    }
    /** 单张远端图片下载:按镜像候选重试。图库动辄几十上百张图,直链被墙时不能每张都等超时。 */
    const fetchRemoteImage = async (url) => {
      let lastError = ''
      for (const u of assetMirrors(url)) {
        try {
          const res = await fetch(u, { signal: AbortSignal.timeout(20000), redirect: 'follow' })
          if (!res.ok) {
            lastError = 'HTTP ' + res.status
            continue
          }
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.byteLength === 0 || buf.byteLength > REMOTE_IMAGE_MAX) throw new Error('图片大小超限(≤8MB)')
          return buf
        } catch (error) {
          if (error instanceof Error && /大小超限/.test(error.message)) throw error
          lastError = shortFetchError(error)
        }
      }
      throw new Error('下载失败: ' + (lastError || '未知错误'))
    }

    /** 下载完之后的校验+解包+安装(任务与旧同步路径共用)。 */
    const installArchiveBuffer = (buf, sha256, opts) => {
      const entries = unzipStore(buf)
      let manifest = {}
      try { manifest = JSON.parse(String(entries.get('manifest.json') || '{}')) } catch { throw new Error('manifest.json 不是合法 JSON') }
      const requestedId = packSlug(opts.requestedId)
      const manifestId = packSlug(manifest.id)
      const id = requestedId || manifestId
      if (!id) throw new Error('ZIP manifest.json 缺少有效 id')
      if (requestedId && manifestId && requestedId !== manifestId) {
        throw new Error('目录 id 与 ZIP manifest id 不一致,已拒绝安装')
      }
      const displayName = String(manifest.name || opts.name || id).trim().slice(0, 60) || id
      const version = String(manifest.version || opts.version || '').trim().slice(0, 40)
      const sidecar = {
        sourceType: 'archive', archiveUrl: opts.archiveUrl, sha256,
        id, name: displayName, version, lastSync: Date.now(),
      }
      installZipEntries(entries, id, sidecar)
      const total = memes.list().memes.length
      const subs = remoteSubs().filter((s) => s && s.id !== id)
      subs.unshift({ id, archiveUrl: opts.archiveUrl, sha256, name: displayName, version, total, lastSync: Date.now() })
      writeSettings({ remoteSubs: subs })
      return { id, displayName, total, files: entries.size }
    }

    /** ZIP 安装走任务制:客户端轮询 remoteJobStatus 就能画下载进度条。 */
    const startArchiveJob = ({ archiveUrl, sha256, requestedId, name, version }) => {
      const jobId = 'ra-' + Date.now().toString(36) + '-' + (++remoteJobSeq)
      const job = {
        id: jobId, packId: packSlug(requestedId) || '', name: name || '', mode: 'archive',
        total: 0, done: 0, failed: 0, added: 0, updated: 0, warnings: [], errors: [],
        state: 'running', message: '开始下载…', startedAt: Date.now(),
      }
      remoteJobs.set(jobId, job)
      while (remoteJobs.size > 10) remoteJobs.delete(remoteJobs.keys().next().value)
      ;(async () => {
        try {
          const { buf, sha256: actual } = await fetchRemoteArchive(archiveUrl, sha256, (got, declared) => {
            job.done = got
            job.total = declared          // 0 = 上游没给 content-length,客户端画不确定进度条
            job.message = '下载中 ' + fmtBytes(got) + (declared ? ' / ' + fmtBytes(declared) : '')
          })
          job.total = buf.byteLength
          job.done = buf.byteLength
          job.message = '校验通过,正在解包安装…'
          const done = installArchiveBuffer(buf, actual, { archiveUrl, requestedId, name, version })
          job.packId = done.id
          job.name = done.displayName
          job.added = done.total
          job.state = 'done'
          job.message = '安装完成,已切换到「' + done.displayName + '」'
        } catch (error) {
          job.state = 'error'
          job.message = error instanceof Error ? error.message : String(error)
          job.errors.push(String(job.message))
        }
      })()
      return job
    }
    const packSlug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40)
    const installZipEntries = (entries, packId, sidecar) => {
      const id = packSlug(packId)
      if (!id) throw new Error('图库 id 无效')
      if (!entries.get('index.db')) throw new Error('ZIP 里没有 index.db,不是有效的表情包包')
      // 装/导入完默认就能用:切换过去 + 打开开关(其它图库的开关保持不动)。
      // 开关状态要在切包之前取,否则「没设置过」的隐含默认会跟着变成新图库。
      const enabledBefore = enabledPackIds(readSettings(), listAllPacks(), activePackId())
      const root = resolve(packsDirNow())
      const targetAbs = resolve(join(root, id))
      if (!targetAbs.startsWith(root + sep)) throw new Error('图库目录越界')
      const nonce = Math.random().toString(16).slice(2, 10)
      const stageAbs = resolve(join(root, id + '.tmp-' + nonce))
      const backupAbs = resolve(join(root, id + '.bak-' + nonce))
      if (!stageAbs.startsWith(root + sep) || !backupAbs.startsWith(root + sep)) throw new Error('临时目录越界')

      const files = new Map(entries)
      if (sidecar) files.set(SIDECAR_NAME, Buffer.from(JSON.stringify(sidecar, null, 2)))
      for (const [rel] of files) {
        if (!rel || /[\\\/]$/.test(rel)) continue
        const full = resolve(stageAbs, rel)
        if (full === stageAbs || !full.startsWith(stageAbs + sep)) {
          throw new Error('ZIP 条目路径越界,已拒绝导入: ' + rel)
        }
      }

      mkdirSync(root, { recursive: true })
      rmSync(stageAbs, { recursive: true, force: true })
      rmSync(backupAbs, { recursive: true, force: true })
      try {
        mkdirSync(stageAbs, { recursive: true })
        for (const [rel, bytes] of files) {
          if (!rel || /[\\\/]$/.test(rel)) continue
          const full = resolve(stageAbs, rel)
          mkdirSync(dirname(full), { recursive: true })
          writeFileSync(full, bytes)
        }
        const verifyDb = new DatabaseSync(join(stageAbs, 'index.db'), { readOnly: true })
        try { verifyDb.prepare('SELECT COUNT(*) AS n FROM memes').get() } finally { verifyDb.close() }
        // 导入的图库常带站点级大标签(出现在几乎每条 keywords 里),对检索零信息量,
        // 还会让搜那些词命中全库(issue #30 附带的建议)。纯增强,失败不影响导入。
        try {
          const pruned = prunePackKeywords(join(stageAbs, 'index.db'))
          if (pruned.drop.length) {
            console.log('[dsh-expression] 图库 ' + id + ':剔除 ' + pruned.drop.length + ' 个高频关键词(改动 ' + pruned.changed + ' 条)- ' + pruned.drop.join(' '))
          }
        } catch (error) {
          console.warn('[dsh-expression] 高频关键词清洗跳过:', error instanceof Error ? error.message : String(error))
        }

        const replacingActive = resolve(memes.root) === targetAbs
        if (replacingActive) {
          try { adminDb.close() } catch { /* 已关闭 */ }
        }
        let backedUp = false
        try {
          if (existsSync(targetAbs)) {
            renameSync(targetAbs, backupAbs)
            backedUp = true
          }
          renameSync(stageAbs, targetAbs)
        } catch (error) {
          if (backedUp && !existsSync(targetAbs) && existsSync(backupAbs)) renameSync(backupAbs, targetAbs)
          if (replacingActive && existsSync(targetAbs)) reloadMemeStore(targetAbs, id)
          throw error
        }
        rmSync(backupAbs, { recursive: true, force: true })
        reloadMemeStore(targetAbs, id)
        writeSettings({ enabledPacks: [...new Set([...enabledBefore, id])] })
        return targetAbs
      } finally {
        rmSync(stageAbs, { recursive: true, force: true })
      }
    }
    // 清单 → 规范化条目;单条非法只跳过并记 warning,不整体失败
    const normalizeRemoteManifest = (raw, fallbackId, sourceUrl) => {
      const items = Array.isArray(raw && raw.memes) ? raw.memes : []
      if (items.length === 0) throw new Error('清单缺少 memes 数组或为空')
      if (items.length > REMOTE_MAX_ITEMS) throw new Error('清单超过 ' + REMOTE_MAX_ITEMS + ' 条,请拆分成多个包')
      const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40)
      const id = slug(raw.id) || slug(fallbackId)
        || ('remote-' + createHash('sha1').update(String(sourceUrl || '')).digest('hex').slice(0, 8))
      const warnings = []
      const seen = new Set()
      const out = []
      for (const it of items) {
        const url = String((it && it.url) || '').trim()
        if (!/^https?:\/\//i.test(url)) { warnings.push('跳过非 http(s) 链接: ' + url.slice(0, 60)); continue }
        const tag = slug(it.tag)
        if (!tag) { warnings.push('跳过无效分类: ' + url.slice(0, 60)); continue }
        let fileName = String(it.file || '').trim().split(/[\\/]/).pop().trim()
        let ext = fileName.includes('.') ? ('.' + fileName.split('.').pop().toLowerCase()) : ''
        if (!IMAGE_EXTS.includes(ext)) {
          const m = /\.(jpe?g|png|gif|webp)(?:\?|#|$)/i.exec(url)
          ext = m ? '.' + (m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()) : '.webp'
          fileName = fileName ? fileName.replace(/\.[^.]*$/, '') + ext : ''
        }
        if (!fileName) fileName = createHash('sha1').update(url).digest('hex').slice(0, 12) + ext
        if (seen.has(tag + '/' + fileName)) fileName = createHash('sha1').update(url).digest('hex').slice(0, 8) + '-' + fileName
        seen.add(tag + '/' + fileName)
        out.push({
          url, tag, fileName,
          rel: 'memes/' + tag + '/' + fileName,
          caption: String((it && it.caption) || '').trim().slice(0, 200),
          keywords: String((it && it.keywords) || '').trim().slice(0, 200),
        })
      }
      if (out.length === 0) throw new Error('清单没有有效条目(检查 url/tag 字段)')
      return {
        id,
        name: String(raw.name || id).trim().slice(0, 60) || id,
        description: String(raw.description || '').trim().slice(0, 200),
        version: String(raw.version || '').trim().slice(0, 40),
        items: out,
        warnings,
      }
    }
    const startRemoteJob = (manifest, sourceUrl, mode) => {
      const jobId = 'rj-' + Date.now().toString(36) + '-' + (++remoteJobSeq)
      const job = {
        id: jobId, packId: manifest.id, name: manifest.name, mode,
        total: manifest.items.length, done: 0, failed: 0, added: 0, updated: 0,
        warnings: manifest.warnings.slice(0, 20), errors: [],
        state: 'running', message: '准备中…', startedAt: Date.now(),
      }
      remoteJobs.set(jobId, job)
      while (remoteJobs.size > 10) remoteJobs.delete(remoteJobs.keys().next().value)
      ;(async () => {
        const packsDir = resolve(packsDirNow())
        // id 必须先合法化:join(packsDir, '') 会得到扫描目录本身,后面 fresh 分支的
        // rmSync(finalDir) 会把整个 meme-packs 目录删掉(清单缺 id 时踩过)
        const safeId = packSlug(manifest.id)
        if (!safeId) {
          job.state = 'error'
          job.message = '远程清单缺少有效的 id,已中止(不会动本地图库)'
          return
        }
        manifest.id = safeId
        job.packId = safeId
        const finalDir = resolve(join(packsDir, safeId))
        if (!finalDir.startsWith(packsDir + sep)) {
          job.state = 'error'
          job.message = '图库目录越界,已中止'
          return
        }
        let workDir = finalDir
        let effectiveMode = mode
        if (existsSync(finalDir)) {
          let sidecar = null
          try { sidecar = JSON.parse(readFileSync(join(finalDir, SIDECAR_NAME), 'utf8')) } catch { }
          if (sidecar && sidecar.manifestUrl === sourceUrl) {
            effectiveMode = 'update'
            job.mode = 'update'
          } else {
            job.state = 'error'
            job.message = '扫描目录下已存在同名图库「' + manifest.id + '」且不是本清单下载的,请先删除或换个 id'
            return
          }
        }
        const prev = {} // url → {path}(更新模式用于跳过已下载/刷新元数据)
        if (effectiveMode === 'update') {
          try {
            const sc = JSON.parse(readFileSync(join(finalDir, SIDECAR_NAME), 'utf8'))
            if (sc && sc.manifestUrl === sourceUrl) for (const it of sc.items || []) prev[it.url] = it
          } catch { }
        } else {
          workDir = resolve(join(packsDir, manifest.id + '.tmp-' + Math.random().toString(16).slice(2, 8)))
          rmSync(workDir, { recursive: true, force: true })
          mkdirSync(workDir, { recursive: true })
        }
        job.message = (effectiveMode === 'update' ? '更新中 ' : '下载中 ') + '0/' + job.total
        const db = new DatabaseSync(join(workDir, 'index.db'))
        db.exec('CREATE TABLE IF NOT EXISTS memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
        try {
          const queue = manifest.items.slice()
          let active = 0
          await new Promise((allDone) => {
            const pump = () => {
              while (active < REMOTE_CONCURRENCY && queue.length) {
                const item = queue.shift()
                active++
                  ; (async () => {
                    const known = prev[item.url]
                    if (known && known.path === item.rel && existsSync(join(workDir, item.rel))) {
                      db.prepare('UPDATE memes SET tag = ?, caption = ?, keywords = ?, mtime = ? WHERE path = ?')
                        .run(item.tag, item.caption, item.keywords, Date.now(), item.rel)
                      job.updated++
                    } else {
                      // 逐图下载走镜像候选(国内直连 raw 会失败,图库安装/更新主要卡在这里)
                      const buf = await fetchRemoteImage(item.url)
                      mkdirSync(join(workDir, 'memes', item.tag), { recursive: true })
                      writeFileSync(join(workDir, item.rel), buf)
                      if (known && known.path !== item.rel) {
                        try { unlinkSync(join(workDir, known.path)) } catch { /* 已不在 */ }
                        db.prepare('DELETE FROM memes WHERE path = ?').run(known.path)
                      }
                      db.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                        .run(item.rel, item.tag, item.fileName, item.caption, item.keywords, Date.now(), Date.now())
                      job.added++
                    }
                    job.done++
                    prev[item.url] = { url: item.url, path: item.rel }
                  })().catch((error) => {
                    job.failed++
                    if (job.errors.length < 20) job.errors.push(item.url.slice(0, 80) + ' — ' + (error instanceof Error ? error.message : String(error)))
                  }).finally(() => {
                    active--
                    job.message = (effectiveMode === 'update' ? '更新中 ' : '下载中 ') + (job.done + job.failed) + '/' + job.total
                    pump()
                  })
              }
              if (active === 0) allDone()
            }
            pump()
          })
        } finally {
          db.close()
        }
        // 清单下载的图库同样清洗一遍高频关键词(与 ZIP 安装路径一致,见 prunePackKeywords)
        try {
          const pruned = prunePackKeywords(join(workDir, 'index.db'))
          if (pruned.drop.length) {
            console.log('[dsh-expression] 图库 ' + manifest.id + ':剔除 ' + pruned.drop.length + ' 个高频关键词(改动 ' + pruned.changed + ' 条)- ' + pruned.drop.join(' '))
          }
        } catch (error) {
          console.warn('[dsh-expression] 高频关键词清洗跳过:', error instanceof Error ? error.message : String(error))
        }
        writeFileSync(join(workDir, SIDECAR_NAME), JSON.stringify({
          manifestUrl: sourceUrl, id: manifest.id, name: manifest.name, version: manifest.version, lastSync: Date.now(),
          items: Object.values(prev),
        }))
        if (effectiveMode === 'fresh') {
          writeFileSync(join(workDir, 'manifest.json'), JSON.stringify({ name: manifest.name, description: manifest.description, source: sourceUrl }, null, 2))
          rmSync(finalDir, { recursive: true, force: true })
          renameSync(workDir, finalDir)
        }
        const subs = remoteSubs().filter((s) => s && s.id !== manifest.id)
        subs.unshift({ id: manifest.id, url: sourceUrl, name: manifest.name, version: manifest.version, total: job.total, lastSync: Date.now() })
        writeSettings({ remoteSubs: subs })
        if (effectiveMode === 'fresh') {
          // 初次订阅下载完也默认直接可用:切过去 + 打开开关
          const enabledBefore = enabledPackIds(readSettings(), listAllPacks(), activePackId())
          reloadMemeStore(finalDir, manifest.id)
          writeSettings({ enabledPacks: [...new Set([...enabledBefore, manifest.id])] })
          job.message = '完成:下载 ' + job.added + '/' + job.total + ' 张并已切换到「' + manifest.name + '」'
            + (job.failed ? '(失败 ' + job.failed + ' 张,可稍后再点一次更新补齐)' : '')
        } else {
          job.message = '完成:新增 ' + job.added + ' 张,刷新元数据 ' + job.updated + ' 张' + (job.failed ? ',失败 ' + job.failed + ' 张' : '')
        }
        job.state = job.failed ? 'done-with-errors' : 'done'
      })().catch((error) => {
        job.state = 'error'
        job.message = '失败: ' + (error instanceof Error ? error.message : String(error))
      })
   
      return job
    }
    // 清理上次运行残留的临时下载目录(没有 index.db,扫描不会看到,但会占磁盘)
    try {
      const dir = packsDirNow()
      if (existsSync(dir)) {
        for (const name of readdirSync(dir)) {
          if (!/\.tmp-[0-9a-f]+$/.test(name)) continue
          const p = join(dir, name)
          try { if (statSync(p).isDirectory()) rmSync(p, { recursive: true, force: true }) } catch { }
        }
      }
    } catch { }

    const readBody = (req, maxBytes = 32 * 1024 * 1024) => new Promise((resolve, reject) => {
      const chunks = []
      let total = 0
      req.on('data', (c) => {
        total += c.length
        if (total > maxBytes) {
          reject(new Error('请求体过大(>32MB)'))
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
    const json = (res, obj, status = 200) => {
      const body = JSON.stringify(obj)
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(body)
    }
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/dsh-memes-api',
      async handler(req, res) {
        if (denyNonLoopback(req, res)) return
        if (req.method === 'GET') {
          const u = new URL(req.url || '/', 'http://localhost')
          if (u.searchParams.has('remoteDir')) {
            const dir = await fetchRemoteDirectory()
            let counts = {}
            try { counts = await fetchDownloadCounts(dir ? dir.entries : []) } catch { /* 只是少个数字 */ }
            const settingsNow = readSettings()
            json(res, {
              ok: true,
              // null = 彻底拉不到(前端显示错误 + 重试);走磁盘缓存时仍是数组
              remoteDir: dir ? dir.entries.map((e) => ({ ...e, downloads: counts[e.id] || 0 })) : null,
              remoteDirSource: remoteDirMeta.source,
              remoteDirCached: !!remoteDirMeta.cached,
              remoteDirError: remoteDirMeta.error || '',
              remoteDirUrl: remoteDirUrlList(),
              remoteDirUrlSetting: typeof settingsNow.remoteDirUrl === 'string' ? settingsNow.remoteDirUrl : '',
            })
            return
          }
          const packs = listAllPacks()
          const activeId = readSettings().packId
            || ((packs.find((p) => resolve(p.path) === resolve(memes.root)) || {}).id || '')
          const urlFor = (m, pid) => ({ ...m, url: ROUTE + '/' + pid + '/' + m.path })
          const packList = () => packs.map((p) => ({ id: p.id, name: p.name, count: p.count }))
          const packId = u.searchParams.get('packId') || activeId
          // packId=all:合并全部包,url 带包前缀(悬浮窗配图索引用,跨包也能渲染/取图)
          if (packId === 'all') {
            const all = []
            for (const p of packs) {
              let store = null
              try {
                store = new MemesStore(p.path)
                for (const m of store.list().memes) all.push(urlFor(m, p.id))
              } catch { /* 坏库跳过 */ }
              finally { if (store) store.close() }
            }
            json(res, { ok: true, total: all.length, tags: [], packId: activeId, packs: packList(), memes: all, remoteSubs: remoteSubs(), remoteDirUrl: remoteDirUrlList(), layoutMode: normalizeLayoutMode(readSettings().layoutMode) })
            return
          }
          const pack = packs.find((p) => p.id === packId)
          let rows = []
          let tags = []
          if (pack) {
            let store = null
            try {
              store = new MemesStore(pack.path)
              const r = store.list(u.searchParams.get('tag') || undefined, u.searchParams.get('q') || undefined)
              rows = r.memes
              tags = r.tags
            } catch { /* 坏库/缺索引 → 空列表 */ }
            finally { if (store) store.close() }
          } else {
            const r = memes.list(u.searchParams.get('tag') || undefined, u.searchParams.get('q') || undefined)
            rows = r.memes
            tags = r.tags
          }
          const pid = pack ? pack.id : activeId
          json(res, {
            ok: true, total: rows.length, tags,
            packId: pid,
            packs: packList(),
            memes: rows.map((m) => urlFor(m, pid)),
            remoteSubs: remoteSubs(),
            remoteDirUrl: remoteDirUrlList(),
            layoutMode: normalizeLayoutMode(readSettings().layoutMode),
          })
          return
        }
        // 状态变更请求:校验 Origin 与 Host 同源,防浏览器跨站触发(CSRF)。
        // 缺失 Origin 的本地脚本/curl 请求放行(兼容),不同源一律 403。
        const origin = req.headers.origin
        if (origin) {
          let sameOrigin = false
          try {
            const o = new URL(origin)
            sameOrigin = o.host === String(req.headers.host || '')
          } catch { sameOrigin = false }
          if (!sameOrigin) {
            json(res, { ok: false, error: '跨站请求被拒绝' }, 403)
            return
          }
        }
        let body
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          json(res, { ok: false, error: '无效的 JSON 请求体' }, 400)
          return
        }
        try {
          const op = String(body.op || '')
          if (op === 'createMemePack') {
            const id = String(body.id || '').trim()
            const name = String(body.name || '').trim()
            if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) throw new Error('ID 须为 1–40 位小写字母、数字、横线或下划线')
            if (!name || name.length > 60) throw new Error('图库名称须为 1–60 字')
            if (listAllPacks().some(p => p.id === id)) throw new Error('图库 ID 已存在')
            const dir = join(resolve(packsDirNow()), id)
            mkdirSync(resolve(packsDirNow()), { recursive: true })
            mkdirSync(dir)
            writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, name, description: String(body.description || '').slice(0, 200), version: '1.0.0' }, null, 2))
            // 保留已有开关状态,再把新建的图库打开(模型立即可用)
            const wasEnabled = enabledPackIds(readSettings(), listAllPacks(), activePackId())
            reloadMemeStore(dir, id)
            writeSettings({ enabledPacks: [...new Set([...wasEnabled, id])] })
            json(res, { ok: true, ...packPayload() })
          } else if (op === 'recognize') {
            // 上传弹窗的 AI 识别:只返回识别结果,不写入图库(用户确认后走 upload)
            const fileName = String(body.fileName || '').trim()
            const data = String(body.dataBase64 || '')
            if (!data) throw new Error('缺少图片数据')
            const buf = Buffer.from(data, 'base64')
            if (buf.byteLength === 0 || buf.byteLength > 8 * 1024 * 1024) throw new Error('图片大小超限(≤8MB)')
            const ext = fileName.includes('.') ? '.' + fileName.split('.').pop().toLowerCase() : ''
            if (!IMAGE_EXTS.includes(ext)) throw new Error('仅支持 jpg/png/gif/webp')
            const sel = ctx.agentDefaultModel && typeof ctx.agentDefaultModel.currentSelection === 'function'
              ? ctx.agentDefaultModel.currentSelection() : null
            const r = await recognizeImageBytes(ctx.get('llm'), sel, buf, MIME[ext.slice(1)] || 'image/jpeg', fileName)
            if (!r.tag || !validTagRe.test(r.tag)) throw new Error('AI 未识别出有效分类,请手动选择')
            json(res, { ok: true, tag: r.tag, caption: r.caption, keywords: r.keywords, animation: r.animation || null })
          } else if (op === 'upload') {
            const tag = String(body.tag || '').trim().toLowerCase()
            const fileName = String(body.fileName || '').trim()
            const data = String(body.dataBase64 || '')
            const caption = String(body.caption || '').trim().slice(0, 200)
            const keywords = String(body.keywords || '').trim().slice(0, 200)
            if (!tag || !validTagRe.test(tag)) throw new Error('tag 只能是小写字母/数字/-/_')
            const ext = fileName.includes('.') ? '.' + fileName.split('.').pop().toLowerCase() : ''
            if (!IMAGE_EXTS.includes(ext)) throw new Error('仅支持 jpg/png/gif/webp')
            if (!data) throw new Error('缺少图片数据')
            const name = Date.now() + '_' + Math.floor(Math.random() * 1000) + ext
            const rel = 'memes/' + tag + '/' + name
            mkdirSync(join(memes.root, 'memes', tag), { recursive: true })
            writeFileSync(join(memes.root, rel), Buffer.from(data, 'base64'))
            adminDb.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(rel, tag, name, caption, keywords, Date.now(), Date.now())
            memes.refresh()
            json(res, { ok: true, meme: { path: rel, tag, file_name: name, caption, keywords, url: ROUTE + '/' + rel } })
          } else if (op === 'update') {
            const path = String(body.path || '')
            const row = memes.list().memes.find((m) => m.path === path)
            if (!row) throw new Error('未知路径: ' + path)
            const tag = body.tag != null ? String(body.tag).trim().toLowerCase() : row.tag
            if (!validTagRe.test(tag)) throw new Error('tag 只能是小写字母/数字/-/_')
            const caption = body.caption != null ? String(body.caption).trim() : row.caption
            const keywords = body.keywords != null ? String(body.keywords).trim() : row.keywords
            adminDb.prepare('UPDATE memes SET tag = ?, caption = ?, keywords = ? WHERE path = ?').run(tag, caption, keywords, path)
            memes.refresh()
            json(res, { ok: true })
          } else if (op === 'delete') {
            const path = String(body.path || '')
            if (!memes.list().memes.some((m) => m.path === path)) throw new Error('未知路径: ' + path)
            adminDb.prepare('DELETE FROM memes WHERE path = ?').run(path)
            memes.refresh()
            try { unlinkSync(join(memes.root, path)) } catch { /* 文件已不存在 */ }
            json(res, { ok: true })
          } else if (op === 'deleteTag') {
            const tag = String(body.tag || '').trim().toLowerCase()
            if (!tag || !validTagRe.test(tag)) throw new Error('tag 只能是小写字母/数字/-/_')
            const n = adminDb.prepare('DELETE FROM memes WHERE tag = ?').run(tag).changes
            memes.refresh()
            rmSync(join(memes.root, 'memes', tag), { recursive: true, force: true })
            json(res, { ok: true, deleted: n })
          } else if (op === 'importMemePack') {
            const data = String(body.dataBase64 || '')
            const name = packSlug(body.name) || 'meme-pack'
            if (!data) throw new Error('缺少 ZIP 数据')
            const entries = unzipStore(Buffer.from(data, 'base64'))
            installZipEntries(entries, name)
            json(res, { ok: true, ...packPayload(), total: memes.list().memes.length, message: '导入成功,已切换到新图库' })
          } else if (op === 'installRemoteArchive') {
            const archiveUrl = String(body.archiveUrl || '').trim()
            const wanted = packSlug(body.packId)
            for (const j of remoteJobs.values()) {
              if (j.mode === 'archive' && j.state === 'running' && wanted && j.packId === wanted) {
                json(res, { ok: true, ...jobSnapshot(j), running: true, message: '该图库已在下载中' })
                return
              }
            }
            json(res, {
              ok: true,
              ...jobSnapshot(startArchiveJob({
                archiveUrl, sha256: body.sha256,
                requestedId: body.packId, name: body.name, version: body.version,
              })),
            })
          } else if (op === 'subscribeRemote') {
            const manifestUrl = String(body.manifestUrl || '').trim()
            const rawManifest = await fetchRemoteJson(manifestUrl)
            const manifest = normalizeRemoteManifest(rawManifest, String(body.packId || '').trim(), manifestUrl)
            for (const j of remoteJobs.values()) {
              if (j.packId === manifest.id && j.state === 'running') {
                json(res, { ok: true, ...jobSnapshot(j), running: true, message: '该图库已在下载中' })
                return
              }
            }
            json(res, { ok: true, ...jobSnapshot(startRemoteJob(manifest, manifestUrl, 'fresh')) })
          } else if (op === 'previewManifest') {
            // 清单热链的包没装也能预览:服务端读清单,把它列的图片地址交给前端
            // (前端直接 fetch 清单要受 CORS 限制,而且清单可能托管在任意主机)
            const manifestUrl = String(body.manifestUrl || '').trim()
            const raw = await fetchRemoteJson(manifestUrl)
            const manifest = normalizeRemoteManifest(raw, '', manifestUrl)
            json(res, {
              ok: true,
              total: manifest.items.length,
              urls: manifest.items.slice(0, PREVIEW_MAX).map((m) => m.url),
            })
          } else if (op === 'remoteJobStatus') {
            const job = remoteJobs.get(String(body.jobId || '').trim())
            if (!job) throw new Error('未知任务: ' + String(body.jobId || ''))
            json(res, { ok: true, ...jobSnapshot(job) })
          } else if (op === 'updateRemotePack') {
            const id = String(body.id || '').trim()
            const sub = remoteSubs().find((s) => s && s.id === id)
            if (!sub) throw new Error('未找到订阅: ' + id)
            if (sub.archiveUrl) {
              const downloaded = await fetchRemoteArchive(sub.archiveUrl, sub.sha256)
              const entries = unzipStore(downloaded.buf)
              let manifest = {}
              try { manifest = JSON.parse(String(entries.get('manifest.json') || '{}')) } catch { throw new Error('manifest.json 不是合法 JSON') }
              const manifestId = packSlug(manifest.id)
              if (manifestId && manifestId !== id) throw new Error('订阅 id 与 ZIP manifest id 不一致,已拒绝更新')
              const displayName = String(manifest.name || sub.name || id).trim().slice(0, 60) || id
              const version = String(manifest.version || sub.version || '').trim().slice(0, 40)
              installZipEntries(entries, id, {
                sourceType: 'archive', archiveUrl: sub.archiveUrl, sha256: downloaded.sha256,
                id, name: displayName, version, lastSync: Date.now(),
              })
              const total = memes.list().memes.length
              const next = remoteSubs().filter((s) => s && s.id !== id)
              next.unshift({ ...sub, sha256: downloaded.sha256, name: displayName, version, total, lastSync: Date.now() })
              writeSettings({ remoteSubs: next })
              json(res, { ok: true, ...packPayload(), total, message: '更新成功,已切换到「' + displayName + '」' })
              return
            }
            if (!sub.url) throw new Error('订阅缺少更新地址: ' + id)
            const rawManifest = await fetchRemoteJson(sub.url)
            const manifest = normalizeRemoteManifest(rawManifest, id, sub.url)
            manifest.id = id
            for (const j of remoteJobs.values()) {
              if (j.packId === id && j.state === 'running') {
                json(res, { ok: true, ...jobSnapshot(j), running: true, message: '该图库已在更新中' })
                return
              }
            }
            json(res, { ok: true, ...jobSnapshot(startRemoteJob(manifest, sub.url, 'update')) })
          } else if (op === 'getMemeRoot') {

            json(res, { ok: true, ...packPayload() })
          } else if (op === 'setPack') {
            const packId = String(body.packId || '').trim()
            if (!packId) throw new Error('未指定图库')
            const hit = listAllPacks().find((p) => p.id === packId)
            if (!hit) throw new Error('未知图库: ' + packId)
            reloadMemeStore(hit.path, hit.id)
            json(res, { ok: true, ...packPayload(), message: '已切换图库,立即生效' })
          } else if (op === 'setPacksDir') {
            const dir = String(body.packsDir || '').trim()
            if (!dir) throw new Error('目录不能为空')
            // 扫描目录必须是「装图库的父目录」,不能是某个图库目录自己:那样之后导入/安装
            // 的图库会嵌进这个包里面(memes/<主库>/<子库>/),而主库自己会从列表里消失
            // ——历史上这么点一下就是 issue #23 那种「描述和图对不上」的现场。
            if (isPackDir(dir)) {
              throw new Error('这个目录本身就是一个图库(里面有 index.db),请选它的上级目录;否则新装的图库会嵌在它里面')
            }
            mkdirSync(dir, { recursive: true })
            writeSettings({ packsDir: resolve(dir) })
            json(res, { ok: true, ...packPayload(), message: '已更新扫描目录' })
          } else if (op === 'setMemeRoot') {
            const dir = String(body.memeRoot || '').trim()
            if (!dir) throw new Error('目录不能为空')
            reloadMemeStore(dir)
            json(res, { ok: true, ...packPayload(), message: '已切换图库,立即生效' })
          } else if (op === 'setRemoteDirUrl') {
            // 图库目录源:''/auto = 自动多镜像(推荐);'official'/'mirror' = 预设;http(s) URL = 自定义
            const rawValue = typeof body.remoteDirUrl === 'string' ? body.remoteDirUrl.trim() : ''
            let value = ''
            if (rawValue && rawValue.toLowerCase() !== 'auto') {
              const key = rawValue.toLowerCase()
              if (REMOTE_DIR_PRESETS.includes(key)) {
                value = key
              } else if (/^https?:\/\//i.test(rawValue)) {
                if (rawValue.length > 500) throw new Error('目录地址过长(不超过 500 字符)')
                value = rawValue
              } else {
                throw new Error('目录源只能是「官方源/镜像源」预设,或 http(s) 链接')
              }
            }
            writeSettings({ remoteDirUrl: value })
            // 立刻清缓存:前端保存后会马上重拉目录,不能等 60s 内存缓存过期
            remoteDirCache = null
            remoteDirMeta = { source: '', cached: false, error: '' }
            preferredMirrorPrefix = ''   // 换源后旧的优先镜像链路也不再适用
            json(res, {
              ok: true,
              ...packPayload(),
              message: value ? '已保存图库目录源:' + dirSourceLabel(value) + ',立即生效' : '已恢复自动(内置多镜像)',
            })
          } else if (op === 'setCompanionPrompt') {
            const text = String(body.text || '').trim()
            writeSettings({ companionPrompt: text })
            json(res, { ok: true, ...packPayload(), message: text ? '已保存,下一条消息生效' : '已恢复默认提示词' })
          } else if (op === 'setPromptEnabled') {
            const enabled = body.enabled !== false
            writeSettings({ promptEnabled: enabled })
            json(res, { ok: true, ...packPayload(), message: enabled ? '已开启陪伴提示词,下一条消息生效' : '已关闭陪伴提示词,下一条消息生效' })
          } else if (op === 'setSendMode') {
            // AI 发送方式:auto = 按渠道自动(Web 配图 / IM 原生图片);text = 纯文字不发图;image = 总是发图
            const mode = String(body.sendMode == null ? '' : body.sendMode).trim()
            if (!SEND_MODES.includes(mode)) throw new Error('发送方式只能是 auto / text / image')
            writeSettings({ sendMode: mode })
            const label = mode === 'text' ? '纯文字' : mode === 'image' ? '图片' : '自动(按渠道)'
            json(res, { ok: true, ...packPayload(), message: '发送方式已改为「' + label + '」,下一条消息生效' })
          } else if (op === 'setLayoutMode') {
            // 表情排布:inline = 图与正文并排(默认);stacked = 图独占一行、正文铺开(issue #50)
            const mode = String(body.layoutMode == null ? '' : body.layoutMode).trim()
            if (!LAYOUT_MODES.includes(mode)) throw new Error('排布方式只能是 inline / stacked')
            writeSettings({ layoutMode: mode })
            const label = mode === 'stacked' ? '独占一行' : '并排'
            json(res, { ok: true, ...packPayload(), message: '表情排布已改为「' + label + '」' })
          } else if (op === 'setPackEnabled') {
            // 每张卡片一个开关,可同时开多个;没设置过时以当前图库为初始值
            const target = String(body.packId || '').trim()
            const packs = listAllPacks()
            if (!packs.some((p) => p.id === target)) throw new Error('图库不存在: ' + target)
            const current = enabledPackIds(readSettings(), packs, packPayload().packId)
            const next = body.enabled !== false
              ? [...new Set([...current, target])]
              : current.filter((id) => id !== target)
            writeSettings({ enabledPacks: next })
            json(res, { ok: true, ...packPayload(), message: next.includes(target) ? '已打开「' + target + '」,模型可以用它发图' : '已关闭「' + target + '」' })
          } else if (op === 'deleteMemePack') {
            // 唯一的删除入口:内置、市场下载、自建/导入都走它。
            // 当前图库也能删——管理用的只读/可写连接挂在上面的包,不切走文件被占用
            // (Windows 下 rmSync 会 EBUSY 删一半),所以这里自动先切到别的图库再删。
            const target = String(body.packId || '').trim()
            const packs = listAllPacks()
            const hit = packs.find((p) => p.id === target)
            if (!hit) throw new Error('图库不存在: ' + target)
            const dir = packDeleteDir(hit, packsDirNow())   // 先过路径校验,再动运行时
            let switchedTo = ''
            if (resolve(hit.path) === resolve(memes.root)) {
              const enabled = enabledPackIds(readSettings(), packs, target)
              const others = packs.filter((p) => resolve(p.path) !== resolve(hit.path))
              // 优先切到还在开着的图库,其次任意一个
              const next = others.find((p) => enabled.includes(p.id)) || others[0]
              if (!next) throw new Error('这是最后一个图库,删掉就没有图库可用了')
              reloadMemeStore(next.path, next.id)
              switchedTo = next.name || next.id
            }
            const settingsNow = readSettings()
            if (remoteSubs().some((s) => s && s.id === target)) {
              writeSettings({ remoteSubs: remoteSubs().filter((s) => s && s.id !== target) })
            }
            // 删除的图库从开关列表里摘掉,别留脏 id
            if (Array.isArray(settingsNow.enabledPacks)) {
              writeSettings({ enabledPacks: settingsNow.enabledPacks.filter((id) => id !== target) })
            }
            rmSync(dir, { recursive: true, force: true })
            json(res, {
              ok: true, ...packPayload(),
              message: '已删除图库「' + (hit.name || target) + '」'
                + (switchedTo ? ',当前图库已切到「' + switchedTo + '」' : '')
                + (hit.source === 'bundled' ? '(内置包,升级或重装后会回来)' : ''),
            })
          } else if (op === 'browse') {
            // 服务端列目录:宿主 0.1.5 的客户端没有 workspaces 服务,「选择目录」只能走自己的 API
            let dir = resolve(String(body.path || '').trim() || packsDirNow())
            if (!existsSync(dir)) dir = dshHome()
            const entries = readdirSync(dir, { withFileTypes: true })
              .filter((e) => e.isDirectory())
              .map((e) => ({ name: e.name, path: join(dir, e.name) }))
              .sort((a, b) => a.name.localeCompare(b.name))
            const crumbs = []
            for (let cur = dir; ;) {
              const parent = dirname(cur)
              crumbs.unshift({ name: cur === parent ? cur : basename(cur), path: cur })
              if (cur === parent) break
              cur = parent
            }
            json(res, { ok: true, path: dir, parent: dirname(dir) === dir ? '' : dirname(dir), entries, breadcrumbs: crumbs })
          } else {
            json(res, { ok: false, error: '未知操作: ' + op }, 400)
          }
        } catch (error) {
          json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
        }
      },
    }), 'dsh-expression: /dsh-memes-api 管理 API')
    // 导出图库为 ZIP 包(分享用):遍历图库目录全部文件打包
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/dsh-memes-export',
      handler(req, res) {
        if (denyNonLoopback(req, res)) return
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end()
          return
        }
        try {
          // packId 指定要导出哪个图库(图库页每张卡片都能导出),不传就导出当前图库
          const wanted = new URL(req.url || '/', 'http://localhost').searchParams.get('packId')
          const target = wanted ? listAllPacks().find((p) => p.id === wanted) : null
          if (wanted && !target) throw new Error('图库不存在: ' + wanted)
          const root = resolve(target ? target.path : memes.root)
          if (root === resolve(memes.root)) adminDb.exec('PRAGMA wal_checkpoint(FULL)')
          // 只导出索引内的文件(index.db + manifest.json + 索引图片),
          // 不打包 .git/备份/缩略图等无关内容(历史教训:整目录遍历会带出 200MB 杂物)
          let paths = []
          {
            const db = new DatabaseSync(join(root, 'index.db'))
            try {
              if (root !== resolve(memes.root)) { try { db.exec('PRAGMA wal_checkpoint(FULL)') } catch { /* 只读库 */ } }
              paths = db.prepare('SELECT path FROM memes').all().map((r) => String(r.path))
            } finally { db.close() }
          }
          if (paths.length === 0) throw new Error('空图库没有可导出的图片')
          const files = [{ name: 'index.db', data: readFileSync(join(root, 'index.db')) }]
          if (existsSync(join(root, 'manifest.json'))) {
            files.push({ name: 'manifest.json', data: readFileSync(join(root, 'manifest.json')) })
          }
          for (const rel of paths) {
            const full = join(root, rel)
            if (existsSync(full)) files.push({ name: rel, data: readFileSync(full) })
          }
          const zip = zipStore(files)
          const stamp = new Date().toISOString().slice(0, 10)
          res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Length': String(zip.byteLength),
            'Content-Disposition': 'attachment; filename="dsh-meme-pack-' + stamp + '.zip"',
          })
          res.end(zip)
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('导出失败: ' + (error instanceof Error ? error.message : String(error)))
        }
      },
    }), 'dsh-expression: /dsh-memes-export 导出 ZIP')

    // 自包含管理面板页面(无构建链、重启不丢)。
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/memes-panel',
      handler(req, res) {
        if (denyNonLoopback(req, res)) return
        try {
          const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'panel.html'))
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(html)
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('panel.html 缺失: ' + (error instanceof Error ? error.message : String(error)))
        }
      },
    }), 'dsh-expression: /memes-panel 管理面板')
    // 对话里表情包小图展示:只限制 /dsh-memes 图片,避免大图贴脸,不影响其他 UI。
    // 选择器必须用 src*= 子串匹配:send_meme 返回的是绝对 URL
    // (http://host:port/dsh-memes/...),src^= 前缀匹配只对相对路径生效,
    // 会漏掉所有真实表情(历史教训:之前的 240px 规则因此从未生效)。
    // 尺寸可用 config.memeSize 覆盖(px,默认 160)。
    const memeSize = Number(config?.memeSize) > 0 ? Number(config.memeSize) : 160
    try {
      // data-plugin 必须打:宿主的客户端模块系统在工厂体跑完后按 claimStyles 认领「当下所有
      // 无主 style」,这条从文档加载起就存在,谁后物化谁就把它认到自己名下,之后那个模块一
      // 变更(改自己的 client.js / 热重载)就被 removeOwnedStyles 连标签删掉 —— 小图限高规则
      // 消失、表情包大图贴脸,而且极难查(issue #32)。值必须是模块注册 id(dsh-meme,与
      // __ModuleLoader__.load({ id }) 一致):宿主按同一个 id 摘标签,换个名字会在插件卸载后
      // 留下孤儿规则。
      ctx.effect(() => webServer.tapIndex((html) => html.replace(
        '</head>',
        '<style data-plugin="dsh-meme">img[src*="/dsh-memes/"]:not([data-meme-zoom-img]){max-width:' + memeSize + 'px!important;max-height:' + memeSize + 'px!important;width:auto!important;height:auto!important;object-fit:contain;border-radius:8px}</style></head>',
      )), 'dsh-expression: 小图 CSS')
    } catch (error) {
      console.error('[dsh-expression] tapIndex 失败:', error instanceof Error ? error.message : String(error))
    }
    console.log('[dsh-expression] 管理 API: /dsh-memes-api , 管理面板: /memes-panel , 小图 CSS 已注入(' + memeSize + 'px)')
  }
}
