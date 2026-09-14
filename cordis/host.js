/**
 * dsh-expression — DeepSeek Harness 动态 Cordis 插件(Host 半边)。
 *
 * 本文件是纯 JS 函数体(无 import/require),作为 cordis_define 的 code.host:
 *   - 检索:直接读 selfloom 表情包库 ~/.hermes/meme-packs/official-001
 *     (index.db SQLite + manifest.json),优先 python3 读库,fs 目录扫描降级;
 *     bigram Dice 相似度 + 口语同义词兜底(与 selfloom memes.ts 同款算法)。
 *   - 展示:注册 webServer 前缀路由 /dsh-memes,以 HTTP 提供图库图片;
 *     send_meme 工具返回相对 URL,模型在回复中用 markdown 图片语法
 *     ![](url) 展示 —— Web 对话内直接斗图,不依赖 QQ 通道。
 *   - 无命中不硬发:返回分类场景建议,让用户换词。
 */
'use strict'

// ---------- 检索核心(与 selfloom memes.ts / 静态插件 memes.js 同款) ----------

/** 字符 bigram 集合(Dice 相似度搜索)。 */
function bigramSet(text) {
  const t = [...String(text).toLowerCase()].filter((c) => /[a-z0-9]|\u4e00-\u9fff/.test(c))
  const set = new Set()
  for (let i = 0; i < t.length - 1; i++) set.add(t[i] + t[i + 1])
  return set
}

function diceSimilarity(a, b) {
  let inter = 0
  for (const item of a) if (b.has(item)) inter += 1
  return inter === 0 ? 0 : (2 * inter) / (a.size + b.size)
}

function searchMemeRows(rows, q) {
  const qSet = bigramSet(q)
  if (qSet.size < 2) {
    return rows.filter((m) => String(m.caption ?? '').toLowerCase().includes(q) || String(m.keywords ?? '').toLowerCase().includes(q))
  }
  return rows
    .map((m) => {
      const score = Math.max(
        diceSimilarity(qSet, bigramSet(m.caption ?? '')),
        diceSimilarity(qSet, bigramSet(m.keywords ?? '')),
      )
      return { m, score }
    })
    .filter((x) => x.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m)
}

/** 口语词 → 图库关键词扩展(搜索兜底:用户说「摸鱼」但图库只有「下班/工作」)。 */
const QUERY_SYNONYMS = {
  摸鱼: '摸鱼 上班 工作 下班 偷懒 躺',
  上班: '上班 工作',
  工作: '工作 上班 加班',
  下班: '下班 工作 摸鱼',
  困: '困 睡觉 熬夜 犯困',
  睡觉: '睡觉 困 熬夜',
  熬夜: '熬夜 困 睡觉',
  生气: '生气 愤怒 暴躁 无语',
  无语: '无语 叹气 翻白眼',
  开心: '开心 高兴 兴奋',
  害怕: '害怕 惊恐 慌张',
  无聊: '无聊 没意思 发呆 摸鱼',
  尴尬: '尴尬 无语 捂脸',
}

/** 按 tag/query 检索:同义词逐词展开,零命中才尝试下一个(与 selfloom memes.ts 同款)。 */
function listMemes(rows, tag, query) {
  const tags = [...new Set(rows.map((r) => r.tag))].sort()
  let memes = rows
  if (tag) {
    memes = memes.filter((m) => m.tag === String(tag).toLowerCase())
  }
  if (query && String(query).trim()) {
    const base = String(query).trim().toLowerCase()
    const expansions = Object.entries(QUERY_SYNONYMS)
      .filter(([word]) => base.includes(word))
      .flatMap(([, words]) => words.split(/\s+/).filter(Boolean))
    const candidates = [base, ...expansions]
    const pool = memes
    for (const q of candidates) {
      const hits = searchMemeRows(pool, q)
      if (hits.length > 0) {
        memes = hits
        break
      }
    }
  }
  return { memes, tags }
}

/** 候选交错:每分类最多 2 张,避免同类扎堆(最多 MAX_CANDIDATES 张)。 */
function interleaveCandidates(hits, max) {
  const perTag = new Map()
  const out = []
  for (const m of hits) {
    if (out.length >= max) break
    const used = perTag.get(m.tag) || 0
    if (used < 2) {
      perTag.set(m.tag, used + 1)
      out.push(m)
    }
  }
  return out
}

