/**
 * 表情包存储与搜索(dsh-expression 插件)。
 *
 * 模型侧:先按 6 个情绪桶选 tag,系统从该桶随机抽 5 张(带 caption),
 * 模型看描述觉得贴再发。管理面板仍可按 caption 子串筛选。
 */
import { DatabaseSync } from 'node:sqlite'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 内置图库根目录：插件包内 memes/<id>/（含 official-001、dafeiyu-001）。 */
export function bundledPacksDir() {
  return fileURLToPath(new URL('./memes', import.meta.url))
}

/** 内置默认图库根：随插件分发的 memes/dafeiyu-001（大肥鱼）。可用 memeRoot 覆盖。 */
export function defaultMemeRoot() {
  return join(bundledPacksDir(), 'dafeiyu-001')
}

/** 用户导入/自建图库的扫描目录。 */
export function defaultPacksDir() {
  return join(process.env.HOME || '.', '.dsh', 'meme-packs')
}

export function isPackDir(dir) {
  try {
    return statSync(dir).isDirectory() && existsSync(join(dir, 'index.db'))
  } catch {
    return false
  }
}

/** 读 manifest + 张数。id 以文件夹名为准(切换键稳定)。 */
export function readPackMeta(dir, id = basename(dir), source = 'custom') {
  let name = id
  let description = ''
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    if (m && m.name) name = String(m.name)
    if (m && m.description) description = String(m.description)
  } catch { /* 无 manifest 也能当包用 */ }
  let count = 0
  try {
    const db = new DatabaseSync(join(dir, 'index.db'), { readOnly: true })
    count = Number(db.prepare('SELECT COUNT(*) AS n FROM memes').get().n) || 0
    db.close()
  } catch { /* 空库或坏库 */ }
  return { id, name, description, count, path: resolve(dir), source }
}

/**
 * 扫描可切换图库:插件内置 memes/* + 用户扫描目录子文件夹。
 * 同 id 时用户目录覆盖内置(方便自己改官方包)。
 */
export function scanPacks(packsDir = defaultPacksDir()) {
  const byId = new Map()
  const addFrom = (parent, source) => {
    if (!parent || !existsSync(parent)) return
    let names
    try { names = readdirSync(parent) } catch { return }
    for (const name of names) {
      const dir = join(parent, name)
      if (!isPackDir(dir)) continue
      byId.set(name, readPackMeta(dir, name, source))
    }
  }
  addFrom(bundledPacksDir(), 'bundled')
  addFrom(packsDir, 'user')
  return [...byId.values()]
}

/** 设置 packId > memeRoot > patch config > 内置默认。 */
export function resolveActiveRoot(settings = {}, configRoot) {
  const packs = scanPacks(settings.packsDir || defaultPacksDir())
  const packId = String(settings.packId || '').trim()
  if (packId && packId !== '_custom') {
    const hit = packs.find((p) => p.id === packId)
    if (hit) return hit.path
  }
  if (settings.memeRoot) return settings.memeRoot
  if (configRoot) return configRoot
  return defaultMemeRoot()
}

/** 热切换时工具闭包仍指向同一对象:replace 内部 store。 */
export function liveStore(store) {
  const box = {
    get root() { return box._s.root },
    list(...a) { return box._s.list(...a) },
    sampleMood(...a) { return box._s.sampleMood(...a) },
    resolveStored(...a) { return box._s.resolveStored(...a) },
    replace(next) { box._s = next },
  }
  box._s = store
  return box
}

/** 模型只认这 6 个情绪桶;磁盘上仍是细 tag(路径不改)。 */
const MOODS = {
  happy: ['happy', 'like', 'meow', 'givemoney', 'color'],
  angry: ['angry', 'fool', 'baka'],
  sad: ['sad', 'sigh'],
  shy: ['shy'],
  confused: ['confused', 'surprised', 'see'],
  daily: ['daily', 'sleep', 'morning', 'work', 'cpu', 'reply'],
}

