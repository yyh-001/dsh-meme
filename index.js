/**
 * dsh-meme — selfloom 表情包层作为 DeepSeek Harness 的插件。
 * npm 包名 dsh-meme;插件 id 仍为 dsh-expression(兼容已有安装)。
 *
 * 图库:随插件分发 memes/official-001 与 memes/dafeiyu-001;
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
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import {
  MemesStore, defaultPacksDir, scanPacks, readPackMeta,
  resolveActiveRoot, liveStore, registerSendMemeTool,
} from './memes.js'

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

/** 打包文件列表为 ZIP(store 无压缩):[{name, data}] → Buffer */
function zipStore(files) {
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
function unzipStore(buf) {
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
const ROUTE = '/dsh-memes'

export function apply(ctx, config) {
  // 图库目录设置存 ~/.dsh(稳定,不受包升级/图库变化影响):
  // 优先级 用户设置(settings) > patch 配置(config.memeRoot) > 包内默认
  const settingsFile = join(process.env.HOME || '.', '.dsh', 'dsh-expression.json')
  const readSettings = () => {
    try { return JSON.parse(readFileSync(settingsFile, 'utf8')) } catch (e) { return {} }
  }
  const writeSettings = (patch) => {
    try {
      mkdirSync(join(process.env.HOME || '.', '.dsh'), { recursive: true })
      writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), ...patch }, null, 2))
    } catch (e) {}
  }
  // 陪伴模式提示词:模型主动斗图。设置页可编辑覆盖(settings.companionPrompt)。
  const DEFAULT_COMPANION_PROMPT = '斗图规则:主动斗图,不要等用户开口:\n' +
    '- 聊天气氛合适就主动用 send_meme 发一张贴题的表情包,不用等用户要求,发图优先于纯文字;\n' +
    '- 情绪到点、接梗、吐槽、卖萌时都主动甩图,别冷场;对方说正事/干活时克制;\n' +
    '- 发完保持简短,让图自己说话,不啰嗦不复述。'
  const memeRoot = resolveActiveRoot(readSettings(), config?.memeRoot)
  let memes = null
  try {
    memes = liveStore(new MemesStore(memeRoot))
  } catch (error) {
    console.error('[dsh-expression] meme store unavailable:', error && error.message)
    return
  }

  // ---- 陪伴模式:系统提示注入,模型根据对话情绪主动斗图 ----
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    assembled.sections.push({
      name: 'dsh-expression:companion',
      text: readSettings().companionPrompt || DEFAULT_COMPANION_PROMPT,
    })
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
      webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler(req, res) {
          const pathname = String(req.url || '').split('?')[0]
          const raw = pathname.startsWith(ROUTE + '/') ? pathname.slice(ROUTE.length + 1) : null
          // 带包前缀格式:/dsh-memes/<packId>/<rel>(跨包发图/配图);无前缀按当前激活包(旧格式兼容)
          let root = memes.root
          let stored = raw
          if (raw) {
            const slash = raw.indexOf('/')
            const first = slash > 0 ? raw.slice(0, slash) : ''
            if (first) {
              let hit = null
              try { hit = listAllPacks().find((p) => p.id === first) } catch { /* 扫描失败走默认 */ }
              if (hit) {
                root = hit.path
                stored = raw.slice(slash + 1)
              }
            }
          }
          // 每次请求动态构建白名单:静态快照会漏掉新上传的图(历史教训:上传后 404 图片不显示)
          let allowed = null
          try { allowed = new Set(new MemesStore(root).list().memes.map((m) => m.path)) } catch { allowed = null }
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
      })
    } catch (error) {
      console.log('[dsh-expression] 路由已存在,复用:', error && error.message)
    }
    urlPrefix = base + ROUTE
  }

  // ---- 发送通道:QQ 优先,Web 兜底 ----
  const qq = ctx.get('companionQq')
  const sendImage = qq !== undefined && typeof qq.sendImage === 'function'
    ? (path, caption) => qq.sendImage(path, caption)
    : null
  if (sendImage || urlPrefix) {
    try {
      registerSendMemeTool(ctx, memes, sendImage, urlPrefix)
      console.log(`[dsh-expression] send_meme 已注册(${sendImage ? 'QQ' : 'Web'}通道,${urlPrefix || '无路由'})`)
    } catch (error) {
      console.error('[dsh-expression] send_meme 注册失败(不影响 API/面板):', error instanceof Error ? error.message : String(error))
    }
  } else {
    console.log('[dsh-expression] 无可用发送通道(需要 dsh-companion 的 QQ 或 webServer),未注册 send_meme')
  }

  // companionQq 迟到时补挂(静态插件与 companion 装载顺序不定)。
  const register = () => {
    if (sendImage || urlPrefix) return
    const qqNow = ctx.get('companionQq')
    if (qqNow !== undefined && typeof qqNow.sendImage === 'function') {
      registerSendMemeTool(ctx, memes, (path, caption) => qqNow.sendImage(path, caption), urlPrefix)
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
    let adminDb = new DatabaseSync(join(memes.root, 'index.db')) // 可写连接
    const packPayload = () => {
      const s = readSettings()
      const packs = listAllPacks()
      const packId = s.packId || (packs.find((p) => resolve(p.path) === resolve(memes.root)) || {}).id || ''
      return {
        memeRoot: memes.root,
        packId,
        packsDir: packsDirNow(),
        packs,
        companionPrompt: readSettings().companionPrompt || '',
        defaultCompanionPrompt: DEFAULT_COMPANION_PROMPT,
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
      const nextDb = new DatabaseSync(indexPath)
      const abs = resolve(dir)
      const hit = scanPacks(packsDirNow()).find((p) => resolve(p.path) === abs)
      writeSettings({
        memeRoot: abs,
        packId: packId || (hit ? hit.id : '_custom'),
      })
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
    ctx.tools.register(defineTool({
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
            mime = stored.ref.mediaType
            fileName = stored.ref.name || 'meme' + (mime === 'image/png' ? '.png' : mime === 'image/gif' ? '.gif' : mime === 'image/webp' ? '.webp' : '.jpg')
            ext = fileName.includes('.') ? '.' + fileName.split('.').pop().toLowerCase() : '.jpg'
          } else {
            if (!/^https?:\/\//i.test(imageUrl)) return { ok: false, message: 'imageUrl 必须是 http(s) 链接' }
            const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000), redirect: 'follow' })
            if (!res.ok) return { ok: false, message: '下载失败: HTTP ' + res.status }
            const ctype = String(res.headers.get('content-type') || '')
            const m = /image\/(jpeg|png|gif|webp)/.exec(ctype)
            mime = m ? { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[m[1]] : ''
            if (!mime) return { ok: false, message: '该 URL 不是图片(jpg/png/gif/webp)' }
            buf = Buffer.from(await res.arrayBuffer())
            if (buf.byteLength === 0 || buf.byteLength > 8 * 1024 * 1024) return { ok: false, message: '图片大小超限(≤8MB)' }
            ext = m ? { jpeg: '.jpg', png: '.png', gif: '.gif', webp: '.webp' }[m[1]] : ''
            fileName = imageUrl.split('/').pop() || 'meme.jpg'
          }
          if (buf.byteLength === 0 || buf.byteLength > 8 * 1024 * 1024) return { ok: false, message: '图片大小超限(≤8MB)' }
          // 未指定分类时自动识图(学图即识图)
          let auto = false
          if (!tag) {
            const sel = ctx.agentDefaultModel && typeof ctx.agentDefaultModel.currentSelection === 'function'
              ? ctx.agentDefaultModel.currentSelection() : null
            const r = await recognizeImageBytes(ctx.get('llm'), sel, buf, mime, fileName)
            auto = true
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
          return { ok: true, path: rel, tag, url: ROUTE + '/' + rel, message: '已收录: [' + tag + '] ' + (caption || name) + (auto ? ' (AI 自动识别)' : '') + ' → ' + rel }
        } catch (error) {
          return { ok: false, message: '收录失败: ' + (error instanceof Error ? error.message : String(error)) }
        }
      },
    }))

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
      const base = await llm.resolveCallConfig({ provider, model, maxTokens: 1024 })
      const prepared = await llm.prepareCall(base)
      const prompt = '你是表情包分类助手。识别这张表情包图片,只输出 JSON(不要任何其他文字):\n' +
        '{"tag":"分类(小写英文,参考: angry生气 happy开心 sad难过 shy害羞 confused困惑 surprised惊讶 sleep睡觉 work上班 like喜欢 see看看 meow喵喵 speechless无语),选最贴切的一个","caption":"一句话中文描述这张图表达的情绪/梗","keywords":"3-5个中文搜索词,空格分隔"}\n'
      let out = ''
      let reason = ''
      for await (const chunk of prepared.stream({
        ...base,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', attachment: await ctx.get('attachments').saveImage({ data: buf, mediaType: mime, name: fileName }) },
          ],
        }],
      })) {
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
      return { tag, caption, keywords }
    }

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
    webServer.register({
      kind: 'exact',
      path: '/dsh-memes-api',
      async handler(req, res) {
        if (req.method === 'GET') {
          const u = new URL(req.url || '/', 'http://localhost')
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
              try {
                for (const m of new MemesStore(p.path).list().memes) all.push(urlFor(m, p.id))
              } catch { /* 坏库跳过 */ }
            }
            json(res, { ok: true, total: all.length, tags: [], packId: activeId, packs: packList(), memes: all })
            return
          }
          const pack = packs.find((p) => p.id === packId)
          let rows = []
          let tags = []
          if (pack) {
            try {
              const r = new MemesStore(pack.path).list(u.searchParams.get('tag') || undefined, u.searchParams.get('q') || undefined)
              rows = r.memes
              tags = r.tags
            } catch { /* 坏库/缺索引 → 空列表 */ }
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
          if (op === 'upload') {
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
            json(res, { ok: true })
          } else if (op === 'delete') {
            const path = String(body.path || '')
            if (!memes.list().memes.some((m) => m.path === path)) throw new Error('未知路径: ' + path)
            adminDb.prepare('DELETE FROM memes WHERE path = ?').run(path)
            try { unlinkSync(join(memes.root, path)) } catch { /* 文件已不存在 */ }
            json(res, { ok: true })
          } else if (op === 'deleteTag') {
            const tag = String(body.tag || '').trim().toLowerCase()
            if (!tag || !validTagRe.test(tag)) throw new Error('tag 只能是小写字母/数字/-/_')
            const n = adminDb.prepare('DELETE FROM memes WHERE tag = ?').run(tag).changes
            rmSync(join(memes.root, 'memes', tag), { recursive: true, force: true })
            json(res, { ok: true, deleted: n })
          } else if (op === 'importMemePack') {
            const data = String(body.dataBase64 || '')
            const name = String(body.name || 'meme-pack').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'meme-pack'
            if (!data) throw new Error('缺少 ZIP 数据')
            const entries = unzipStore(Buffer.from(data, 'base64'))
            const indexPath = entries.get('index.db')
            if (!indexPath) throw new Error('ZIP 里没有 index.db,不是有效的表情包包')
            // 解包到扫描目录/<name>(包外,持久)
            const target = join(packsDirNow(), name)
            rmSync(target, { recursive: true, force: true })
            mkdirSync(target, { recursive: true })
            for (const [rel, bytes] of entries) {
              const full = join(target, rel)
              mkdirSync(dirname(full), { recursive: true })
              writeFileSync(full, bytes)
            }
            reloadMemeStore(target, name)
            json(res, { ok: true, ...packPayload(), total: memes.list().memes.length, message: '导入成功,已切换到新图库' })
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
            mkdirSync(dir, { recursive: true })
            writeSettings({ packsDir: resolve(dir) })
            json(res, { ok: true, ...packPayload(), message: '已更新扫描目录' })
          } else if (op === 'setMemeRoot') {
            const dir = String(body.memeRoot || '').trim()
            if (!dir) throw new Error('目录不能为空')
            reloadMemeStore(dir)
            json(res, { ok: true, ...packPayload(), message: '已切换图库,立即生效' })
          } else if (op === 'setCompanionPrompt') {
            const text = String(body.text || '').trim()
            writeSettings({ companionPrompt: text })
            json(res, { ok: true, ...packPayload(), message: text ? '已保存,下一条消息生效' : '已恢复默认提示词' })
          } else {
            json(res, { ok: false, error: '未知操作: ' + op }, 400)
          }
        } catch (error) {
          json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
        }
      },
    })
    // 导出图库为 ZIP 包(分享用):遍历图库目录全部文件打包
    webServer.register({
      kind: 'exact',
      path: '/dsh-memes-export',
      handler(req, res) {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end()
          return
        }
        try {
          // 只导出索引内的文件(index.db + manifest.json + 索引图片),
          // 不打包 .git/备份/缩略图等无关内容(历史教训:整目录遍历会带出 200MB 杂物)
          const files = [{ name: 'index.db', data: readFileSync(join(memes.root, 'index.db')) }]
          if (existsSync(join(memes.root, 'manifest.json'))) {
            files.push({ name: 'manifest.json', data: readFileSync(join(memes.root, 'manifest.json')) })
          }
          for (const m of memes.list().memes) {
            const full = join(memes.root, m.path)
            if (existsSync(full)) files.push({ name: m.path, data: readFileSync(full) })
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
    })

    // 自包含管理面板页面(无构建链、重启不丢)。
    webServer.register({
      kind: 'exact',
      path: '/memes-panel',
      handler(req, res) {
        try {
          const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'panel.html'))
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(html)
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('panel.html 缺失: ' + (error instanceof Error ? error.message : String(error)))
        }
      },
    })
    // 对话里表情包小图展示:只限制 /dsh-memes 图片,避免大图贴脸,不影响其他 UI。
    // 选择器必须用 src*= 子串匹配:send_meme 返回的是绝对 URL
    // (http://host:port/dsh-memes/...),src^= 前缀匹配只对相对路径生效,
    // 会漏掉所有真实表情(历史教训:之前的 240px 规则因此从未生效)。
    // 尺寸可用 config.memeSize 覆盖(px,默认 160)。
    const memeSize = Number(config?.memeSize) > 0 ? Number(config.memeSize) : 160
    try {
      webServer.tapIndex((html) => html.replace(
        '</head>',
        '<style>img[src*="/dsh-memes/"]{max-width:' + memeSize + 'px!important;max-height:' + memeSize + 'px!important;width:auto!important;height:auto!important;object-fit:contain;border-radius:8px}</style></head>',
      ))
    } catch (error) {
      console.error('[dsh-expression] tapIndex 失败:', error instanceof Error ? error.message : String(error))
    }
    console.log('[dsh-expression] 管理 API: /dsh-memes-api , 管理面板: /memes-panel , 小图 CSS 已注入(' + memeSize + 'px)')
  }
}