function mimeOf(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] || 'application/octet-stream'
}

// ---------- 加载器 ----------

/** 校验 configRoot:必须是绝对路径且不含 .. 穿越段,防止越界读取图库目录外的文件。 */
function safeConfigRoot(root) {
  const value = String(root)
  const normalized = value.replace(/\\/g, '/')
  if (value.includes('\0') || normalized.split('/').some((seg) => seg === '..')) {
    throw new Error('memeRoot 含非法路径穿越序列')
  }
  if (!normalized.startsWith('/') && !normalized.startsWith('~/')) {
    throw new Error('memeRoot 必须是绝对路径')
  }
  return value
}

/** 优先:python3 + 标准库 sqlite3 读 index.db 与 manifest.json(单次调用)。 */
async function loadViaPython(shell, configRoot) {
  // 外层 shell 双引号,Python 代码内全部单引号,避免引号嵌套。
  const py = "import sqlite3,json,sys,os; root=sys.argv[1] if len(sys.argv)>1 else os.path.expanduser('~/.hermes/meme-packs/official-001'); c=sqlite3.connect(os.path.join(root,'index.db')); rows=c.execute('SELECT path,tag,file_name,caption,keywords FROM memes').fetchall(); cats={}; mf=os.path.join(root,'manifest.json'); cats=json.load(open(mf)).get('categories',{}) if os.path.exists(mf) else {}; print(json.dumps({'root':root,'memes':[{'path':r[0],'tag':r[1],'file_name':r[2],'caption':r[3] or '','keywords':r[4] or ''} for r in rows],'categories':cats},ensure_ascii=False))"
  const rootArg = configRoot ? ` '${safeConfigRoot(configRoot).replace(/'/g, "'\\''")}'` : ''
  // stdoutMaxBytes:读库 JSON 约 100KB,默认 stdout 只保留尾部会截断,必须指定预算。
  const result = await shell.run(shell.resolve({ command: `python3 -c "${py}"${rootArg}`, timeoutMs: 15000, stdoutMaxBytes: 300 * 1024 }))
  if (result.exitCode !== 0) throw new Error(result.stderr && result.stderr.text ? String(result.stderr.text).slice(0, 500) : 'python3 退出码 ' + result.exitCode)
  // stdout 是 CollectedOutput({ text, truncated, spillPath }),取 .text 再解析。
  const parsed = JSON.parse(String(result.stdout.text))
  if (!parsed || !Array.isArray(parsed.memes)) throw new Error('python 输出格式不符')
  const categories = {}
  for (const [k, v] of Object.entries(parsed.categories || {})) categories[k] = (v && v.description) || ''
  return { root: parsed.root, memes: parsed.memes, categories }
}

/** 降级:fs 服务扫描 memes/<tag>/ 目录 + manifest.json 分类描述(无 caption)。 */
async function loadViaFs(fs, root) {
  if (!root) throw new Error('缺少 memeRoot 配置,无法扫描图库')
  const rootTarget = await fs.resolve(root)
  const top = await fs.listDir(rootTarget)
  const memesEntry = top.find((d) => d.name === 'memes' && d.type === 'directory')
  if (!memesEntry) throw new Error('图库缺少 memes/ 目录')
  const tagDirs = await fs.listDir(memesEntry.target)
  const memes = []
  const tags = []
  for (const tagDir of tagDirs) {
    if (tagDir.type !== 'directory') continue
    tags.push(tagDir.name)
    const files = await fs.listDir(tagDir.target)
    for (const f of files) {
      if (f.type !== 'file') continue
      memes.push({ path: 'memes/' + tagDir.name + '/' + f.name, tag: tagDir.name, file_name: f.name, caption: '', keywords: '' })
    }
  }
  let categories = {}
  try {
    const parsed = JSON.parse(await fs.readText(await fs.resolve(root + '/manifest.json')))
    categories = {}
    for (const [k, v] of Object.entries(parsed.categories || {})) categories[k] = (v && v.description) || ''
  } catch { /* manifest 可选 */ }
  return { root, memes, categories }
}

