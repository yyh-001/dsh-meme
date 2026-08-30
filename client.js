/**
 * dsh-meme — 设置页表情包管理面板(Client 半边)。
 *
 * 以 dsh.client bundle 格式加载(与 dsh-ssh 同款):注册 settings.section
 * 「表情包」页,渲染完整管理面板(列表/上传/编辑/删除)。
 * 数据走 dsh-meme 的 HTTP API(/dsh-memes-api,静态、重启不丢)。
 * 注册 id 必须等于 loader entry 名(dsh-meme),否则 ModuleLoader 报
 * "loaded without registering dsh-meme"。
 */
window.__ModuleLoader__.load({
  id: 'dsh-meme',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const CSS = [
      '.meme-panel{display:flex;flex-direction:column;gap:14px;padding:4px 0;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.meme-panel .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.meme-panel .section-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em;margin:2px 0 -4px}',
      '.meme-panel .pack-dd{position:relative;flex:1;min-width:160px}',
      '.meme-panel .pack-dd-btn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer;padding:8px 12px}',
      '.meme-panel .pack-dd-btn .caret{opacity:.55;font-size:11px;flex:none}',
      '.meme-panel .pack-dd-menu{position:absolute;z-index:20;left:0;right:0;top:calc(100% + 4px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;max-height:240px;overflow:auto}',
      '.meme-panel .pack-dd-item{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;border:none;background:transparent;padding:8px 10px;border-radius:6px;cursor:pointer}',
      '.meme-panel .pack-dd-item:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.meme-panel .pack-dd-item.on{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}',
      '.meme-panel .pack-dd-item .hint{font-size:11px;color:var(--dsw-alias-label-secondary);flex:none}',
      '.meme-panel .switch{position:relative;width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-border-l1);cursor:pointer;transition:background .15s ease;flex:none;display:inline-block}',
      '.meme-panel .switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .15s ease}',
      '.meme-panel .switch.on{background:var(--dsw-alias-brand-primary)}',
      '.meme-panel .switch.on::after{transform:translateX(16px)}',
      '.meme-panel input[type=text],.meme-panel select,.meme-panel textarea{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;font-size:13px;outline:none;transition:border-color .12s ease}',
      '.meme-panel input[type=text]:focus,.meme-panel select:focus,.meme-panel textarea:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.meme-panel textarea{resize:vertical;font-family:inherit}',
      '.meme-panel button{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer;transition:border-color .12s ease,background .12s ease}',
      '.meme-panel button:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.meme-panel button:disabled{opacity:.5;cursor:default}',
      '.meme-panel .btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.meme-panel .btn-primary:hover{background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}',
      '.meme-panel .notice{padding:7px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.meme-panel .meme-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}',
      '.meme-panel .meme-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;box-shadow:0 1px 3px rgba(0,0,0,.06);transition:transform .12s ease,box-shadow .12s ease}',
      '.meme-panel .meme-card:hover{transform:translateY(-2px);box-shadow:0 5px 14px rgba(0,0,0,.12)}',
      '.meme-panel .meme-card img{width:100%!important;height:120px!important;object-fit:contain!important;display:block;background:var(--dsw-alias-bg-base);padding:4px;box-sizing:border-box}',
      '.meme-panel .meta{padding:8px 10px;display:flex;flex-direction:column;gap:5px;min-height:80px}',
      '.meme-panel .tag{display:inline-block;align-self:flex-start;font-size:11px;color:var(--dsw-alias-brand-primary);text-transform:lowercase;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);border-radius:999px;padding:1px 8px}',
      '.meme-panel .cap{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.meme-panel .acts{display:flex;gap:6px;margin-top:auto}',
      '.meme-panel .acts button{padding:3px 10px;font-size:12px;border-radius:6px}',
      '.meme-panel .acts button.danger:hover{border-color:#e5484d;color:#e5484d}',
      '.meme-panel .empty{color:var(--dsw-alias-label-secondary);padding:24px;text-align:center}',
      '.meme-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px}',
      '.meme-modal{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;width:340px;max-width:100%;box-shadow:0 10px 36px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:10px}',
      '.meme-modal h3{margin:0;font-size:14px;font-weight:600}',
      '.meme-modal img{width:100%!important;height:220px!important;object-fit:contain!important;border-radius:8px;background:var(--dsw-alias-bg-base);padding:6px;box-sizing:border-box}',
      '.meme-modal .field{display:flex;flex-direction:column;gap:4px}',
      '.meme-modal input[type=text],.meme-modal select,.meme-modal textarea{box-sizing:border-box;width:100%}',
      '.meme-modal .field label{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.meme-modal .modal-acts{display:flex;gap:8px;justify-content:flex-end}',
    ].join('')

    // 分类中文显示(仅 UI,存储/搜索仍是英文 tag)
    const TAG_ZH = {
      angry: '生气', happy: '开心', sad: '难过', shy: '害羞', confused: '困惑',
      daily: '日常',
      surprised: '惊讶', sleep: '睡觉', meow: '喵喵', morning: '早上好', work: '上班',
      like: '喜欢', see: '看看', reply: '回复', sigh: '叹气', baka: '笨蛋',
      fool: '傻瓜', givemoney: '给钱', color: '彩色', cpu: 'CPU',
    }
    const tagZh = (t) => TAG_ZH[t] || t

    async function apiGet(params) {
      const qs = new URLSearchParams()
      if (params.tag) qs.set('tag', params.tag)
      if (params.q) qs.set('q', params.q)
      return (await fetch('/dsh-memes-api?' + qs.toString())).json()
    }
    async function apiPost(payload) {
      return (await fetch('/dsh-memes-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })).json()
    }

    function MemePanel(props) {
      const ctx = props && props.ctx
      const h = React.createElement
      const [memes, setMemes] = React.useState([])
      const [tags, setTags] = React.useState([])
      const [total, setTotal] = React.useState(0)
      const [q, setQ] = React.useState('')
      const [tagFilter, setTagFilter] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [edit, setEdit] = React.useState(null)
      const [upTag, setUpTag] = React.useState('')
      const [upCaption, setUpCaption] = React.useState('')
      const [upKeywords, setUpKeywords] = React.useState('')
      const [uploading, setUploading] = React.useState(false)
      const [recognizing, setRecognizing] = React.useState(false)
      const [uploadOpen, setUploadOpen] = React.useState(false)
      const [memeRoot, setMemeRoot] = React.useState('')
      const [memeRootInput, setMemeRootInput] = React.useState('')
      const [packId, setPackId] = React.useState('')
      const [packs, setPacks] = React.useState([])
      const [packsDir, setPacksDir] = React.useState('')
      const [packsDirInput, setPacksDirInput] = React.useState('')
      const [rootNotice, setRootNotice] = React.useState('')
      const [packOpen, setPackOpen] = React.useState(false)
      const [browseOpen, setBrowseOpen] = React.useState(false)
      const [browseMode, setBrowseMode] = React.useState('packsDir')
      const [browseList, setBrowseList] = React.useState(null)
      const [browseErr, setBrowseErr] = React.useState('')
      const [companionPrompt, setCompanionPrompt] = React.useState('') // 用户自定义覆盖(空=默认)
      const [defaultPrompt, setDefaultPrompt] = React.useState('') // 内置默认提示词
      const [promptOpen, setPromptOpen] = React.useState(false)
      const [promptDraft, setPromptDraft] = React.useState('') // 弹窗内草稿
      const applyRoot = (res) => {
        if (!res || !res.ok) return
        setMemeRoot(res.memeRoot || '')
        setMemeRootInput(res.memeRoot || '')
        setPackId(res.packId || '')
        setPacks(Array.isArray(res.packs) ? res.packs : [])
        setPacksDir(res.packsDir || '')
        setPacksDirInput(res.packsDir || '')
        setCompanionPrompt(res.companionPrompt || '')
        setDefaultPrompt(res.defaultCompanionPrompt || '')
      }
      const onSaveCompanionPrompt = async () => {
        try {
          const res = await apiPost({ op: 'setCompanionPrompt', text: promptDraft })
          if (res && res.ok) {
            applyRoot(res)
            setPromptOpen(false)
            setRootNotice(res.message || '已保存')
          } else {
            setRootNotice('保存失败: ' + (res && res.error || ''))
          }
        } catch (e) {
          setRootNotice('保存失败')
        }
      }
      React.useEffect(() => {
        apiPost({ op: 'getMemeRoot' }).then(applyRoot).catch(() => {})
      }, [])
      const onSetPack = async (id) => {
        const packIdNext = String(id || '').trim()
        if (!packIdNext) return
        try {
          setPackOpen(false)
          const res = await apiPost({ op: 'setPack', packId: packIdNext })
          if (res && res.ok) {
            applyRoot(res)
            setRootNotice('已切换图库,立即生效')
            await load(q, tagFilter)
          } else {
            setRootNotice('切换失败: ' + (res && res.error || ''))
          }
        } catch (e) {
          setRootNotice('切换失败')
        }
      }
      const onSavePacksDir = async (dirArg) => {
        const dir = String(dirArg !== undefined ? dirArg : packsDirInput || '').trim()
        if (!dir) { setRootNotice('扫描目录不能为空'); return }
        try {
          const res = await apiPost({ op: 'setPacksDir', packsDir: dir })
          if (res && res.ok) {
            applyRoot(res)
            setRootNotice('已更新扫描目录')
          } else {
            setRootNotice('保存失败: ' + (res && res.error || ''))
          }
        } catch (e) {
          setRootNotice('保存失败')
        }
      }
      const onSaveMemeRoot = async (dirArg) => {
        const dir = String(dirArg !== undefined ? dirArg : memeRootInput || '').trim()
        if (!dir) { setRootNotice('目录不能为空'); return }
        try {
          const res = await apiPost({ op: 'setMemeRoot', memeRoot: dir })
          if (res && res.ok) {
            applyRoot(res)
            setRootNotice('已切换图库,立即生效')
            await load(q, tagFilter)
          } else {
            setRootNotice('保存失败: ' + (res && res.error || ''))
          }
        } catch (e) {
          setRootNotice('保存失败')
        }
      }
      const onPickDir = async (mode) => {
        setBrowseErr('')
        setBrowseMode(mode || 'packsDir')
        try {
          const workspaces = ctx.get('workspaces')
          if (!workspaces || typeof workspaces.listDirectory !== 'function') return
          const start = mode === 'memeRoot'
            ? String(memeRootInput || '').trim()
            : String(packsDirInput || '').trim()
          setBrowseList(await workspaces.listDirectory(start || undefined))
          setBrowseOpen(true)
        } catch (e) {}
      }
      const browseTo = async (path) => {
        setBrowseErr('')
        try {
          setBrowseList(await ctx.get('workspaces').listDirectory(path))
        } catch (e) {
          setBrowseErr('读取失败: ' + (e && e.message ? e.message : String(e)))
        }
      }

      const [upNewTag, setUpNewTag] = React.useState('')
      const [upFile, setUpFile] = React.useState(null)
      const [upData64, setUpData64] = React.useState('')
      const [upPreview, setUpPreview] = React.useState('')
      const fileRef = React.useRef(null)
      const importFileRef = React.useRef(null)
      const onImportPack = (ev) => {
        const file = ev.target.files && ev.target.files[0]
        ev.target.value = ''
        if (!file) return
        const reader = new FileReader()
        reader.onload = async () => {
          const b64 = String(reader.result || '').split(',')[1] || ''
          const name = String(file.name || '').replace(/\.zip$/i, '')
          setRootNotice('导入中…')
          try {
            const res = await apiPost({ op: 'importMemePack', dataBase64: b64, name })
            if (res && res.ok) {
              applyRoot(res)
              setRootNotice(res.message || '导入成功')
              await load(q, tagFilter)
            } else {
              setRootNotice('导入失败: ' + (res && res.error || ''))
            }
          } catch (e) {
            setRootNotice('导入失败')
          }
        }
        reader.onerror = () => setRootNotice('读取文件失败')
        reader.readAsDataURL(file)
      }

      const load = async (query, tagf) => {
        setBusy(true)
        try {
          const res = await apiGet({ q: query || '', tag: tagf || '' })
          if (res && res.ok) {
            setMemes(res.memes)
            setTags(res.tags)
            setTotal(res.total)
            setNotice('')
          } else {
            setNotice('加载失败' + (res && res.error ? ': ' + res.error : ''))
          }
        } catch (error) {
          setNotice('加载失败: ' + (error && error.message ? error.message : String(error)))
        }
        setBusy(false)
      }
      React.useEffect(() => { load('', '') }, [])

      const onDeleteTag = async (tagArg) => {
        const tag = tagArg || (upTag === '__new__' ? '' : String(upTag || '').trim())
        if (!tag) return
        if (!window.confirm('删除分类「' + tagZh(tag) + ' (' + tag + ')」及其中所有表情包?此操作不可恢复')) return
        try {
          const res = await apiPost({ op: 'deleteTag', tag })
          setNotice(res && res.ok ? '已删除分类,共 ' + (res.deleted || 0) + ' 张' : '删除失败: ' + (res && res.error || ''))
          setUpTag('')
          setUpNewTag('')
          await load(q, tagFilter === tag ? '' : tagFilter)
        } catch (error) {
          setNotice('删除失败: ' + (error && error.message ? error.message : String(error)))
        }
      }

      const onPickFile = (ev) => {
        const file = ev.target.files && ev.target.files[0]
        ev.target.value = ''
        if (!file) return
        if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(file.name)) {
          setNotice('仅支持 jpg/png/gif/webp')
          return
        }
        setUpFile(file)
        setUpPreview(URL.createObjectURL(file))
        // 换图后清掉上一张的识别结果,避免误存错标签
        setUpTag('')
        setUpCaption('')
        setUpKeywords('')
        const reader = new FileReader()
        reader.onload = () => setUpData64(String(reader.result || '').split(',')[1] || '')
        reader.readAsDataURL(file)
      }

      // AI 识别:上传前先让模型看图,自动填分类/描述/关键词;失败不阻塞手动填写
      const onRecognize = async () => {
        if (!upFile) { setNotice('先选择图片'); return }
        if (!upData64) { setNotice('图片还没读好,稍等片刻再试'); return }
        setRecognizing(true)
        try {
          const res = await apiPost({ op: 'recognize', fileName: upFile.name, dataBase64: upData64 })
          if (res && res.ok) {
            setUpTag(res.tag || '')
            setUpCaption(res.caption || '')
            setUpKeywords(res.keywords || '')
            setNotice('AI 已识别: [' + (res.tag || '?') + '] ' + (res.caption || ''))
          } else {
            setNotice('AI 识别失败: ' + (res && res.error || '未知错误'))
          }
        } catch (error) {
          setNotice('AI 识别失败: ' + (error && error.message ? error.message : String(error)))
        }
        setRecognizing(false)
      }

      const onConfirmUpload = async () => {
        const file = upFile
        if (!file) { setNotice('先选择图片文件'); return }
        const tag = upTag === '__new__' ? String(upNewTag || '').trim().toLowerCase() : String(upTag || '').trim()
        if (!tag) { setNotice('先选择或填写分类'); return }
        if (!/^[a-z0-9_-]+$/.test(tag)) { setNotice('分类只能是小写字母/数字/-/_'); return }
        setUploading(true)
        const reader = new FileReader()
        reader.onload = async () => {
          const data = String(reader.result || '').split(',')[1] || ''
          try {
            const res = await apiPost({
              op: 'upload',
              tag,
              caption: String(upCaption || '').trim(),
              keywords: String(upKeywords || '').trim(),
              fileName: file.name,
              dataBase64: data,
            })
            setNotice(res && res.ok && res.meme ? '已上传: ' + res.meme.path : '上传失败: ' + (res && res.error || ''))
            if (res && res.ok) {
              setUploadOpen(false)
              setUpFile(null)
              setUpPreview('')
              setUpTag('')
              setUpNewTag('')
              setUpCaption('')
              setUpKeywords('')
              await load(q, tagFilter)
            }
          } catch (error) {
            setNotice('上传失败: ' + (error && error.message ? error.message : String(error)))
          }
          setUploading(false)
        }
        reader.onerror = () => { setUploading(false); setNotice('读取文件失败') }
        reader.readAsDataURL(file)
      }

      const onSaveEdit = async () => {
        if (!edit) return
        try {
          const tag = edit.tag === '__new__' ? String(edit.newTag || '').trim().toLowerCase() : String(edit.tag || '').trim().toLowerCase()
          const res = await apiPost({
            op: 'update',
            path: edit.path,
            tag,
            caption: String(edit.caption || ''),
            keywords: String(edit.keywords || ''),
          })
          setNotice(res && res.ok ? '已保存' : '保存失败: ' + (res && res.error || ''))
          setEdit(null)
          await load(q, tagFilter)
        } catch (error) {
          setNotice('保存失败: ' + (error && error.message ? error.message : String(error)))
        }
      }

      const onDelete = async (m) => {
        if (!window.confirm('删除 ' + m.path + ' ?')) return
        try {
          const res = await apiPost({ op: 'delete', path: m.path })
          setNotice(res && res.ok ? '已删除' : '删除失败: ' + (res && res.error || ''))
          await load(q, tagFilter)
        } catch (error) {
          setNotice('删除失败: ' + (error && error.message ? error.message : String(error)))
        }
      }

      const searchInput = h('input', {
        type: 'text',
        placeholder: '搜索描述/关键词',
        value: q,
        onChange: (e) => setQ(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') load(q, tagFilter) },
        style: { width: 180 },
      })
      const tagSelect = h('select', {
        value: tagFilter,
        onChange: (e) => { setTagFilter(e.target.value); load(q, e.target.value) },
      }, [
        h('option', { key: '', value: '' }, '全部分类'),
        tags.map((t) => h('option', { key: t, value: t }, tagZh(t) + ' (' + t + ')')),
      ])

      const fileInput = h('input', {
        ref: fileRef,
        type: 'file',
        accept: 'image/*',
        style: { display: 'none' },
        onChange: onPickFile,
      })

      const cards = memes.map((m) => h('div', { key: m.path, className: 'meme-card' },
        h('img', { src: m.url, alt: m.path, loading: 'lazy' }),
        h('div', { className: 'meta' },
          h('div', { className: 'tag' }, tagZh(m.tag)),
          h('div', { className: 'cap' }, m.caption || m.file_name),
          h('div', { className: 'acts' },
            h('button', { onClick: () => setEdit({ path: m.path, tag: m.tag, caption: m.caption || '', keywords: m.keywords || '' }) }, '编辑'),
            h('button', { className: 'danger', onClick: () => onDelete(m) }, '删除'),
          ),
        ),
      ))

      return h('div', { className: 'meme-panel' },
        h('div', { className: 'section-title' }, '当前图库'),
        h('div', { className: 'row', style: { width: '100%' } },
          h('div', { className: 'pack-dd' },
            h('button', {
              type: 'button',
              className: 'pack-dd-btn',
              onClick: () => setPackOpen((v) => !v),
            },
              h('span', null, (() => {
                const cur = packs.find((p) => p.id === packId)
                return cur ? (cur.name + ' (' + (cur.count || 0) + ' 张)') : (packs.length ? '选择图库' : '暂无图库')
              })()),
              h('span', { className: 'caret' }, packOpen ? '▲' : '▼'),
            ),
            packOpen ? h('div', { className: 'pack-dd-menu' },
              packs.length === 0
                ? h('div', { className: 'empty', style: { padding: 12 } }, '还没有可切换的图库')
                : packs.map((p) => h('button', {
                  type: 'button',
                  key: p.id,
                  className: 'pack-dd-item' + (p.id === packId ? ' on' : ''),
                  onClick: () => onSetPack(p.id),
                },
                  h('span', null, p.name),
                  h('span', { className: 'hint' },
                    (p.count || 0) + ' 张' +
                    (p.source === 'bundled' ? '' : p.source === 'user' ? ' · 导入' : ' · 自定义')),
                )),
            ) : null,
          ),
        ),
        memeRoot ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' } }, memeRoot) : null,
        h('div', { className: 'section-title' }, '图库 (' + total + ' 张)'),
        h('div', { className: 'row' },
          searchInput,
          h('button', { className: 'btn-primary', onClick: () => setUploadOpen(true) }, '上传表情包'),
          tagSelect,
          h('button', { onClick: () => load(q, tagFilter), disabled: busy }, '搜索'),
        ),
        notice ? h('div', { className: 'notice' }, notice) : null,
        memes.length === 0 && !busy
          ? h('div', { className: 'empty' }, '没有匹配的表情包')
          : h('div', { className: 'meme-grid' }, cards),
        // 编辑弹窗
        edit ? h('div', { className: 'meme-modal-mask', onClick: () => setEdit(null) },
          h('div', { className: 'meme-modal', onClick: (e) => e.stopPropagation() },
            h('h3', null, '编辑表情包'),
            h('img', { src: memes.find((m) => m.path === edit.path)?.url, alt: edit.path }),
            h('div', { className: 'field' },
              h('label', null, '分类'),
              h('div', { className: 'row', style: { width: '100%' } },
                h('select', { value: edit.tag, onChange: (e) => setEdit({ ...edit, tag: e.target.value }), style: { flex: 1 } },
                  (tags.includes(edit.tag) ? tags : [edit.tag, ...tags]).map((t) => h('option', { key: t, value: t }, tagZh(t) + ' (' + t + ')')),
                  h('option', { value: '__new__' }, '+ 新建分类'),
                ),
                h('button', { onClick: () => onDeleteTag(edit.tag), disabled: !edit.tag || edit.tag === '__new__', title: '删除该分类及其中所有表情包' }, '删除分类'),
              ),
              edit.tag === '__new__'
                ? h('input', { type: 'text', value: edit.newTag || '', placeholder: '新分类名,小写字母/数字/-/_', onChange: (e) => setEdit({ ...edit, newTag: e.target.value }), style: { width: '100%' } })
                : null,
            ),
            h('div', { className: 'field' },
              h('label', null, '描述'),
              h('textarea', { value: edit.caption, placeholder: '如:无语', rows: 2, onChange: (e) => setEdit({ ...edit, caption: e.target.value }) }),
            ),
            h('div', { className: 'field' },
              h('label', null, '关键词(空格分隔)'),
              h('input', { type: 'text', value: edit.keywords, placeholder: '搜索用', onChange: (e) => setEdit({ ...edit, keywords: e.target.value }) }),
            ),
            h('div', { className: 'modal-acts' },
              h('button', { onClick: () => setEdit(null) }, '取消'),
              h('button', { className: 'btn-primary', onClick: onSaveEdit }, '保存'),
            ),
          ),
        ) : null,
        // 上传弹窗
        uploadOpen ? h('div', { className: 'meme-modal-mask', onClick: () => setUploadOpen(false) },
          h('div', { className: 'meme-modal', onClick: (e) => e.stopPropagation() },
            h('h3', null, '上传表情包'),
            upFile
              ? h('img', { src: upPreview, alt: upFile.name })
              : h('div', { className: 'empty', style: { padding: '24px', border: '1px dashed var(--dsw-alias-border-l1)', borderRadius: 8 } },
                  h('button', { onClick: () => fileRef.current && fileRef.current.click() }, '选择图片'),
                ),

            h('div', { className: 'field' },
              h('label', null, upFile ? '已选: ' + upFile.name + ' (点击更换)' : '文件'),
              h('input', { type: 'text', placeholder: upFile ? '' : '先选图片', value: '', readOnly: true, style: { display: 'none' } }),
            ),
            // AI 识别:选图后一键自动填分类/描述/关键词,识别失败不阻塞手动填写
            upFile ? h('div', { className: 'row', style: { width: '100%' } },
              h('button', { className: 'btn-primary', onClick: onRecognize, disabled: recognizing }, recognizing ? 'AI 识别中…' : 'AI 识别'),
            ) : null,
            h('div', { className: 'field' },
              h('label', null, '分类(必填)'),
              h('div', { className: 'row', style: { width: '100%' } },
                h('select', { value: upTag, onChange: (e) => setUpTag(e.target.value), style: { flex: 1 } },
                  h('option', { value: '' }, '选择分类'),
                  tags.map((t) => h('option', { key: t, value: t }, tagZh(t) + ' (' + t + ')')),
                  h('option', { value: '__new__' }, '+ 新建分类'),
                ),
                h('button', { onClick: onDeleteTag, disabled: !upTag || upTag === '__new__', title: '删除该分类及其中所有表情包' }, '删除分类'),
              ),
              upTag === '__new__'
                ? h('input', { type: 'text', value: upNewTag, placeholder: '新分类名,小写字母/数字/-/_', onChange: (e) => setUpNewTag(e.target.value), style: { width: '100%' } })
                : null,
            ),
            h('div', { className: 'field' },
              h('label', null, '描述'),
              h('textarea', { value: upCaption, placeholder: '如:无语', rows: 2, onChange: (e) => setUpCaption(e.target.value) }),
            ),
            h('div', { className: 'field' },
              h('label', null, '关键词(空格分隔)'),
              h('input', { type: 'text', value: upKeywords, placeholder: '搜索用', onChange: (e) => setUpKeywords(e.target.value) }),
            ),
            h('div', { className: 'modal-acts' },
              h('button', { onClick: () => setUploadOpen(false) }, '取消'),
              h('button', { className: 'btn-primary', onClick: onConfirmUpload, disabled: uploading }, uploading ? '上传中…' : '上传'),
            ),
          ),
        ) : null,
        fileInput,
        // 陪伴提示词编辑弹窗:基于默认提示词修改,留空/恢复默认 = 内置规则
        promptOpen ? h('div', { className: 'meme-modal-mask', onClick: () => setPromptOpen(false) },
          h('div', { className: 'meme-modal', style: { width: 460 }, onClick: (e) => e.stopPropagation() },
            h('h3', null, '陪伴提示词(注入模型)'),
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
              '在默认提示词基础上修改,保存后下一条消息生效;留空 = 使用内置默认。'),
            h('textarea', {
              value: promptDraft,
              onChange: (e) => setPromptDraft(e.target.value),
              rows: 7,
              style: { boxSizing: 'border-box', width: '100%', minHeight: 140, fontFamily: 'inherit', fontSize: 12, lineHeight: 1.6, background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 8 },
            }),
            h('div', { className: 'modal-acts' },
              h('button', { onClick: () => { setPromptDraft(defaultPrompt); setRootNotice('已重置为默认,点击保存生效') } }, '恢复默认'),
              h('button', { onClick: () => setPromptOpen(false) }, '取消'),
              h('button', { className: 'btn-primary', onClick: onSaveCompanionPrompt }, '保存'),
            ),
          ),
        ) : null,
        // 底部:扫描目录 / 导入导出
        h('div', { className: 'section-title' }, '扫描目录'),
        h('div', { className: 'row', style: { width: '100%' } },
          h('input', { type: 'text', value: packsDirInput, onChange: (e) => setPacksDirInput(e.target.value), placeholder: '自动扫描含 index.db 的子文件夹', style: { flex: 1, minWidth: 160 } }),
          h('button', { onClick: () => onPickDir('packsDir') }, '选择目录'),
          h('button', { className: 'btn-primary', onClick: () => onSavePacksDir() }, '保存'),
        ),
        h('div', { className: 'section-title' }, '陪伴提示词'),
        h('div', { className: 'row' },
          h('button', { className: 'btn-primary', onClick: () => { setPromptDraft(companionPrompt || defaultPrompt); setPromptOpen(true) } }, '编辑提示词'),
          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
            companionPrompt ? '已自定义' : '使用默认'),
        ),
        h('div', { className: 'row' },
          h('button', { onClick: () => { window.location.href = '/dsh-memes-export' } }, '导出图库'),
          h('button', { onClick: () => importFileRef.current && importFileRef.current.click() }, '导入图库'),
          h('button', { onClick: () => onPickDir('memeRoot') }, '打开其他目录'),
          h('input', { ref: importFileRef, type: 'file', accept: '.zip,application/zip', style: { display: 'none' }, onChange: onImportPack }),
        ),
        rootNotice ? h('div', { className: 'notice' }, rootNotice) : null,
        // 目录浏览弹窗(WSL 无原生选择器,用 browse 能力前端浏览)
        browseOpen && browseList ? h('div', { className: 'meme-modal-mask', onClick: () => setBrowseOpen(false) },
          h('div', { className: 'meme-modal', style: { width: 420 }, onClick: (e) => e.stopPropagation() },
            h('h3', null, '选择表情包目录'),
            h('div', { className: 'total', style: { wordBreak: 'break-all' } }, browseList.path),
            h('div', { className: 'row', style: { flexWrap: 'wrap', gap: 4 } },
              h('button', {
                onClick: () => {
                  // 上一级 = 当前路径去掉最后一段(不依赖 breadcrumbs)
                  const p = String(browseList.path || '')
                  const parent = p.replace(/\/+[^\/]*\/?$/, '') || '/'
                  if (parent !== p) browseTo(parent)
                },
                disabled: !String(browseList.path || '').includes('/'),
                style: { padding: '3px 8px', fontSize: 12 },
              }, '⬆ 上一级'),
              (browseList.breadcrumbs || []).map((c, i) =>
                h('button', { key: c.path, onClick: () => browseTo(c.path), style: { padding: '3px 8px', fontSize: 12 } },
                  (i === 0 ? '🏠 ' : '') + c.name)),
            ),
            h('div', { style: { height: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 4 } },
              (browseList.entries || []).length === 0
                ? h('div', { className: 'empty' }, '(空目录)')
                : (browseList.entries || []).map((e) =>
                    h('button', { key: e.path, onClick: () => browseTo(e.path), style: { textAlign: 'left', padding: '5px 10px', fontSize: 13 } },
                      '📁 ' + e.name)),
            ),
            browseErr ? h('div', { className: 'notice' }, browseErr) : null,
            h('div', { className: 'modal-acts' },
              h('button', { onClick: () => setBrowseOpen(false) }, '取消'),
              h('button', { className: 'btn-primary', onClick: () => {
                const p = browseList.path
                if (browseMode === 'memeRoot') onSaveMemeRoot(p)
                else onSavePacksDir(p)
                setBrowseOpen(false)
              } }, '使用此目录'),
            ),
          ),
        ) : null,
      )
    }

    // ---- 输入框快捷发图(QQ 式):😊 按钮 + 悬浮面板 ----
    const memePickerCSS = [
      '.meme-trigger{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:transparent;border:none;line-height:1;outline:none;transition:background .12s,color .12s}',
      '.meme-trigger:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.meme-trigger.active{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}',
      '.meme-picker{position:absolute;bottom:calc(100% + 8px);left:0;width:min(360px,90vw);z-index:30;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:10px;padding:12px;max-height:46vh;overflow:hidden;font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.meme-picker .mp-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '.meme-picker .mp-tabs{display:flex;gap:4px;align-items:center;overflow-x:auto;max-width:100%;padding-bottom:2px}',
      '.meme-picker .mp-tag{padding:3px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;flex:none;transition:background .12s,color .12s,border-color .12s}',
      '.meme-picker .mp-tag:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
      '.meme-picker .mp-tag.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}',
      '.meme-picker .mp-grid{overflow-y:auto;display:flex;flex-wrap:wrap;gap:8px;max-height:38vh;padding:2px}',
      '.meme-picker .mp-cell{width:76px;height:76px;flex:0 0 76px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;overflow:hidden;cursor:pointer;background:var(--dsw-alias-bg-layer-2);padding:0;display:block;transition:border-color .12s,transform .12s,box-shadow .12s}',
      '.meme-picker .mp-cell:hover{border-color:var(--dsw-alias-brand-primary);transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.15)}',
      '.meme-picker .mp-empty{color:var(--dsw-alias-label-secondary);text-align:center;padding:28px 0}',
    ].join('')

    function makeMemeStore() {
      let open = false
      let base = ''
      const subs = new Set()
      return {
        get: () => open,
        set: (v) => { open = !!v; subs.forEach((fn) => fn()) },
        toggle: () => { open = !open; subs.forEach((fn) => fn()) },
        subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) },
        setBase: (s) => { base = s || '' },
        getBase: () => base,
      }
    }

    function makeMemeButton(store) {
      return function MemeButton(props) {
        const open = React.useSyncExternalStore(store.subscribe, store.get)
        return React.createElement('button', {
          className: open ? 'meme-trigger active' : 'meme-trigger',
          title: '表情包',
          onClick: (e) => {
            e.preventDefault(); e.stopPropagation()
            if (!store.get()) {
              const d = props && props.input && typeof props.input.draft === 'string' ? props.input.draft : ''
              store.setBase(d)
            }
            store.toggle()
          },
        }, React.createElement('svg', { viewBox: '0 0 24 24', width: 20, height: 20, style: { display: 'block' } },
          // Material 标准笑脸,currentColor 跟随主题
          React.createElement('path', { d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z', fill: 'currentColor' }),
        ))
      }
    }

    function MemeBoard(props) {
      const h = React.createElement
      const store = props.store
      const actions = props.inputActions
      const open = React.useSyncExternalStore(store.subscribe, store.get)
      const [memes, setMemes] = React.useState([])
      const [packs, setPacks] = React.useState([]) // [{id,name,count}] 可切换的表情包组
      const [packId, setPackId] = React.useState('') // '' = 跟随当前激活图库

      React.useEffect(() => {
        if (!open) return
        let alive = true
        const qs = new URLSearchParams()
        if (packId) qs.set('packId', packId)
        fetch('/dsh-memes-api?' + qs.toString())
          .then((r) => r.json())
          .then((res) => {
            if (!alive || !res || !res.ok) return
            setPacks(res.packs || [])
            setMemes(res.memes || [])
            // 首次打开:锚定当前激活图库;切包后当前包不存在时回退激活包
            setPackId((cur) => {
              const valid = (res.packs || []).some((p) => p.id === cur)
              return cur && valid ? cur : (res.packId || '')
            })
          })
          .catch(() => {})
        return () => { alive = false }
      }, [open, packId])

      // 点外部(非面板、非 😊 按钮)自动收起。
      React.useEffect(() => {
        if (!open) return
        const onDown = (e) => {
          const t = e && e.target
          if (t && t.closest && !t.closest('.meme-picker') && !t.closest('.meme-trigger')) {
            store.set(false)
          }
        }
        document.addEventListener('pointerdown', onDown)
        return () => document.removeEventListener('pointerdown', onDown)
      }, [open])

      if (!open) return null

      // 点击:发 [表情: 描述] 文本,前端按描述配图。
      const send = async (m) => {
        if (!m) return
        // 纯文本:[表情: 描述] —— 模型只看到文字;前端按描述配图。
        const setText = (text) => { try { if (actions && actions.setDraft) actions.setDraft(text) } catch (e) {} }
        const desc = (m.caption || m.keywords || m.tag || '表情包').slice(0, 80)
        const text = '[表情: ' + desc + ']'
        const cur = store.getBase() || ''
        setText(cur ? (cur.trim() ? cur + '\n' + text : text) : text)
        try { if (actions && actions.submit) actions.submit() } catch (e) {}
        store.setBase('')
        store.set(false)
      }

      // 表情包组 tab:大肥鱼 / 官方 / 导入的包,点选即切换数据源
      const cells = memes.map((m) => h('div', {
        key: m.path, className: 'mp-cell', title: m.caption || m.file_name, onClick: () => send(m),
        style: {
          width: '74px', height: '74px',
          backgroundImage: 'url(' + m.url + ')',
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
          backgroundRepeat: 'no-repeat',
        },
      }))

      return h('div', { className: 'meme-picker', onClick: (e) => e.stopPropagation() },
        h('div', { className: 'mp-tabs' },
          packs.length === 0
            ? h('div', { className: 'mp-empty', style: { padding: '4px 0' } }, '加载中…')
            : packs.map((p) => h('button', {
              type: 'button', key: p.id,
              className: 'mp-tag' + (p.id === packId ? ' on' : ''),
              onClick: () => setPackId(p.id),
            }, p.name + ' (' + (p.count || 0) + ')')),
        ),
        memes.length === 0
          ? h('div', { className: 'mp-empty' }, '没有匹配的表情包')
          : h('div', { className: 'mp-grid' }, cells),
      )
    }

    const inject = ['slots', 'workspaces']

    // 模型常把 “” 抄成 ""；匹配时折叠引号和空白。
    const foldCaption = (s) => String(s || '').trim()
      .replace(/[\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f«»]/g, '"')
      .replace(/\s+/g, ' ')
    const looseCaption = (s) => foldCaption(s).replace(/["'\s]/g, '')
    // 描述里按中英文标点切词,长词优先(两字以下太泛,不参与匹配)。
    const splitDescTokens = (s) => foldCaption(s)
      .split(/[\s,.!?;:、，。！？；：""''()（）\[\]【】《》…·～~\-]+/)
      .map((t) => t.replace(/["']/g, ''))
      .filter((t) => t.length >= 2)
      .sort((a, b) => b.length - a.length)
    // 分词兜底的 haystack:caption/关键词/文件名的折叠与紧凑形态 + 分词。
    const buildMemeSearch = (rows, toUrl) => (rows || []).map((row) => {
      const hay = []
      const parts = []
      for (const s of [row.caption, row.keywords, row.file_name]) {
        const f = foldCaption(s)
        if (!f) continue
        const l = looseCaption(s)
        hay.push(f, ...(l && l !== f ? [l] : []))
        parts.push(s)
      }
      const tokens = [...new Set(splitDescTokens(parts.join(' ')))]
      return { hay, tokens, url: toUrl(row) }
    })
    // 组合匹配:精确(原文/折叠/紧凑三级)→ 分词在 caption/关键词里双向包含。
    const matchDesc = (desc, index, search) => {
      if (index) {
        const raw = String(desc || '').trim()
        const exact = index.get(raw) || index.get(foldCaption(raw)) || index.get(looseCaption(raw))
        if (exact) return exact
      }
      for (const token of splitDescTokens(desc)) {
        const needle = looseCaption(token)
        if (!needle) continue
        for (const row of search || []) {
          if (row.hay.some((hay) => hay.includes(needle))) return row.url
          if ((row.tokens || []).some((t) => { const lt = looseCaption(t); return lt && (needle.includes(lt) || lt.includes(needle)) })) return row.url
        }
      }
      return null
    }

    function apply(ctx) {
      const styleEl = document.createElement('style')
      styleEl.textContent = CSS
      document.head.appendChild(styleEl)
      ctx.effect(() => () => { styleEl.remove() }, 'dsh-expression-entry: styles')

      const pickerStyle = document.createElement('style')
      pickerStyle.textContent = memePickerCSS
      document.head.appendChild(pickerStyle)
      ctx.effect(() => () => { pickerStyle.remove() }, 'dsh-expression-entry: meme-picker styles')

      // 表情文本渲染:[表情: 描述] 或旧格式 [表情: 描述](url) → 图片。
      // 无 url 时先按描述精确匹配图库;失败再按分词在 caption/关键词里做包含匹配
      // 兜底(模型偶尔不抄候选原文、自己编描述);仍无命中显示描述原文,
      // 不把 [表情: ...] 标记裸露在气泡里(历史教训:社区反馈「表情显示不出来」)。
      const MEME_TEXT_RE = /\[表情:\s*([^\]]+)\](?:\((https?:\/\/[^\s)]+)\))?/g
      let memeIndex = null
      let memeSearch = [] // 分词兜底用的 haystack:[{hay:[...], url}]
      let memeIndexLoading = false
      const absMemeUrl = (u, path) => {
        if (u && /^https?:\/\//.test(u)) return u
        const rel = u || (path ? '/dsh-memes/' + path : '')
        try { return new URL(rel, window.location.origin).href } catch (e) { return rel }
      }
      const addCaptionKey = (map, key, url) => {
        const raw = String(key || '').trim()
        if (!raw) return
        map.set(raw, url)
        map.set(foldCaption(raw), url)
        const loose = looseCaption(raw)
        if (loose) map.set(loose, url)
      }
      const findMemeUrl = (desc) => matchDesc(desc, memeIndex, memeSearch)
      const loadMemeIndex = () => {
        if (memeIndex || memeIndexLoading) return
        memeIndexLoading = true
        // 拉全部包(带包前缀 URL),任意组的 [表情: 描述] 都能配图
        fetch('/dsh-memes-api?packId=all')
          .then((r) => r.json())
          .then((res) => {
            const rows = (res && res.memes) || []
            memeIndex = new Map()
            for (const row of rows) {
              const url = absMemeUrl(row.url, row.path)
              addCaptionKey(memeIndex, row.caption, url)
              addCaptionKey(memeIndex, row.file_name, url)
              addCaptionKey(memeIndex, row.keywords, url)
              addCaptionKey(memeIndex, String(row.caption || '').slice(0, 80), url)
              addCaptionKey(memeIndex, String(row.caption || '').slice(0, 100), url)
            }
            memeSearch = buildMemeSearch(rows, (row) => absMemeUrl(row.url, row.path))
            decorateMemeText()
          })
          .catch(() => { memeIndex = new Map() })
          .finally(() => { memeIndexLoading = false })
      }
      const decorateMemeText = () => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const parent = node.parentElement
            if (!parent) return NodeFilter.FILTER_REJECT
            // 只渲染「对话」气泡。轨迹 / Think / 工具卡 / 输入框保持纯文本。
            if (!parent.closest('[data-chat-flow]')) return NodeFilter.FILTER_REJECT
            if (parent.closest('input,textarea,[contenteditable="true"],[data-variant="think"],[data-variant="others"],pre,code')) {
              return NodeFilter.FILTER_REJECT
            }
            if (parent.dataset && parent.dataset.memeDecorated) return NodeFilter.FILTER_REJECT
            return MEME_TEXT_RE.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
          },
        })
        const nodes = []
        let n
        while ((n = walker.nextNode())) nodes.push(n)
        for (const node of nodes) {
          const parent = node.parentElement
          if (!parent || parent.dataset.memeDecorated) continue
          const text = node.nodeValue || ''
          MEME_TEXT_RE.lastIndex = 0
          const matches = []
          let m
          while ((m = MEME_TEXT_RE.exec(text))) matches.push(m)
          if (matches.length === 0) continue
          const needsLookup = matches.some((hit) => !hit[2])
          if (needsLookup && !memeIndex) {
            loadMemeIndex()
            continue
          }
          parent.dataset.memeDecorated = '1'
          const frag = document.createDocumentFragment()
          const imgs = []
          let last = 0
          for (const hit of matches) {
            if (hit.index > last) frag.appendChild(document.createTextNode(text.slice(last, hit.index)))
            const src = hit[2] || findMemeUrl(hit[1])
            if (src) {
              const img = document.createElement('img')
              img.src = src
              img.alt = hit[0].slice(0, 60)
              img.title = hit[0].slice(0, 60)
              img.style.cssText = 'max-width:180px;max-height:180px;border-radius:10px;display:block;margin:8px 0'
              frag.appendChild(img)
              imgs.push(img)
            } else {
              // 无命中:降级显示描述原文,不把 [表情: ...] 标记裸露给用户
              frag.appendChild(document.createTextNode(hit[1]))
            }
            last = hit.index + hit[0].length
          }
          if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
          parent.replaceChild(frag, node)
          const row = parent.closest('[data-time-hover-root]')
          if (row && imgs.length > 0) {
            for (const img of imgs) row.insertBefore(img, row.firstChild)
            let el = parent
            while (el && el !== row) {
              if (!el.textContent.trim()) el.style.display = 'none'
              el = el.parentElement
            }
          }
        }
      }
      // 设置侧边栏「表情包」行的齿轮图标替换成笑脸(dsh navIcon 硬编码,不支持自定义)
      const decorateNavIcon = () => {
        const nav = document.querySelector('[role="dialog"] nav')
        if (!nav) return
        for (const btn of nav.querySelectorAll('button')) {
          if (btn.dataset.memeNav) continue
          if (!btn.textContent || !btn.textContent.includes('表情包')) continue
          const icon = btn.firstElementChild
          if (!icon || icon.tagName === 'IMG') { btn.dataset.memeNav = '1'; continue }
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          svg.setAttribute('viewBox', '0 0 24 24')
          svg.style.cssText = 'width:16px;height:16px;flex:none'
          const mk = (tag, attrs) => {
            const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
            for (const k in attrs) el.setAttribute(k, attrs[k])
            return el
          }
          svg.appendChild(mk('path', { d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z', fill: 'currentColor' }))
          icon.replaceWith(svg)
          btn.dataset.memeNav = '1'
        }
      }
      const observer = new MutationObserver(() => { decorateMemeText(); decorateNavIcon() })
      observer.observe(document.body, { childList: true, subtree: true })
      decorateMemeText()
      decorateNavIcon()
      ctx.effect(() => () => { observer.disconnect() }, 'dsh-expression-entry: meme text observer')

      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'memes', order: 25, label: '表情包' },
        () => React.createElement(MemePanel, { ctx }),
      ))

      // 输入框快捷发图(QQ 式)。
      const store = makeMemeStore()
      slots.inject('conversation.input.left', () => slots.register(
        { name: 'conversation.input.left', id: 'meme-picker', order: 5, label: '表情包' },
        (props) => React.createElement(makeMemeButton(store), { input: props.input }),
      ))
      slots.inject('conversation.input.overlay', () => slots.register(
        { name: 'conversation.input.overlay', id: 'meme-picker', order: 5, label: '表情包' },
        (props) => React.createElement(MemeBoard, {
          store,
          inputActions: props.inputActions,
          getConversation: () => ctx.get('conversation'),
        }),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    // 纯函数导出仅用于回归测试(node --test),宿主/打包不消费
    exports.__test = { foldCaption, looseCaption, splitDescTokens, buildMemeSearch, matchDesc }
    return module.exports
  },
})
