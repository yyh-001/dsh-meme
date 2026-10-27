/**
 * 表情包存储与搜索(dsh-expression 插件)。
 *
 * 模型侧两种搜法:①按 6 个情绪桶选 tag,从桶里随机抽若干张;②按关键词
 * 在 caption/关键词/图名里子串搜(全部关键词命中优先)。两个都给 = 在该
 * 情绪里筛关键词。候选都带 caption,模型看描述觉得贴再发。
 */
import { DatabaseSync } from 'node:sqlite'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 内置图库根目录：插件包内 memes/<id>/（随包分发的只有 dafeiyu-001）。 */
export function bundledPacksDir() {
  return fileURLToPath(new URL('./memes', import.meta.url))
}

/**
 * dsh 的 home 目录(设置/图库扫描目录的根)。
 * 用 os.homedir() 而不是 process.env.HOME:Windows 上通常没有 HOME,
 * 回落成 '.' 会让设置文件和扫描目录跟着 CWD 走(历史 bug:.dsh\meme-packs 变相对路径)。
 * 测试用 DSH_MEME_HOME 覆盖到临时目录。
 */
export function dshHome() {
  return process.env.DSH_MEME_HOME || homedir()
}

/** 内置默认图库根：随插件分发的 memes/dafeiyu-001（大肥鱼）。可用 memeRoot 覆盖。 */
export function defaultMemeRoot() {
  return join(bundledPacksDir(), 'dafeiyu-001')
}

/** 用户导入/自建图库的扫描目录。 */
export function defaultPacksDir() {
  return join(dshHome(), '.dsh', 'meme-packs')
}

/**
 * 本插件包自己的根目录。
 * 装成插件时就是 `node_modules/dsh-meme`;插件市场更新会用 pnpm 把整个目录改名替换。
 * @param {string} [fromDir] 测试用:以某个目录作为「插件包根」,不传则按本模块位置推。
 */
export function pluginPackageDir(fromDir) {
  return fromDir ? resolve(fromDir) : resolve(bundledPacksDir(), '..')
}

/**
 * dir 是否落在插件包目录里。
 *
 * 为什么关心这件事:内置图库在 `<插件包>/memes/<id>` 里,用户在上面学图/上传时
 * 插件会写这个目录。Windows 上目录里只要有打开的文件句柄,`rename` 该目录(或它的
 * 祖先)就报 `EPERM`;而 pnpm 更新正是 rename 整个包目录 → 插件更新失败(issue #43)。
 * 包内路径上的 SQLite 连接一律不常驻,见 openIndexWriter。
 * @param {string} dir 要判断的目录
 * @param {string} [packageDir] 插件包根目录(默认按本模块位置推;测试可传)
 */
export function isInsidePluginPackage(dir, packageDir) {
  try {
    const target = resolve(dir)
    const pkg = pluginPackageDir(packageDir)
    return target === pkg || target.startsWith(pkg + sep)
  } catch {
    return false
  }
}

/**
 * 删除图库时该删哪个目录。只认两种路径,别的一律拒绝(防越界/防误删):
 * - 内置包:插件包内 `memes/<id>`
 * - 用户包:扫描目录子树里一个真正的包目录(`<packsDir>/<id>`,或历史遗留的嵌套包)
 * @param {{id?: string, path?: string, source?: string}} pack listAllPacks() 的一项
 * @param {string} packsDir 当前扫描目录
 */
export function packDeleteDir(pack, packsDir) {
  const id = String((pack && pack.id) || '').trim()
  if (!pack || !pack.path || !id) throw new Error('图库信息不完整')
  const dir = resolve(pack.path)
  if (pack.source === 'bundled') {
    if (dir !== resolve(join(bundledPacksDir(), id))) throw new Error('图库目录与预期不符,已拒绝删除')
    return dir
  }
  // 用户包:以前只认 `<packsDir>/<id>` 这一层,于是历史遗留的嵌套包(见 scanPacks)
  // 能列在设置页里却删不掉。放宽成「packsDir 子树 + 目录名正好是包 id」,多层嵌套可删,
  // 但仍然碰不到扫描目录本身,也删不到扫描目录外面的任何东西。
  const root = resolve(String(packsDir || ''))
  if (!root) throw new Error('图库目录无效,已拒绝删除')
  if (dir === root) throw new Error('这个图库就是当前的「图库目录」本身,请先把它改到上级目录再删')
  if (basename(dir) === id && dir.startsWith(root + sep)) return dir
  throw new Error('图库目录与预期不符,已拒绝删除')
}

/**
 * 模型可以用的图库 id 列表(设置页每张卡片上的开关)。
 * 没设置过 `enabledPacks` 时只算当前图库——保持「装完即用」的旧行为,
 * 用户一旦拨过开关就以显式列表为准(可以同时开多个)。
 * 已删除/已卸载的 id 会被过滤掉。
 */