const MOOD_WORDS = {
  happy: '开心 高兴 兴奋 喜欢 卖萌 可爱 比心 哈哈 欢迎 得意 好耶 满意',
  angry: '生气 愤怒 暴躁 笨蛋 傻瓜 嫌弃 逮',
  sad: '难过 哭 委屈 叹气 无语 求饶 怂 晕',
  shy: '害羞 腼腆 脸红 花痴',
  confused: '困惑 疑惑 惊讶 问号 懵 惊吓 震惊',
  daily: '困 睡觉 早上好 打招呼 你好 上班 下班 摸鱼 工作 熬夜 吃饭 干饭 饿 日常',
}

export function moodNames() {
  return Object.keys(MOODS)
}

function fineTagsFor(tag) {
  const t = String(tag || '').trim().toLowerCase()
  if (!t) return null
  if (MOODS[t]) return MOODS[t]
  for (const fine of Object.values(MOODS)) {
    if (fine.includes(t)) return [t]
  }
  return [t]
}

const MOOD_DICT =
  'happy 开心(卖萌/可爱/喜欢) / angry 生气 / sad 难过(无语/求饶) / shy 害羞 / confused 困惑惊讶 / daily 日常(睡觉/上班/早上好)'

function moodsFromQuery(text) {
  const hit = []
  for (const [mood, words] of Object.entries(MOOD_WORDS)) {
    if (words.split(/\s+/).some((w) => w && text.includes(w))) hit.push(mood)
  }
  return hit
}

/** tag 优先;否则用 query 里的口语词推断情绪。 */
export function resolveMood(tag, query) {
  const t = String(tag || '').trim().toLowerCase()
  if (t) {
    if (MOODS[t]) return t
    for (const [mood, fine] of Object.entries(MOODS)) {
      if (fine.includes(t)) return mood
    }
  }
  const q = String(query || '').trim().toLowerCase()
  if (!q) return null
  if (MOODS[q]) return q
  return moodsFromQuery(q)[0] || null
}

function pickRandom(rows, n) {
  const copy = rows.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }
  return copy.slice(0, n)
}

export class MemesStore {
  constructor(root = defaultMemeRoot()) {
    this.root = resolve(root)
    const indexPath = join(this.root, 'index.db')
    if (!existsSync(indexPath)) {
      throw new Error('缺少表情包索引: ' + indexPath)
    }
    this.db = new DatabaseSync(indexPath, { readOnly: true })
  }

  /** 列表情包:tag 为情绪桶或细分类;query 只做 caption/keywords 子串(管理面板用)。 */
  list(tag, query) {
    const rows = this.db
      .prepare('SELECT path, tag, file_name, caption, COALESCE(keywords, \'\') AS keywords FROM memes')
      .all()
    const tags = moodNames()
    let memes = rows
    const fine = fineTagsFor(tag)
    if (fine) memes = memes.filter((m) => fine.includes(m.tag))
    const q = query && String(query).trim().toLowerCase()
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean)
      memes = memes.filter((m) => {
        const hay = (m.tag + ' ' + (m.caption ?? '') + ' ' + (m.keywords ?? '')).toLowerCase()
        return tokens.some((t) => hay.includes(t))
      })
    }
    return { memes, tags }
  }

  /** 按情绪取池,随机抽 n 张给模型看 caption。 */
  sampleMood(tag, query, n = 5) {
    const mood = resolveMood(tag, query)
    if (!mood) return { mood: null, memes: [], tags: moodNames() }
    const { memes } = this.list(mood)
    return { mood, memes: pickRandom(memes, n), tags: moodNames() }
  }

  /** 把索引内相对路径解析为绝对路径(不允许逃出图库根)。 */
  resolveStored(stored) {
    const target = resolve(this.root, stored)
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error('路径超出表情包目录')
    }
    if (!existsSync(target)) {
      throw new Error('文件不存在: ' + stored)
    }
    return target
  }
}

/**
 * 注册 send_meme 工具。
 *
 * 两种模式:
 * - Web 模式(无 QQ 通道,有 urlPrefix):只保留 search——随机抽候选,
 *   模型挑一张把 [表情: 描述] 写进回复,前端按描述配图,
 *   不需要冗余的 send 动作;
 * - QQ 模式(companionQq 可用):两步式,action=send 才是真正的投递动作。
 *
 * @param {object} ctx 插件上下文
 * @param {MemesStore} memes 图库
 * @param {(path: string, caption?: string) => void | null} sendImage QQ 通道发送
 *   (dsh-companion 的 companionQq.sendImage);传 null 时走 web 模式。
 * @param {string | null} urlPrefix webServer 图片路由前缀(如 '/dsh-memes'),无则 null
 */