/** 图片路由 handler:只放行索引白名单内的路径,杜绝任意文件读取。 */
function makeMemeHandler(fs, root, pathIndex, urlPrefix) {
  return async (req, res) => {
    let stored = null
    try {
      const pathname = String(req.url || '').split('?')[0]
      stored = pathname.startsWith(urlPrefix + '/') ? pathname.slice(urlPrefix.length + 1) : null
      if (!stored || !pathIndex.has(stored)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not found')
        return
      }
      const target = await fs.resolve(root + '/' + stored)
      const bytes = await fs.readBytes(target, undefined, 16 * 1024 * 1024)
      res.writeHead(200, {
        'Content-Type': mimeOf(stored),
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'public, max-age=3600',
      })
      res.end(bytes)
    } catch (error) {
      console.error('[dsh-expression] 图片路由失败:', stored, error && error.message)
      try {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not found')
      } catch { /* response already sent */ }
    }
  }
}

// ---------- 管理操作(python3 + stdin JSON 读写 index.db,与 selfloom memes.ts 对齐) ----------

/** 多行 python(经 stdin JSON 的 op 执行 update/delete/upload;if/elif 必须换行,不能单行拼接)。 */
const ADMIN_PY = "import sqlite3,json,sys,os,base64,time\n" +
  "d=json.load(sys.stdin)\n" +
  "root=d['root']\n" +
  "c=sqlite3.connect(os.path.join(root,'index.db'))\n" +
  "op=d['op']\n" +
  "out={'ok':False}\n" +
  "if op=='update':\n" +
  "  c.execute('UPDATE memes SET tag=?,caption=?,keywords=? WHERE path=?',(d['tag'],d['caption'],d['keywords'],d['path']))\n" +
  "  c.commit()\n" +
  "  out={'ok':True}\n" +
  "elif op=='delete':\n" +
  "  c.execute('DELETE FROM memes WHERE path=?',(d['path'],))\n" +
  "  c.commit()\n" +
  "  p=os.path.join(root,d['path'])\n" +
  "  if os.path.exists(p): os.remove(p)\n" +
  "  out={'ok':True}\n" +
  "elif op=='upload':\n" +
  "  tag=d['tag']; name=d['file_name']; rel='memes/%s/%s'%(tag,name)\n" +
  "  os.makedirs(os.path.join(root,'memes',tag),exist_ok=True)\n" +
  "  open(os.path.join(root,rel),'wb').write(base64.b64decode(d['data']))\n" +
  "  now=int(time.time()*1000)\n" +
  "  c.execute('INSERT INTO memes (path,tag,file_name,caption,keywords,mtime,captioned_at) VALUES (?,?,?,?,?,?,?)',(rel,tag,name,'','',now,now))\n" +
  "  c.commit()\n" +
  "  out={'ok':True,'path':rel}\n" +
  "else:\n" +
  "  out={'error':'unknown op '+str(op)}\n" +
  "print(json.dumps(out,ensure_ascii=False))"

/** 校验 tag:小写字母/数字/-/_ (与 selfloom validTag 一致)。 */
function validTag(tag) {
  return tag.length > 0 && /^[a-z0-9_-]+$/.test(tag)
}

/** 允许的图片扩展名(与 selfloom upload 一致)。 */
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp']

// ---------- 插件 ----------