export function enabledPackIds(settings = {}, packs = [], activeId = '') {
  const saved = Array.isArray(settings.enabledPacks) ? settings.enabledPacks.map(String) : null
  if (saved === null) return activeId ? [activeId] : []
  const alive = new Set(packs.map((p) => p.id))
  return saved.filter((id) => alive.has(id))
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
  let version = ''
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    if (m && m.name) name = String(m.name)
    if (m && m.description) description = String(m.description)
    if (m && m.version) version = String(m.version)
  } catch { /* 无 manifest 也能当包用 */ }
  let count = 0
  let cover = ''
  try {
    const db = new DatabaseSync(join(dir, 'index.db'), { readOnly: true })
    count = Number(db.prepare('SELECT COUNT(*) AS n FROM memes').get().n) || 0
    // 封面用图库自己的一张图(相对路径),装完的那份就在本地,不必再拉远程预览图。
    // 取法固定:优先 happy 桶里字典序第一张,保证同一图库每次算出来同一张。
    const row = db.prepare("SELECT path FROM memes ORDER BY (tag = 'happy') DESC, path ASC LIMIT 1").get()
    if (row && row.path) cover = String(row.path)
    db.close()
  } catch { /* 空库或坏库 */ }
  return { id, name, description, version, count, cover, path: resolve(dir), source }
}

/**
 * 扫描可切换图库:插件内置 memes/* + 用户扫描目录下的一层子文件夹。
 * 同 id 时用户目录覆盖内置(方便自己改官方包),同层里顶层优先。
 *
 * 历史遗留(issue #23):扫描目录被设成某个包目录自己时(设置页「选择目录」很容易点到包
 * 文件夹),之后导入的包会嵌在那个包里面 → `memes/<主库>/<子库>/index.db`。这不是设计内的
 * 布局,但已经躺在用户磁盘上了,所以这里额外容忍两种形状,免得图库「在磁盘上却扫不到」:
 *   1. 扫描目录本身就是包 → 也当包收进来,否则它自己会从列表里消失(比嵌套更迷惑)
 *   2. 包目录下再嵌一层包 → 一起收(顶层优先,同 id 不覆盖)
 * 新导入不会再生成这种布局:setPacksDir 拒绝把包目录当扫描目录。
 */
