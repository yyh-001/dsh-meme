<p align="center">
  <img src="https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/hero.jpg?v=3" alt="dsh-meme — 找得到、发得出" width="100%" />
</p>

<p align="center">
  <strong>表情包插件 dsh-meme</strong> — 找得到、发得出、学得会
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" /></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/topic-dsh--plugin-amber?style=flat-square" alt="dsh-plugin" /></a>
  <img src="https://img.shields.io/badge/Host-DeepSeek%20Harness-informational?style=flat-square" alt="DeepSeek Harness" />
  <img src="https://img.shields.io/badge/Deps-node%3Asqlite%20only-blue?style=flat-square" alt="zero third-party deps" />
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="awesome · DSH plugin" /></a>
</p>

---

宣传页：**[yyh-001.github.io/dsh-meme](https://yyh-001.github.io/dsh-meme/)**（表情包合集可预览；仓库加 topic [`dsh-meme-pack`](https://github.com/topics/dsh-meme-pack) + `previews/` 即收录）

图库下载：**[yyh-001/dsh-meme-packs](https://github.com/yyh-001/dsh-meme-packs)**（下载 ZIP 后可在设置页直接导入）

**dsh-meme**（原 `dsh-expression`）是 DeepSeek Harness 的表情包插件——找得到、发得出、学得会：

- **纯文本也能斗图**：界面显示表情图片，模型收到的是 `[表情: 描述]`，无需图片输入能力
- **AI 自动学图**：用户说「入库」时，`learn_meme` 收录最近一张用户附件（不必填附件 id），自动识别分类/描述
- **情绪主动发图**：先选情绪桶，系统随机抽若干张 caption，模型挑一张贴进回复
- **像 QQ/微信 一样发图**：输入框 😊 悬浮面板点选表情直接发出
- **零第三方依赖**：仅 node:sqlite，装完即用

交流 / 反馈：**QQ 群 [993579665](https://qm.qq.com/q/7AD2g70HqS)**（[点击加入](https://qm.qq.com/q/7AD2g70HqS)）

---

## 安装

已发布到 **npm**（`dsh-meme`），一行装进任意 DSH profile（如 `~/.dsh/profiles/web/`）：

```bash
dsh plugin --profile web add dsh-meme
# 等价于:
pnpm add dsh-meme
```

旧包名 `dsh-expression` 已弃用，请改用 `dsh-meme`。插件内部 id 仍为 `dsh-expression`，已有安装不受影响。

或从 GitHub / 本地直接装：

```bash
pnpm add github:yyh-001/dsh-meme   # 或
pnpm add file:/path/to/dsh-meme
```

> 注意：pnpm 有「新包安全期」（默认 24h），刚发布的版本会被静默回落到旧版；急用可在 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 里加上 `dsh-meme`。

> 运行时要求：**Node ≥ 22.13.0**（依赖内置 `node:sqlite` 模块；22.5–22.12 需 `--experimental-sqlite` 标志，Node 20 不支持）。

## 配置

内置一套图库：`dafeiyu-001`（大肥鱼，49 张），开箱即用，**无需任何配置**。「官方表情包 1 号」（`official-001`）已不再随插件分发，需要的话到设置页「发现」里一键安装（市场里有带 SHA-256 校验的 Release ZIP）。

设置页「图库」页：点卡片上的「编辑」切入该图库（管理图片用），点卡片右上角的开关决定**模型能不能用这个图库发图**（可以同时开多个）。插件会扫描内置 `memes/*` 以及「扫描目录」（默认 `~/.dsh/meme-packs`）下带 `index.db` 的子文件夹。导入 ZIP 也会放进扫描目录并立刻切过去。设置存在 `~/.dsh/dsh-expression.json`，升级插件不丢。

## 装完即用

```text
用户: 发个无语的表情包
模型: send_meme tag=sad → 随机几张 caption → 把 [表情: …] 贴进回复
前端: 按描述配图，对话里看起来就是表情
```

输入框左侧点 **😊**（微信同款笑脸）直接选图一键发出，无需让模型代劳。

<p align="center">
  <img src="https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/chat-example.png" alt="模型根据情绪主动发表情包" width="80%" />
</p>

## 工具

| 工具 | 作用 |
|------|------|
| `send_meme` | 按情绪从**所有打开开关的图库**里随机抽候选；Web 模式把 `[表情: 描述]` 写进回复，前端配图 |
| `learn_meme` | **学图**：用户说「入库」即可（默认最近一张用户附件）；也可传 `attachmentId` / `imageUrl` |

## 发图格式（默认）

**界面显示表情图片，模型只读写文字 token**——不触发 dsh 的图片准入检查：

- 模型和悬浮窗都发 `[表情: 描述]`（不要带网址）
- 前端只在**对话气泡**里按 caption 配图（Think / 轨迹 / 工具卡保持纯文字）
- 引号差异（`“”` / `""`）会折叠后再匹配
- 描述没抄中候选时：先按分词在图库 caption/关键词里兜底匹配；仍无命中就显示描述原文，不裸露 `[表情: ...]` 标记
- 直接上传的图片仍是附件，原样进会话；学图走 `learn_meme`

## 界面

设置页「表情包」面板三个一级标签页（没有二级标签）：

- **图库**：卡片列出已安装图库（内置 / 导入 / 自定义 / 市场下载），显示封面、张数、分类标签；点卡片上的「编辑」切到该图库并进入它的表情包页，页内可搜索/筛选/上传/编辑/删除，左上角「← 图库列表」返回
- **图库开关**：每张卡片右上角一个开关，**打开后模型才能用这个图库发图**，可以同时打开多个（`send_meme` 的候选从所有打开的图库里抽；一个都没开时模型会被告知去设置页打开）
- **新建图包库 / 导入图库**：图库页顶部；导入是选一个插件导出的 ZIP，导入后自动切过去。新建的图库会自动打开开关
- **导出**：每张图库卡片上都有，导出该图库的 ZIP（不必先切过去）
- **更新**：只在市场里有更新版本时才显示（比对图库自己的版本与市场目录的版本）；发现页只负责安装，装过的条目不给按钮，要更新到图库页
- **删除**：图库卡片上的「删除」——内置、市场下载、自建/导入都走这一个入口（二次确认在应用内弹窗里，不是浏览器原生框）。删市场下载的会连订阅记录一起清掉；内置包删了，插件升级或重装后会随包回来；当前图库要先切走
- **投稿**：当前图库的卡片上，导出图库 ZIP 并打开预填好的 GitHub 投稿表单
- **发现**：展示 GitHub 图库目录，点「安装」下载 Release ZIP、校验 SHA-256 并自动切换；已安装的条目不显示按钮（更新在图库页）。底部可粘贴清单 JSON 地址订阅
- **设置**：扫描目录（带「选择目录」应用内浏览器）、陪伴提示词开关（关掉后模型不再主动斗图）、编辑提示词
- **上传弹窗**：选图预览 + 分类下拉（选择/新建/删除分类）+ 描述 + 关键词
- **编辑弹窗**：同款分类下拉，改分类/描述/关键词
- **分类中文显示**：下拉与卡片显示「生气 (angry)」式中文
- 分类筛选即时生效

<p align="center">
  <img src="https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/settings-panel.png" alt="设置页表情包管理面板" width="80%" />
</p>

输入框 😊 一键发表情包：点开面板 → 搜索 / 浏览缩略图 → 点一张直接发出。

<p align="center">
  <img src="https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/quick-picker.png" alt="输入框一键发表情包" width="80%" />
</p>

## 分享自己的表情包

两条路：发给朋友，或提交到公共的 [`dsh-meme-packs`](https://github.com/yyh-001/dsh-meme-packs) 图库市场。

**新建并投稿到市场**

设置页 → 图库 → 顶部 **新建图包库**，填写名称、ID 和简介，创建后自动切换到空图库（并打开它的开关）。添加图片后点当前图库卡片上的 **投稿** → 导出 ZIP 并打开投稿页。

插件会下载当前图库 ZIP 并打开预填名称、简介和图片数量的 GitHub 投稿页。登录 GitHub 后，将 ZIP 拖入“图库 ZIP”一栏，补充图片来源与许可，再手动提交。审核通过后收录到市场。无需配置 Token，也不需要付费上传服务。若浏览器拦截新页面，可点击提示下方的“打开 GitHub 投稿页”。导出完成不代表已经投稿或收录。

**发给朋友**

1. 设置页 → 图库 → 该图库卡片上的 **导出**，得到 `dsh-meme-<图库id>.zip`
2. 把这个 ZIP 发出去
3. 对方设置页 → 图库 → 顶部 **导入图库**，选这个 ZIP，会自动切换到新图库

请用插件导出的 ZIP。GitHub 仓库页上的「Download ZIP / 下载源码」是压缩过的，导入会失败。

**挂到宣传页**

1. 先按上面导出 ZIP，解压成一个文件夹（里面应有 `index.db`、`manifest.json`、`memes/`）
2. 新建 GitHub 仓库，把文件夹内容放进仓库根目录
3. 加 `previews/`，放 6–12 张缩略图（jpg/png），宣传页靠它们做预览
4. 仓库 Settings → Topics 加上 [`dsh-meme-pack`](https://github.com/topics/dsh-meme-pack)

可选：把插件导出的那个 ZIP 挂到 GitHub Release，别人就能直接下载再导入。也可以 `git clone` 之后，把仓库放进扫描目录（设置页「扫描目录」里改路径，或用「选择目录」浏览）。

## 图库市场与远程订阅

设置页「图库市场 → 发现」默认读取 [`dsh-meme-packs/catalog.json`](https://github.com/yyh-001/dsh-meme-packs/blob/main/catalog.json)。用户点「安装」后，插件直接下载 GitHub Release ZIP、校验 SHA-256、安装并切换，不需要先手动下载。

- GitHub Release ZIP 与旧版逐图清单两种格式都支持，规范见 **[docs/remote-pack-spec.md](./docs/remote-pack-spec.md)**
- 已订阅的包再点「更新」走增量:只下载新增图片,已有图片仅刷新描述/关键词
- 主目录走 jsDelivr/raw 双源；旧目录 [`docs/remote-packs.json`](./docs/remote-packs.json) 保留为兼容回退

## 它做什么

| 能力 | 说明 |
|------|------|
| **按情绪抽图** | 六个情绪桶：happy / angry / sad / shy / confused / daily；随机抽 N 张 caption 给模型挑 |
| **自动学图** | `learn_meme` 默认收录最近一张用户附件，也可传 URL；识图需当前模型支持图片输入 |
| **文字 token 发图** | `[表情: 描述]` → 前端配图；只渲染对话气泡 |
| **输入框一键发图** | 会话输入框左侧 😊 按钮 → 悬浮面板选图 → 一点即发 |
| **情绪主动发图** | 气氛对了就主动甩图；发完短接，让图自己说话 |
| **管理 API** | 上传 / 编辑 / 删除 / 删除分类，全部在设置页完成，数据持久 |
| **图库切换** | 设置页「图库」页点卡片上的「编辑」切换并进入；扫描目录默认 `~/.dsh/meme-packs` |
| **导出 / 导入** | 图库一键打包 ZIP 分享，导入别人的包自动切换（零依赖实现） |
| **图库市场** | 发现页读取 GitHub 目录，一键安装带 SHA-256 校验的 Release ZIP；图库页在有新版本时才显示「更新」 |

## 日常命令（模型视角）

```text
send_meme tag=sad limit=8          # 难过桶随机 8 张，挑一行 [表情: …] 贴进回复
send_meme tag=happy                # 开心/卖萌
learn_meme                         # 收录最近一张用户图（不必填 id）
learn_meme imageUrl="https://…"    # 收录任意图片 URL
```

情绪字典：`happy` 开心（卖萌/可爱/喜欢）/ `angry` 生气 / `sad` 难过（无语/求饶）/ `shy` 害羞 / `confused` 困惑惊讶 / `daily` 日常（睡觉/上班/早上好）。不满意再 `search` 同一 tag 换一批。

## 给模型的三条铁律

完整约定见 `send_meme` 工具描述。

1. 把候选里的 `[表情: 描述]` 整段原样写进回复，不要加网址、不要改成 markdown 图片
2. 没命中就换情绪或回文字，别硬发
3. 发完保持简短，让图自己说话——不复述、不描述图的内容

## 图库来源

内置两套：

- **大肥鱼**（`id: dafeiyu-001`，49 张鲸鱼娘 chibi），设置页可切过来：包含 `angry` 3 张、`confused` 4 张、`daily` 7 张、`happy` 12 张、`sad` 6 张、`shy` 4 张，以及 `baka` / `color` / `cpu` / `fool` / `givemoney` / `like` / `meow` / `morning` / `see` / `sigh` / `sleep` / `surprised` / `work` 各 1 张。
  - 2026-08-20 新增 25 张自动学图表情，来自 [PR #3](https://github.com/yyh-001/dsh-meme/pull/3)，感谢 [hZsFN](https://github.com/hZsFN) 的补充。
- **官方表情包1号**（`id: official-001`，已改为市场安装、不再内置）来自 **Astrbot mememanager 官方初始表情包**：

- 上游仓库：[anka-afk/astrbot-meme-pack-official-01](https://github.com/anka-afk/astrbot-meme-pack-official-01)（`main` 分支），维护者 **anka-afk**
- 构成：`index.db`（SQLite 索引，含每张 caption/关键词）+ `manifest.json`（分类说明 + 来源标注）+ `memes/<tag>/` 图片 + `previews/`
- ⚠️ 上游**未提供 LICENSE**：这套图缺乏显式的再分发许可。随插件打包作为个人默认库使用没问题；如需公开对外分发，请保留 manifest.json 中的上游来源标注。

## 接到你的 Agent

| 组件 | 说明 |
|------|------|
| **dsh-meme** | 本插件：`MemesStore`（情绪抽图）+ `send_meme`（发送）+ `learn_meme`（学图）+ 管理 API |
| **[dsh-companion](https://github.com/yyh-001/dsh-companion)** | 人设 + Hermes 记忆 + 消息通道；提供发图服务 |
| **图库** | 内置 `dafeiyu-001`；`official-001` 和其它图库在市场「发现」页安装，也可导入分享包 |

```text
dsh-meme/
  index.js          插件入口：memeRoot 配置 + 管理 API + learn_meme/识图
  memes.js          MemesStore：SQLite 索引 + 情绪桶随机抽图 + 路径安全
  client.js         前端：设置页面板(上传/编辑/删除) + 😊 悬浮窗 + [表情: 描述] 配图
  cordis.patch.yml  bundle patch(纯 insert,热挂载免重启)
  memes/
    dafeiyu-001/    内置大肥鱼（49 张鲸鱼娘）
  package.json      name / inject / peer deps
  README.md
  LICENSE
```

## 已知限制

- `learn_meme` 自动识图依赖当前默认模型支持图片输入（不支持时可手动指定 tag/caption）；
- 磁盘上仍是细 tag（angry/baka/…），模型只认六个情绪桶；caption 对不齐时前端会折叠引号后再配图。

## License

[MIT](./LICENSE)
