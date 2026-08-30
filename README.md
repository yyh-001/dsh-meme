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

默认内置两套图库：`official-001`（官方表情包 1 号，92 张）和 `dafeiyu-001`（大肥鱼，49 张），开箱用官方包，**无需任何配置**。

设置页「当前图库」下拉即可切换。插件会扫描内置 `memes/*` 以及「扫描目录」（默认 `~/.dsh/meme-packs`）下带 `index.db` 的子文件夹。导入 ZIP 也会放进扫描目录并立刻切过去。设置存在 `~/.dsh/dsh-expression.json`，升级插件不丢。

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
| `send_meme` | 按情绪随机抽候选；Web 模式把 `[表情: 描述]` 写进回复，前端配图 |
| `learn_meme` | **学图**：用户说「入库」即可（默认最近一张用户附件）；也可传 `attachmentId` / `imageUrl` |

## 发图格式（默认）

**界面显示表情图片，模型只读写文字 token**——不触发 dsh 的图片准入检查：

- 模型和悬浮窗都发 `[表情: 描述]`（不要带网址）
- 前端只在**对话气泡**里按 caption 配图（Think / 轨迹 / 工具卡保持纯文字）
- 引号差异（`“”` / `""`）会折叠后再匹配
- 描述没抄中候选时：先按分词在图库 caption/关键词里兜底匹配；仍无命中就显示描述原文，不裸露 `[表情: ...]` 标记
- 直接上传的图片仍是附件，原样进会话；学图走 `learn_meme`

## 界面

设置页「表情包」面板（已美化）：

- **当前图库**：下拉切换已扫描到的表情包组（内置 + 扫描目录）
- **扫描目录**：改路径后自动发现子文件夹里的图库；导入 ZIP 也放这里
- **导出/导入图库**：打包成 ZIP 分享给别人，导入别人的包一键切换
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

两条路：发给朋友，或挂到[宣传页](https://yyh-001.github.io/dsh-meme/)让别人预览。

**发给朋友**

1. 设置页 → **导出图库**，得到 `dsh-meme-pack-日期.zip`
2. 把这个 ZIP 发出去
3. 对方设置页 → **导入图库**，选这个 ZIP，会自动切换到新图库

请用插件导出的 ZIP。GitHub 仓库页上的「Download ZIP / 下载源码」是压缩过的，导入会失败。

**挂到宣传页**

1. 先按上面导出 ZIP，解压成一个文件夹（里面应有 `index.db`、`manifest.json`、`memes/`）
2. 新建 GitHub 仓库，把文件夹内容放进仓库根目录
3. 加 `previews/`，放 6–12 张缩略图（jpg/png），宣传页靠它们做预览
4. 仓库 Settings → Topics 加上 [`dsh-meme-pack`](https://github.com/topics/dsh-meme-pack)

可选：把插件导出的那个 ZIP 挂到 GitHub Release，别人就能直接下载再导入。也可以 `git clone` 之后，把仓库放进扫描目录（或设置页「打开其他目录」指过去）。

## 订阅远程图库

设置页「远程图库」里粘贴一个**清单 JSON 地址**(或从图库目录点「下载」),插件自动下载全部图片、建索引、出现在「当前图库」下拉并切换——不用碰 ZIP,不用碰命令行。

- 清单格式与收录方式见 **[docs/remote-pack-spec.md](./docs/remote-pack-spec.md)**(URL + 分类 + 描述 + 关键词,一张 JSON 管一个包)
- 已订阅的包再点「更新」走增量:只下载新增图片,已有图片仅刷新描述/关键词
- 图库目录:[`docs/remote-packs.json`](./docs/remote-packs.json)(jsDelivr/raw 双源,PR 收录)

## 它做什么

| 能力 | 说明 |
|------|------|
| **按情绪抽图** | 六个情绪桶：happy / angry / sad / shy / confused / daily；随机抽 N 张 caption 给模型挑 |
| **自动学图** | `learn_meme` 默认收录最近一张用户附件，也可传 URL；识图需当前模型支持图片输入 |
| **文字 token 发图** | `[表情: 描述]` → 前端配图；只渲染对话气泡 |
| **输入框一键发图** | 会话输入框左侧 😊 按钮 → 悬浮面板选图 → 一点即发 |
| **情绪主动发图** | 气氛对了就主动甩图；发完短接，让图自己说话 |
| **管理 API** | 上传 / 编辑 / 删除 / 删除分类，全部在设置页完成，数据持久 |
| **图库切换** | 设置页下拉切换已扫描图库；扫描目录默认 `~/.dsh/meme-packs` |
| **导出 / 导入** | 图库一键打包 ZIP 分享，导入别人的包自动切换（零依赖实现） |
| **订阅远程图库** | 设置页粘贴清单 JSON 即按需下载建包，支持增量更新（`remoteDirUrl` 可配目录源） |

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
- **官方表情包1号**（`id: official-001`，默认）来自 **Astrbot mememanager 官方初始表情包**：

- 上游仓库：[anka-afk/astrbot-meme-pack-official-01](https://github.com/anka-afk/astrbot-meme-pack-official-01)（`main` 分支），维护者 **anka-afk**
- 构成：`index.db`（SQLite 索引，含每张 caption/关键词）+ `manifest.json`（分类说明 + 来源标注）+ `memes/<tag>/` 图片 + `previews/`
- ⚠️ 上游**未提供 LICENSE**：这套图缺乏显式的再分发许可。随插件打包作为个人默认库使用没问题；如需公开对外分发，请保留 manifest.json 中的上游来源标注。

## 接到你的 Agent

| 组件 | 说明 |
|------|------|
| **dsh-meme** | 本插件：`MemesStore`（情绪抽图）+ `send_meme`（发送）+ `learn_meme`（学图）+ 管理 API |
| **[dsh-companion](https://github.com/yyh-001/dsh-companion)** | 人设 + Hermes 记忆 + 消息通道；提供发图服务 |
| **图库** | 内置 `official-001` + `dafeiyu-001`，设置页扫描切换 / 导入分享包 |

```text
dsh-meme/
  index.js          插件入口：memeRoot 配置 + 管理 API + learn_meme/识图
  memes.js          MemesStore：SQLite 索引 + 情绪桶随机抽图 + 路径安全
  client.js         前端：设置页面板(上传/编辑/删除) + 😊 悬浮窗 + [表情: 描述] 配图
  cordis.patch.yml  bundle patch(纯 insert,热挂载免重启)
  memes/
    official-001/   内置默认图库（92 张）
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