export function scanPacks(packsDir = defaultPacksDir()) {
  const byId = new Map()
  const addPack = (dir, id, source) => {
    if (!id || byId.has(id)) return
    byId.set(id, readPackMeta(dir, id, source))
  }
  const addFrom = (parent, source) => {
    if (!parent || !existsSync(parent)) return
    if (isPackDir(parent)) addPack(parent, basename(parent), source)
    let names
    try { names = readdirSync(parent) } catch { return }
    for (const name of names) {
      const dir = join(parent, name)
      if (!isPackDir(dir)) continue
      addPack(dir, name, source)
      let subs
      try { subs = readdirSync(dir) } catch { continue }
      for (const sub of subs) {
        const subdir = join(dir, sub)
        if (!isPackDir(subdir)) continue
        addPack(subdir, sub, source)
      }
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
  // 记住的 memeRoot 可能已经不存在了(比如内置包在升级后被移除/用户删掉了图库目录)。
  // 这里只认真正有 index.db 的目录,否则一路回落到内置默认包——历史教训:把死路径
  // 传给 MemesStore 会抛错,调用方 return,整个插件都装不起来。
  if (settings.memeRoot && isPackDir(settings.memeRoot)) return settings.memeRoot
  if (configRoot && isPackDir(configRoot)) return configRoot
  return defaultMemeRoot()
}

/** 热切换时工具闭包仍指向同一对象:replace 内部 store。 */
export function liveStore(store) {
  const box = {
    get root() { return box._s.root },
    list(...a) { return box._s.list(...a) },
    search(...a) { return box._s.search(...a) },
    sampleMood(...a) { return box._s.sampleMood(...a) },
    resolveStored(...a) { return box._s.resolveStored(...a) },
    /** 写库之后刷新内存索引快照(store 内部已关闭连接,不再有长期句柄,#43)。 */
    refresh() { if (typeof box._s.refresh === 'function') box._s.refresh() },
    replace(next) {
      const prev = box._s
      box._s = next
      if (prev && prev !== next && typeof prev.close === 'function') prev.close()
    },
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

/** 关键词分词:空格/逗号/顿号/斜杠分隔,小写去重。中文词整词先搜,不预先切。 */
export function keywordTokens(query) {
  const raw = String(query || '').trim().toLowerCase()
  if (!raw) return []
  return [...new Set(raw.split(/[\s,，、;；/|]+/).filter(Boolean))]
}

/** 整词全都没命中时的兜底拆词:「生气猫」→ 生气 / 气猫。 */
function biGrams(tokens) {
  const out = []
  for (const t of tokens) {
    if (t.length < 3 || !/[\u4e00-\u9fff]/.test(t)) continue
    for (let i = 0; i + 2 <= t.length; i++) out.push(t.slice(i, i + 2))
  }
  return [...new Set(out)]
}

/** keywords 的分词(与 keywordTokens 同分隔符,但保留原大小写:清洗后要原样写回) */
const keywordWords = (s) => String(s || '').split(/[\s,，、;；/|]+/).filter(Boolean)

/**
 * 高频关键词清洗(issue #30 附带的建议)。
 *
 * 外部图库常把「角色大标签」写进每一条的 keywords:deepseek-chan 里 4 个词各出现在
 * 1407/1407 条,搜「GPT」于是命中全库(official-001 的「表情包」占 70%、dafeiyu-001 的
 * 「大肥鱼」占 100%,同类)。判定原则:出现在 ≥50% 条目里的词对检索零信息量 ——
 * 比维护黑名单通用,导入时算一遍词频就行。
 *
 * 只在条目数 ≥ minRows 时动手:小图库里的重复词往往是真关键词
 * (3 张猫图里的「猫」出现在 100% 条目里,但它是这张库唯一的检索入口)。
 *
 * @param {Array<{keywords?: string}>} rows 全部条目(只需要 keywords)
 * @param {{threshold?: number, minRows?: number}} [opts]
 * @returns {{total: number, drop: string[], cleaned: (string|null)[]}}
 *   drop: 被剔掉的词(小写);cleaned: 每条清洗后的 keywords,没变的条目是 null。
 */
export function pruneCommonKeywords(rows, { threshold = 0.5, minRows = 8 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const total = list.length
  const none = list.map(() => null)
  if (total < minRows) return { total, drop: [], cleaned: none }
  const words = list.map((row) => keywordWords(row && row.keywords))
  const counts = new Map()
  for (const toks of words) {
    for (const w of new Set(toks.map((t) => t.toLowerCase()))) counts.set(w, (counts.get(w) || 0) + 1)
  }
  // 至少有两条会命中才剔:不然「过半」在小样本里可能落到 1 条上
  const floor = Math.max(2, Math.ceil(total * threshold))
  const drop = [...counts].filter(([, n]) => n >= floor).map(([w]) => w)
  if (drop.length === 0) return { total, drop: [], cleaned: none }
  const dropSet = new Set(drop)
  return {
    total,
    drop,
    cleaned: words.map((toks) => {
      const keep = toks.filter((w) => !dropSet.has(w.toLowerCase()))
      return keep.length === toks.length ? null : keep.join(' ')
    }),
  }
}

/**
 * 对已落盘的图库做一次高频关键词清洗(导入/安装流程调用)。
 * 只改 keywords 字段,图片和其它字段都不动;这是检索质量的增强,失败不该拖垮安装,
 * 所以调用方一律 try/catch。
 * @returns {{drop: string[], changed: number}} 剔掉的词与改动的条目数
 */
export function prunePackKeywords(indexPath, opts) {
  const db = new DatabaseSync(indexPath)
  try {
    const rows = db.prepare("SELECT rowid AS rid, COALESCE(keywords, '') AS keywords FROM memes").all()
    const { drop, cleaned } = pruneCommonKeywords(rows, opts)
    if (drop.length === 0) return { drop: [], changed: 0 }
    let changed = 0
    const update = db.prepare('UPDATE memes SET keywords = ? WHERE rowid = ?')
    for (let i = 0; i < rows.length; i++) {
      if (cleaned[i] === null) continue
      update.run(cleaned[i], rows[i].rid)
      changed++
    }
    return { drop, changed }
  } finally {
    db.close()
  }
}

const rowHay = (row) => (
  (row.tag || '') + ' ' + (row.caption || '') + ' ' + (row.keywords || '') + ' ' + (row.file_name || '')
).toLowerCase()

/**
 * 关键词搜图(纯函数:面板/工具/跨图库合并共用)。
 * 排序:全部关键词都命中的优先;没有全命中就取命中词数最多的那一档;
 * 同一档内随机——同一个词反复 search 能换一批,不会每次都撞同一张。
 * @returns {{query: string, tokens: string[], memes: object[]}}
 */
export function searchRows(rows, query, limit = 8) {
  const tokens = keywordTokens(query)
  if (tokens.length === 0) return { query: '', tokens: [], memes: [] }
  const scan = (words) => {
    const hits = []
    for (const row of rows) {
      const hay = rowHay(row)
      let score = 0
      for (const w of words) if (hay.includes(w)) score++
      if (score > 0) hits.push({ row, score })
    }
    return hits
  }
  let hits = scan(tokens)
  if (hits.length === 0) {
    const grams = biGrams(tokens)
    if (grams.length) hits = scan(grams)
  }
  if (hits.length === 0) return { query: tokens.join(' '), tokens, memes: [] }
  const best = Math.max(...hits.map((h) => h.score))
  return {
    query: tokens.join(' '),
    tokens,
    memes: pickRandom(hits.filter((h) => h.score === best).map((h) => h.row), limit),
  }
}

/** 图库索引的读取语句(内存快照和一次性读取共用)。 */
const SELECT_ROWS = 'SELECT path, tag, file_name, caption, COALESCE(keywords, \'\') AS keywords FROM memes'

/**
 * 图库索引(只读检索)。
 *
 * issue #43:以前这里在构造时打开 SQLite 连接并**一直持有**。插件默认激活内置图库
 * (`<插件包>/memes/dafeiyu-001`),它就在 npm 包目录里;Windows 上只要目录里还有
 * 打开的文件,`rename` 该目录就会 EPERM/EBUSY,而插件市场更新正是用 pnpm 把
 * `node_modules/dsh-meme` 整个目录改名替换 → 更新失败(`ERR_PNPM_EPERM ... rename`)。
 * 现在构造时一次性把索引读进内存并立刻关掉连接;写操作由 openIndexWriter 落盘后
 * 调 refresh() 刷新快照。索引只有几千行(947K 的图库,索引本身几百 KB),
 * 常驻内存的代价可以忽略,换来的好处是插件运行期**不占用图库文件**。
 */
export class MemesStore {
  constructor(root = defaultMemeRoot()) {
    this.root = resolve(root)
    if (!existsSync(join(this.root, 'index.db'))) {
      throw new Error('缺少表情包索引: ' + join(this.root, 'index.db'))
    }
    this.rows = this.readRows()
  }

  /** 一次性读全表并关闭连接(不在磁盘上留长连接)。 */
  readRows() {
    const db = new DatabaseSync(join(this.root, 'index.db'), { readOnly: true })
    try {
      return db.prepare(SELECT_ROWS).all()
    } finally {
      try { db.close() } catch { /* 已关闭 */ }
    }
  }

  /** 写操作(openIndexWriter)落盘后刷新内存快照,否则校验/搜图还看到旧数据。 */
  refresh() {
    this.rows = this.readRows()
  }

    /**
     * 列表情包:tag 为情绪桶或细分类;query 只做 caption/keywords 子串(管理面板用)。
     * exact = true 时按 tag 精确匹配、不做情绪桶展开——管理面板的分类下拉列的是
     * 图库里真实的 tag,选「开心」却混进 like/meow 的桶展开行为会把用户搞糊涂(用户反馈)。
     */
    list(tag, query, exact = false) {
      const rows = this.rows
      const tags = moodNames()
      let memes = rows
      if (exact && tag) {
        memes = memes.filter((m) => m.tag === String(tag).trim().toLowerCase())
      } else {
        const fine = fineTagsFor(tag)
        if (fine) memes = memes.filter((m) => fine.includes(m.tag))
      }
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

  /**
   * 关键词搜图。给了 tag 就先把范围限在那个情绪桶里(细 tag 展开同 list),
   * 于是「情绪 + 关键词」= 在桶里筛词。
   * @returns {{query: string, tokens: string[], memes: object[], tags: string[]}}
   */
  search(query, n = 8, tag = null) {
    const rows = this.rows
    const fine = fineTagsFor(tag)
    const scoped = fine ? rows.filter((m) => fine.includes(m.tag)) : rows
    return { ...searchRows(scoped, query, n), tags: moodNames() }
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

  /** 接口保留:连接已在构造时关闭,热切换时调用 close() 不需要额外动作。 */
  close() {}
}

/**
 * 图库索引的**可写**连接(管理 API 上传/删除、learn_meme 学图用)。
 *
 * 用户图库(~/.dsh/meme-packs)保持常驻连接,和以前一样省去每次开关库的开销。
 * 插件包内的图库则绝不常驻:更新时 pnpm 要 rename 整个包目录,Windows 上目录里
 * 只要有打开的文件就会 EPERM(#43)。这类目录改成每条语句临时 open→执行→close,
 * 写完立刻释放;对调用方暴露的 prepare/exec/close 接口保持不变。
 *
 * @param {string} root 图库根目录
 * @param {{packageDir?: string}} [opts] packageDir 供测试指定「插件包根」,默认按本模块位置推
 */
export function openIndexWriter(root, opts = {}) {
  const dir = resolve(root)
  const indexPath = join(dir, 'index.db')
  // 用户图库(包外):维持常驻可写连接。
  if (!isInsidePluginPackage(dir, opts.packageDir)) {
    const db = new DatabaseSync(indexPath)
    return {
      prepare: (...args) => db.prepare(...args),
      exec: (...args) => db.exec(...args),
      close: () => { try { db.close() } catch { /* 已关闭 */ } },
    }
  }
  // 插件包内:每条语句开、关一次,插件运行期不占包内文件。
  const withDb = (fn) => {
    const db = new DatabaseSync(indexPath)
    try {
      return fn(db)
    } finally {
      try { db.close() } catch { /* 已关闭 */ }
    }
  }
  const statement = (sql) => ({
    run: (...args) => withDb((db) => db.prepare(sql).run(...args)),
    get: (...args) => withDb((db) => db.prepare(sql).get(...args)),
    all: (...args) => withDb((db) => db.prepare(sql).all(...args)),
  })
  return {
    prepare: statement,
    exec: (sql) => withDb((db) => db.exec(sql)),
    close: () => { /* 无常驻连接 */ },
  }
}

/**
 * 已知 IM 渠道的 id(rpcId 前缀)。与 @xmanrui/dsh-im 的 channel 列表保持一致:
 * 它给每条进来的消息写 `source.rpcId = <channel>-<uuid>`(steer 消息是
 * `<channel>-steer-<uuid>`),旧版还会把 `<channel>-` 直接拼进会话 id。
 * dsh-im 将来加渠道时在这里补一项即可,没列到的渠道会退回 Web 的标记模式。
 */
export const IM_CHANNEL_PREFIXES = Object.freeze([
  'weixin', 'feishu', 'dingtalk', 'wecom', 'wecomapp', 'qq', 'slack', 'telegram',
  'discord', 'whatsapp', 'imessage', 'matrix', 'email', 'office',
])

/** IM 渠道 id → 展示名(写进提示词/工具结果,让模型知道当前是哪个聊天软件)。 */
export const IM_CHANNEL_LABELS = Object.freeze({
  weixin: '微信',
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企业微信',
  wecomapp: '企业微信应用',
  qq: 'QQ',
  slack: 'Slack',
  telegram: 'Telegram',
  discord: 'Discord',
  whatsapp: 'WhatsApp',
  imessage: 'iMessage',
  matrix: 'Matrix',
  email: '邮件',
  office: 'AI Office',
})

const IM_UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const IM_RPC_ID_RE = new RegExp('^(' + IM_CHANNEL_PREFIXES.join('|') + ')-(?:steer-)?' + IM_UUID_PATTERN + '$', 'u')
const IM_LEGACY_SESSION_ID_RE = new RegExp('^(' + IM_CHANNEL_PREFIXES.join('|') + ')-.+', 'u')

function sessionEventsOf(session) {
  const events = typeof session?.snapshotEvents === 'function'
    ? session.snapshotEvents()
    : session?.events
  return Array.isArray(events) ? events : []
}

/**
 * 这个会话当前这一轮是不是从 IM(dsh-im 的 QQ/微信/飞书…)进来的,是则返回渠道 id。
 *
 * 判据取「最后一条真实用户消息」的 rpcId 前缀,而不是扫全会话:同一个会话
 * 可以在 Web 里创建、后来被 dsh-im 用 `/session` 绑到某个 IM 聊天(会话同步),
 * 那样早先的 Web 消息和后来的 IM 消息会混在同一段日志里——机器人在哪个渠道
 * 回复,取决于这一轮是从哪进来的。Web UI 的 rpcId 是没有渠道前缀的裸 uuid,
 * 于是自然不命中。
 *
 * fork 出来的会话不能继承父会话的渠道(父子消息会混在事件流里),宿主两版
 * Session 都暴露 inheritedEventCount,拿不到就不猜。
 */
export function imChannelOfSession(session) {
  if (!session || typeof session !== 'object') return null
  try {
    const header = session.header && typeof session.header === 'object' ? session.header : null
    const inherited = session.inheritedEventCount
    if (header?.parentSession && !Number.isSafeInteger(inherited)) return null
    const events = sessionEventsOf(session)
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (!event || event.type !== 'user/message') continue
      if (Number.isSafeInteger(inherited) && Number.isSafeInteger(event.seq) && event.seq < inherited) continue
      const source = event.data && event.data.source
      if (!source || source.kind !== 'user') continue
      const rpcId = String(source.rpcId || '')
      if (!rpcId) continue
      const hit = IM_RPC_ID_RE.exec(rpcId)
      if (hit) return hit[1]
      // 最近一条用户消息有 rpcId、但没命中 IM 前缀:这一轮来自 Web/其他来源
      return null
    }
    if (header?.parentSession) return null
    // 旧版 dsh-im 把渠道写进会话 id;新版 id 是纯 uuid,只能靠上面的 rpcId
    const id = typeof session.id === 'string'
      ? session.id
      : typeof session.sessionId === 'string' ? session.sessionId : ''
    const legacy = IM_LEGACY_SESSION_ID_RE.exec(id)
    return legacy ? legacy[1] : null
  } catch {
    // 宿主会话对象处于半初始化/已释放状态时不能连累系统提示装配
    return null
  }
}

/**
 * AI 的发送方式(设置页「发送方式」下拉框):
 * - auto(默认):按渠道自动——Web 写 [表情: 描述] 由前端配图,IM 会话改走 dsh_im_return_file;
 * - text:纯文字,不发表情图片(仍可查候选,但只用文字描述/接梗);
 * - image:总是发图——Web 写标记,IM 必须调 dsh_im_return_file。
 * 只影响 AI 怎么发,不改前端把 [表情: 描述] 配成图的渲染逻辑。
 */
export const SEND_MODES = ['auto', 'text', 'image']
export function normalizeSendMode(value) {
  return SEND_MODES.includes(value) ? value : 'auto'
}

/**
 * 表情排布方式(设置页「表情排布」下拉框,issue #50):
 * - inline(默认):图与正文并排——图提到消息行行首,正文在右,短消息紧凑;
 * - stacked:图独占一行在上,正文按正常宽度铺开在下,阅读宽度完整。
 * 只影响前端把 [表情: 描述] 渲染成图后的排布,默认保持并排不改已有用户观感。
 */
export const LAYOUT_MODES = ['inline', 'stacked']
export function normalizeLayoutMode(value) {
  return LAYOUT_MODES.includes(value) ? value : 'inline'
}

// ---- 用户收藏的稳定落点与图库目录扫描 ----

/** 扫描/收录认可的图片扩展(与上传、AI 学图一致) */
export const SCAN_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp']

const SCAN_TAG_RE = /^[a-z0-9_-]+$/

/**
 * 手动放进图库目录的图片 → 索引行(扫描入库用,纯函数便于单测)。
 * 分类取路径首段目录名(memes/<tag>/x.jpg → <tag>,<tag>/x.jpg → <tag>);
 * 首段不是合法 tag、或图片散在根目录 → misc。path 保持磁盘上的真实相对路径
 * (图片路由按索引 path 找文件,不能为了格式好看改写)。描述兜底用文件名去扩展名。
 */
export function scanRowFor(rel) {
  const posix = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const body = posix.startsWith('memes/') ? posix.slice('memes/'.length) : posix
  const segs = body.split('/').filter(Boolean)
  const file = segs[segs.length - 1] || ''
  const tag = segs.length >= 2 && SCAN_TAG_RE.test(segs[0]) ? segs[0] : 'misc'
  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  return { path: posix, tag, file_name: file, caption: stem.slice(0, 200) }
}

/**
 * 递归列出图库目录下的图片文件(相对 root 的 posix 路径),跳过 index.db、
 * manifest.json 与隐藏目录。用户「自己塞进文件夹」的图从这里入库:原始字节
 * 原样保留——聊天附件通道会把 GIF 压成单帧,磁盘文件不会。
 */
export function walkPackImages(root) {
  const out = []
  const walk = (dir, prefix) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'manifest.json' || e.name.startsWith('index.db')) continue
      const abs = join(dir, e.name)
      const rel = prefix ? prefix + '/' + e.name : e.name
      if (e.isDirectory()) { walk(abs, rel); continue }
      if (!e.isFile()) continue
      const dot = e.name.lastIndexOf('.')
      const ext = dot >= 0 ? e.name.slice(dot).toLowerCase() : ''
      if (SCAN_IMAGE_EXTS.includes(ext)) out.push(rel)
    }
  }
  walk(resolve(root), '')
  return out.sort()
}

/**
 * 确保一个最小图库存在于 dir(manifest.json + 空 index.db),已存在则不动。
 * 给「我的收藏」这类程序化创建的稳定图库用。
 */
export function ensurePackAt(dir, meta) {
  mkdirSync(dir, { recursive: true })
  const indexPath = join(dir, 'index.db')
  if (!existsSync(indexPath)) {
    const db = new DatabaseSync(indexPath)
    db.exec('CREATE TABLE IF NOT EXISTS memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
    db.close()
  }
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, JSON.stringify({ id: meta.id, name: meta.name, description: String(meta.description || ''), version: '1.0.0' }, null, 2))
  }
  return dir
}

/**
 * 把 src 图库里的指定条目(索引行 + 文件)搬到 dst 图库的 memes/<tag>/ 下,保持分类。
 * 用于把内置图库里用户后加的收藏搬去包外的稳定图库——插件升级会整个替换包目录,
 * 留在里面的用户文件会被清掉。目标撞名时加时间缀;rename 跨盘失败回落 copy+unlink。
 * 返回 { moved: [{from,to}], missing: [...] }(missing = 索引行或文件已不存在)。
 */
export function movePackEntries(srcRoot, dstRoot, paths) {
  const moved = []
  const missing = []
  const src = openIndexWriter(srcRoot)
  const dst = openIndexWriter(dstRoot)
  try {
    for (const rel of paths || []) {
      const row = src.prepare('SELECT tag, file_name, caption, keywords FROM memes WHERE path = ?').get(String(rel))
      const from = join(resolve(srcRoot), String(rel))
      if (!row || !existsSync(from)) { missing.push(String(rel)); continue }
      const tag = SCAN_TAG_RE.test(String(row.tag || '')) ? row.tag : 'misc'
      let name = basename(String(rel))
      let toRel = 'memes/' + tag + '/' + name
      if (existsSync(join(resolve(dstRoot), toRel))) {
        const dot = name.lastIndexOf('.')
        name = (dot > 0 ? name.slice(0, dot) : name) + '_' + Date.now() + (dot > 0 ? name.slice(dot) : '')
        toRel = 'memes/' + tag + '/' + name
      }
      const to = join(resolve(dstRoot), toRel)
      mkdirSync(dirname(to), { recursive: true })
      try { renameSync(from, to) } catch {
        copyFileSync(from, to)
        unlinkSync(from)
      }
      dst.prepare('INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(toRel, tag, name, row.caption || '', row.keywords || '', Date.now(), Date.now())
      src.prepare('DELETE FROM memes WHERE path = ?').run(String(rel))
      moved.push({ from: String(rel), to: toRel })
    }
  } finally {
    try { src.close() } catch { /* 已关闭 */ }
    try { dst.close() } catch { /* 已关闭 */ }
  }
  return { moved, missing }
}

/**
 * 注册 send_meme 工具。
 *
 * 三种模式:
 * - Web 模式(无 QQ 通道,有 urlPrefix):只保留 search——随机抽候选,
 *   模型挑一张把 [表情: 描述] 写进回复,前端按描述配图,
 *   不需要冗余的 send 动作;
 * - IM 模式(Web 模式 + 本轮来自 dsh-im 的 QQ/微信等渠道):候选额外带绝对路径,
 *   IM 聊天不渲染 [表情: 描述] 标记,模型要把挑中的 path 交给 dsh-im 的
 *   `dsh_im_return_file` 作为原生图片发出;
 * - QQ 模式(companionQq 可用):两步式,action=send 才是真正的投递动作。
 *
 * @param {object} ctx 插件上下文
 * @param {MemesStore} memes 图库
 * @param {(path: string, caption?: string) => void | null} sendImage QQ 通道发送
 *   (dsh-companion 的 companionQq.sendImage);传 null 时走 web 模式。
 * @param {string | null} urlPrefix webServer 图片路由前缀(如 '/dsh-memes'),无则 null
 * @param {object} [options]
 * @param {(session: object) => string | null} [options.imChannelOf]
 *   判断某个会话本轮来自哪个 IM 渠道(dsh-im 可用时由 index.js 传入;返回 null = 非 IM 或能力缺失)
 * @param {boolean} [options.imReady] 注册时 dsh-im 是否已在进程内(只影响工具描述措辞)
 * @param {() => string} [options.sendMode] 运行时读发送方式设置(auto/text/image)
 * @param {() => Array<{tag: string, count: number}> | null} [options.tagStats]
 *   跨启用图库的分类统计(按张数降序)。搜索没命中时用它给模型真实的换词建议,
 *   而不是只甩一串静态情绪字典(issue #53)。
 */
function clampLimit(n) {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x)) return 8
  return Math.max(1, Math.min(20, Math.floor(x)))
}

export function registerSendMemeTool(ctx, memes, sendImage, urlPrefix = null, options = {}) {
  const webMode = !sendImage && !!urlPrefix
  const imChannelOf = typeof options.imChannelOf === 'function' ? options.imChannelOf : null
  /** 注册时 dsh-im 是否已在进程内——只决定工具描述要不要提 IM 的发送方式 */
  const imReady = options.imReady === true
  /** 运行时的发送方式设置(auto/text/image):每次执行读一次,设置改了下一条消息就生效 */
  const sendModeOf = typeof options.sendMode === 'function' ? options.sendMode : () => 'auto'
  /** 跨启用图库的分类统计(张数降序);没有就退回静态情绪字典 */
  const tagStatsOf = typeof options.tagStats === 'function' ? options.tagStats : () => null
  /** 没命中时给模型的换词建议:真实分类统计优先,拉不到才用静态情绪字典(issue #53) */
  const tagHint = () => {
    try {
      const stats = tagStatsOf()
      if (Array.isArray(stats) && stats.length > 0) {
        const top = stats.slice(0, 15).map((s) => s.tag + '(' + s.count + ')').join(' / ')
        return '当前启用图库里的分类(按张数): ' + top
      }
    } catch { /* 统计失败退回字典 */ }
    return '情绪字典: ' + MOOD_DICT
  }

  const parameters = {
    tag: {
      type: 'string',
      description: '情绪范围(可选): ' + MOOD_DICT + '。只给 tag = 在该情绪里随机抽;tag + query = 在该情绪里按关键词筛。',
    },
    query: {
      type: 'string',
      description: '关键词(可选,想找特定的图就用它): 按 caption/关键词/图名子串搜,比只抽情绪准。中文词,空格分隔多个(如「猫」「生气 猫」「无语」);整词没命中会自动拆词重试。没给 tag 时,搜不到也会拿它推断情绪。',
    },
    limit: {
      type: 'number',
      description: '本次返回几张候选(1-20,默认 8)。拿不准就多抽点;不满意再 search 换一批。',
    },
  }
  if (!webMode) {
    parameters.action = {
      type: 'string',
      enum: ['search', 'send'],
      description: 'search: 按情绪或关键词取候选; send: 发送挑中的 path',
    }
    parameters.path = { type: 'string', description: 'send 时要发的图路径(来自 search 候选列表)' }
  }

  ctx.tools.register(defineTool({
    name: 'send_meme',
    description: '发一张表情包。两种搜法:①只给 tag(情绪)→ 从该情绪里随机抽;②给 query(关键词)→ 在 caption/关键词/图名里搜,想找特定的图(「猫」「比心」「摸鱼」)就用这个;两个都给 = 在该情绪里按关键词筛,最准。' +
      '流程:给 tag/query → 系统返回若干张候选(带 caption,数量用 limit 自己定) → 看描述觉得贴就发;不满意再 search 换一批,还不行就换词/换情绪或回文字。' +
      '情绪字典: ' + MOOD_DICT + '。' +
      (webMode
        ? (imReady
            ? '发送方式看工具结果末尾的说明:Web 聊天把 [表情: 描述] 原样写进回复(描述抄候选原文,不要带网址);IM(QQ/微信等)聊天调用 dsh_im_return_file 传候选的 path 发原生图片,不要写 [表情: ...] 标记。'
            : '挑中后把 [表情: 描述] 原样写进回复(描述必须抄候选原文,不要带网址)——自己编的描述前端配不上图。')
        : '两步:search 看候选,再用 send + path 发出。') +
      '发送方式以设置里的「发送方式」下拉框为准(自动/纯文字/图片),每次结果末尾的「发图」说明会告诉你怎么发。' +
      '气氛对了就主动发;发完短接,让图自己说话。',
    parameters,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    execute(args, exec) {
      const action = webMode ? 'search' : (args.action === 'send' ? 'send' : 'search')
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : ''
      const path = typeof args.path === 'string' ? args.path.trim() : ''
      const limit = clampLimit(args.limit)
      const sendMode = normalizeSendMode(sendModeOf())
      const textMode = sendMode === 'text'
      const imageMode = sendMode === 'image'

      if (action === 'send') {
        if (textMode) {
          return { ok: false, message: '当前发送方式是「纯文字」,不发图片;直接用文字接梗/描述即可' }
        }
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

      // 这一轮来自 dsh-im 的 IM 渠道时,图片只能作为原生图片发出:
      // [表情: 描述] 标记只有 Web 前端会配图,IM 聊天里它只是一行方括号文字。
      // 所以候选要带上绝对路径,交给 dsh-im 的 dsh_im_return_file 投递。
      const imChannel = !sendImage && imChannelOf ? imChannelOf(exec?.agent?.session) : null
      // 纯文字模式:Web/IM 都不发图;候选不带路径,免得模型顺手把 path 交给投递工具
      const imMode = !textMode && !sendImage && !!imChannel
      const imLabel = imMode ? (IM_CHANNEL_LABELS[imChannel] || 'IM') : ''

      const captionOf = (m) => String(m.caption || m.file_name || '').slice(0, 80)
      /** 候选的绝对路径:IM 投递工具要的是磁盘路径,不能是图库内的相对路径/包前缀路径 */
      const absolutePathOf = (m) => {
        try {
          return memes.resolveStored(m.path)
        } catch {
          return String(m.path || '')
        }
      }
      /** 候选所属图库:跨库合并时 sampler 会给每行标 packName/packId(issue #53) */
      const libraryOf = (m) => String(m.packName || m.packId || '')

      const lines = (rows) => rows.map((m, i) => {
        const caption = captionOf(m)
        // 纯文字模式:只给描述,不给 [表情: …] 标记也不给路径——标记在前端仍会配成图
        if (textMode) return (i + 1) + '. 描述=' + caption + ' | 分类=' + m.tag
        // IM 模式不要用 "[tag] caption" 的方括号样式:模型会照着把方括号抄进回复,
        // 而 IM 客户端只把方括号里的文字显示出来(用户看到的是 [无语死鱼脸] 之类)。
        if (imMode) return (i + 1) + '. path=' + absolutePathOf(m) + ' | 分类=' + m.tag + ' | 描述=' + caption
        return webMode
          ? (i + 1) + '. [表情: ' + caption + ']'
          : (i + 1) + '. path=' + m.path + ' | [' + m.tag + '] ' + caption
      })
      const hits = (rows) => {
        // 出处元信息(issue #53):path/library 进模型可见的 JSON(用户问「这图哪来的」
        // 模型答得上),不进用户可见的行文本——Web 模式行里仍只有 [表情: 描述],
        // 模型不会顺手把路径抄进回复。纯文字模式维持只给描述(路径会诱导投递工具)。
        // absPath:绝对路径,给 QQ 官方机器人(dsh-qqbot 的 qqbot_send_file(file_path))
        // 用——它的路径白名单要求绝对路径;Web 聊天里模型不会用到这个字段。
        if (textMode) return rows.map((m) => ({ tag: m.tag, caption: captionOf(m), library: libraryOf(m) }))
        if (imMode) return rows.map((m) => ({ path: absolutePathOf(m), tag: m.tag, caption: captionOf(m), library: libraryOf(m) }))
        return webMode
          ? rows.map((m) => ({ caption: captionOf(m), path: m.path, absPath: absolutePathOf(m), library: libraryOf(m) }))
          : rows.map((m) => ({ path: m.path, absPath: absolutePathOf(m), tag: m.tag, caption: m.caption, library: libraryOf(m) }))
      }
      const howToSend = textMode
        ? '发图:当前发送方式是「纯文字」,不发图片——不要写 [表情: ...] 或 [任何描述] 这类方括号标记,不要调用 dsh_im_return_file 或 qqbot_send_file,也不要把图片路径贴进回复;把下面某一行「描述=」的原文用进你的文字回复里,接梗/吐槽/卖萌即可。'
        : (imageMode ? '当前发送方式是「图片」:挑好图就必须真的发出去,不能只写文字描述。' : '') +
          (imMode
            ? '发图:把挑中的那一行 path 原样传给 dsh_im_return_file(path=...)——它会作为 ' + imLabel +
              ' 原生图片消息发出;不用等用户要求,现在就能主动发。回复正文只写普通文字:不要写 [表情: ...] 或 [任何描述] 这类方括号标记,不要写 markdown 图片或把本地路径贴进回复,也不用解释图片投递过程——图片会由渠道自己发出。'
            : webMode
              ? '发图:把下面某一行的 [表情: ...] 整段原样写进回复(描述抄候选原文,可加一两句文字,不要加网址)。候选 JSON 里的 path/library 只是出处信息,用户问「这图哪个库的/文件叫什么」可以引用;发图仍然只写 [表情: 描述],不要把路径贴进回复。' +
                '如果本会话的工具表里有 qqbot_send_file(QQ 官方机器人的 dsh-qqbot 插件),说明当前是 QQ 机器人会话:此时不要写 [表情: ...] 标记,把挑中候选的 absPath(绝对路径)原样传给 qqbot_send_file 的 file_path 参数发出,正文只写普通文字、不要贴路径;若它返回路径白名单拒绝,提示用户在 dsh-qqbot 配置的 sendFile.extraRoots 里加上图库目录(通常是 ~/.dsh/meme-packs)。'
              : '用 send + path 发出。')

      // 关键词优先:有关键词就先精确搜(caption/关键词/图名),命中了直接给候选。
      // 全都没命中才退回老路——拿 query 推断情绪随机抽,并在消息里说清是退回来的。
      let keywordMiss = ''
      if (query) {
        const found = memes.search(query, limit, tag)
        if (found.memes.length > 0) {
          return {
            ok: true,
            mode: 'keyword',
            query: found.query,
            hits: hits(found.memes),
            tags: found.tags,
            message: '关键词「' + found.query + '」命中 ' + found.memes.length + ' 张' +
              (tag ? '(限在情绪 ' + tag + ' 里)' : '') +
              '。看 caption 贴就发;不满意再 search(换词或加大 limit)。' +
              howToSend + '\n' + lines(found.memes).join('\n'),
          }
        }
        if (found.reason) return { ok: false, message: found.reason }
        keywordMiss = '关键词「' + (found.query || query) + '」没找到图(caption/关键词里没有这几个词)。'
      }

      const { mood, memes: candidates, tags, reason } = memes.sampleMood(tag, query, limit)
      if (!mood) {
        return {
          ok: false,
          // 换词建议给真实的分类统计(按张数),比静态情绪字典有用得多(issue #53)
          message: reason || (keywordMiss + ' 要么换个更常见的词,要么给个情绪 tag。' + tagHint()),
        }
      }
      if (candidates.length === 0) {
        return {
          ok: false,
          // 没有可用图库时 sampler 会给 reason,直说比「情绪下没有图」清楚
          message: reason || (keywordMiss + '情绪「' + mood + '」下也没有图。换一个: ' + tagHint()),
        }
      }
      return {
        ok: true,
        mode: 'mood',
        mood,
        hits: hits(candidates),
        tags,
        message: (keywordMiss ? keywordMiss + '下面按情绪抽:' : '') +
          '情绪 ' + mood + ' 随机 ' + candidates.length + ' 张。看 caption 贴就发;不满意再 search 同一 tag 换一批(可加大 limit)。' +
          howToSend + '\n' + lines(candidates).join('\n'),
      }
    },
  }))
}