function clampLimit(n) {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x)) return 8
  return Math.max(1, Math.min(20, Math.floor(x)))
}

export function registerSendMemeTool(ctx, memes, sendImage, urlPrefix = null) {
  const webMode = !sendImage && !!urlPrefix

  const parameters = {
    tag: {
      type: 'string',
      description: '先选情绪(必填优先): ' + MOOD_DICT + '。没特定情绪用 happy。',
    },
    query: {
      type: 'string',
      description: '可选。没传 tag 时用来推断情绪(如「害羞」「生气」),不要一长串。',
    },
    limit: {
      type: 'number',
      description: '本次随机抽几张候选(1-20,默认 8)。拿不准就多抽点;不满意再 search 换一批。',
    },
  }
  if (!webMode) {
    parameters.action = {
      type: 'string',
      enum: ['search', 'send'],
      description: 'search: 按情绪随机抽候选; send: 发送挑中的 path',
    }
    parameters.path = { type: 'string', description: 'send 时要发的图路径(来自 search 候选列表)' }
  }

  ctx.tools.register(defineTool({
    name: 'send_meme',
    description: '发一张表情包。流程:根据对话选一个情绪 tag → 系统从该情绪随机抽若干张(带 caption,数量用 limit 自己定) → 看描述觉得贴就发;不满意就再 search 同一 tag(会换一批),还是不行再换情绪或回文字。' +
      '情绪字典: ' + MOOD_DICT + '。' +
      (webMode
        ? '挑中后把 [表情: 描述] 原样写进回复(描述必须抄候选原文,不要带网址)——自己编的描述前端配不上图。'
        : '两步:search 看候选,再用 send + path 发出。') +
      '气氛对了就主动发;发完短接,让图自己说话。',
    parameters,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    execute(args) {
      const action = webMode ? 'search' : (args.action === 'send' ? 'send' : 'search')
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : ''
      const path = typeof args.path === 'string' ? args.path.trim() : ''
      const limit = clampLimit(args.limit)

      if (action === 'send') {
        if (!path) {
          return { ok: false, message: 'send 需要 path——先 search 看候选,再挑一张发' }
        }
        let absolute
        try {
          absolute = memes.resolveStored(path)
        } catch (error) {
          return { ok: false, message: '未知路径: ' + path + ' —— 用 search 的候选 path' }
        }
        if (sendImage) {
          try {
            sendImage(absolute)
            return { ok: true, message: '已发送表情包', path }
          } catch (error) {
            return { ok: false, message: '发送失败: ' + (error instanceof Error ? error.message : String(error)) }
          }
        }
        return { ok: false, message: '没有可用发送通道: ' + absolute }
      }

      const { mood, memes: candidates, tags } = memes.sampleMood(tag, query, limit)
      if (!mood) {
        return {
          ok: false,
          message: '先选一个情绪 tag 再搜。字典: ' + MOOD_DICT,
        }
      }
      if (candidates.length === 0) {
        return {
          ok: false,
          message: '情绪「' + mood + '」下没有图。换一个: ' + MOOD_DICT,
        }
      }
      const lines = candidates.map((m, i) => {
        const caption = (m.caption || m.file_name).slice(0, 80)
        return webMode
          ? (i + 1) + '. [表情: ' + caption + ']'
          : (i + 1) + '. path=' + m.path + ' | [' + m.tag + '] ' + caption
      })
      return {
        ok: true,
        mood,
        hits: webMode
          ? candidates.map((m) => ({ caption: (m.caption || m.file_name).slice(0, 80) }))
          : candidates.map((m) => ({ path: m.path, tag: m.tag, caption: m.caption })),
        tags,
        message: '情绪 ' + mood + ' 随机 ' + candidates.length + ' 张。看 caption 贴就发;不满意再 search 同一 tag 换一批(可加大 limit)。' +
          (webMode
            ? '发图:把下面某一行的 [表情: ...] 整段原样写进回复(描述抄候选原文,可加一两句文字,不要加网址)。'
            : '用 send + path 发出。') + '\n' + lines.join('\n'),
      }
    },
  }))
}
