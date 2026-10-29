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
      '.meme-panel .meme-thumb{width:100%;height:120px;background-size:contain;background-position:center center;background-repeat:no-repeat;background-color:var(--dsw-alias-bg-base)}',
      '.meme-modal .meme-shot{width:100%;height:220px;border-radius:8px;background-size:contain;background-position:center center;background-repeat:no-repeat;background-color:var(--dsw-alias-bg-base)}',
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
      '.meme-modal .field{display:flex;flex-direction:column;gap:4px}',
      '.meme-modal input[type=text],.meme-modal select,.meme-modal textarea{box-sizing:border-box;width:100%}',
      '.meme-modal .field label{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.meme-modal .hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      // 即时校验:字段不合法时标签和边框变红,而不是等提交后在面板顶部报错
      '.meme-modal .field.bad label{color:#e5484d}',
      '.meme-modal .field.bad input[type=text]{border-color:#e5484d}',
      '.meme-modal .modal-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:2px}',
      '.meme-modal .modal-acts button{padding:6px 14px}',
      '.mk-tabs{display:flex;gap:18px;border-bottom:1px solid var(--dsw-alias-border-l1);width:100%}',
      '.meme-panel .mk-tab{border:none;background:transparent;cursor:pointer;font-size:13px;color:var(--dsw-alias-label-secondary);padding:4px 2px 8px;border-bottom:2px solid transparent;margin-bottom:-1px;border-radius:0;transition:color .12s}',
      '.meme-panel .mk-tab:hover{color:var(--dsw-alias-label-primary);background:transparent;border-color:transparent;border-bottom-color:transparent}',
      '.meme-panel .mk-tab.on{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.mk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;width:100%}',
      '.mk-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;transition:transform .12s ease,box-shadow .12s ease}',
      '.mk-card:hover{transform:translateY(-2px);box-shadow:0 5px 14px rgba(0,0,0,.12)}',
      '.mk-cover{position:relative;width:100%!important;height:136px!important;background-color:var(--dsw-alias-bg-base);display:flex;align-items:center;justify-content:center;font-size:26px;color:var(--dsw-alias-label-secondary)}',
      '.mk-cover-img{position:absolute;inset:0;background-size:cover;background-position:center 28%;background-repeat:no-repeat}',
      '.mk-cover-fallback{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-2))}',
      '.mk-body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:6px;flex:1}',
      '.mk-title{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.mk-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mk-meta{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mk-desc{font-size:12px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.mk-chips{display:flex;gap:4px;flex-wrap:wrap}',
      '.mk-chip{font-size:10px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:999px;padding:1px 8px}',
      '.mk-progress-wrap{display:flex;flex-direction:column;gap:3px}',
      '.mk-progress{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}',
      '.mk-progress-bar{height:100%;background:var(--dsw-alias-brand-primary);border-radius:999px;transition:width .3s ease}',
      '.mk-progress-text{font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.mk-progress-unknown{width:35%;animation:mk-slide 1.2s ease-in-out infinite}',
      '@keyframes mk-slide{0%{margin-left:0}50%{margin-left:65%}100%{margin-left:0}}',
      '.mk-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto}',
      '.mk-acts button{padding:3px 12px;font-size:12px;border-radius:6px}',
      '.mk-acts button.mk-danger:hover{border-color:#e5484d;color:#e5484d}',
      '.mk-empty{width:100%;color:var(--dsw-alias-label-secondary);padding:20px;text-align:center;border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;font-size:12px}',
      '.mk-card-open{cursor:pointer}',
      '.meme-modal-head{display:flex;align-items:flex-start;gap:8px;margin:-4px -4px 0 0}',
      '.meme-modal-head h3{flex:1;margin:0}',
      '.meme-panel .meme-x{flex:none;border:none;background:transparent;cursor:pointer;font-size:18px;line-height:1;padding:2px 8px;border-radius:6px;color:var(--dsw-alias-label-secondary)}',
      '.meme-panel .meme-x:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:transparent}',
      '.mk-preview{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px;max-height:300px;overflow:auto;padding:2px}',
      '.mk-preview a{display:block;height:84px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background-size:contain;background-position:center;background-repeat:no-repeat;background-color:var(--dsw-alias-bg-base)}',
      '.meme-panel .meme-footer{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;margin-top:8px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.meme-panel .meme-footer a{color:var(--dsw-alias-brand-primary);text-decoration:none;white-space:nowrap}',
      '.meme-panel .meme-footer a:hover{text-decoration:underline}',
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
    // 下拉框选项文案:标准情绪给「中文 (tag)」,自定义分类(扫描/用户新建)直接显示原名,
    // 别出现「misc (misc)」这种废话
    const tagLabel = (t) => (TAG_ZH[t] ? tagZh(t) + ' (' + t + ')' : t)

    // 归属 id:必须等于模块注册 id(loader entry 名 = dsh-meme),宿主按同一个 id 摘标签。
    const STYLE_OWNER_ID = 'dsh-meme'

    /**
     * 建一个归属本插件的 <style>。
     *
     * 宿主的客户端模块系统在工厂体跑完后才 claimStyles:它把「当时所有无主 style」认到刚
     * 物化的那个模块名下,那个模块之后一变更(改它自己的 client.js / 热重载)就被
     * removeOwnedStyles 连标签删掉 —— 表现是设置页整套样式消失、重启宿主才好,且归属由物化
     * 顺序决定,很难复现(issue #32)。预标记的标签不会被认领,所以每个 style 都要打上。
     */
    function createOwnedStyle(css) {
      const el = document.createElement('style')
      el.setAttribute('data-plugin', STYLE_OWNER_ID)
      el.textContent = css
      document.head.appendChild(el)
      return el
    }

    /**
     * 交互控件里的 `<img>`(宿主交付卡片「用 xx 打开」按钮的应用图标、文件类型图标等)
     * 点它的语义是按钮动作不是看图,点击手势要放行。类名是 CSS module 哈希值
     * (OMoRSG_*),判交互只能靠语义标签和 role;input/select 这些放进来纯属保险。
     * 模块级常量:光标重置 CSS 也按它生成。
     */
    const INTERACTIVE_IMG_SEL = 'button,a,[role="button"],[role="link"],[role="menuitem"],[role="tab"],input,select,textarea,label,summary'

    /**
     * 点击聊天里的图放大查看:滚轮缩放、双击复位、Esc 或点背景关闭。
     *
     * 只认**消息正文里的图**和本插件提到行首的 `img[data-meme-img]` —— 消息正文在宿主的
     * 内容槽 `[data-slot="conversation.chat.node"]` 里。别的插件(比如自定义会话头像)也会
     * 往 FlowItem 行里注入装饰性图片,它们是内容槽的兄弟节点,按整行认会连装饰图一起放大
     * 并显示 zoom-in 光标(issue #44)。输入框预览、面板缩略图、遮罩里自己那张也都不碰。
     * 内容槽里还塞着宿主的交付卡片,卡片按钮图标同样是 `<img>`,也在交互控件判定上放过
     * (issue #57)——交付卡片整体在槽内,按槽认会连按钮图标一起放大并吞掉按钮的手势。
     * 监听挂在 document 的**捕获阶段**、装一次就够:流式输出期间消息行反复重建,
     * 挂在容器上的监听会跟着丢。
     *
     * @param {Document} [doc] 测试注入用;缺省取全局 document
     * @returns {() => void} 卸载:摘监听、摘遮罩
     */
    function installMemeZoom(doc) {
      const d = doc || (typeof document === 'undefined' ? null : document)
      // 回归测试里那些只搭了必要部分的假 document 可能不给 addEventListener:那种环境
      // 直接不装 —— 真实宿主一定有。别为一个可选增强把整个 apply() 带崩。
      if (!d || typeof d.addEventListener !== 'function' || d.__dshMemeZoom) return () => {}
      d.__dshMemeZoom = true

      let box = null
      let pic = null
      let scale = 1

      const close = () => {
        if (!box) return
        box.style.display = 'none'
        scale = 1
        pic.style.transform = 'scale(1)'
      }

      const ensure = () => {
        if (box) return box
        box = d.createElement('div')
        box.setAttribute('data-meme-zoom', '1')
        box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.78);backdrop-filter:blur(6px);cursor:zoom-out;padding:24px;box-sizing:border-box'
        pic = d.createElement('img')
        pic.setAttribute('data-meme-zoom-img', '1')
        pic.style.cssText = 'max-width:100%;max-height:100%;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.6);display:block;transition:transform .12s ease-out;transform-origin:center center'
        box.appendChild(pic)
        const tip = d.createElement('div')
        tip.textContent = '滚轮缩放 · 双击复位 · Esc 或点背景关闭'
        tip.style.cssText = 'position:absolute;bottom:18px;left:0;right:0;text-align:center;color:rgba(255,255,255,.72);font-size:12px;pointer-events:none'
        box.appendChild(tip)
        box.addEventListener('click', (e) => { if (e.target === box) close() })
        box.addEventListener('wheel', (e) => {
          e.preventDefault()
          scale = Math.min(6, Math.max(.4, scale * (e.deltaY < 0 ? 1.15 : .87)))
          pic.style.transform = 'scale(' + scale + ')'
        }, { passive: false })
        box.addEventListener('dblclick', () => { scale = 1; pic.style.transform = 'scale(1)' })
        ;(d.body || d.documentElement).appendChild(box)
        return box
      }

      const open = (url, alt) => {
        if (!url) return
        ensure()
        pic.src = url
        pic.alt = alt || ''
        scale = 1
        pic.style.transform = 'scale(1)'
        box.style.display = 'flex'
      }

      const onKeydown = (e) => { if (e.key === 'Escape') close() }
      const onClick = (e) => {
        const t = e.target
        if (!t || t.tagName !== 'IMG' || t === pic) return
        // 只认消息正文里的图,加上本插件自己提到行首的 img[data-meme-img];
        // 行里其它插件注入的装饰图不在内容槽内、也没有我们的标记,直接放过(issue #44)。
        if (!t.closest) return
        if (!t.closest('img[data-meme-img]') && !t.closest('[data-slot="conversation.chat.node"]')) return
        // 交互控件里的图标放过:捕获层不吃 preventDefault/stopPropagation,
        // 让控件自己的 onClick(冒泡/目标阶段)照常收到这一下(issue #57)。
        if (t.closest(INTERACTIVE_IMG_SEL)) return
        e.preventDefault()
        e.stopPropagation()
        open(t.currentSrc || t.src, t.alt)
      }

      d.addEventListener('keydown', onKeydown, true)
      d.addEventListener('click', onClick, true)

      return () => {
        d.removeEventListener('keydown', onKeydown, true)
        d.removeEventListener('click', onClick, true)
        if (box && box.parentNode) box.parentNode.removeChild(box)
        box = null
        pic = null
        delete d.__dshMemeZoom
      }
    }

    async function apiGet(params) {
      const qs = new URLSearchParams()
      if (params.tag) qs.set('tag', params.tag)
      if (params.q) qs.set('q', params.q)
      if (params.remoteDir) qs.set('remoteDir', '1')
      return (await fetch('/dsh-memes-api?' + qs.toString())).json()
    }
    // 管理页和气泡装饰共享变更通知,避免发图面板已看到新库而气泡仍查旧索引(#39)。
    let memeLibraryRevision = 0
    const memeIndexListeners = new Set()
    // 表情排布模式(issue #50):inline = 图与正文并排(默认,行为同旧版);stacked = 图
    // 独占一行在上、正文按正常宽度铺开在下。设置页(排布下拉框)和 host 的索引/设置
    // 响应都会回写这里;翻转只改行元素上的 data-meme-layout 属性,排布交给 CSS,
    // 不动行布置 JS。放在模块级:管理页与气泡装饰两个作用域都要读写同一个值。
    let memeLayoutMode = 'inline'
    const applyMemeLayout = () => {
      for (const img of document.querySelectorAll('img[data-meme-img]')) {
        const row = img.closest('[data-time-hover-root],[data-chat-flow-key]')
        if (!row) continue
        if (memeLayoutMode === 'stacked') row.setAttribute('data-meme-layout', 'stacked')
        else row.removeAttribute('data-meme-layout')
      }
    }
    const setMemeLayoutMode = (mode) => {
      const next = mode === 'stacked' ? 'stacked' : 'inline'
      if (next === memeLayoutMode) return
      memeLayoutMode = next
      applyMemeLayout()
    }
    const completedRemoteJobs = new Set()
    const memeMutationOps = new Set([
      'importMemePack', 'createMemePack', 'deleteMemePack', 'setPack', 'setMemeRoot',
      'setPacksDir', 'setPackEnabled', 'upload', 'update', 'delete', 'deleteTag', 'scanPack',
    ])
    const invalidateMemeLibrary = () => {
      memeLibraryRevision++
      pickerCache = null
      for (const listener of memeIndexListeners) listener()
    }
    async function apiPost(payload) {
      const res = await (await fetch('/dsh-memes-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })).json()
      if (res && res.ok) {
        const finished = res.state === 'done' || res.state === 'done-with-errors'
        const jobId = res.id || payload.jobId
        if (payload.op === 'remoteJobStatus' && finished && !completedRemoteJobs.has(jobId)) {
          completedRemoteJobs.add(jobId)
          invalidateMemeLibrary()
        } else if (memeMutationOps.has(payload.op) || (payload.op === 'updateRemotePack' && !res.state)) {
          invalidateMemeLibrary()
        }
      }
      return res
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
      const [packId, setPackId] = React.useState('')
      const [packs, setPacks] = React.useState([])
      const [packsDir, setPacksDir] = React.useState('')
      const [packsDirInput, setPacksDirInput] = React.useState('')
      const [rootNotice, setRootNotice] = React.useState('')
      const [browseOpen, setBrowseOpen] = React.useState(false)
      const [browseList, setBrowseList] = React.useState(null)
      const [browseErr, setBrowseErr] = React.useState('')
      const [companionPrompt, setCompanionPrompt] = React.useState('') // 用户自定义覆盖(空=默认)
      const [defaultPrompt, setDefaultPrompt] = React.useState('') // 内置默认提示词
      const [promptOpen, setPromptOpen] = React.useState(false)
      const [promptDraft, setPromptDraft] = React.useState('') // 弹窗内草稿
      // Agent 说明(AGENTS.md)的查看/编辑:session 开局自动进上下文,给在插件目录里干活的 agent 看
      const [agentsOpen, setAgentsOpen] = React.useState(false)
      const [agentsDraft, setAgentsDraft] = React.useState('')
      const [agentsSaving, setAgentsSaving] = React.useState(false)
      const [remoteSubs, setRemoteSubs] = React.useState([])
      const [remoteDir, setRemoteDir] = React.useState(null) // 服务端代拉的图库目录(null=暂不可用)
      // 目录元信息:source=这次成功的源 URL,cached=来自磁盘缓存,error=全失败时的最后一条错误
      const [remoteDirSource, setRemoteDirSource] = React.useState('')
      const [remoteDirCached, setRemoteDirCached] = React.useState(false)
      const [remoteDirError, setRemoteDirError] = React.useState('')
      const [remoteDirUrlSetting, setRemoteDirUrlSetting] = React.useState('') // 用户设置的目录源原始串(空=自动)
      const [dirDraft, setDirDraft] = React.useState('') // 设置页「自定义地址」输入框草稿
      const dirDraftTouched = React.useRef(false) // 草稿被用户动过就别让 applyRoot 抢内容
      const [dirMode, setDirMode] = React.useState('auto') // 目录源下拉框:auto/official/mirror/custom
      // 设置值 → 下拉框选项值(空=自动;预设原样;其它一律当自定义 URL)
      const dirModeOf = (setting) => {
        const value = String(setting || '').trim()
        if (!value || value.toLowerCase() === 'auto') return 'auto'
        return value === 'official' || value === 'mirror' ? value : 'custom'
      }
      const DIR_MODE_LABELS = {
        auto: '自动(内置多镜像)',
        official: '官方源(GitHub 直连)',
        mirror: '镜像源(国内加速)',
        custom: '自定义地址',
      }
      // 挂载即拉目录:初值 true,别让空态/错误态先闪一下再变 loading
      const [remoteDirLoading, setRemoteDirLoading] = React.useState(true)
      const [remoteJobs, setRemoteJobs] = React.useState({})
      const [remoteBusy, setRemoteBusy] = React.useState(false)
      const [panelTab, setPanelTab] = React.useState('library')
      const [remoteQuery, setRemoteQuery] = React.useState('')
      const [packView, setPackView] = React.useState('') // 非空 = 进入该图库的表情包页(二级页,不是标签页)
      const [promptOn, setPromptOn] = React.useState(true)
      // AI 发送方式:auto=按渠道自动 / text=纯文字不发图 / image=总是发图
      const [sendMode, setSendMode] = React.useState('auto')
      // QQ 发图尺寸:打开后 IM/QQ 发送前缩到 200-450px 长边(Web 仍用原图)
      const [qqSendResize, setQqSendResize] = React.useState(false)
      const [qqSendEdge, setQqSendEdge] = React.useState(300)
      const [qqSendResizeSupported, setQqSendResizeSupported] = React.useState(true)
      // 发图概率:打开后每轮按概率决定是否主动发图(仅「自动」发送方式);默认关
      const [sendChanceOn, setSendChanceOn] = React.useState(false)
      const [sendChance, setSendChance] = React.useState(30)
      // 表情排布:inline=图文并排(默认) / stacked=图独占一行(issue #50)
      const [layoutMode, setLayoutMode] = React.useState('inline')
      // 局域网访问图库(issue #54):默认仅本机;打开后手机/平板经局域网 IP 才能加载表情包
      const [allowLan, setAllowLan] = React.useState(false)
      const [pluginVersion, setPluginVersion] = React.useState('')
      const applyRoot = (res) => {
        if (!res || !res.ok) return
        setMemeRoot(res.memeRoot || '')
        setPackId(res.packId || '')
        setPacks(Array.isArray(res.packs) ? res.packs : [])
        setPromptOn(res.promptEnabled !== false)
        setSendMode(res.sendMode === 'text' || res.sendMode === 'image' ? res.sendMode : 'auto')
        setQqSendResize(res.qqSendResize === true)
        setQqSendEdge([200, 300, 400, 450].includes(Number(res.qqSendEdge)) ? Number(res.qqSendEdge) : 300)
        if (res.qqSendResizeSupported === false) setQqSendResizeSupported(false)
        else if (res.qqSendResizeSupported === true) setQqSendResizeSupported(true)
        setSendChanceOn(res.sendChanceEnabled === true)
        setSendChance(Number.isFinite(Number(res.sendChance)) ? Math.max(0, Math.min(100, Math.round(Number(res.sendChance)))) : 30)
        // 排布设置(old host 不带该字段,按默认并排处理),同时回写模块级状态
        // 让气泡装饰即时翻新(issue #50)
        setLayoutMode(res.layoutMode === 'stacked' ? 'stacked' : 'inline')
        setMemeLayoutMode(res.layoutMode)
        setAllowLan(res.allowLanAccess === true)
        setPluginVersion(res.pluginVersion || '')
        setPacksDir(res.packsDir || '')
        setPacksDirInput(res.packsDir || '')
        setCompanionPrompt(res.companionPrompt || '')
        setDefaultPrompt(res.defaultCompanionPrompt || '')
        setRemoteSubs(Array.isArray(res.remoteSubs) ? res.remoteSubs : [])
        // 目录源设置(原始字符串,空 = 自动)。别覆盖正在编辑的草稿:用户输入到一半时
        // 别的 op 回来一次 applyRoot 就把输入框内容抢走,很难解释。
        setRemoteDirUrlSetting(String(res.remoteDirUrlSetting || ''))
        if (!dirDraftTouched.current) {
          setDirDraft(String(res.remoteDirUrlSetting || ''))
          setDirMode(dirModeOf(res.remoteDirUrlSetting))
        }
      }
      // 图库目录:挂载时拉一次;发现页「重试」、设置里保存目录源之后复用同一个函数。
      // 目录由 host 代拉(多镜像竞速 + 磁盘缓存),浏览器只负责展示。null = 彻底拉不到,
      // 要和「空数组 = 目录真的没内容」分开,否则用户只看得到一句含糊的「不可用」。
      const loadRemoteDir = async () => {
        setRemoteDirLoading(true)
        try {
          const res = await apiGet({ remoteDir: 1 })
          if (!res || !res.ok) {
            setRemoteDir(null)
            setRemoteDirSource('')
            setRemoteDirCached(false)
            setRemoteDirError(String((res && res.error) || ''))
            return
          }
          setRemoteDir(Array.isArray(res.remoteDir) ? res.remoteDir : null)
          setRemoteDirSource(res.remoteDirSource || '')
          setRemoteDirCached(res.remoteDirCached === true)
          setRemoteDirError(typeof res.remoteDirError === 'string' ? res.remoteDirError : '')
          // 旧 host 没有这个字段,undefined 时保持 applyRoot 同步过的值
          if (typeof res.remoteDirUrlSetting === 'string' && !dirDraftTouched.current) {
            setRemoteDirUrlSetting(res.remoteDirUrlSetting)
            setDirDraft(res.remoteDirUrlSetting)
            setDirMode(dirModeOf(res.remoteDirUrlSetting))
          }
        } catch (e) {
          setRemoteDir(null)
          setRemoteDirError(e && e.message ? e.message : String(e))
        } finally {
          setRemoteDirLoading(false)
        }
      }
      // 保存图库目录源(空串 = 恢复自动):写 settings 后 host 会清目录缓存,这里立刻
      // 重拉一次,让设置页「当前源」和发现页马上反映新配置,而不是等下次挂载。
      const saveRemoteDirUrl = async (value) => {
        const next = String(value == null ? '' : value).trim()
        try {
          const res = await apiPost({ op: 'setRemoteDirUrl', remoteDirUrl: next })
          if (!res || !res.ok) {
            setRootNotice('保存失败: ' + ((res && res.error) || ''))
            setDirMode(dirModeOf(remoteDirUrlSetting)) // 保存失败别让下拉框停在错误选项
            return
          }
          // 新 host 会带完整 pack 字段;极简响应(只有 ok)别拿空值把现有状态覆盖掉
          if (Array.isArray(res.packs)) applyRoot(res)
          dirDraftTouched.current = false
          setDirDraft(next)
          setRemoteDirUrlSetting(next)
          setDirMode(dirModeOf(next))
          setRootNotice(res.message || '已保存图库目录源')
          loadRemoteDir()
        } catch (e) {
          setRootNotice('保存失败: ' + (e && e.message ? e.message : String(e)))
          setDirMode(dirModeOf(remoteDirUrlSetting))
        }
      }
      // 下拉框切换:自动/官方/镜像立即保存并重拉目录;自定义只展开输入框,点保存才提交
      const onPickDirMode = (mode) => {
        setDirMode(mode)
        if (mode === 'custom') {
          dirDraftTouched.current = true
          setDirDraft(remoteDirUrlSetting || '')
          return
        }
        saveRemoteDirUrl(mode === 'auto' ? '' : mode)
      }
      // 设置页「当前源」:显示真正拉通的源 host(用户只关心哪个域名能用);
      // 解析不出 host 就原样显示,别为一个畸形 URL 把整页渲染搞崩
      const dirSourceStatus = () => {
        if (remoteDirSource) {
          let host = remoteDirSource
          try { host = new URL(remoteDirSource).host } catch (e) { /* 保留原文 */ }
          return '当前源:' + host
        }
        if (remoteDirCached) return '当前使用本地缓存'
        return '当前:' + (DIR_MODE_LABELS[dirMode] || dirMode)
      }
      const localPackCards = packs.map((p) => {
        const entry = (remoteDir || []).find((e) => e.id === p.id) || null
        const sub = remoteSubs.find((s) => s.id === p.id) || null
        const isBundled = p.source === 'bundled'
        const isUserPack = p.source === 'user'
        const count = p.count || 0
        // 本地版本:市场装的看订阅记录,内置/导入/自建看自己的 manifest
        const installed = String((sub && sub.version) || p.version || '').trim()
        const hasUpdate = !!(entry && entry.version && installed && compareVersions(entry.version, installed) > 0)
        return {
          key: 'pack-' + p.id, packId: p.id,
          name: p.name || p.id, desc: '',
          // 已安装的图库用本地那张图当封面(插件自己的路由),不再依赖远程预览图
          cover: p.cover || null,
          meta: [
            isBundled ? '内置' : (isUserPack ? '导入' : '自定义'),
            installed ? 'v' + installed.replace(/^v/i, '') : '',
            count ? count + ' 张' : '',
            p.size ? fmtBytes(p.size) : '',
            hasUpdate ? '可更新到 v' + String(entry.version).replace(/^v/i, '') : '',
          ].filter(Boolean).join(' · '),
          tags: (entry && (entry.keywords || entry.tags)) || [],
          entry, sub,
          installed: true, job: null,
          downloaded: true,
          hasUpdate,
          builtin: isBundled,
          enabled: p.enabled === true,
          onToggle: (next) => onTogglePack(p.id, next),
          pack: p,
        }
      })
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
      // AGENTS.md:打开时拉当前内容进编辑框,保存写回插件包根目录
      const openAgentsMd = async () => {
        try {
          const res = await apiPost({ op: 'getAgentsMd' })
          if (!res || !res.ok) { setRootNotice('读取失败: ' + ((res && res.error) || '')); return }
          setAgentsDraft(res.content || '')
          setAgentsOpen(true)
        } catch (e) {
          setRootNotice('读取失败: ' + (e && e.message ? e.message : String(e)))
        }
      }
      const onSaveAgentsMd = async () => {
        if (agentsSaving) return
        setAgentsSaving(true)
        try {
          const res = await apiPost({ op: 'setAgentsMd', content: agentsDraft })
          if (res && res.ok) {
            setAgentsOpen(false)
            setRootNotice(res.message || 'AGENTS.md 已保存')
          } else {
            setRootNotice('保存失败: ' + ((res && res.error) || ''))
          }
        } catch (e) {
          setRootNotice('保存失败: ' + (e && e.message ? e.message : String(e)))
        } finally {
          setAgentsSaving(false)
        }
      }
      React.useEffect(() => {
        apiPost({ op: 'getMemeRoot' }).then(applyRoot).catch(() => {})
      }, [])
      // 图库目录:挂载时拉一次。失败可在发现页点「重试」,设置里保存目录源后也会重拉。
      React.useEffect(() => { loadRemoteDir() }, [])
      const pollRemoteJob = async (jobId) => {
        try {
          const res = await apiPost({ op: 'remoteJobStatus', jobId })
          if (!res || !res.ok) {
            setRemoteJobs((cur) => { const n = { ...cur }; delete n[jobId]; return n })
            return
          }
          if (res.state === 'running') {
            setRemoteJobs((cur) => ({ ...cur, [jobId]: res }))
            return
          }
          setRemoteJobs((cur) => { const n = { ...cur }; delete n[jobId]; return n })
          setRootNotice(res.message || (res.state === 'error' ? '下载失败' : '远程图库已就绪'))
          if (res.state !== 'error') {
            await load('', '')
            apiPost({ op: 'getMemeRoot' }).then(applyRoot).catch(() => {})
          }
        } catch (e) { /* 下一轮轮询再试 */ }
      }
      React.useEffect(() => {
        const ids = Object.keys(remoteJobs)
        if (ids.length === 0) return
        const t = setInterval(() => { for (const id of ids) pollRemoteJob(id) }, 1200)
        return () => clearInterval(t)
      }, [remoteJobs])
      const startRemote = async (manifestUrl, packId) => {
        const url = String(manifestUrl || '').trim()
        if (!url) { setRootNotice('先填远程图库清单 JSON 地址'); return }
        setRemoteBusy(true)
        try {
          const res = await apiPost({ op: 'subscribeRemote', manifestUrl: url, packId: packId || '' })
          if (res && res.ok) {
            setRemoteJobs((cur) => ({ ...cur, [res.id]: res }))
            setRemoteUrl('')
            setRootNotice('「' + res.name + '」开始下载(' + res.total + ' 张),完成后自动切换')
          } else {
            setRootNotice('订阅失败: ' + ((res && res.error) || '未知错误'))
          }
        } catch (e) {
          setRootNotice('订阅失败: ' + (e && e.message ? e.message : String(e)))
        }
        setRemoteBusy(false)
      }
      const startArchive = async (entry) => {
        const archiveUrl = String((entry && entry.archiveUrl) || '').trim()
        if (!archiveUrl) { setRootNotice('该图库没有可下载的 ZIP 地址'); return }
        setRemoteBusy(true)
        setRootNotice('正在下载并校验「' + (entry.name || entry.id || '图库') + '」…')
        try {
          const res = await apiPost({
            op: 'installRemoteArchive', archiveUrl,
            sha256: entry.sha256 || '', packId: entry.id || '',
            name: entry.name || '', version: entry.version || '',
          })
          if (res && res.ok) {
            // 走任务制:注册后由轮询更新进度条,装完 pollRemoteJob 会刷新列表
            setRemoteJobs((cur) => ({ ...cur, [res.id]: res }))
            setRootNotice('「' + (entry.name || entry.id || '图库') + '」开始下载安装…')
          } else {
            setRootNotice('安装失败: ' + ((res && res.error) || '未知错误'))
          }
        } catch (e) {
          setRootNotice('安装失败: ' + (e && e.message ? e.message : String(e)))
        }
        setRemoteBusy(false)
      }
      // 图库卡片「导出」:导出指定图库的 ZIP(不必先切过去)
      const onExportPack = async (id, name) => {
        try {
          setRootNotice('正在导出…')
          const response = await fetch('/dsh-memes-export?packId=' + encodeURIComponent(id))
          if (!response.ok) throw new Error((await response.text()) || '导出失败')
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = 'dsh-meme-' + id + '.zip'
          document.body.appendChild(link)
          link.click()
          link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 60000)
          setRootNotice('已导出「' + (name || id) + '」的 ZIP')
        } catch (error) {
          setRootNotice(error.message || '导出失败，请重试')
        }
      }
      // 图库卡片开关:打开后模型可以用这个图库发图
      const onTogglePack = async (id, next) => {
        try {
          const res = await apiPost({ op: 'setPackEnabled', packId: id, enabled: next })
          if (!res || !res.ok) throw new Error((res && res.error) || '操作失败')
          applyRoot(res)
          setRootNotice(res.message || '')
        } catch (error) { setRootNotice(error.message || '操作失败') }
      }
      const onDeletePack = async (id) => {
        try {
          const res = await apiPost({ op: 'deleteMemePack', packId: id })
          if (!res || !res.ok) throw new Error((res && res.error) || '删除失败')
          applyRoot(res)
          if (packView === id) setPackView('')
          setRootNotice(res.message || '已删除')
          await load('', '')
        } catch (error) { setRootNotice(error.message || '删除失败') }
      }
      // 预览弹窗:已装的图库列它自己的图,没装的用目录里带的预览图
      const openPreview = async (row) => {
        const entry = row.entry || {}
        const catalogImages = [
          ...(entry.preview ? [entry.preview] : []),
          ...(Array.isArray(entry.previews) ? entry.previews : []),
        ]
        setPreviewPack({
          packId: row.packId || '', name: row.name || '', meta: row.meta || '',
          desc: row.desc || '', tags: row.tags || [],
          images: [...new Set(catalogImages)].filter(Boolean),
          total: Number(entry.count) || 0,
          // 已装的读本地图库、清单包读清单:这两种拿到的都是图库自己的图,能说「显示前 N 张」
          loading: !!(row.downloaded && row.packId) || !!entry.manifestUrl,
        })
        // 清单热链的包:没装也能看它列出的图(清单里有全部 128 条,比目录里那 19 张精选全)
        if ((!row.downloaded || !row.packId) && entry.manifestUrl) {
          try {
            const res = await apiPost({ op: 'previewManifest', manifestUrl: entry.manifestUrl })
            if (res && res.ok && Array.isArray(res.urls) && res.urls.length) {
              setPreviewPack((cur) => (cur && cur.packId === row.packId
                ? { ...cur, images: res.urls, total: Number(res.total) || res.urls.length, loading: false, fromPack: true }
                : cur))
              return
            }
          } catch (e) { /* 清单读不到就用目录里的预览图 */ }
        }
        if (!row.downloaded || !row.packId) {
          setPreviewPack((cur) => (cur && cur.packId === row.packId ? { ...cur, loading: false } : cur))
          return
        }
        try {
          const res = await fetch('/dsh-memes-api?packId=' + encodeURIComponent(row.packId)).then((r) => r.json())
          const urls = (res && Array.isArray(res.memes)) ? res.memes.map((m) => m.url).filter(Boolean) : []
          if (urls.length) {
            setPreviewPack((cur) => (cur && cur.packId === row.packId
              ? { ...cur, images: urls.slice(0, 60), total: urls.length, loading: false, fromPack: true }
              : cur))
            return
          }
        } catch (e) { /* 读不到就用目录里的预览图 */ }
        setPreviewPack((cur) => (cur && cur.packId === row.packId ? { ...cur, loading: false } : cur))
      }
      const onDeletePackPrompt = (row) => {
        setRootNotice('')
        setConfirmBox({
          title: '删除图库',
          lines: [
            '确认删除图库「' + (row.name || row.packId) + '」？',
            '该图库的目录和里面的图片都会被删掉，不可恢复。',
            ...(row.packId === packId ? ['这是当前图库（编辑/上传写进的那个），删除后会自动切到别的图库。'] : []),
            ...(row.builtin ? ['这是插件自带的内置图库，升级或重装插件后它会重新出现。'] : []),
          ],
          confirmLabel: '删除',
          onConfirm: () => onDeletePack(row.packId),
        })
      }
      // 图库卡片「编辑」:先切到该图库(上传/改/删只作用于当前图库),再进它的表情包页
      const onEditPack = async (id) => {
        const next = String(id || '').trim()
        if (!next) return
        try {
          if (next !== packId) {
            const res = await apiPost({ op: 'setPack', packId: next })
            if (!res || !res.ok) { setRootNotice('打开失败: ' + ((res && res.error) || '')); return }
            applyRoot(res)
          }
          setPackView(next)
          setQ('')
          setTagFilter('')
          await load('', '')
        } catch (e) { setRootNotice('打开失败') }
      }
      const onTogglePrompt = async (next) => {
        try {
          const res = await apiPost({ op: 'setPromptEnabled', enabled: next })
          if (res && res.ok) {
            applyRoot(res)
            setPromptOn(next)
            setRootNotice(res.message || (next ? '已开启陪伴提示词' : '已关闭陪伴提示词'))
          } else {
            setRootNotice('操作失败: ' + ((res && res.error) || ''))
          }
        } catch (e) { setRootNotice('操作失败') }
      }
      // 发送方式下拉框:立即保存(不需要「保存」按钮),失败回滚选中项
      const onPickSendMode = async (mode) => {
        const prev = sendMode
        setSendMode(mode)
        try {
          const res = await apiPost({ op: 'setSendMode', sendMode: mode })
          if (res && res.ok) {
            if (Array.isArray(res.packs)) applyRoot(res)
            setRootNotice(res.message || '已更新发送方式,下一条消息生效')
          } else {
            setSendMode(prev)
            setRootNotice('保存失败: ' + ((res && res.error) || ''))
          }
        } catch (e) {
          setSendMode(prev)
          setRootNotice('保存失败: ' + (e && e.message ? e.message : String(e)))
        }
      }
      // QQ 发图尺寸开关:立即保存,失败回滚。只影响 QQ/IM 的发送副本,Web 仍用原图。
      const onToggleQqSendResize = async (next) => {
        const prev = qqSendResize
        setQqSendResize(next)
        try {
          const res = await apiPost({ op: 'setQqSendResize', enabled: next, edge: qqSendEdge })
          if (res && res.ok) {
            applyRoot(res)
            setRootNotice(res.message || '已更新 QQ 发图尺寸')
          } else {
            setQqSendResize(prev)
            setRootNotice('保存失败: ' + ((res && res.error) || ''))
          }
        } catch (e) {
          setQqSendResize(prev)
          setRootNotice('保存失败: ' + (e && e.message ? e.message : String(e)))
        }
      }
      const onPickQqSendEdge = async (edge) => {
        const prev = qqSendEdge
        setQqSendEdge(edge)
        try {
          const res = await apiPost({ op: 'setQqSendResize', enabled: qqSendResize, edge })
          if (res && res.ok) {
            applyRoot(res)
            setRootNotice(res.message || '已更新 QQ 发图尺寸')
          } else {
            setQqSendEdge(prev)
            setRootNotice('保存失败: ' + ((res && res.error) || ''))
          }
        } catch (e) {
          setQqSendEdge(prev)
          setRootNotice('保存失败: ' + (e && e.message ? e.message : String(e)))
        }
      }
      // 发图概率:开关/概率立即保存(不需要「保存」按钮),失败回滚
      const onToggleSendChance = async (next) => {
        const prev = sendChanceOn
        setSendChanceOn(next)
        try {
          const res = await apiPost({ op: 'setSendChance', enabled: next, chance: sendChance })
          if (res && res.ok) {
            applyRoot(res)
            setRootNotice(res.message || (next ? '已开启发图概率' : '已关闭发图概率'))
          } else {
            setSendChanceOn(prev)
            setRootNotice('保存失败: ' + ((res && res.error) || ''))
          }
        } catch (e) {
          setSendChanceOn(prev)
          setRootNotice('保存失败: ' + (e && e.message ? e.message : String(e)))
        }
      }
      const onPickSendChance = async (chance) => {
        const prev = sendChance
        setSendChance(chance)
        try {
          const res = await apiPost({ op: 'setSendChance', enabled: sendChanceOn, chance })
          if (res && res.ok) {
            applyRoot(res)
            setRootNotice(res.message || '已更新发图概率')
          } else {
            setSendChance(prev)
            setRootNotice('保存失败: ' + ((res && res.error) || ''))
          }
        } catch (e) {
          setSendChance(prev)
          setRootNotice('保存失败: ' + (e && e.message ? e.message : String(e)))
        }
      }
      // 表情排布下拉框(issue #50):立即保存,失败回滚;切换只翻 data 属性,不动行布置
      const onPickLayoutMode = async (mode) => {
        const prev = layoutMode
        setLayoutMode(mode)
        try {
          const res = await apiPost({ op: 'setLayoutMode', layoutMode: mode })
          if (res && res.ok) {
            if (Array.isArray(res.packs)) applyRoot(res)
            setRootNotice(res.message || '已更新表情排布')
          } else {
            setLayoutMode(prev)
            setRootNotice('保存失败: ' + ((res && res.error) || ''))
          }
        } catch (e) {
          setLayoutMode(prev)
          setRootNotice('保存失败: ' + (e && e.message ? e.message : String(e)))
        }
      }
      // 扫描图库目录:把手动拷进去、还没进索引的图片收进来。动图 GIF 走这条路保真
      // (聊天附件通道会把 GIF 压成单帧);内置图库里扫到的会由 host 搬进「我的收藏」。
      const [scanning, setScanning] = React.useState(false)
      const onScanPack = async () => {
        if (!packView || scanning) return
        setScanning(true)
        try {
          const res = await apiPost({ op: 'scanPack', packId: packView })
          setRootNotice(res && res.ok ? (res.message || '扫描完成') : '扫描失败: ' + ((res && res.error) || ''))
          if (res && res.ok) {
            if (Array.isArray(res.packs)) applyRoot(res)
            await load('', '')
          }
        } catch (e) {
          setRootNotice('扫描失败: ' + (e && e.message ? e.message : String(e)))
        } finally {
          setScanning(false)
        }
      }
      // 局域网访问开关(issue #54):手机/平板经电脑局域网 IP 打开 DSH Web 时,
      // 图库四条路由默认只认回环 Host,打开这个才能加载表情包;失败回滚
      const onToggleAllowLan = async (next) => {
        try {
          const res = await apiPost({ op: 'setAllowLanAccess', enabled: next })
          if (res && res.ok) {
            applyRoot(res)
            setAllowLan(next)
            setRootNotice(res.message || (next ? '已允许局域网访问图库' : '已关闭局域网访问图库'))
          } else {
            setRootNotice('操作失败: ' + ((res && res.error) || ''))
          }
        } catch (e) { setRootNotice('操作失败') }
      }
      const [packDialog, setPackDialog] = React.useState('')
      const [packDraft, setPackDraft] = React.useState({ id: '', name: '', description: '' })
      const [packSaving, setPackSaving] = React.useState(false)
      // 新建弹窗的即时校验:规则与服务端 createMemePack 一致,不合法就别让点「创建」。
      // 红框只在碰过那个字段之后才显示——刚打开就一片红太吓人,空名字靠禁用按钮表达。
      const [packTouched, setPackTouched] = React.useState({})
      const packIdOk = /^[a-z0-9][a-z0-9_-]{0,39}$/.test(packDraft.id.trim())
      const packNameOk = packDraft.name.trim().length > 0
      const packDraftOk = packIdOk && packNameOk
      const packBad = (key) => !!packTouched[key] && !(key === 'id' ? packIdOk : packNameOk)
      const packSubmitOnEnter = (e) => { if (e.key === 'Enter' && packDraftOk && !packSaving) savePack() }
      // 应用内确认弹窗(不用浏览器原生 confirm):{title, lines, confirmLabel, onConfirm}
      const [confirmBox, setConfirmBox] = React.useState(null)
      const [previewPack, setPreviewPack] = React.useState(null) // 预览弹窗
      const [marketResult, setMarketResult] = React.useState('')
      const savePack = async () => {
        if (packSaving) return
        setPackSaving(true)
        setRootNotice('正在新建图库…')
        try {
          const res = await apiPost({ op: 'createMemePack', ...packDraft })
          if (!res || !res.ok) throw new Error(res && res.error || '操作失败')
          applyRoot(res)
          await load('', '')
          setQ('')
          setTagFilter('')
          setRootNotice('图库已新建并切换，可以开始添加图片')
          setPackDialog('')
        } catch (error) { setRootNotice(error.message || '操作失败，请重试') }
        finally { setPackSaving(false) }
      }
      const submitPack = async () => {
        if (packSaving) return
        const pack = packs.find(p => p.id === packId)
        if (!pack || !pack.count) { setRootNotice('空图库不能投稿，请先添加图片'); return }
        const params = new URLSearchParams({ template: 'submit-pack.yml',
          title: '[投稿] ' + pack.name, name: pack.name,
          description: (pack.description || '') + '\n图片数量：' + pack.count + '\n图库 ID：' + pack.id })
        const issueUrl = 'https://github.com/yyh-001/dsh-meme-packs/issues/new?' + params
        // Open synchronously in the click handler so browsers do not block the tab.
        const issueWindow = window.open('about:blank', '_blank')
        if (issueWindow) issueWindow.opener = null
        setPackSaving(true)
        setMarketResult('')
        setRootNotice('正在导出投稿 ZIP…')
        try {
          const response = await fetch('/dsh-memes-export?packId=' + encodeURIComponent(pack.id))
          if (!response.ok) throw new Error(await response.text() || '导出失败')
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = 'dsh-meme-' + pack.id + '.zip'
          document.body.appendChild(link)
          link.click()
          link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 60000)
          setMarketResult(issueUrl)
          if (issueWindow && !issueWindow.closed) issueWindow.location.href = issueUrl
          setPackDialog('')
          setRootNotice('已发起 ZIP 下载。请在 GitHub 投稿页登录，拖入下载的 ZIP，补充来源和许可后提交。尚未提交或收录；如果页面未打开，请点击下方链接。')
        } catch (error) {
          if (issueWindow && !issueWindow.closed) issueWindow.close()
          setRootNotice(error.message || '导出失败，请重试')
        } finally { setPackSaving(false) }
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
      // 目录浏览走插件自己的 API(宿主 0.1.5 的客户端没有 workspaces 服务,
      // 之前依赖它 → 点了「选择目录」什么都不发生)
      const browseFetch = async (path) => {
        const res = await apiPost({ op: 'browse', path: path || '' })
        if (!res || !res.ok) throw new Error((res && res.error) || '读取失败')
        return { path: res.path, parent: res.parent, entries: res.entries, breadcrumbs: res.breadcrumbs }
      }
      const browseTo = async (path) => {
        setBrowseErr('')
        try {
          setBrowseList(await browseFetch(path))
        } catch (e) {
          setBrowseErr('读取失败: ' + (e && e.message ? e.message : String(e)))
        }
      }
      const onPickDir = async () => {
        setBrowseErr('')
        setBrowseList(null)
        try {
          setBrowseList(await browseFetch(String(packsDirInput || '').trim()))
        } catch (e) {
          // 失败原因要说出来,否则用户看到的就是「点了没反应」
          setRootNotice('打开目录浏览器失败: ' + (e && e.message ? e.message : String(e)))
        }
        setBrowseOpen(true)
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
            if (Array.isArray(res.packs)) setPacks(previous => previous.map(p => ({ ...p, count: (res.packs.find(next => next.id === p.id) || p).count })))
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

      const onDeleteTag = (tagArg) => {
        const tag = tagArg || (upTag === '__new__' ? '' : String(upTag || '').trim())
        if (!tag) return
        setConfirmBox({
          title: '删除分类',
          lines: [
            '确认删除分类「' + tagZh(tag) + ' (' + tag + ')」？',
            '这个分类下的表情包会一起删掉，不可恢复。',
          ],
          confirmLabel: '删除分类',
          onConfirm: () => doDeleteTag(tag),
        })
      }
      const doDeleteTag = async (tag) => {
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
            setNotice(res && res.ok && res.meme
              ? '已上传: ' + res.meme.path + (res.message ? '(' + res.message + ')' : '')
              : '上传失败: ' + (res && res.error || ''))
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

      const onDelete = (m) => {
        setConfirmBox({
          title: '删除表情包',
          lines: ['确认删除这张表情包？', m.path, '不可恢复。'],
          confirmLabel: '删除',
          onConfirm: () => doDelete(m),
        })
      }
      const doDelete = async (m) => {
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
        tags.map((t) => h('option', { key: t, value: t }, tagLabel(t))),
      ])

      const fileInput = h('input', {
        ref: fileRef,
        type: 'file',
        accept: 'image/*',
        style: { display: 'none' },
        onChange: onPickFile,
      })

      const curPack = packs.find((p) => p.id === packId) || null
      const cards = memes.map((m) => h('div', { key: m.path, className: 'meme-card' },
        // 用背景层而不是 <img>:宿主对 img 的全局样式会把图挤到左边(封面那次踩过)
        h('div', { className: 'meme-thumb', style: { backgroundImage: 'url("' + m.url + '")' }, title: m.caption || m.file_name }),
        h('div', { className: 'meta' },
          h('div', { className: 'tag' }, tagZh(m.tag)),
          h('div', { className: 'cap' }, m.caption || m.file_name),
          m.size ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, fmtBytes(m.size)) : null,
          h('div', { className: 'acts' },
            h('button', { onClick: () => setEdit({ path: m.path, tag: m.tag, caption: m.caption || '', keywords: m.keywords || '' }) }, '编辑'),
            h('button', { className: 'danger', onClick: () => onDelete(m) }, '删除'),
          ),
        ),
      ))

      // 市场卡片:发现 = 目录条目;图库页 = 已安装图库(订阅记录 + 扫描到的本地图库)。搜索按 空格分词 全命中。
      const mkQuery = remoteQuery.trim().toLowerCase()
      const mkMatch = (hay) => !mkQuery || mkQuery.split(/\s+/).filter(Boolean).every((t) => hay.includes(t))
      const jobFor = (pid) => Object.values(remoteJobs).find((j) => j.packId === pid && j.state === 'running')
      const discoverCards = (() => {
        const cards = []
        for (const entry of (remoteDir || [])) {
          const pid = entry.id || ''
          const sub = remoteSubs.find((s) => s.id === pid)
            || remoteSubs.find((s) => s.url && s.url === entry.manifestUrl)
            || remoteSubs.find((s) => s.archiveUrl && s.archiveUrl === entry.archiveUrl)
            || null
          const keywords = Array.isArray(entry.keywords) ? entry.keywords : (Array.isArray(entry.tags) ? entry.tags : [])
          const author = entry.author || entry.maintainer || ''
          const hay = ((entry.name || '') + ' ' + author + ' ' + (entry.description || '') + ' ' + keywords.join(' ') + ' ' + pid).toLowerCase()
          if (!mkMatch(hay)) continue
          const local = pid ? packs.find((p) => p.id === pid) : null
          const downloaded = !!(pid && local)
          cards.push({
            key: 'dir-' + (pid || entry.manifestUrl || entry.archiveUrl), packId: pid,
            name: entry.name || pid, desc: entry.description || '',
            // 装过的用本地封面,没装的才用目录里的远程预览图
            cover: (downloaded && local.cover) ? local.cover : (entry.preview || (entry.previews || [])[0] || null),
            meta: [
              author,
              entry.version ? 'v' + String(entry.version).replace(/^v/i, '') : '',
              entry.count ? entry.count + ' 张' : '',
              entry.downloads ? '↓ ' + fmtCount(entry.downloads) : '',
            ].filter(Boolean).join(' · '),
            tags: keywords, entry, sub,
            installed: !!sub || downloaded,
            job: jobFor(pid),
            downloaded,
            downloads: Number(entry.downloads) || 0,
          })
        }
        // 默认按下载量排序;没有下载量的(清单热链的包、或额度/网络拉不到)排最后,
        // 同分保持目录原顺序(Array#sort 稳定)
        cards.sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
        return cards
      })()
      // 已安装:本地扫描到的图库(含内置/导入/自定义 + 下载的远程包)在前,订阅了但没扫到的追加在后
      const libraryCards = (() => {
        const cards = []
        for (const c of localPackCards) {
          const hay = ((c.name || '') + ' ' + c.packId + ' ' + (c.tags || []).join(' ') + ' ' + c.meta).toLowerCase()
          if (mkMatch(hay)) cards.push(c)
        }
        const seen = new Set(cards.map((c) => c.packId))
        for (const s of remoteSubs) {
          if (seen.has(s.id)) continue
          const hay = ((s.name || '') + ' ' + s.id + ' ' + (s.url || s.archiveUrl || '')).toLowerCase()
          if (!mkMatch(hay)) continue
          cards.push({
            key: 'sub-' + s.id, packId: s.id,
            name: s.name || s.id, desc: s.url || s.archiveUrl, cover: null,
            meta: ['未下载', s.version, s.total ? s.total + ' 张' : ''].filter(Boolean).join(' · '),
            tags: [], entry: null, sub: s,
            installed: true, job: jobFor(s.id),
            downloaded: false,
          })
        }
        return cards
      })()

      // 市场/图库共用的卡片:封面 + 名称 + 徽标 + meta + 标签 + 进度 + 操作
      const packCard = (row, acts, onOpen) => {
        const job = row.job
        const pct = job && job.total ? Math.round(((job.done + job.failed) / job.total) * 100) : 0
        return h('div', {
          key: row.key,
          className: 'mk-card' + (onOpen ? ' mk-card-open' : ''),
          // 整卡可点 = 打开预览;卡片内的按钮自己 stopPropagation,不会误触发
          ...(onOpen ? { onClick: () => onOpen(row), title: '点击打开' } : {}),
        },
          // 封面用背景图而不是 <img>:尺寸完全由我们这层样式决定,不受宿主对 img 的
          // 全局样式影响(之前实测在宿主里图片没铺满,露出一块空底色很难看)
          // 首字母始终是子节点:背景图正常时不透明看不见,加载失败(远程 404/断网)时就露出来,
          // 不会只留一块空白让人以为坏了 —— 之前 catalog 里漏了扩展名就是这个症状
          row.cover
            ? h('div', { className: 'mk-cover' },
              (row.name || '?').slice(0, 1),
              // 图片单独一层盖在首字母上面:加载成功(不透明)就看不见字,404/断网时露出来,
              // 不会只留一块空白让人以为坏了 —— catalog 里漏扩展名那次就是这个症状。
              // 远端预览图走 MemeRemoteImage(镜像逐个探测回退);本地图只有一个候选,行为不变。
              h(MemeRemoteImage, {
                className: 'mk-cover-img',
                src: row.cover,
                style: {
                  backgroundImage: 'url("' + imageUrl(row.cover) + '")',
                  backgroundSize: 'cover', backgroundPosition: 'center 28%', backgroundRepeat: 'no-repeat',
                },
              }))
            : h('div', { className: 'mk-cover mk-cover-fallback' }, (row.name || '?').slice(0, 1)),
          h('div', { className: 'mk-body' },
            h('div', { className: 'mk-title' },
              h('span', { className: 'mk-name', title: row.name }, row.name),
              // 开关:打开后模型可以用这个图库发图(可以同时开多个)
              row.onToggle
                ? h('span', {
                  className: 'switch' + (row.enabled ? ' on' : ''),
                  title: row.enabled ? '模型正在使用这个图库,点击关闭' : '点击打开:模型可以用这个图库发图',
                  // 开关自己吞掉点击:卡片整张可点(进表情包页 / 开预览),别误触发
                  onClick: (e) => { e.stopPropagation(); row.onToggle(!row.enabled) },
                })
                : null,
            ),
            row.meta ? h('div', { className: 'mk-meta', title: row.meta }, row.meta) : null,
            row.desc ? h('div', { className: 'mk-desc', title: row.desc }, row.desc) : null,
            row.tags && row.tags.length
              ? h('div', { className: 'mk-chips' }, row.tags.slice(0, 4).map((t) => h('span', { key: t, className: 'mk-chip' }, t)))
              : null,
            job ? h('div', { className: 'mk-progress-wrap' },
              h('div', { className: 'mk-progress' },
                // total 为 0 = 上游没给 content-length:画不确定进度条,别假装 100%
                job.total
                  ? h('div', { className: 'mk-progress-bar', style: { width: pct + '%' } })
                  : h('div', { className: 'mk-progress-bar mk-progress-unknown' })),
              h('span', { className: 'mk-progress-text' }, (job.message || '下载中…') + (job.total ? ' ' + pct + '%' : '')),
            ) : null,
            h('div', { className: 'mk-acts', onClick: (e) => e.stopPropagation() }, acts),
          ),
        )
      }
      // 更新:有订阅走订阅,否则回落到目录条目;没下载过就是「安装」
      const updateBtn = (row) => h('button', {
        key: 'update',
        onClick: row.sub
          ? () => (row.sub.archiveUrl ? startArchive(row.sub) : startRemote(row.sub.url, row.sub.id))
          : () => (row.entry.archiveUrl ? startArchive(row.entry) : startRemote(row.entry.manifestUrl, row.entry.id || '')),
        disabled: remoteBusy || !!row.job,
      }, row.downloaded ? '更新' : '安装')
      return h('div', { className: 'meme-panel' },
        h('div', { className: 'mk-tabs', style: { width: '100%', marginBottom: 2 } },
          h('button', { className: 'mk-tab' + (panelTab === 'library' ? ' on' : ''), onClick: () => setPanelTab('library') }, '图库' + (packs.length ? ' (' + packs.length + ')' : '')),
          h('button', { className: 'mk-tab' + (panelTab === 'market' ? ' on' : ''), onClick: () => { setRootNotice(''); setPanelTab('market') } }, '发现'),
          h('button', { className: 'mk-tab' + (panelTab === 'settings' ? ' on' : ''), onClick: () => setPanelTab('settings') }, '设置'),
        ),
        // 图库页两态:已安装图库列表 ⇄ 某个图库的表情包页(二级页面,不是二级标签)
        panelTab === 'library' ? (packView
          ? h(React.Fragment, null,
            h('div', { className: 'row', style: { width: '100%' } },
              h('button', { onClick: () => { setPackView(''); setRootNotice('') } }, '← 图库列表'),
              h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                (curPack ? curPack.name : packView) + ' · ' + total + ' 张'
                  + (curPack && curPack.size ? ' · ' + fmtBytes(curPack.size) : '')),
            ),
            memeRoot ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' } }, memeRoot) : null,
            h('div', { className: 'row' },
              searchInput,
              h('button', { className: 'btn-primary', onClick: () => setUploadOpen(true) }, '上传表情包'),
              tagSelect,
              h('button', { onClick: () => load(q, tagFilter), disabled: busy }, '搜索'),
              h('button', {
                onClick: onScanPack,
                disabled: scanning,
                title: '把图库目录里手动拷入、还没入索引的图片收进图库。动图 GIF 建议走这条路,原始动画保留',
              }, scanning ? '扫描中…' : '扫描新增'),
            ),
            notice ? h('div', { className: 'notice' }, notice) : null,
            memes.length === 0 && !busy
              ? h('div', { className: 'empty' }, '没有匹配的表情包')
              : h('div', { className: 'meme-grid' }, cards),
          )
          : h(React.Fragment, null,
            h('div', { className: 'row', style: { width: '100%' } },
              h('button', { className: 'btn-primary', disabled: packSaving, onClick: () => { setPackDraft({ id: 'pack-' + Date.now().toString(36), name: '', description: '' }); setPackTouched({}); setPackDialog('create') } }, '新建图包库'),
              h('button', { disabled: uploading, onClick: () => importFileRef.current && importFileRef.current.click() }, '导入图库'),
            ),
            h('input', { ref: importFileRef, type: 'file', accept: '.zip,application/zip', style: { display: 'none' }, onChange: onImportPack }),
            libraryCards.length === 0
              ? h('div', { className: 'empty' }, '还没有图库')
              : h('div', { className: 'mk-grid' }, libraryCards.map((row) => packCard(row, [
                row.downloaded
                  ? h('button', { key: 'export', onClick: () => onExportPack(row.packId, row.name) }, '导出')
                  : null,
                row.packId === packId && curPack && curPack.count > 0
                  ? h('button', { key: 'submit', disabled: packSaving, onClick: () => { setRootNotice(''); setPackDialog('submit') } }, '投稿')
                  : null,
                // 没下载的给「安装」,下载了且真有新版本才给「更新」
                (!row.downloaded || row.hasUpdate) ? updateBtn(row) : null,
                // 删除是唯一入口:内置、市场下载、自建/导入都走它(服务端也只留这一个 op)
                row.downloaded
                  ? h('button', { key: 'delete', className: 'mk-danger', disabled: packSaving, onClick: () => onDeletePackPrompt(row) }, '删除')
                  : null,
              ].filter(Boolean), () => onEditPack(row.packId)))),
          )
        ) : null,
        // 编辑弹窗
        edit ? h('div', { className: 'meme-modal-mask', onClick: () => setEdit(null) },
          h('div', { className: 'meme-modal', onClick: (e) => e.stopPropagation() },
            h('h3', null, '编辑表情包'),
            h('div', {
              className: 'meme-shot',
              style: { backgroundImage: 'url("' + (memes.find((m) => m.path === edit.path)?.url || '') + '")' },
            }),
            h('div', { className: 'field' },
              h('label', null, '分类'),
              h('div', { className: 'row', style: { width: '100%' } },
                h('select', { value: edit.tag, onChange: (e) => setEdit({ ...edit, tag: e.target.value }), style: { flex: 1 } },
                  (tags.includes(edit.tag) ? tags : [edit.tag, ...tags]).map((t) => h('option', { key: t, value: t }, tagLabel(t))),
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
              ? h('div', {
                className: 'meme-shot',
                style: { backgroundImage: 'url("' + upPreview + '")' },
                title: upFile.name,
              })
              : h('div', { className: 'empty', style: { padding: '24px', border: '1px dashed var(--dsw-alias-border-l1)', borderRadius: 8 } },
                  h('button', { onClick: () => fileRef.current && fileRef.current.click() }, '选择图片'),
              ),
            // 格式与动图说明:GIF 想保动画只能走这里或「扫描新增」——聊天附件通道
            // 会把动图压成单帧,这是宿主行为,插件侧无法还原。
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', width: '100%' } },
              '支持 jpg/png/gif/webp;动图 GIF 从这里上传保留动画,从聊天发给 AI 学图会被压成单帧'),

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
                  // 现有分类在前,标准情绪补在后:空库/新包也能直接选常用分类,
                  // 不必先「新建分类」再猜名字
                  [...new Set([...tags, ...Object.keys(TAG_ZH)])].map((t) => h('option', { key: t, value: t }, tagLabel(t))),
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
        panelTab === 'market' ? h(React.Fragment, null,
        h('div', { className: 'row', style: { width: '100%' } },
          h('input', {
            type: 'text', value: remoteQuery, onChange: (e) => setRemoteQuery(e.target.value),
            placeholder: '搜索图库…', style: { flex: 1, minWidth: 160 },
          }),
        ),
        // 磁盘缓存兜底:目录能看但资源可能下载失败,提前说清楚,免得用户点安装又撞墙
        remoteDirCached ? h('div', { className: 'notice', title: remoteDirError || undefined },
          '网络暂不可用,目录来自本地缓存,安装可能失败') : null,
        discoverCards.length === 0
          ? h('div', { className: 'mk-empty' },
              remoteDirLoading
                ? '正在拉取图库目录…'
                : (remoteDir === null
                    ? h(React.Fragment, null,
                        h('div', null, '图库目录暂不可用' + (remoteDirError ? ':' + String(remoteDirError).slice(0, 120) : '(检查网络或稍后重试)')),
                        h('button', { onClick: () => loadRemoteDir(), style: { marginTop: 8 } }, '重试'),
                        h('div', { style: { marginTop: 8, fontSize: 11, lineHeight: 1.6 } },
                          '国内网络可在 设置 → 图库目录源 选择「镜像源」;目录地址错误也会这样'))
                    : (mkQuery
                        ? '没有匹配的图库'
                        : h(React.Fragment, null,
                            h('div', null, '目录暂无内容'),
                            h('button', { onClick: () => loadRemoteDir(), style: { marginTop: 8 } }, '重试')))))
          : h('div', { className: 'mk-grid' }, discoverCards.map((row) => packCard(row, [
            // 发现页只负责装:装过的这里不给按钮,更新去图库页(有新版本才显示)
            row.downloaded ? null : h('button', {
              key: 'install',
              className: 'btn-primary',
              onClick: () => row.entry.archiveUrl
                ? startArchive(row.entry)
                : startRemote(row.entry.manifestUrl, row.entry.id || ''),
              disabled: remoteBusy || !!row.job,
            }, row.job ? '下载中…' : '安装'),
          ].filter(Boolean), () => openPreview(row)))),

        ) : null,
        panelTab === 'settings' ? h(React.Fragment, null,
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
        agentsOpen ? h('div', { className: 'meme-modal-mask', onClick: () => setAgentsOpen(false) },
          h('div', { className: 'meme-modal', style: { width: 520 }, onClick: (e) => e.stopPropagation() },
            h('h3', null, 'Agent 说明(AGENTS.md)'),
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
              '工作目录在插件里的 agent 新开会话时自动读到;进行中的会话不会热刷新。市场更新插件会覆盖此文件。'),
            h('textarea', {
              value: agentsDraft,
              onChange: (e) => setAgentsDraft(e.target.value),
              rows: 16,
              spellCheck: false,
              style: { boxSizing: 'border-box', width: '100%', minHeight: 320, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, lineHeight: 1.6, background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 8, whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto' },
            }),
            h('div', { className: 'modal-acts' },
              h('button', { onClick: () => setAgentsOpen(false) }, '取消'),
              h('button', { className: 'btn-primary', onClick: onSaveAgentsMd, disabled: agentsSaving }, agentsSaving ? '保存中…' : '保存'),
            ),
          ),
        ) : null,
        // 图库目录源:host 内置多镜像自动竞速;国内用户下拉选「镜像源」即可,不用手填地址
        h('div', { className: 'section-title' }, '图库目录源'),
        h('div', { className: 'row', style: { width: '100%' } },
          h('select', {
            value: dirMode,
            onChange: (e) => onPickDirMode(e.target.value),
            title: '自动 = 内置多镜像竞速;镜像源 = 只走国内加速节点;官方源 = 只直连 GitHub',
            style: { flex: 1, minWidth: 160 },
          },
            h('option', { value: 'auto' }, '自动(内置多镜像,推荐)'),
            h('option', { value: 'official' }, '官方源(GitHub 直连)'),
            h('option', { value: 'mirror' }, '镜像源(国内加速)'),
            h('option', { value: 'custom' }, '自定义地址…'),
          ),
        ),
        dirMode === 'custom' ? h('div', { className: 'row', style: { width: '100%' } },
          h('input', {
            type: 'text', value: dirDraft, maxLength: 500,
            placeholder: 'https://…/catalog.json(自定义图库目录清单地址)',
            onChange: (e) => { dirDraftTouched.current = true; setDirDraft(e.target.value) },
            onKeyDown: (e) => { if (e.key === 'Enter') saveRemoteDirUrl(dirDraft) },
            style: { flex: 1, minWidth: 160 },
          }),
          h('button', { className: 'btn-primary', onClick: () => saveRemoteDirUrl(dirDraft) }, '保存'),
        ) : null,
        h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', width: '100%' } }, dirSourceStatus()),
        // 底部:扫描目录 / 提示词(导入导出在图库页)
        h('div', { className: 'section-title' }, '扫描目录'),
        h('div', { className: 'row', style: { width: '100%' } },
          h('input', { type: 'text', value: packsDirInput, onChange: (e) => setPacksDirInput(e.target.value), placeholder: '自动扫描含 index.db 的子文件夹', style: { flex: 1, minWidth: 160 } }),
          h('button', { onClick: () => onPickDir() }, '选择目录'),
          h('button', { className: 'btn-primary', onClick: () => onSavePacksDir() }, '保存'),
        ),
        // 发送方式:只控制 AI 怎么发,不影响前端把 [表情: 描述] 配成图
        h('div', { className: 'section-title' }, '发送方式'),
        h('div', { className: 'row', style: { width: '100%' } },
          h('select', {
            value: sendMode,
            onChange: (e) => onPickSendMode(e.target.value),
            title: '控制 AI 怎么发图:自动 = Web 配图、IM 原生图片;纯文字 = 只用文字接梗;图片 = 每次都发图',
            style: { flex: 1, minWidth: 160 },
          },
            h('option', { value: 'auto' }, '自动(按渠道,推荐)'),
            h('option', { value: 'text' }, '纯文字(不发图)'),
            h('option', { value: 'image' }, '图片(总是发图)'),
          ),
        ),
        h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', width: '100%' } },
          sendMode === 'text'
            ? 'AI 只用文字接梗,不写 [表情: 描述] 标记,也不发表情图片'
            : sendMode === 'image'
              ? 'AI 每次斗图都必须把图片发出来:Web 显示图片,IM 发原生图片'
              : 'Web 聊天显示图片;QQ/微信等 IM 聊天发原生图片'),
        // QQ 发图尺寸:QQ 官方机器人没有表情类型,只能靠缩小让客户端按表情渲染
        h('div', { className: 'section-title' }, 'QQ 发图尺寸'),
        h('div', { className: 'row', style: { width: '100%' } },
          h('span', {
            className: 'switch' + (qqSendResize ? ' on' : ''),
            title: qqSendResize ? '点击关闭:QQ/IM 按原图发送' : '点击开启:QQ/IM 发送前缩到表情尺寸(Web 仍用原图)',
            onClick: () => onToggleQqSendResize(!qqSendResize),
          }),
          h('span', { style: { fontSize: 12 } }, qqSendResize ? '缩到表情尺寸' : '原图发送'),
          h('select', {
            value: qqSendEdge,
            onChange: (e) => onPickQqSendEdge(Number(e.target.value)),
            disabled: !qqSendResize,
            title: '发送长边(px);QQ 经验区间 200-450,300 比较稳',
            style: { width: 110, marginLeft: 8 },
          },
            [200, 300, 400, 450].map((n) => h('option', { key: n, value: n }, n + ' px')),
          ),
        ),
        h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', width: '100%' } },
          qqSendResizeSupported === false
            ? '当前环境没有可用的图片缩放组件(装 dsh-im 或 sharp 后生效),发送仍按原图'
            : qqSendResize
              ? 'QQ/IM 发图前把长边缩到 ' + qqSendEdge + 'px,Web 聊天仍用原图;GIF 保留动画。QQ 更容易按表情渲染,平板端不会拉伸满屏'
              : '保持原图发送。QQ 官方机器人没有表情类型,大图会被当图片消息;打开后缩到 200-450px 更容易被识别成表情'),
        // 发图概率:每轮(一条用户消息)由插件抽签,命中才允许 AI 主动发图;
        // 默认关 = 维持原来的「按提示词自由发挥」,用户明确要图时不受概率限制
        h('div', { className: 'section-title' }, '发图概率'),
        h('div', { className: 'row', style: { width: '100%' } },
          h('span', {
            className: 'switch' + (sendChanceOn ? ' on' : ''),
            title: sendChanceOn ? '点击关闭:恢复按提示词自由发图' : '点击开启:每轮按概率决定是否主动发图',
            onClick: () => onToggleSendChance(!sendChanceOn),
          }),
          h('span', { style: { fontSize: 12 } }, sendChanceOn ? '按概率发图' : '不限概率'),
          h('select', {
            value: sendChance,
            onChange: (e) => onPickSendChance(Number(e.target.value)),
            disabled: !sendChanceOn,
            title: '每轮主动发图的概率;用户明确要图时不受限制',
            style: { width: 110, marginLeft: 8 },
          },
            // 选项与 memes.js 的 SEND_CHANCE_OPTIONS 一致;手改设置里的非预设值也回显出来
            [...new Set([0, 10, 20, 30, 50, 70, 100, sendChance])].sort((a, b) => a - b)
              .map((n) => h('option', { key: n, value: n }, n + '%')),
          ),
        ),
        h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', width: '100%' } },
          !sendChanceOn
            ? '默认不限制:AI 按提示词自己决定发不发图'
            : sendChance === 0
              ? '每轮都不主动发图,只在你明确要图时才发'
              : '每轮按 ' + sendChance + '% 概率决定是否主动发图;你明确要图时不受概率限制。仅在「发送方式 = 自动」且开启陪伴提示词时生效'),
        // 表情排布:图文同条时怎么排,只影响前端渲染,默认并排不改已有观感(issue #50)
        h('div', { className: 'section-title' }, '表情排布'),
        h('div', { className: 'row', style: { width: '100%' } },
          h('select', {
            value: layoutMode,
            onChange: (e) => onPickLayoutMode(e.target.value),
            title: '图文同一条消息时怎么排:并排紧凑省纵向空间;独占一行正文按正常宽度铺开',
            style: { flex: 1, minWidth: 160 },
          },
            h('option', { value: 'inline' }, '并排(默认,紧凑)'),
            h('option', { value: 'stacked' }, '独占一行(正文铺开)'),
          ),
        ),
        h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', width: '100%' } },
          layoutMode === 'stacked'
            ? '表情图独占一行在上,正文按正常宽度铺开在下'
            : '表情图与正文并排,短消息更紧凑'),
        // 局域网访问(issue #54):手机/平板经电脑局域网 IP 打开 DSH Web 时加载表情包
        h('div', { className: 'section-title' }, '局域网访问图库'),
        h('div', { className: 'row' },
          h('span', {
            className: 'switch' + (allowLan ? ' on' : ''),
            title: allowLan ? '点击关闭:图库路由恢复只接受本机请求' : '点击开启:允许手机/平板经局域网 IP 加载表情包',
            onClick: () => onToggleAllowLan(!allowLan),
          }),
          h('span', { style: { fontSize: 12 } }, allowLan ? '已允许' : '仅本机'),
        ),
        h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', width: '100%' } },
          '手机/平板用电脑的局域网 IP 打开 DSH Web 时,打开它才能加载表情包;只放行 IP 字面量(域名始终拒绝),需同一 Wi-Fi 且系统防火墙放行该端口'),
        h('div', { className: 'section-title' }, '陪伴提示词'),
        h('div', { className: 'row' },
          h('span', {
            className: 'switch' + (promptOn ? ' on' : ''),
            title: promptOn ? '点击关闭:模型不再主动斗图' : '点击开启:模型主动斗图',
            onClick: () => onTogglePrompt(!promptOn),
          }),
          h('span', { style: { fontSize: 12 } }, promptOn ? '已开启' : '已关闭'),
          h('button', { onClick: () => { setPromptDraft(companionPrompt || defaultPrompt); setPromptOpen(true) } }, '编辑提示词'),
          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
            companionPrompt ? '已自定义' : '使用默认'),
        ),
        // Agent 说明:与陪伴提示词是两回事——这份给「在插件目录里干活的 agent」看,
        // session 开局自动进上下文;陪伴提示词才是每次聊天注入的斗图规则
        h('div', { className: 'section-title' }, 'Agent 说明(AGENTS.md)'),
        h('div', { className: 'row' },
          h('button', { onClick: openAgentsMd }, '查看 / 编辑'),
          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
            '给维护插件/整理图库的 agent 看的操作说明,新开会话自动带上。市场更新插件会覆盖此文件;要长期生效的约定放 ~/.dsh/AGENTS.md(全局)'),
        ),

        ) : null,
        rootNotice ? h('div', { className: 'notice' }, rootNotice) : null,
        marketResult ? h('a', { href: marketResult, target: '_blank', rel: 'noopener noreferrer' }, '打开 GitHub 投稿页') : null,
        // 页脚:版本号 + 求 star + 反馈入口
        h('div', { className: 'meme-footer' },
          pluginVersion ? h('span', { title: '当前运行的 dsh-meme 版本(读自插件包 package.json)' }, 'v' + pluginVersion) : null,
          pluginVersion ? h('span', null, '·') : null,
          h('span', null, '觉得好用？'),
          h('a', { href: 'https://github.com/yyh-001/dsh-meme', target: '_blank', rel: 'noopener noreferrer' }, '⭐ 去 GitHub 点个 Star'),
          h('span', null, '·'),
          h('a', {
            href: issueFormUrl(pluginVersion),
            target: '_blank', rel: 'noopener noreferrer',
          }, '💬 反馈建议 / 提 issue'),
        ),
        packDialog ? h('div', { className: 'meme-modal-mask', onClick: () => { if (!packSaving) setPackDialog('') } },
          h('div', {
            className: 'meme-modal',
            style: { width: packDialog === 'create' ? 400 : 440 },
            onClick: (e) => e.stopPropagation(),
          },
            h('div', { className: 'meme-modal-head' },
              h('h3', null, packDialog === 'create' ? '新建图包库' : '投稿到市场'),
              h('button', {
                className: 'meme-x', title: '关闭', 'aria-label': '关闭', disabled: packSaving,
                onClick: () => setPackDialog(''),
              }, '×'),
            ),
            rootNotice ? h('div', { className: 'notice', role: 'status' }, rootNotice) : null,
            packDialog === 'create' ? h(React.Fragment, null,
              h('div', { className: 'field' + (packBad('name') ? ' bad' : '') },
                h('label', null, '图库名称'),
                h('input', {
                  type: 'text', value: packDraft.name, maxLength: 60, autoFocus: true,
                  placeholder: '如：大肥鱼、官方表情包1号', disabled: packSaving,
                  onChange: (e) => { setPackTouched({ ...packTouched, name: true }); setPackDraft({ ...packDraft, name: e.target.value }) },
                  onKeyDown: packSubmitOnEnter,
                }),
                packBad('name') ? h('div', { className: 'hint' }, '起个名字——图库列表和模型都用它认这套图') : null,
              ),
              h('div', { className: 'field' + (packBad('id') ? ' bad' : '') },
                h('label', null, '图库 ID'),
                h('input', {
                  type: 'text', value: packDraft.id, maxLength: 40, disabled: packSaving,
                  placeholder: '如：my-cat-pack',
                  onChange: (e) => { setPackTouched({ ...packTouched, id: true }); setPackDraft({ ...packDraft, id: e.target.value }) },
                  onKeyDown: packSubmitOnEnter,
                }),
                h('div', { className: 'hint' }, packBad('id')
                  ? '只能用小写字母、数字、- 和 _，首字符不能是 - 或 _（1–40 位）'
                  : '图库就装在这个文件夹名下；以后分享给别人时保持 ID 不变'),
              ),
              h('div', { className: 'field' },
                h('label', null, '简介 / 图片来源（可选）'),
                h('textarea', {
                  value: packDraft.description, rows: 2, maxLength: 200, disabled: packSaving,
                  placeholder: '如：图是谁画的、来自哪个仓库、什么许可',
                  onChange: (e) => setPackDraft({ ...packDraft, description: e.target.value }),
                }),
              ),
            ) : h(React.Fragment, null,
              h('p', null, '自动导出当前图库 ZIP，并打开预填好的 GitHub 投稿页。'),
              h('p', null, '登录 GitHub 后，将下载的 ZIP 拖入“图库 ZIP”一栏，补充图片来源和许可，再提交。审核通过后收录到市场。'),
            ),
            h('div', { className: 'modal-acts' },
              h('button', { disabled: packSaving, onClick: () => setPackDialog('') }, '取消'),
              h('button', {
                className: 'btn-primary',
                disabled: packSaving || (packDialog === 'create' && !packDraftOk),
                title: packDialog === 'create' && !packDraftOk ? '先填图库名称和合法的图库 ID' : undefined,
                onClick: packDialog === 'create' ? savePack : submitPack,
              }, packSaving ? '处理中…' : packDialog === 'create' ? '创建并切换' : '导出 ZIP 并打开投稿页'),
            ),
          ),
        ) : null,
        // 图库预览弹窗:点卡片打开
        previewPack ? h('div', { className: 'meme-modal-mask', onClick: () => setPreviewPack(null) },
          h('div', {
            className: 'meme-modal', style: { width: 560, maxHeight: '82vh', overflow: 'auto' },
            onClick: (e) => e.stopPropagation(),
          },
            h('div', { className: 'meme-modal-head' },
              h('h3', null, previewPack.name),
              h('button', {
                className: 'meme-x', title: '关闭', 'aria-label': '关闭',
                onClick: () => setPreviewPack(null),
              }, '×'),
            ),
            previewPack.meta ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, previewPack.meta) : null,
            previewPack.desc ? h('p', { style: { margin: 0, fontSize: 12 } }, previewPack.desc) : null,
            previewPack.tags.length
              ? h('div', { className: 'mk-chips' }, previewPack.tags.map((t) => h('span', { key: t, className: 'mk-chip' }, t)))
              : null,
            previewPack.loading ? h('div', { className: 'notice' }, '正在读取图库图片…') : null,
            previewPack.images.length
              ? h('div', { className: 'mk-preview' }, previewPack.images.map((u, i) => h('a', {
                key: u + '#' + i, href: imageUrl(u), target: '_blank', rel: 'noopener noreferrer', title: '点开原图',
              }, h(MemeRemoteImage, {
                // <a> 里放 div 是合法的;尺寸/边框仍由 .mk-preview a 管,背景交给组件做镜像回退
                className: 'mk-preview-cell', src: u,
                style: { width: '100%', height: '100%', backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' },
              }))))
              : (previewPack.loading ? null : h('div', { className: 'empty' }, '这个图库没有提供预览图')),
            previewPack.images.length && previewPack.total > previewPack.images.length
              ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                previewPack.fromPack
                  ? '共 ' + previewPack.total + ' 张，这里显示前 ' + previewPack.images.length + ' 张'
                  : '目录里提供 ' + previewPack.images.length + ' 张预览；这个图库共 ' + previewPack.total + ' 张，安装后可以看全部')
              : null,
          ),
        ) : null,
        // 应用内确认弹窗(原生 confirm 在桌面壳里观感不一致)
        confirmBox ? h('div', { className: 'meme-modal-mask', onClick: () => setConfirmBox(null) },
          h('div', { className: 'meme-modal', onClick: (e) => e.stopPropagation() },
            h('h3', null, confirmBox.title),
            (confirmBox.lines || []).map((line, i) => h('p', { key: i }, line)),
            h('div', { className: 'row', style: { marginTop: 16 } },
              h('button', {
                className: 'btn-primary',
                onClick: () => { const run = confirmBox.onConfirm; setConfirmBox(null); if (run) run() },
              }, confirmBox.confirmLabel || '确认'),
              h('button', { onClick: () => setConfirmBox(null) }, '取消'),
            ),
          ),
        ) : null,
        // 目录浏览弹窗(WSL 无原生选择器,用 browse 能力前端浏览)
        browseOpen && browseList ? h('div', { className: 'meme-modal-mask', onClick: () => setBrowseOpen(false) },
          h('div', { className: 'meme-modal', style: { width: 420 }, onClick: (e) => e.stopPropagation() },
            h('h3', null, '选择表情包目录'),
            h('div', { className: 'total', style: { wordBreak: 'break-all' } }, browseList.path),
            h('div', { className: 'row', style: { flexWrap: 'wrap', gap: 4 } },
              h('button', {
                onClick: () => { if (browseList.parent) browseTo(browseList.parent) },
                disabled: !browseList.parent,
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
                onSavePacksDir(browseList.path)
                setBrowseOpen(false)
              } }, '使用此目录'),
            ),
          ),
        ) : null,
      )
    }

    // ---- 输入框快捷发图(QQ 式):😊 按钮 + 悬浮面板 ----
    // 尺寸规则(issue #30 第 3 条):整个面板高度自适应,头/筛选不收缩,只有网格内部滚动。
    // position 保持原来的 absolute + bottom:calc(100% + 8px)(锚点由宿主那层输入区容器给),
    // 千万别在这条规则里重写 position —— 同优先级后出现者胜,覆盖成 relative 会让锚点失效、
    // 面板掉到输入框下面(这条踩过一次,排查很久)。
    const memePickerCSS = [
      '.meme-trigger{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:transparent;border:none;line-height:1;outline:none;transition:background .12s,color .12s}',
      '.meme-trigger:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.meme-trigger.active{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}',
      // box-sizing 必须是 border-box:高度自适应是拿 getBoundingClientRect 量的(带 padding/border),
      // 而 max-height 默认按 content-box 算 —— 少了这句,面板实际比算出来的高一个 padding+border,
      // 上缘直接顶到视口外面去(实测 607px 的上限渲染成 633px、top=-10)。
      // 宽度按「一行正好 5 格」定:格子外框 78(76 + 两条 1px 边框)+ 间距 8,5 格要 422 的网格
      // 内宽;面板 480 时网格内宽约 441(已扣掉面板 padding/border、网格 padding 和滚动条),
      // 留够余量不至于被滚动条挤成 4 格,也还不到 6 格的 508。窄窗口仍由 92vw 兜底。
      '.meme-picker{position:absolute;bottom:calc(100% + 8px);left:0;box-sizing:border-box;width:min(480px,92vw);z-index:30;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:8px;padding:12px;max-height:min(46vh,calc(100vh - 32px));overflow:hidden;font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.meme-picker .mp-head{display:flex;gap:6px;align-items:center;flex:none}',
      '.meme-picker .mp-search{flex:1 1 auto;min-width:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 9px;font-size:12px;outline:none;transition:border-color .12s ease}',
      '.meme-picker .mp-search:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.meme-picker .mp-clear{flex:none;padding:4px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px}',
      '.meme-picker .mp-clear:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
      '.meme-picker .mp-count{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      // 筛选区开关:复用 chip(.mp-tag)的外观,右侧小三角表示展开/收起
      '.meme-picker .mp-toggle{flex:none}',
      '.meme-picker .mp-toggle .caret{margin-left:4px;font-size:9px;line-height:1;opacity:.75}',
      '.meme-picker .mp-filters{flex:none;display:flex;flex-direction:column;gap:6px;max-height:min(168px,32vh);overflow-y:auto}',
      '.meme-picker .mp-filter-row{display:flex;gap:4px;align-items:flex-start;flex-wrap:wrap}',
      '.meme-picker .mp-filter-label{flex:none;width:26px;font-size:11px;line-height:21px;color:var(--dsw-alias-label-secondary)}',
      '.meme-picker .mp-tag{padding:3px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;flex:none;transition:background .12s,color .12s,border-color .12s}',
      '.meme-picker .mp-tag:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
      '.meme-picker .mp-tag.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}',
      '.meme-picker .mp-tag .n{opacity:.65;margin-left:3px;font-size:10px}',
      // min-height:0 是必须的:flex 子项的默认 min-height:auto 会按内容撑开,网格就不收缩了,
      // 面板会被撑破(而不是出现滚动条)。
      '.meme-picker .mp-grid{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-wrap:wrap;gap:8px;padding:2px}',
      '.meme-picker .mp-cell{width:76px;height:76px;flex:0 0 76px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;overflow:hidden;cursor:pointer;background-color:var(--dsw-alias-bg-layer-2);background-size:cover;background-position:center center;background-repeat:no-repeat;padding:0;display:block;transition:border-color .12s,transform .12s,box-shadow .12s}',
      '.meme-picker .mp-cell:hover{border-color:var(--dsw-alias-brand-primary);transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.15)}',
      '.meme-picker .mp-empty{color:var(--dsw-alias-label-secondary);text-align:center;padding:28px 0}',
      '.meme-picker .mp-hint{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);text-align:center}',
      // 悬浮预览(issue #30 第 2 条):fixed + pointer-events:none,浮在格子旁边不挡点击;
      // 位置在 layout effect 里按实测尺寸算(右侧放不下翻左边、垂直钳制),见 MemeBoard。
      '.meme-picker .mp-hover{position:fixed;z-index:60;width:176px;pointer-events:none;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:8px;box-shadow:0 12px 32px rgba(0,0,0,.32);display:flex;flex-direction:column;gap:6px}',
      '.meme-picker .mp-hover-img{width:144px;height:144px;margin:0 auto;border-radius:8px;background-color:var(--dsw-alias-bg-base);background-size:contain;background-position:center center;background-repeat:no-repeat}',
      '.meme-picker .mp-hover-tag{align-self:flex-start;font-size:10px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);border-radius:999px;padding:1px 8px}',
      '.meme-picker .mp-hover-cap{font-size:12px;line-height:1.45;max-height:3.9em;overflow:hidden;word-break:break-word}',
      '.meme-picker .mp-hover-file{font-size:10px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    ].join('')

    /**
     * 比较版本号:按 `.` `-` `+` 切段,纯数字段按数值比,长度不足补 0。
     * 非数字段退化成字符串比较;任一侧为空返回 0(无法判断 = 不算有更新)。
     * @returns {number} 1 / 0 / -1
     */
    function compareVersions(a, b) {
      const parts = (v) => String(v == null ? '' : v).trim().replace(/^v/i, '').split(/[.\-+]/).filter(Boolean)
      const pa = parts(a)
      const pb = parts(b)
      if (pa.length === 0 || pb.length === 0) return 0
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || '0'
        const y = pb[i] || '0'
        const nx = /^\d+$/.test(x)
        const ny = /^\d+$/.test(y)
        if (nx && ny) {
          const d = Number(x) - Number(y)
          if (d !== 0) return d > 0 ? 1 : -1
          continue
        }
        // 一边数字一边非数字:非数字那段是预发布后缀(1.2.0-beta),比不带后缀的旧
        if (nx !== ny) return nx ? 1 : -1
        if (x !== y) return x > y ? 1 : -1
      }
      return 0
    }

    /**
     * 远端预览图的镜像候选(顺序与 host 的 remoteMirrors 一致,国内可达性优先):
     * jsdmirror → ghfast → gh-proxy → ghproxy → 原始 raw → jsDelivr → fastly。
     *
     * 为什么要多候选:背景图不会告诉我们「加载失败」,浏览器只会默默留白;而
     * raw.githubusercontent.com 在国内基本不可达 → 发现页整片空白。非 GitHub raw 的地址
     * (本地 /dsh-memes/...、用户自填 URL)原样返回 —— 那种没有镜像可换。
     */
    function imageCandidates(u) {
      const raw = String(u || '')
      const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(raw)
      if (!m) return raw ? [raw] : []
      const gh = m[1] + '/' + m[2] + '@' + m[3] + '/' + m[4]
      return [...new Set([
        'https://cdn.jsdmirror.com/gh/' + gh,
        'https://ghfast.top/' + raw,
        'https://gh-proxy.com/' + raw,
        'https://ghproxy.net/' + raw,
        raw,
        'https://cdn.jsdelivr.net/gh/' + gh,
        'https://fastly.jsdelivr.net/gh/' + gh,
      ])]
    }

    /** 首候选:不需要预加载的地方(如 <a href>)直接用;空串返回 '' */
    function imageUrl(u) {
      return imageCandidates(u)[0] || ''
    }

    /**
     * 兼容旧名:对外仍叫 coverUrl,内部已是 imageUrl(首候选镜像)。首候选从 jsDelivr
     * 换成 cdn.jsdmirror.com —— 同属 jsDelivr 家族,对国内更友好。
     */
    function coverUrl(u) {
      return imageUrl(u)
    }

    /** 镜像族标识:失败一次就能整族跳过。空串 = 不是镜像(本地路由/用户地址),不参与跳过。 */
    function imageProvider(u) {
      const s = String(u || '')
      if (s.indexOf('https://cdn.jsdmirror.com/') === 0) return 'jsdmirror'
      if (s.indexOf('https://ghfast.top/') === 0) return 'ghfast'
      if (s.indexOf('https://gh-proxy.com/') === 0) return 'gh-proxy'
      if (s.indexOf('https://ghproxy.net/') === 0) return 'ghproxy'
      if (s.indexOf('https://fastly.jsdelivr.net/') === 0 || s.indexOf('https://cdn.jsdelivr.net/') === 0) return 'jsdelivr'
      if (s.indexOf('https://raw.githubusercontent.com/') === 0) return 'raw'
      return ''
    }

    // 模块级图片探测缓存(跨卡片/弹窗共享,离屏打开再回来也不用重新探测):
    // - OK:源 URL → 已验证可用的候选 URL
    // - BAD:跑不通的镜像族。记族而不是记 URL —— 同一族对所有图都不可达,按 URL 记
    //   等于每张图都重等一次超时,面板会一张比一张慢。
    const remoteImageOk = new Map()
    const remoteImageBad = new Set()
    const REMOTE_IMAGE_TIMEOUT = 6000

    /**
     * 远端图片背景层(封面 / 预览格):先显示首候选,再用 new Image() 逐个探测候选,
     * 哪个加载成功切哪个;全失败就留空底(封面的首字母兜底由父层保留)。
     *
     * 为什么用 new Image() 而背景图自己不换:background-image 不报告加载结果,没法回退,
     * 一张 raw.githubusercontent 的图在国内就是永久空白。
     * 为什么是 div + background 而不是 <img>:尺寸完全由我们这层样式决定,不受宿主对
     * img 的全局样式影响(实测 <img> 没铺满卡片,露出一块空底色很难看)。
     */
    function MemeRemoteImage(props) {
      const src = (props && props.src) || ''
      const candidates = imageCandidates(src)
      const initial = remoteImageOk.get(src) || candidates[0] || ''
      const [current, setCurrent] = React.useState(initial)
      React.useEffect(() => {
        // 同一位置换了图(src 变)时先回到这张图的首候选,别停在上一个 URL 上
        setCurrent(remoteImageOk.get(src) || candidates[0] || '')
        // 只有一个候选 = 没有可换的镜像(本地路由/用户地址),预加载只是白跑一趟;
        // 测试/SSR 没有 Image,也直接显示首候选
        if (candidates.length < 2 || typeof Image === 'undefined') return undefined
        let alive = true
        let timer = 0
        let probe = null
        const stop = () => {
          alive = false
          if (timer) { clearTimeout(timer); timer = 0 }
          if (probe) { probe.onload = null; probe.onerror = null; probe = null }
        }
        // 跳过已知失效的镜像族;全族都黑名单了就直接保留首候选,不再挨个等超时
        const queue = candidates.filter((u) => !remoteImageBad.has(imageProvider(u)))
        if (queue.length === 0) return stop
        let i = 0
        const tryNext = () => {
          if (timer) { clearTimeout(timer); timer = 0 }
          if (!alive || i >= queue.length) return
          const url = queue[i++]
          probe = new Image()
          probe.onload = () => {
            if (!alive) return
            remoteImageOk.set(src, url)
            setCurrent(url)
            stop()
          }
          probe.onerror = () => {
            if (!alive) return
            const prov = imageProvider(url)
            if (prov) remoteImageBad.add(prov)
            tryNext()
          }
          // 超时按失败处理:慢镜像不能把后面的可用镜像堵死,首屏更不该等它半分钟
          timer = setTimeout(() => {
            timer = 0
            if (!alive) return
            const prov = imageProvider(url)
            if (prov) remoteImageBad.add(prov)
            tryNext()
          }, REMOTE_IMAGE_TIMEOUT)
          probe.src = url
        }
        tryNext()
        return stop
      }, [src])
      return React.createElement('div', {
        className: (props && props.className) || '',
        style: Object.assign({}, (props && props.style) || null, current ? { backgroundImage: 'url("' + current + '")' } : null),
      })
    }

    /**
     * 反馈入口:直接打开仓库里的「反馈 / Bug」表单,尽量替用户填好能自动拿到的信息
     * (插件版本来自 payload;运行环境只有浏览器 UA 可读,dsh 版本得让用户补)。
     */
    function issueFormUrl(version) {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''
      const env = ua ? (/Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '') + (/(Electron\/[\d.]+)/.exec(ua) ? ' · ' + /(Electron\/[\d.]+)/.exec(ua)[1] : '') : ''
      const qs = new URLSearchParams({ template: 'feedback.yml' })
      if (version) qs.set('version', String(version))
      if (env) qs.set('env', env)
      return 'https://github.com/yyh-001/dsh-meme/issues/new?' + qs.toString()
    }

    /** 下载量显示:上千折成 1.2k,省得数字把卡片撑爆 */
    function fmtCount(n) {
      const x = Number(n) || 0
      return x >= 1000 ? (Math.round(x / 100) / 10) + 'k' : String(x)
    }

    /** 文件大小:图库卡片/表情卡片用,一位小数就够 */
    function fmtBytes(n) {
      const x = Number(n) || 0
      if (x <= 0) return ''
      if (x < 1024) return x + ' B'
      if (x < 1024 * 1024) return (Math.round(x / 102.4) / 10) + ' KB'
      if (x < 1024 * 1024 * 1024) return (Math.round(x / (1024 * 1024) * 10) / 10) + ' MB'
      return (Math.round(x / (1024 * 1024 * 1024) * 10) / 10) + ' GB'
    }

    /** 悬浮面板上次拉到的全量数据;再次打开先拿它渲染,后台再刷新(图库多时首屏不闪)。 */
    let pickerCache = null
    /** 一次渲染的表情格上限:上千张全铺出来就是上千个 DOM 节点 + 上千个图片请求,不值得。 */
    const PICKER_MAX_CELLS = 240
    /**
     * 筛选区(图库 / 情绪两排 chip)是否展开。默认收起:图库一多,两排 chip 能占掉小面板的
     * 一多半高度,把网格挤没;收起后只剩一个带计数的「筛选」按钮,发现性还在。展开状态记在
     * 模块里 —— 同一个页面会话内关掉面板再打开不用重新展开。
     */
    let pickerFiltersOpen = false
    /**
     * 面板顶边与宿主顶栏之间留的呼吸间距(px)。顶着顶栏贴脸很难看,留一点点白。
     * 只在实际被顶栏挡住时才加 —— 面板本来就在下方(没被挡)时加它会白白压矮一截。
     */
    const PICKER_TOP_GAP = 12
    /**
     * 面板高度上限:视口高度的 46%(沿用 CSS 里那个 46vh)。自适应只往下收、不往上撑破这个
     * 上限 —— 半屏高左右最能兼顾「看得到够多图」和「不把对话顶掉」,再高就喧宾夺主了。
     */
    const PICKER_MAX_VH = 0.46

    /**
     * 从图片 url 反推图库 id(issue #30 第 1 条):
     * `?packId=all` 的每行只有 path/tag/file_name/caption/keywords/url —— 没有 packId,
     * 图库只能从 url 前缀推(url 形如 /dsh-memes/<packId>/memes/<tag>/<file>);
     * 单图库的返回同样没有这个字段,所以这条对两种响应都适用。
     */
    function packOfUrl(url) {
      const u = String(url || '')
      const at = u.indexOf('/dsh-memes/')
      if (at < 0) return ''
      const rest = u.slice(at + '/dsh-memes/'.length)
      const cut = rest.indexOf('/')
      return cut > 0 ? rest.slice(0, cut) : ''
    }

    /** 图库多选的范围:空数组 = 不筛(全部图库) */
    function pickerPackScope(memes, selPacks) {
      const rows = Array.isArray(memes) ? memes : []
      if (!selPacks || selPacks.length === 0) return rows
      return rows.filter((m) => selPacks.includes(packOfUrl(m.url)))
    }

    /**
     * 情绪 chip 的可选项与计数:只列「当前图库选择范围内」真实存在的情绪,按数量降序
     * (数量相同按 tag 名,保证顺序稳定)。
     */
    function pickerTagCounts(memes, selPacks) {
      const counts = new Map()
      for (const m of pickerPackScope(memes, selPacks)) {
        const tag = String(m.tag || '').trim()
        if (!tag) continue
        counts.set(tag, (counts.get(tag) || 0) + 1)
      }
      return [...counts].map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => (b.count - a.count) || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    }

    /** 结果 = 文字搜索 ∩ 所选图库 ∩ 所选情绪。搜索按空格分词、全命中(与市场搜索一致)。 */
    function pickerFilter(memes, selPacks, selTags, query) {
      let rows = pickerPackScope(memes, selPacks)
      if (selTags && selTags.length) rows = rows.filter((m) => selTags.includes(String(m.tag || '').trim()))
      const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
      if (tokens.length) {
        rows = rows.filter((m) => {
          // 标签的中文显示也进 haystack:chip 上写的是「开心」,用户就会照着打「开心」,
          // 而库里存的是 happy(与情绪筛选同义,不会多出意外的结果)
          const hay = ((m.tag || '') + ' ' + tagZh(m.tag || '') + ' ' + (m.caption || '') + ' ' + (m.keywords || '') + ' ' + (m.file_name || '')).toLowerCase()
          return tokens.every((t) => hay.includes(t))
        })
      }
      return rows
    }

    /**
     * 面板高度(issue #30 第 3 条):自然高度 / 「上缘不越窗口顶」的可用高度 / 视口占比上限
     * 三者取小,再兜一个最小高度。available 由调用方按实测底边算出 —— 面板底边本来就贴着
     * 输入框(absolute + bottom:calc(100% + 8px)),所以能长多高 = 底边到窗口顶;cap 是
     * 「长到多少就该收住」,不能光由窗口高度定(见 PICKER_MAX_VH)。
     */
    function fitPanelHeight(natural, available, floor = 180, cap = Infinity) {
      const min = Number(floor) > 0 ? Number(floor) : 180
      const nat = Math.ceil(Number(natural) || 0)
      const room = Math.floor(Number(available) || 0)
      const top = Number(cap) > 0 ? Math.floor(Number(cap)) : Infinity
      return Math.max(min, Math.min(nat || min, room || min, top))
    }

    /**
     * 面板的「自然高度」= 当前外框高度 + 网格里被藏起来的那截(issue #33)。
     *
     * 早先是靠临时把 max-height 撤成 none 量出来的,但那样一来网格的可用高度等于整块内容高,
     * 滚动区间归零 —— 浏览器立刻把 scrollTop 夹到 0,还原 max-height 也回不来。于是每次重绘
     * 都要量的路径(鼠标扫过格子要看悬浮预览)都会把列表顶掉,并排的图库 chip 也白滚一趟。
     *
     * 不碰样式也能量:面板被 max-height 压住时,压掉的那部分全由网格(唯一的 flex:1 收缩项)
     * 吸收,溢出的量正好等于少掉的高度,加回去就是自然高度。网格不存在(加载中/空/无匹配)时
     * 面板没被压,外框高度本身就是自然高度。
     */
    function naturalPanelHeight(panel) {
      const outer = Math.ceil(Number(panel.getBoundingClientRect().height) || 0)
      const grid = panel.querySelector('.mp-grid')
      if (!grid) return outer
      const hidden = Number(grid.scrollHeight) - Number(grid.clientHeight)
      return outer + (hidden > 0 ? Math.ceil(hidden) : 0)
    }

    /**
     * 面板实际可见的第一行(issue #33 后续)。面板锚在输入框上方、向上生长,而宿主自己的
     * 顶栏(标题行 / 页签)是后画的,会长在面板上面 —— 窗口一高,面板就长进顶栏底下,搜索框
     * 和筛选开关正好被盖住,用户看到的就是「顶部没了」。
     *
     * 命中测试从面板顶往下扫,第一条真正命中面板内部的 y 就是可见起点,它上面那段判给宿主顶栏。
     * 被盖住的一定是连续的一段、下面是可见的,所以用二分(十次左右探针,而不是逐像素扫几百次)。
     * 全被盖住(扫不到)时返回底边 —— 由调用方兜最小高度,不至于彻底塌掉。
     * 纯函数,probe(y) 由调用方注入(浏览器里是 elementFromPoint,测试里给假函数)。
     */
    function panelVisibleTop(top, bottom, probe) {
      const from = Math.ceil(Number(top) || 0)
      const to = Math.floor(Number(bottom) || 0)
      if (to <= from) return to
      if (probe(from)) return from // 面板顶边就没被挡
      if (!probe(to - 1)) return to // 整块都被挡
      let lo = from
      let hi = to - 1
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (probe(mid)) hi = mid
        else lo = mid + 1
      }
      return lo
    }

    /**
     * 悬浮预览的位置(issue #30 第 2 条):默认浮在格子右侧 10px;右侧放不下(或越出窗口)
     * 翻到左侧;垂直钳制在窗口内(上下各留 8px)—— 面板 overflow:hidden,最下面一排按实测
     * 高度钳制后预览才不会被裁掉。caption 长短不同,预览高度也会变,所以尺寸是实测传进来的。
     */
    function previewPosition(cell, size, viewport) {
      const w = Number(size && size.width) || 176
      const hh = Number(size && size.height) || 184
      const vw = Number(viewport && viewport.width) || 0
      const vh = Number(viewport && viewport.height) || 0
      let left = cell.right + 10
      if (vw && left + w > vw - 8) left = cell.left - 10 - w
      if (left < 8) left = 8
      let top = cell.top - 2
      const maxTop = Math.max(8, vh - hh - 8)
      if (top > maxTop) top = maxTop
      if (top < 8) top = 8
      return { left: Math.round(left), top: Math.round(top) }
    }

    /**
     * 悬浮预览的视口钳制(issue #55):fixed 浮层的屏幕坐标不一定等于写进去的 left/top ——
     * 祖先带 transform / zoom / filter / contain 时,fixed 改为相对那一层定位,整体产生偏移,
     * 而且越靠窗口右边累积越多(「最右两列出问题、左边没事」就是这条);另外换内容那一帧量到
     * 的尺寸也未必是最新的,按它算 maxTop 会偏大。
     *
     * 所以不拿「算出来的位置」判断越界:写下去之后量真实矩形(视口坐标),把越出视口的部分
     * 算成修正量,由调用方加到 left/top 上、迭代几轮收敛。量到的就是真实屏幕位置,不需要知道
     * 外面有没有 transform。返回 { dx, dy, done },done 为真表示已经在视口内。
     */
    function previewClampOffset(rect, viewport, margin) {
      const vw = Number(viewport && viewport.width) || 0
      const vh = Number(viewport && viewport.height) || 0
      const gap = Number.isFinite(Number(margin)) ? Math.max(0, Number(margin)) : 8
      const out = { dx: 0, dy: 0, done: true }
      if (!rect || (!vw && !vh)) return out
      const left = Number(rect.left) || 0
      const top = Number(rect.top) || 0
      // 全 0 的矩形 = 还没进布局(挂载那一帧):别拿它当「贴着左上角」去挪,等下一帧再量
      const rw = (Number(rect.right) || 0) - left
      const rh = (Number(rect.bottom) || 0) - top
      if (!(rw > 0) && !(rh > 0)) return out
      if (vw) {
        let dx = 0
        const overR = (Number(rect.right) || 0) - (vw - gap)
        if (overR > 0) dx = -overR
        else if (gap - left > 0) dx = gap - left
        // 比视口还宽:左缘贴边就够了,再往右推只会把右边挤出去
        if (left + dx < gap) dx = gap - left
        out.dx = Math.round(dx)
      }
      if (vh) {
        let dy = 0
        const overB = (Number(rect.bottom) || 0) - (vh - gap)
        if (overB > 0) dy = -overB
        else if (gap - top > 0) dy = gap - top
        // 比视口还高:上缘贴边,优先保住大图那一头
        if (top + dy < gap) dy = gap - top
        out.dy = Math.round(dy)
      }
      out.done = !out.dx && !out.dy
      return out
    }

    /**
     * 把「量真实矩形 → 减掉越界量」迭代到收敛。写进去的 left/top 只是起点,最终位置完全由
     * 实测矩形决定;返回收敛后的 left/top。
     * 默认三轮:坐标系没被缩放时第一轮就 break;祖先带 zoom(写进去的值按比例放大/缩小)时,
     * 每轮残差按比例缩一截,两轮还会剩几个像素,三轮基本归零。
     * 单独抽出来是为了能直接回归测试:假 el 按「写进去的值 × 缩放 + 祖先偏移」算矩形,就能验证
     * 「越靠右偏移越大」「换内容后变高」「zoom 缩放坐标系」三种情况都能收进视口(issue #55)。
     */
    function clampPreviewElement(el, viewport, rounds) {
      const n = Number(rounds) > 0 ? Math.floor(Number(rounds)) : 3
      const px = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }
      for (let k = 0; k < n; k++) {
        const off = previewClampOffset(el.getBoundingClientRect(), viewport, 8)
        if (off.done) break
        if (off.dx) el.style.left = (px(el.style.left) + off.dx) + 'px'
        if (off.dy) el.style.top = (px(el.style.top) + off.dy) + 'px'
      }
      return { left: px(el.style.left), top: px(el.style.top) }
    }

    /**
     * 指针是否还停在「当前格子 ∪ 预览框」里(4px 容差,避免贴边移动时抖动)。
     * 预览框也算停留区,否则从格子挪到大图上预览会闪掉。
     */
    function inKeepZone(zones, x, y, slack = 4) {
      for (const z of zones || []) {
        if (!z || z.right <= z.left || z.bottom <= z.top) continue
        if (x >= z.left - slack && x <= z.right + slack && y >= z.top - slack && y <= z.bottom + slack) return true
      }
      return false
    }

    /**
     * 表情格的 key:正常情况下 url 唯一,但同一张图被两个图库各收一份时就会撞;key 撞了
     * React 的协调会错乱(实测筛到 2 张后网格里还剩两百多个旧格子),所以撞了按出现次序
     * 补后缀 —— 顺序稳定,key 就稳定。
     */
    function uniqueKeys(rows) {
      const seen = new Map()
      return rows.map((m) => {
        const base = String((m && (m.url || m.path)) || '')
        const n = (seen.get(base) || 0) + 1
        seen.set(base, n)
        return base + '#' + n
      })
    }

    function makeMemeStore() {
      let open = false
      const subs = new Set()
      return {
        get: () => open,
        set: (v) => { open = !!v; subs.forEach((fn) => fn()) },
        toggle: () => { open = !open; subs.forEach((fn) => fn()) },
        subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) },
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
      // 草稿要从宿主实时读:本 slot 的 props 只有 inputActions 加 hooks 派生的 useInput
      // (宿主输入栏就是 useInput((s) => s)),没有 props.input;读不存在的属性不报错,
      // 只会静默拿到 undefined —— 别再回头去读 props.input.draft。
      // 拿不到钩子(宿主侧改动)时兜底为空串,即修复前的行为,不因此崩。
      const useLiveInput = typeof props.useInput === 'function' ? props.useInput : (() => null)
      const inputState = useLiveInput((s) => s)
      const open = React.useSyncExternalStore(store.subscribe, store.get)
      const [data, setData] = React.useState(() => pickerCache || { packs: [], memes: [] })
      const [loaded, setLoaded] = React.useState(!!pickerCache)
      const [q, setQ] = React.useState('')
      const [selPacks, setSelPacks] = React.useState([]) // 空 = 不筛:全部图库
      const [selTags, setSelTags] = React.useState([])   // 空 = 不筛:全部情绪
      const [showFilters, setShowFilters] = React.useState(() => pickerFiltersOpen) // 筛选区展开状态(默认收起)
      const [hover, setHover] = React.useState(null)     // 悬浮预览:{ meme, cellRect }
      const panelRef = React.useRef(null)
      const previewRef = React.useRef(null)
      const keepRef = React.useRef(null) // 预览停留区 [格子矩形, 预览框矩形],pointermove 判「还在不在」
      const topLimitRef = React.useRef(null) // { limit, nat }:宿主顶栏下沿 + 量它时的自然高度(作失效键)

      // 打开时拉全量(packId=all,带包前缀 url):多选筛选和情绪计数都要全量数据。
      // 本机 5 个图库 1645 张约 0.3s / 454KB,换来「跨图库找图不用来回切」;
      // 上一次的结果先顶上渲染,后台再刷新。
      React.useEffect(() => {
        if (!open) return
        let alive = true
        const revision = memeLibraryRevision
        fetch('/dsh-memes-api?packId=all')
          .then((r) => r.json())
          .then((res) => {
            if (!alive || revision !== memeLibraryRevision || !res || !res.ok) return
            const next = {
              packs: Array.isArray(res.packs) ? res.packs : [],
              memes: Array.isArray(res.memes) ? res.memes : [],
            }
            pickerCache = next
            // 打开面板也同步索引:其它页面或 AI 学图带来的变化无需刷新整个页面。
            for (const listener of memeIndexListeners) listener(next.memes, res.layoutMode)
            setData(next)
            setLoaded(true)
          })
          .catch(() => {})
        return () => { alive = false }
      }, [open])

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

      const viewport = (what) => {
        try {
          const root = document.documentElement
          const v = what === 'w' ? root.clientWidth : root.clientHeight
          return v || (what === 'w' ? window.innerWidth : window.innerHeight) || 0
        } catch (e) { return 0 }
      }

      // 悬浮预览定位:默认浮在格子右侧,右侧放不下翻到左侧;垂直按实测的预览高度钳制 ——
      // 面板 overflow:hidden,最下面一排不钳制就会被裁掉。算完把「格子 ∪ 预览框」记成停留区:
      // 指针从格子挪到大图上不能闪掉,钳制改了位置也要同步更新,否则会被误判成「已经离开」。
      const placePreview = () => {
        const el = previewRef.current
        if (!hover || !el || !hover.cellRect) { keepRef.current = null; return }
        try {
          const vp = { width: viewport('w'), height: viewport('h') }
          const rect = el.getBoundingClientRect()
          const pos = previewPosition(hover.cellRect, rect, vp)
          el.style.left = pos.left + 'px'
          el.style.top = pos.top + 'px'
          // 上面用的 rect 是上一帧的尺寸,而 fixed 浮层在带 transform/zoom 的祖先下坐标还会
          // 整体偏移(issue #55,越靠窗口右边偏得越多)。所以不再用算出来的值判断越界:写下去
          // 之后量真实矩形,把越出视口的那部分减回来,迭代收敛(坐标系没被缩放时第一轮就够)。
          clampPreviewElement(el, vp, 3)
          keepRef.current = [hover.cellRect, el.getBoundingClientRect()]
        } catch (e) { keepRef.current = null }
      }
      const useLayout = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect
      // 预览的关闭时机:指针离开「当前格子 ∪ 预览框」就关(4px 容差),分三处兜住 ——
      // ① 离开格子:pointerleave 里按停留区判(指针挪到探出面板的大图上时不能误关);
      //    「从格子 A 直接滑到格子 B」时 DOM 事件顺序是 leave(A) → enter(B),B 的那次
      //    setHover 在后、同一批里胜出,所以不会闪。
      // ② 停在探出去的预览上继续往外滑:面板收不到 pointermove(指针已经在面板外),所以
      //    监听挂 document;落在格子上时交给 ①(否则会跟 enter 抢着清掉预览)。
      // ③ 指针整个离开窗口:document 的 pointerleave。
      useLayout(() => {
        placePreview()
        if (!hover) return
        const onMove = (e) => {
          const t = e.target
          if (t && t.closest && t.closest('.mp-cell')) return
          if (!inKeepZone(keepRef.current, e.clientX, e.clientY)) setHover(null)
        }
        const onLeave = () => setHover(null)
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerleave', onLeave)
        return () => {
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerleave', onLeave)
        }
      }, [hover])

      // 量「宿主顶栏下沿」:面板得先真的长到那个位置才量得出来,所以先把 max-height 放到「底边到
      // 窗口顶」摆一次(有限值 —— 不是 none),再从面板顶往下命中测试。测完原样还回去。
      //
      // 两个坑都踩过:① 量到的一半是「加载中」时的矮面板(那时顶栏根本没挡到它),这个值必须
      // 跟着内容失效,否则网格出来以后还拿旧值算,面板被压到最小高度;所以缓存按自然高度作键。
      // ② 这一放一收会改网格的可用高度、把 grid.scrollTop 夹掉(和 #33 同一个坑),量完写回。
      const measureTopLimit = (panel, bottom, nat) => {
        const grid = panel.querySelector('.mp-grid')
        const keep = grid ? grid.scrollTop : 0
        let limit = 16
        try {
          const prev = panel.style.maxHeight
          panel.style.maxHeight = Math.max(0, bottom - 16) + 'px'
          const box = panel.getBoundingClientRect()
          const x = Math.round(box.left + Math.min(box.width / 2, 80))
          const probe = (y) => {
            const el = document.elementFromPoint(x, y)
            return !!(el && panel.contains(el))
          }
          const visibleTop = panelVisibleTop(box.top, bottom, probe)
          // 被挡住时可见起点就是顶栏下沿,再往下留 PICKER_TOP_GAP 的呼吸间距;没被挡
          // (可见起点就是面板自己的顶边)就不加,否则面板会白白矮一截、还永远长不回来。
          limit = Math.max(16, visibleTop > box.top ? visibleTop + PICKER_TOP_GAP : visibleTop)
          panel.style.maxHeight = prev
        } catch (e) { limit = 16 } // 量不出来就退回「只留窗口边距」的老行为
        if (grid && grid.scrollTop !== keep) grid.scrollTop = keep
        topLimitRef.current = { limit, nat }
        return limit
      }

      // 面板高度自适应:头/筛选不收缩,只有网格内部滚动。自然高度 = 当前高度 + 网格藏起来的那截
      // (见 naturalPanelHeight —— 不再靠撤 max-height 去量,那会把滚动位置夹掉);可用高度 =
      // 实测底边到「宿主顶栏下沿」(见 topLimit,顶栏会盖在面板上面)。取小就是最终高度。
      const fitPanel = () => {
        try {
          const panel = panelRef.current
            || (typeof document.querySelector === 'function' ? document.querySelector('.meme-picker') : null)
          if (!panel) return
          const nat = naturalPanelHeight(panel)
          const bottom = Math.floor(panel.getBoundingClientRect().bottom)
          const cached = topLimitRef.current
          const limit = cached && cached.nat === nat ? cached.limit : measureTopLimit(panel, bottom, nat)
          const avail = Math.floor(bottom - limit)
          const cap = Math.floor(viewport('h') * PICKER_MAX_VH)
          const finalH = fitPanelHeight(nat, avail, 180, cap)
          // 判断依据必须是「这个节点当前的内联高度」,不能用跨挂载记的 ref(历史 bug:
          // 关掉面板再打开,新节点没有内联 max-height、却因为 ref 记着同一个数值被判成
          // 「不用改」,于是回退到 CSS 默认的 46vh —— 表现就是反复点笑脸高度会变,
          // 而且窗口越高差得越多)。这样写是幂等的:值一样就不写,写过的节点也不会重复改。
          const want = finalH + 'px'
          if (panel.style.maxHeight !== want) panel.style.maxHeight = want
          // 排查用现场记录:控制台里一眼看出「新代码有没有加载 / 算出什么」
          panel.setAttribute('data-meme-picker-fit', 'nat=' + nat + ' avail=' + avail + ' h=' + finalH + ' top=' + limit)
        } catch (e) { /* 纯增强:算不出来就退回 CSS 的 46vh,不能影响面板本身 */ }
      }
      useLayout(() => { if (open) fitPanel() })

      React.useEffect(() => {
        if (!open) return
        // 几何变了(窗口 / 宿主容器 / 输入框高):顶栏下沿要重量,别拿旧值
        const onResize = () => { topLimitRef.current = null; fitPanel() }
        const win = typeof window !== 'undefined' ? window : null
        if (win && typeof win.addEventListener === 'function') win.addEventListener('resize', onResize)
        let ro = null
        try {
          // 输入框变高(打多行)时宿主容器跟着变 → 面板跟着收紧
          if (typeof ResizeObserver === 'function' && panelRef.current && panelRef.current.parentElement) {
            ro = new ResizeObserver(onResize)
            ro.observe(panelRef.current.parentElement)
          }
        } catch (e) { ro = null }
        return () => {
          if (win && typeof win.removeEventListener === 'function') win.removeEventListener('resize', onResize)
          if (ro) ro.disconnect()
        }
      }, [open])

      if (!open) return null

      // 点击:发 [表情: 描述] 文本,前端按描述配图。
      const send = async (m) => {
        if (!m) return
        // 纯文本:[表情: 描述] —— 模型只看到文字;前端按描述配图。
        const setText = (text) => { try { if (actions && actions.setDraft) actions.setDraft(text) } catch (e) {} }
        const desc = (m.caption || m.keywords || m.tag || '表情包').slice(0, 80)
        const text = '[表情: ' + desc + ']'
        const cur = inputState && typeof inputState.draft === 'string' ? inputState.draft : ''
        setText(cur.trim() ? cur + '\n' + text : text)
        try { if (actions && actions.submit) actions.submit() } catch (e) {}
        store.set(false)
      }

      // 多选 chip:点一下选中(只看它),再点取消;一个都不选 = 不筛
      const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : list.concat([id]))
      const clearAll = () => { setQ(''); setSelPacks([]); setSelTags([]) }
      const hasFilter = !!(q.trim() || selPacks.length || selTags.length)
      const selCount = selPacks.length + selTags.length
      // 展开状态记到模块级:面板关掉再打开不用重新展开(同一页面会话内)
      const toggleFilters = () => { const next = !showFilters; pickerFiltersOpen = next; setShowFilters(next) }

      const tagCounts = pickerTagCounts(data.memes, selPacks)
      const rows = pickerFilter(data.memes, selPacks, selTags, q)
      const cells = rows.slice(0, PICKER_MAX_CELLS)
      const packCounts = (() => {
        const m = new Map()
        for (const row of data.memes) {
          const pid = packOfUrl(row.url)
          if (pid) m.set(pid, (m.get(pid) || 0) + 1)
        }
        return m
      })()
      const packChips = data.packs
        .map((p) => ({ id: p.id, name: p.name || p.id, count: packCounts.get(p.id) || p.count || 0 }))
        .filter((p) => p.count > 0)

      const gridCellKeys = uniqueKeys(cells)
      const gridCells = cells.map((m, i) => h('div', {
        key: gridCellKeys[i],
        className: 'mp-cell',
        // 刻意不给 title:原生 tooltip 要等一会儿才冒出来,正好压在悬浮预览上面,两个提示重着显示
        // (描述、文件名预览里都有,不用再来一份)
        onClick: () => send(m),
        onPointerEnter: (e) => {
          try { setHover({ meme: m, cellRect: e.currentTarget.getBoundingClientRect() }) } catch (err) { setHover(null) }
        },
        // 离开格子:只有指针既不在格子里、也不在预览框里(见上面的停留区)才关
        onPointerLeave: (e) => {
          if (!inKeepZone(keepRef.current, e.clientX, e.clientY)) setHover(null)
        },
        style: { backgroundImage: 'url("' + m.url + '")' },
      }))

      return h('div', {
        className: 'meme-picker',
        ref: panelRef,
        'data-meme-picker': '1',
        onClick: (e) => e.stopPropagation(),
        // 滚动后格子的屏幕位置就不对了,预览跟着清掉(关闭时机见上面的 layout effect)
        onWheel: () => setHover(null),
      },
        h('div', { className: 'mp-head' },
          h('input', {
            type: 'text', className: 'mp-search', value: q,
            placeholder: '搜索描述 / 关键词…',
            onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Escape') { setQ(''); if (e.currentTarget && e.currentTarget.blur) e.currentTarget.blur() } },
          }),
          hasFilter ? h('button', { type: 'button', className: 'mp-clear', onClick: clearAll }, '清空') : null,
          // 筛选区默认收起(图库一多两排 chip 能吃掉大半个面板);有选中的筛选就显示选了几个,免得收起时看不出来
          h('button', {
            type: 'button',
            className: 'mp-tag mp-toggle' + (selCount ? ' on' : ''),
            title: showFilters ? '收起筛选' : '展开筛选(按图库 / 情绪挑图)',
            'aria-expanded': showFilters ? 'true' : 'false',
            onClick: toggleFilters,
          }, '筛选' + (selCount ? ' ' + selCount : ''), h('span', { className: 'caret' }, showFilters ? '▲' : '▼')),
          h('span', { className: 'mp-count' }, '共 ' + rows.length + ' 张'),
        ),
        // 两排多选 chip:都不选 = 不筛。情绪只列当前图库范围内真实存在的,按数量降序带计数。
        // 收起时不渲染(而不是 display:none):省掉几十个 chip 的节点与重排。
        showFilters
          ? h('div', { className: 'mp-filters' },
            packChips.length
              ? h('div', { className: 'mp-filter-row' },
                h('span', { className: 'mp-filter-label' }, '图库'),
                packChips.map((p) => h('button', {
                  type: 'button', key: p.id,
                  className: 'mp-tag' + (selPacks.includes(p.id) ? ' on' : ''),
                  title: '点一下只看这个图库;再点取消。都不点 = 全部图库',
                  onClick: () => toggle(selPacks, setSelPacks, p.id),
                }, p.name, h('span', { className: 'n' }, String(p.count)))),
              )
              : null,
            tagCounts.length
              ? h('div', { className: 'mp-filter-row' },
                h('span', { className: 'mp-filter-label' }, '情绪'),
                tagCounts.map((t) => h('button', {
                  type: 'button', key: t.tag,
                  className: 'mp-tag' + (selTags.includes(t.tag) ? ' on' : ''),
                  title: '点一下只看这个情绪;再点取消。都不点 = 全部情绪',
                  onClick: () => toggle(selTags, setSelTags, t.tag),
                }, tagZh(t.tag), h('span', { className: 'n' }, String(t.count)))),
              )
              : null,
          )
          : null,
        data.memes.length === 0
          ? h('div', { className: 'mp-empty' }, loaded ? '还没有可发的表情包' : '加载中…')
          : (rows.length === 0
            ? h('div', { className: 'mp-empty' }, '没有匹配的表情包')
            : h('div', { className: 'mp-grid' }, gridCells)),
        rows.length > cells.length
          ? h('div', { className: 'mp-hint' },
            '只画了前 ' + cells.length + ' 张,还有 ' + (rows.length - cells.length) + ' 张——用搜索或筛选取一部分')
          : null,
        // 悬浮预览:大图(contain 不裁切)+ 情绪 + 描述 + 文件名;pointer-events:none 不挡点击
        hover ? h('div', {
          className: 'mp-hover', ref: previewRef,
          style: {
            left: (hover.cellRect ? hover.cellRect.right + 10 : 0) + 'px',
            top: (hover.cellRect ? hover.cellRect.top - 2 : 0) + 'px',
          },
        },
          h('div', { className: 'mp-hover-img', style: { backgroundImage: 'url("' + hover.meme.url + '")' } }),
          hover.meme.tag ? h('span', { className: 'mp-hover-tag' }, tagZh(hover.meme.tag)) : null,
          h('div', { className: 'mp-hover-cap' }, hover.meme.caption || hover.meme.file_name),
          hover.meme.caption ? h('div', { className: 'mp-hover-file' }, hover.meme.file_name) : null,
        ) : null,
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
    // 索引 key 入表(原文/折叠/紧凑三形态)。同层同 key 不隐式覆盖:先注册者优先
    // (包顺序,内置包在前)——后到的同 key 是跨包撞车,悄悄挤掉先到的只会配错图(issue #52)。
    const addIndexKey = (map, key, url) => {
      const raw = String(key || '').trim()
      if (!raw) return
      for (const form of new Set([raw, foldCaption(raw), looseCaption(raw)])) {
        if (form && !map.has(form)) map.set(form, url)
      }
    }
    // 精确索引分两层(issue #52):caption 层(caption/文件名/超长 caption 截断)与
    // keyword 层(keywords 逐词 + 整串)。此前三路塞同一个 Map,keywords 只有整串能
    // 精确命中,单个词只能掉进分词兜底——兜底里 caption 与 keyword 同权、平手先到
    // 先得,内置包排前面就赢走用户包同词的图。拆层后 caption 精确 > keyword 精确 >
    // 分词兜底,同层撞 key 按包顺序 first-wins,不再隐式互相覆盖。
    const buildMemeIndex = (rows, toUrl) => {
      const captions = new Map()
      const keywords = new Map()
      for (const row of rows || []) {
        const url = toUrl(row)
        addIndexKey(captions, row.caption, url)
        addIndexKey(captions, row.file_name, url)
        addIndexKey(captions, String(row.caption || '').slice(0, 80), url)
        addIndexKey(captions, String(row.caption || '').slice(0, 100), url)
        const kw = String(row.keywords || '')
        addIndexKey(keywords, kw, url)
        for (const word of kw.split(/\s+/)) addIndexKey(keywords, word, url)
      }
      return { caption: captions, keyword: keywords }
    }
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
    // 组合匹配:caption 精确(原文/折叠/紧凑)→ keyword 精确 → 分词在 caption/关键词里双向包含。
    // caption/文件名是这张图的确切身份,keywords 只是检索词:跨包撞词时 caption 命中必须压过
    // keyword 命中(issue #52:内置包 keywords 含「下班」,不该抢走用户包 caption="下班！！！"的配图)。
    // index 兼容两种形态:单层 Map(旧调用/测试)或 { caption, keyword } 双层 Map。
    const matchDesc = (desc, index, search) => {
      const captionIndex = index && typeof index.get === 'function'
        ? index
        : (index && index.caption && typeof index.caption.get === 'function' ? index.caption : null)
      const keywordIndex = index && index.keyword && typeof index.keyword.get === 'function' ? index.keyword : null
      const raw = String(desc || '').trim()
      const forms = [raw, foldCaption(raw), looseCaption(raw)]
      for (const map of [captionIndex, keywordIndex]) {
        if (!map) continue
        for (const form of forms) {
          const exact = map.get(form)
          if (exact) return exact
        }
      }
      const needles = [...new Set(splitDescTokens(desc).map(looseCaption).filter(Boolean))]
      let best = null
      let bestLength = 0
      let bestCount = 0
      for (const row of search || []) {
        let longest = 0
        let count = 0
        for (const needle of needles) {
          let length = row.hay.some((hay) => hay.includes(needle)) ? needle.length : 0
          for (const token of row.tokens || []) {
            const t = looseCaption(token)
            if (t && (needle.includes(t) || t.includes(needle))) length = Math.max(length, Math.min(needle.length, t.length))
          }
          if (length) { longest = Math.max(longest, length); count++ }
        }
        if (longest > bestLength || (longest === bestLength && count > bestCount)) {
          best = row.url
          bestLength = longest
          bestCount = count
        }
      }
      return best
    }

    function apply(ctx) {
      const styleEl = createOwnedStyle(CSS)
      ctx.effect(() => () => { styleEl.remove() }, 'dsh-expression-entry: styles')

      const pickerStyle = createOwnedStyle(memePickerCSS)
      ctx.effect(() => () => { pickerStyle.remove() }, 'dsh-expression-entry: meme-picker styles')

      // 点图放大:光标提示样式同样走 createOwnedStyle(issue #32),遮罩与监听装一次、卸载时摘掉。
      // 范围与 installMemeZoom 的点击判定保持一致:只给内容槽里的图和本插件提到行首的图上光标(issue #44),
      // 交互控件里的图标除外,光标还原成继承值,按钮显式给啥就是啥(issue #57)。
      const zoomStyle = createOwnedStyle(
        'img[data-meme-img],[data-slot="conversation.chat.node"] img{cursor:zoom-in}'
        + INTERACTIVE_IMG_SEL.split(',')
          .map((s) => '[data-slot="conversation.chat.node"] ' + s + " img{cursor:inherit}")
          .join('')
      )
      ctx.effect(() => () => { zoomStyle.remove() }, 'dsh-expression-entry: zoom styles')

      // 表情排布「独占一行」(issue #50):行元素翻成纵向 flex——图在上,正文在下按正常
      // 宽度铺开;user/steering 行右对齐(并排模式下靠 marginLeft:auto,这里靠 flex 尾对齐)。
      // 默认「并排」不给行打 data-meme-layout,CSS 完全不命中,观感与旧版一致。
      const layoutStyle = createOwnedStyle(
        '[data-meme-layout="stacked"]{display:flex;flex-direction:column;align-items:flex-start;gap:6px}'
        + '[data-meme-layout="stacked"][data-chat-flow-kind="user"],'
        + '[data-meme-layout="stacked"][data-chat-flow-kind="steering"]{align-items:flex-end}'
      )
      ctx.effect(() => () => { layoutStyle.remove() }, 'dsh-expression-entry: meme layout styles')
      const disposeZoom = installMemeZoom()
      ctx.effect(() => () => { disposeZoom() }, 'dsh-expression-entry: zoom overlay')

      // 表情文本渲染:[表情: 描述] 或旧格式 [表情: 描述](url) → 图片。
      // 无 url 时先按描述精确匹配图库;失败再按分词在 caption/关键词里做包含匹配
      // 兜底(模型偶尔不抄候选原文、自己编描述);仍无命中显示描述原文,
      // 不把 [表情: ...] 标记裸露在气泡里(历史教训:社区反馈「表情显示不出来」)。
      const MEME_TEXT_RE = /\[表情:\s*([^\]]+)\](?:\((https?:\/\/[^\s)]+)\))?/g
      // acceptNode 用不带 g 的副本。带 g 的正则 test() 会推进 lastIndex,下一个文本节点从
      // 上次的位置往后找——于是「这一条运气不好」的消息被静默跳过、永远不出图,还得等下一轮
      // 扫描碰巧把游标绕回 0(历史 bug:表现就是「表情有时显示不出来」)。
      const MEME_TEXT_TEST = /\[表情:\s*([^\]]+)\](?:\((https?:\/\/[^\s)]+)\))?/
      let memeIndex = null
      let memeSearch = [] // 分词兜底用的 haystack:[{hay:[...], url}]
      let memeIndexLoading = false
      let memeIndexRetryAfter = 0 // 失败后的冷却截止时刻(ms):冷却期内不再发请求
      let memeIndexAttempts = 0
      let memeIndexWarned = false
      let memeIndexGeneration = 0
      let memeIndexController = null
      let disposed = false
      // 索引拉取失败必须保持「可重试」状态。早先失败会往 memeIndex 写一个空 Map 兜底,
      // 而入口守卫是 `if (memeIndex || memeIndexLoading) return`——空 Map 也是真值,
      // 于是这个会话剩下的 [表情: x] 全部退化成描述文字,无报错、无提示,只能靠刷新恢复。
      // 现在失败就保持 null:之后再扫描到未装饰的 [表情: x] 会自然重试(指数退避,
      // 后端起来了自愈)。不另起定时器——扫描本身就是触发点,少一个要清理的生命周期。
      const MEME_INDEX_TIMEOUT = 15000
      const MEME_INDEX_RETRY_BASE = 2000
      const MEME_INDEX_RETRY_MAX = 30000
      const absMemeUrl = (u, path) => {
        if (u && /^https?:\/\//.test(u)) return u
        const rel = u || (path ? '/dsh-memes/' + path : '')
        try { return new URL(rel, window.location.origin).href } catch (e) { return rel }
      }
      const findMemeUrl = (desc) => matchDesc(desc, memeIndex, memeSearch)
      const setMemeIndex = (rows) => {
        memeIndex = buildMemeIndex(rows, (row) => absMemeUrl(row.url, row.path))
        memeSearch = buildMemeSearch(rows, (row) => absMemeUrl(row.url, row.path))
        memeIndexAttempts = 0
        memeIndexRetryAfter = 0
        decorateMemeText()
      }
      const loadMemeIndex = () => {
        if (disposed || memeIndex || memeIndexLoading) return
        if (Date.now() < memeIndexRetryAfter) return // 冷却中:上一次失败还没到重试时刻
        memeIndexLoading = true
        memeIndexAttempts++
        // fetch 挂起(既不 resolve 也不 reject)时连 catch 都不走,超时自己 abort 兜底
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        memeIndexController = controller
        const generation = memeIndexGeneration
        const timeoutTimer = controller ? setTimeout(() => controller.abort(), MEME_INDEX_TIMEOUT) : 0
        // 拉全部包(带包前缀 URL),任意组的 [表情: 描述] 都能配图
        fetch('/dsh-memes-api?packId=all', controller ? { signal: controller.signal } : undefined)
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then((res) => {
            if (disposed || generation !== memeIndexGeneration) return
            if (!res || !res.ok || !Array.isArray(res.memes)) throw new Error('无效的表情索引响应')
            // 排布设置随索引一起下发:设置页不开,装饰器也能拿到持久化的排布(issue #50)
            if (typeof res.layoutMode === 'string') setMemeLayoutMode(res.layoutMode)
            setMemeIndex(res.memes)
          })
          .catch((error) => {
            if (disposed || generation !== memeIndexGeneration) return
            // 失败保持 null(下次扫描还能重试),退避到下次重试时刻;提示只打一次,别刷屏
            const backoff = Math.min(MEME_INDEX_RETRY_MAX, MEME_INDEX_RETRY_BASE * Math.pow(2, Math.max(0, memeIndexAttempts - 1)))
            memeIndexRetryAfter = Date.now() + backoff
            if (!memeIndexWarned) {
              memeIndexWarned = true
              console.warn('[dsh-expression] 表情索引加载失败,' + Math.round(backoff / 1000) + 's 后自动重试:', error && error.message ? error.message : error)
            }
          })
          .finally(() => {
            if (timeoutTimer) clearTimeout(timeoutTimer)
            if (generation === memeIndexGeneration) {
              memeIndexLoading = false
              memeIndexController = null
            }
          })
      }
      const refreshMemeIndex = (rows, layoutMode) => {
        if (disposed) return
        if (typeof layoutMode === 'string' && layoutMode) setMemeLayoutMode(layoutMode)
        memeIndexGeneration++
        if (memeIndexController) memeIndexController.abort()
        memeIndexController = null
        memeIndexLoading = false
        memeIndex = null
        memeSearch = []
        memeIndexAttempts = 0
        memeIndexRetryAfter = 0
        if (Array.isArray(rows)) setMemeIndex(rows)
        else loadMemeIndex()
      }
      memeIndexListeners.add(refreshMemeIndex)
      ctx.effect(() => () => {
        disposed = true
        memeIndexGeneration++
        memeIndexListeners.delete(refreshMemeIndex)
        if (memeIndexController) memeIndexController.abort()
      }, 'dsh-expression-entry: meme index')
      // 把 [表情: x] 换成 <img> 之后,气泡里的 textContent 就变了。有些插件(注入记忆条那类)
      // 靠比对 textContent 判断「消息被改过」,于是重写 DOM → img 被打回文字 → 我们再装饰,
      // 来回打回闪个不停(issue #22 第 2 条)。所以每处替换都在 img 后面挂一个 display:none
      // 的 ghost span 装回原文标记:整段 textContent 与替换前逐字一致,谁来比都不觉得变过。
      const ghostFor = (raw) => {
        const ghost = document.createElement('span')
        ghost.setAttribute('data-meme-hidden', '1')
        ghost.style.cssText = 'display:none'
        ghost.textContent = raw
        return ghost
      }
      // 判断「这层是不是已经空了、要不要隐藏」必须无视 ghost:ghost 里装着原文标记,
      // 拿 textContent 判空会永远非空,气泡里会留一块空白。
      const textWithoutGhosts = (el) => {
        let out = ''
        for (const child of el.childNodes) {
          if (child.nodeType === 3) { out += child.nodeValue || ''; continue }
          if (child.nodeType !== 1) continue
          if (child.dataset && child.dataset.memeHidden) continue
          out += textWithoutGhosts(child)
        }
        return out
      }
      // 流式渲染会覆盖我们的注入,同一个 [表情: x] 可能被装饰两次 → 同一消息行挂两张相同的图
      // (issue #22 第 3 条:刷新后稳态只剩一张,说明是竞态而不是双注入)。按「消息行 + 描述」
      // 幂等去重:没有重复时零副作用,所以每轮扫描完无脑跑一次就行。
      const dedupeMemeImages = () => {
        const seenByRow = new Map()
        for (const img of document.querySelectorAll('img[data-meme-img]')) {
          const row = img.closest('[data-time-hover-root],[data-chat-flow-key]') || img.parentElement
          if (!row) continue
          let seen = seenByRow.get(row)
          if (!seen) seenByRow.set(row, seen = new Set())
          const caption = img.getAttribute('data-meme-img') || ''
          if (seen.has(caption)) { img.remove(); continue } // 留先出现的那张(已被提到行首的)
          seen.add(caption)
        }
      }
      // ---- 增量扫描配套 ----
      // 文字节点该不该被装饰:判据与原 acceptNode 完全一致(增量扫描复用同一套,
      // 免得两条路径行为分叉)。
      const memeTextAcceptable = (node) => {
        const parent = node.parentElement
        if (!parent) return false
        // 只渲染「对话」气泡。轨迹 / Think / 工具卡 / 输入框保持纯文本。
        // 容器标记认两个:老版本是 data-chat-flow,DSH 0.1.2 起消息行是 data-chat-flow-key
        // (issue #22 附录,使用者在新版上实测)。只认前者的话新版上 TreeWalker 一个节点都
        // 扫不到、表情永不转图;多认一个纯增益。
        const flowEl = parent.closest('[data-chat-flow],[data-chat-flow-key]')
        if (!flowEl) return false
        if (parent.closest('input,textarea,[contenteditable="true"],[data-variant="think"],[data-variant="others"],pre,code')) {
          return false
        }
        // 自己的 ghost 里装着 [表情: x] 原文,不排掉就会被反复装饰
        if (parent.closest('[data-meme-hidden]')) return false
        if (parent.dataset && parent.dataset.memeDecorated) return false
        // 0.2 宿主(dsh-client-ui-chat 0.2.0-rc.2)源码核对:① 工具/步骤轨迹整行是
        // data-chat-flow-kind="turn-process",宿主自己枚举行时也排除它,不排的话新版上
        // 轨迹文本会被装饰;② 分组折叠容器 ChatGroupSeat 的根上同时挂着
        // data-chat-group-key 和 data-chat-flow-key,分组头部文本最近命中的是分组本身,
        // 放行会把图提到分组顶上。消息行(FlowItem)只有 flow-key,不受影响。两个标记
        // 老版宿主都没有,加了纯增益。
        if (parent.closest('[data-chat-flow-kind="turn-process"]')) return false
        if (flowEl.getAttribute('data-chat-group-key') !== null) return false
        return MEME_TEXT_TEST.test(node.nodeValue || '')
      }
      // 清理孤儿标记与隐藏残留:scope 为元素时只清它自己和它的后代,为 null 时清全文档。
      // 返回「标记被清掉、需要重新装饰」的元素列表。
      const cleanupMemeMarkers = (scope) => {
        const root = scope && scope.nodeType === 1 ? scope : null
        const list = []
        if (root) {
          if (root.dataset && (root.dataset.memeDecorated || root.dataset.memeEmpty)) list.push(root)
          for (const el of root.querySelectorAll('[data-meme-decorated],[data-meme-empty]')) list.push(el)
        } else {
          for (const el of document.querySelectorAll('[data-meme-decorated],[data-meme-empty]')) list.push(el)
        }
        const revived = []
        for (const el of list) {
          if (!el.querySelector('img[data-meme-img],[data-meme-hidden]')) {
            if (el.dataset.memeDecorated) revived.push(el)
            delete el.dataset.memeDecorated
          }
          if (el.dataset.memeEmpty && textWithoutGhosts(el).trim()) {
            delete el.dataset.memeEmpty
            el.style.display = ''
          }
        }
        return revived
      }
      // 装饰一批文本节点:全量扫描与增量扫描共用同一段装饰逻辑。
      // forceDedupe=true(全量路径)照旧每轮去重;增量路径只在真的装饰了东西时才去重。
      const decorateMemeNodes = (nodes, forceDedupe) => {
        let decoratedAny = false
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
          decoratedAny = true
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
              img.dataset.memeImg = foldCaption(hit[1]) // 去重用的描述标记
              img.style.cssText = 'max-width:180px;max-height:180px;border-radius:10px;display:block;margin:8px 0'
              // 图在聊天流里常常一屏放不下:懒加载省首屏解码,异步解码避免长任务卡渲染。
              img.loading = 'lazy'
              img.decoding = 'async'
              frag.appendChild(img)
              frag.appendChild(ghostFor(hit[0]))
              imgs.push(img)
            } else {
              // 无命中:降级只显示描述原文,不把 [表情: ...] 标记裸露给用户。方括号单独用 ghost
              // 藏起来——可见的只有描述本身,而 textContent 仍是替换前那个 [表情: x] 逐字不差,
              // 否则比对 textContent 的插件照样会把这条打回(issue #22 第 2 条)。
              const at = hit[0].indexOf(']') - hit[1].length
              frag.appendChild(ghostFor(hit[0].slice(0, at)))
              frag.appendChild(document.createTextNode(hit[1]))
              frag.appendChild(ghostFor(hit[0].slice(at + hit[1].length)))
            }
            last = hit.index + hit[0].length
          }
          if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
          parent.replaceChild(frag, node)
          const row = parent.closest('[data-time-hover-root],[data-chat-flow-key]')
          if (row && imgs.length > 0) {
            // 用户 / steering 消息是右对齐的,但那个右对齐挂在气泡外面那层 flex 列容器
            // (宿主 MessageItem 的 userRow,align-items:flex-end)上;而这里为了掏空气泡把图
            // 提到了行元素(FlowItem,只是个普通 block)的行首,block 图落在 block 容器里默认
            // 贴左 → 自己发的表情包跑到屏幕左边(助手行本来就左对齐,一直看不出来)。按行角色
            // 补一次左外边距 auto 把图推回右边。data-chat-flow-kind 是 0.2 宿主才有的标记,
            // 老宿主取不到,行为保持原样。
            const kind = row.getAttribute('data-chat-flow-kind')
            if (kind === 'user' || kind === 'steering') {
              for (const img of imgs) img.style.marginLeft = 'auto'
            }
            for (const img of imgs) row.insertBefore(img, row.firstChild)
            // 排布模式(issue #50):stacked 时行翻成纵向 flex,图在上正文在下;
            // inline 不打标记,CSS 不命中,观感与旧版一致。
            if (memeLayoutMode === 'stacked') row.setAttribute('data-meme-layout', 'stacked')
            // 中间层被掏空才隐藏,并打 memeEmpty 标记(回显逻辑见函数开头的清理段)
            let el = parent
            while (el && el !== row) {
              if (!textWithoutGhosts(el).trim()) {
                el.style.display = 'none'
                el.dataset.memeEmpty = '1'
              }
              el = el.parentElement
            }
          }
        }
        if (forceDedupe || decoratedAny) dedupeMemeImages()
        return decoratedAny
      }
      const decorateMemeText = () => {
        // 宿主重渲染(切语言/切主题/HMR)会让 React 对纯文本 children 走 textContent 覆写:
        // 注入的 img 和 ghost 一起被抹掉、原文裸露,而 data-meme-decorated 在元素属性上,
        // 覆写不影响它 → 标记还在、注入已不在,下面的 acceptNode 见标记就永久跳过,图再也
        // 回不来,刷新页面才恢复(issue #26)。每轮扫描先摘孤儿标记:注入 = img + ghost,
        // 两个都不在了才认孤儿;降级装饰(图库未命中、只有 ghost)不能动,否则每轮扫描都在
        // 白白重写这段 DOM。摘完标记本轮就会重新装饰;上一轮幸存的同描述图由 dedupeMemeImages 去重。
        // 同一轮顺带处理「隐藏残留」:hide walk 只藏不露,React 之后往同一个元素写回可见文本
        // (流式追加/编辑消息)时元素还带着 display:none,内容会永久不可见——按「现在有没有
        // 可见文本」翻回来,只动打过 data-meme-empty 标记的,宿主自己隐藏的元素不碰。
        cleanupMemeMarkers(null)
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            return memeTextAcceptable(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
          },
        })
        const nodes = []
        let n
        while ((n = walker.nextNode())) nodes.push(n)
        decorateMemeNodes(nodes, true)
      }
      // 设置侧边栏「表情包」行的齿轮图标替换成笑脸(dsh navIcon 硬编码,不支持自定义)
      const decorateNavIcon = () => {
        const nav = document.querySelector('[role="dialog"] nav')
        if (!nav) return
        // 同 decorateMemeText 的孤儿标记(issue #26):面板重渲染抹掉注入后,btn 上的标记
        // 不该再拦着重新装饰。标记分两档:真注入过的才是 '1'(svg 上有 data-meme-nav-icon
        // 为证),没图标/图标是 IMG 这种「没得换」的记 'skip',清理时不碰。
        for (const btn of nav.querySelectorAll('button[data-meme-nav="1"]')) {
          if (!btn.querySelector('svg[data-meme-nav-icon]')) delete btn.dataset.memeNav
        }
        for (const btn of nav.querySelectorAll('button')) {
          if (btn.dataset.memeNav) continue
          if (!btn.textContent || !btn.textContent.includes('表情包')) continue
          const icon = btn.firstElementChild
          if (!icon || icon.tagName === 'IMG') { btn.dataset.memeNav = 'skip'; continue }
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          svg.setAttribute('viewBox', '0 0 24 24')
          svg.setAttribute('data-meme-nav-icon', '1')
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
      // 扫描是「全文档 TreeWalker + 每个文本节点跑一遍正则」,不便宜;流式输出期间
      // mutation 密集,每来一条就整篇扫一遍会在长会话里雪崩(点进去明显卡顿)。
      // 原先靠 300ms 纯 trailing 防抖压频率,但每次 mutation 都清掉重排,变动比 300ms
      // 更密时定时器永远等不到触发点,只能靠 SCAN_MAX_WAIT 兜底;一次全量扫描本身还可能
      // 超过 1.2s,长会话里会一直扫——图于是永远比文字晚一大截(实测中位 600ms、
      // p90 1100ms)。现在改成「最小间隔 + 排一次不重排」:扫描一结束就把下一次排上,
      // 窗内变动合并到窗末尾,节奏固定、不会被后续 mutation 无限推迟。
      const SCAN_MIN_GAP = 300
      // 调度上界:从本轮第一次变动算起最多推迟这么久。最小间隔(300ms)恒小于它,due 不会
      // 晚于 now+SCAN_MIN_GAP,正常节奏下命中不了;保留它是给调度公式一个硬上界。
      const SCAN_MAX_WAIT = 1200
      let scanTimer = 0
      let scanDeadline = 0
      let scanning = false
      // 增量扫描:只处理 MutationObserver 记录里真正变过的文本节点/新增子树;
      // 只有结构性重排(删了别的东西元素)才回退全量扫描。首轮与索引到达仍走全量。
      const MEME_NODE_TEXT = 3
      const MEME_NODE_ELEMENT = 1
      const MEME_PENDING_LIMIT = 2000
      let pendingRecords = []
      let forceFullScan = true
      const collectMemeTextNodes = (node, out) => {
        if (!node) return
        if (node.nodeType === MEME_NODE_TEXT) { out.push(node); return }
        if (node.nodeType !== MEME_NODE_ELEMENT) return
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
        let n
        while ((n = walker.nextNode())) out.push(n)
      }
      // 增量路径的「解藏」:hide walk 会把 parent→行容器之间的空中间层都 display:none,并打上
      // data-meme-empty(见 decorateMemeNodes 末尾)。宿主之后往这些层里补可见文本(流式追加 /
      // 编辑消息)时,增量清理的范围只在变动点子树内、碰不到祖先,新文字会一直隐着,直到下一次
      // 全量扫描才回来。这里从变动点向上,把带着标记、且已经有可见文本的祖先翻回来;只动自己
      // 打过标记的元素,宿主自己隐藏的不碰。
      const unhideStale = (start) => {
        for (let el = start; el; el = el.parentElement) {
          if (el.dataset && el.dataset.memeEmpty && textWithoutGhosts(el).trim()) {
            delete el.dataset.memeEmpty
            el.style.display = ''
          }
          if (el.matches && el.matches('[data-time-hover-root],[data-chat-flow-key]')) return
        }
      }
      // 增量装饰:只处理记录里指向的节点。返回 false = 需要回退全量扫描。
      const decorateMemeIncremental = (records) => {
        const candidates = []
        for (const record of records) {
          if (record.type === 'characterData') {
            collectMemeTextNodes(record.target, candidates)
            // 原地改写也可能把可见文本写回上一轮被 hide 的中间层,先解藏再装饰。
            unhideStale(record.target.parentElement || record.target)
            continue
          }
          if (record.type !== 'childList') continue
          const target = record.target
          // 宿主覆写 textContent 会把注入的 img/ghost 一起删掉,元素上的标记成了孤儿(issue
          // #26)。只有真的删了东西才需要清目标容器:纯新增(新消息行插进流容器)时 target
          // 是整个历史容器,清它的标记是 O(历史) 的 —— 增量扫描就白做了。
          if (target && target.nodeType === MEME_NODE_ELEMENT && record.removedNodes.length > 0) {
            for (const el of cleanupMemeMarkers(target)) collectMemeTextNodes(el, candidates)
          }
          for (const added of record.addedNodes) {
            collectMemeTextNodes(added, candidates)
            // 新内容落进上一轮被 hide 的空中间层时,把显示恢复回来。
            unhideStale(added.nodeType === MEME_NODE_ELEMENT ? added : added.parentElement)
          }
          for (const removed of record.removedNodes) {
            // 删掉的是自己注入的 img/ghost → 上面的局部清理已经处理;
            // 删掉的是别的东西 → 布局变了,全量扫描才稳妥。
            if (removed.nodeType !== MEME_NODE_ELEMENT) continue
            const ours = typeof removed.matches === 'function' && removed.matches('img[data-meme-img],[data-meme-hidden]')
            if (!ours) return false
          }
        }
        const nodes = []
        for (const node of candidates) {
          if (!node.isConnected) continue
          if (!memeTextAcceptable(node)) continue
          nodes.push(node)
        }
        if (nodes.length > 0) decorateMemeNodes(nodes, false)
        return true
      }
      const runScan = () => {
        if (scanning) return // 重入保护:装饰本身改 DOM,会再触发 observer
        scanning = true
        try {
          const records = pendingRecords
          pendingRecords = []
          let handled = false
          if (!forceFullScan && records.length > 0 && records.length <= MEME_PENDING_LIMIT) {
            handled = decorateMemeIncremental(records)
          }
          if (!handled) decorateMemeText()
          forceFullScan = false
          decorateNavIcon()
        } catch (error) {
          // 装饰失败不该打断宿主渲染:最多是这一轮表情不转图。
          // 但这一轮可能只处理了一半:下一轮退回全量,别让增量背着半成品状态继续。
          forceFullScan = true
          console.warn('[dsh-expression] 表情装饰失败:', error && error.message ? error.message : error)
        } finally {
          scanning = false
        }
      }
      let lastScanAt = 0
      // 关键:已排期的扫描不再被后续变动重排(旧实现每次都 clearTimeout 重来)。
      // 触发时刻由「上次扫描时刻」唯一定出,后续变动只合并、不改变它,因此密流式
      // 也不会把扫描无限往后推 —— 那正是旧实现「图比文字晚一大截」的根因。
      const scheduleScan = () => {
        if (scanTimer !== 0) return // 本轮已有排期,合流即可
        const now = Date.now()
        if (scanDeadline === 0) scanDeadline = now + SCAN_MAX_WAIT
        const due = lastScanAt === 0 ? now : lastScanAt + SCAN_MIN_GAP
        const wait = Math.max(0, Math.min(due, scanDeadline) - now)
        scanTimer = setTimeout(() => {
          scanTimer = 0
          scanDeadline = 0
          lastScanAt = Date.now()
          runScan()
        }, wait)
      }
      const observer = new MutationObserver((records) => {
        // 只认真正影响文本的变动;纯属性变化(宿主的 hover/动画很吵)不值得重扫。
        // 记录攒起来给增量扫描用。
        let relevant = 0
        for (const record of records) {
          if (record.type === 'characterData' || record.addedNodes.length || record.removedNodes.length) {
            pendingRecords.push(record)
            relevant++
          }
        }
        if (relevant > 0) scheduleScan()
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      runScan()
      ctx.effect(() => () => {
        observer.disconnect()
        clearTimeout(scanTimer)
        scanTimer = 0
        scanDeadline = 0
        // 模块级状态不清会让「卸载→重新挂载」继承上一轮的节奏:复位后首条变动仍立即扫,
        // 待处理记录也不会被带进下一次挂载。
        pendingRecords = []
        lastScanAt = 0
        forceFullScan = true
      }, 'dsh-expression-entry: meme text observer')

      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'memes', order: 25, label: '表情包' },
        () => React.createElement(MemePanel, { ctx }),
      ))
      // 插件详情页(插件 → 表情包)挂同一份管理面板:plugins.bundle.config 按
      // bundle 包名匹配,渲染在详情页描述与组件列表之间。设置页保留入口,两处
      // 共用同一套 HTTP API,改动即时互见。宿主未声明该槽时 inject 不会触发。
      slots.inject('plugins.bundle.config', () => slots.register(
        { name: 'plugins.bundle.config', key: 'dsh-meme' },
        () => React.createElement(MemePanel, { ctx }),
      ))

      // 输入框快捷发图(QQ 式)。
      const store = makeMemeStore()
      // Hoisted out of the render callback on purpose: makeMemeButton() returns a fresh
      // function component on every call, so creating it inside the slot render callback
      // hands React a new component type on every re-render → the trigger button is
      // unmounted and remounted each time (measured 20+ rebuilds/second while a turn is
      // streaming), which in turn wakes every full-body MutationObserver in the host.
      const MemeButton = makeMemeButton(store)
      slots.inject('conversation.input.left', () => slots.register(
        { name: 'conversation.input.left', id: 'meme-picker', order: 5, label: '表情包' },
        () => React.createElement(MemeButton),
      ))
      slots.inject('conversation.input.overlay', () => slots.register(
        { name: 'conversation.input.overlay', id: 'meme-picker', order: 5, label: '表情包' },
        (props) => React.createElement(MemeBoard, {
          store,
          inputActions: props.inputActions,
          useInput: props.useInput,
          getConversation: () => ctx.get('conversation'),
        }),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    // 辅助入口仅用于回归测试(node --test),宿主不消费
    exports.__test = {
      apiPost,
      foldCaption, looseCaption, splitDescTokens, buildMemeIndex, buildMemeSearch, matchDesc, compareVersions,
      setMemeLayoutMode,
      createOwnedStyle, STYLE_OWNER_ID, installMemeZoom,
      packOfUrl, pickerTagCounts, pickerFilter, fitPanelHeight, naturalPanelHeight, panelVisibleTop, previewPosition, previewClampOffset, clampPreviewElement, inKeepZone, uniqueKeys,
      // 图片镜像候选/回退:测试要能直接钉候选顺序,也要能在用例之间清掉模块级探测缓存
      imageCandidates, imageUrl, imageProvider, MemeRemoteImage, remoteImageOk, remoteImageBad,
    }
    return module.exports
  },
})