return {
  async apply(ctx, config) {
    const shell = ctx.get('shell')
    const fs = ctx.get('fs')
    const webServer = ctx.get('webServer')
    const configRoot = config && typeof config.memeRoot === 'string' ? config.memeRoot : null

    // 1) 加载索引:python3 + sqlite 优先,fs 扫描降级,shell 探测 home 兜底。
    let store = null
    if (shell) {
      try {
        store = await loadViaPython(shell, configRoot)
      } catch (error) {
        console.error('[dsh-expression] python 读库失败:', error && error.message)
      }
    }
    if (!store && fs) {
      let fallbackRoot = configRoot
      if (!fallbackRoot && shell) {
        try {
          const r = await shell.run(shell.resolve({ command: 'echo "$HOME"', timeoutMs: 5000 }))
          fallbackRoot = String((r.stdout && r.stdout.text) || '').trim() + '/.hermes/meme-packs/official-001'
        } catch { /* home 探测失败 */ }
      }
      try {
        store = await loadViaFs(fs, fallbackRoot)
      } catch (error) {
        console.error('[dsh-expression] fs 扫描失败:', error && error.message)
      }
    }
    if (!store || !store.memes || store.memes.length === 0) {
      console.error('[dsh-expression] 图库不可用,插件未激活(memeRoot 可配置)')
      return
    }

    const rows = store.memes
    const hints = store.categories || {}
    const pathIndex = new Map(rows.map((m) => [m.path, m]))

    // 2) 图片 HTTP 路由(白名单;webServer/fs 缺一即跳过,工具只返回路径)。
    //    路由可能已被静态版插件注册(容错:冲突则复用,不影响工具)。
    //    urlPrefix 用绝对 URL:前端 markdown 渲染器不显示相对路径图片。
    let urlPrefix = null
    if (fs && webServer) {
      const host = webServer.host === '0.0.0.0' ? '127.0.0.1' : webServer.host
      const base = 'http://' + host + ':' + webServer.port
      try {
        webServer.register({ kind: 'prefix', path: '/dsh-memes', handler: makeMemeHandler(fs, store.root, pathIndex, '/dsh-memes') })
      } catch (error) {
        console.log('[dsh-expression] 路由已存在,复用:', error && error.message)
      }
      urlPrefix = base + '/dsh-memes'
    }

    // 3) send_meme 工具:两步式(与 selfloom 同款)——action=search 翻候选(带描述),
    //    挑一张 action=send;harness 里"发送"= 返回 URL,模型用 markdown 展示。
    const MAX_CANDIDATES = 10
    harness.registerTool(ctx, harness.defineTool({
      name: 'send_meme',
      description: 'Send an image meme (表情包) to the chat. 两步式:先 action=search 翻图库看候选' +
        '(每张带描述 caption),挑最贴题的一张用 action=send + path 发出;模型在回复里用' +
        'markdown 图片语法 ![](url) 展示给用户。query 传情绪/内容口语描述(如「无语」「下班」「生气」「摸鱼」),' +
        'tag 传分类(angry/happy/sad/…)精确筛。气氛对了就主动发,别硬凑;没命中就回文字、列分类建议让用户换词;' +
        '发完保持简短,让图自己说话。',
      parameters: {
        action: {
          type: 'string',
          enum: ['search', 'send'],
          description: 'search: 翻图库看候选(含描述); send: 发送 search 挑中的 path',
        },
        query: { type: 'string', description: '描述想要的表情(情绪/内容/配文),如「无语」「下班」' },
        tag: { type: 'string', description: '按分类筛选(angry/happy/sad/…),可与 query 叠加' },
        path: { type: 'string', description: 'send 时要发的图路径(来自 search 候选列表)' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args) {
        const action = args.action === 'send' ? 'send' : 'search'
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : ''
        const path = typeof args.path === 'string' ? args.path.trim() : ''

        // send:精确发送 search 挑中的一张(harness = 返回 URL 供 markdown 展示)
        if (action === 'send') {
          if (!path) {
            return { ok: false, message: 'send 需要 path——先 action=search 看候选,再挑一张发' }
          }
          if (!pathIndex.has(path)) {
            return { ok: false, message: '未知路径: ' + path + ' —— 用 search 的候选 path' }
          }
          const row = pathIndex.get(path)
          const absUrl = urlPrefix ? urlPrefix + '/' + path : ''
          return {
            ok: true,
            path,
            url: absUrl || null,
            message: '已选: [' + row.tag + '] ' + (row.caption || row.file_name) +
              (absUrl ? ' —— 把这张图展示在你的回复正文里(图片地址: ' + absUrl + '),用 markdown 图片语法写进回复,发完不啰嗦' : ''),
          }
        }

        // search:列出候选,让模型自己挑(像翻收藏)
        const { memes, tags } = listMemes(rows, tag, query)
        if (memes.length === 0) {
          const list = tags.map((t) => t + (hints[t] ? '(' + hints[t] + ')' : '')).join(' / ')
          return { ok: false, hits: [], tags, message: '没找到匹配的表情包,回文字并列出分类建议让用户换词: ' + list + '。别硬发。' }
        }
        const candidates = interleaveCandidates(memes, MAX_CANDIDATES)
        const lines = candidates.map((m, i) => {
          const caption = (m.caption || m.file_name).slice(0, 100)
          return (i + 1) + '. path=' + m.path + ' | [' + m.tag + '] ' + caption + (urlPrefix ? ' | ' + urlPrefix + '/' + m.path : '')
        })
        return {
          ok: true,
          hits: candidates.map((m) => ({ path: m.path, tag: m.tag, caption: m.caption, url: urlPrefix ? urlPrefix + '/' + m.path : null })),
          tags,
          message: '候选 ' + candidates.length + ' 张(按分类错开,共命中 ' + memes.length + ' 张),挑最贴题的一张用 action=send + path 发出:\n' + lines.join('\n'),
        }
      },
    }))

    // 4) 管理 RPC(设置页面板用):list / upload / update / delete
    const runAdmin = async (payload) => {
      if (!shell) throw new Error('shell 服务不可用,无法管理图库')
      const result = await shell.run(shell.resolve({ command: 'python3 -c "' + ADMIN_PY + '"', timeoutMs: 20000, stdoutMaxBytes: 64 * 1024, stdin: JSON.stringify(payload) }))
      if (result.exitCode !== 0) throw new Error(result.stderr && result.stderr.text ? String(result.stderr.text).slice(0, 300) : '管理操作失败(退出码 ' + result.exitCode + ')')
      return JSON.parse(String(result.stdout.text))
    }
    const syncRow = (path, patch) => {
      const row = pathIndex.get(path)
      if (!row) return
      for (const k of Object.keys(patch)) row[k] = patch[k]
    }
    harness.handle('memes-list', async (args) => {
      const q = args && typeof args.q === 'string' ? args.q.trim() : ''
      const tag = args && typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : ''
      const { memes, tags } = listMemes(rows, tag, q)
      return {
        ok: true,
        total: rows.length,
        tags,
        memes: memes.map((m) => ({ path: m.path, tag: m.tag, file_name: m.file_name, caption: m.caption, keywords: m.keywords, url: urlPrefix ? urlPrefix + '/' + m.path : null })),
      }
    })
    harness.handle('memes-upload', async (args) => {
      const tag = String((args && args.tag) || '').trim().toLowerCase()
      const fileName = String((args && args.fileName) || '').trim()
      const data = String((args && args.dataBase64) || '')
      if (!validTag(tag)) throw new Error('tag 只能是小写字母/数字/-/_')
      const ext = fileName.includes('.') ? '.' + fileName.split('.').pop().toLowerCase() : ''
      if (!IMAGE_EXTS.includes(ext)) throw new Error('仅支持 jpg/png/gif/webp')
      if (!data) throw new Error('缺少图片数据')
      const name = Date.now() + '_' + Math.floor(Math.random() * 1000) + ext
      const out = await runAdmin({ op: 'upload', root: store.root, tag, file_name: name, data })
      if (!out.ok) throw new Error(out.error || '上传失败')
      const row = { path: out.path, tag, file_name: name, caption: '', keywords: '' }
      rows.push(row)
      pathIndex.set(out.path, row)
      return { ok: true, meme: { path: out.path, tag, file_name: name, caption: '', keywords: '', url: urlPrefix ? urlPrefix + '/' + out.path : null } }
    })
    harness.handle('memes-update', async (args) => {
      const path = String((args && args.path) || '')
      const row = pathIndex.get(path)
      if (!row) throw new Error('未知路径: ' + path)
      const tag = args && typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : row.tag
      if (!validTag(tag)) throw new Error('tag 只能是小写字母/数字/-/_')
      const caption = args && typeof args.caption === 'string' ? args.caption.trim() : row.caption
      const keywords = args && typeof args.keywords === 'string' ? args.keywords.trim() : row.keywords
      const out = await runAdmin({ op: 'update', root: store.root, path, tag, caption, keywords })
      if (!out.ok) throw new Error(out.error || '更新失败')
      syncRow(path, { tag, caption, keywords })
      return { ok: true }
    })
    harness.handle('memes-delete', async (args) => {
      const path = String((args && args.path) || '')
      if (!pathIndex.has(path)) throw new Error('未知路径: ' + path)
      const out = await runAdmin({ op: 'delete', root: store.root, path })
      if (!out.ok) throw new Error(out.error || '删除失败')
      pathIndex.delete(path)
      const i = rows.findIndex((m) => m.path === path)
      if (i >= 0) rows.splice(i, 1)
      return { ok: true }
    })

    console.log('[dsh-expression] 已激活:' + rows.length + ' 个表情包,' + pathIndex.size + ' 路径,' + new Set(rows.map((r) => r.tag)).size + ' 个分类' + (urlPrefix ? ',图片路由 ' + urlPrefix : ' (无图片路由)'))
  },
}
