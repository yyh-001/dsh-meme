<p align="center">
  <img src="./docs/hero-banner-v4.jpg" alt="dsh-meme — 找得到、发得出、学得会" width="100%" />
</p>

<p align="center"><strong>给 DeepSeek Harness 加上表情包：自己点图发，也能让 AI 接着斗图。</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-meme"><img src="https://img.shields.io/npm/v/dsh-meme?style=flat-square" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/Node-%E2%89%A522.13-blue?style=flat-square" alt="Node ≥ 22.13" />
</p>

<p align="center">
  <a href="https://yyh-001.github.io/dsh-meme/">预览表情包</a> ·
  <a href="https://github.com/yyh-001/dsh-meme-packs">图库市场</a> ·
  <a href="https://github.com/yyh-001/dsh-meme/issues/new/choose">反馈问题</a> ·
  <strong>中文</strong> · <a href="./README.en.md">English</a>
</p>

## 能做什么

- **一键发图**：输入框旁点 😊，搜索、按图库或情绪筛选，点一张就发送。
- **查看大图**：点击聊天里的表情，滚轮缩放、双击复位，Esc 或点背景关闭。
- **跟 AI 斗图**：说「发个开心的表情」或「找一张猫猫比心」，也可以直接按情绪或关键词找图；Web 聊天里模型输出文字标记、前端显示图片，发图无需模型支持图片输入；QQ/微信等 IM 聊天里自动改走 dsh-im 原生图片发送。
- **学会新图**：上传图片后说「把这张图入库」，AI 自动识别分类和描述；也可以把图片文件直接拷进图库目录，点「扫描新增」一键入库（动图 GIF 建议走这条，原始动画保留；文件改名/删除后扫描会顺手清理失效记录）。
- **整理图库**：跟 AI 说「列一下表情包清单」「帮我查查重复」「把这张改成 work 分类」——内置 `meme_list` / `meme_update` 维护工具，改分类/描述/关键词不用手动翻面板（删除留在面板，防误删）。
- **管理与分享**：多图库开关、上传与编辑、ZIP 导入导出、市场安装与更新。
- **收藏不丢**：上传和 AI 学图统一存到 `~/.dsh/meme-packs` 下的「我的收藏」图库（自动启用）——内置图库随插件升级会被整个替换，收藏放在包外，更新插件不再清空。
- **手机也能看**：手机/平板经电脑局域网 IP 打开 DSH Web，设置页打开「局域网访问图库」即可加载表情包（默认关，见下文）。
- **开箱即用**：内置大肥鱼图库（24 张），零第三方运行依赖，使用 Node 内置 SQLite。

## 宣传视频

<p align="center">
  <a href="https://www.bilibili.com/video/BV1ZWnF6EEAa">
    <img src="./docs/promo-video-cover.jpg" alt="dsh-meme 宣传视频（B 站）" width="720" />
  </a>
  <br />
  <a href="https://www.bilibili.com/video/BV1ZWnF6EEAa">▶ 在 B 站观看（56 秒）</a>
</p>

## 安装

在 DSH 中打开 **插件 → 添加插件**，输入 `dsh-meme` 并安装。

也可以安装到指定 profile：

```bash
dsh plugin --profile web add dsh-meme
```

需要 **Node.js ≥ 22.13.0**。旧包名 `dsh-expression` 已弃用，内部插件 ID 保留兼容。

## 效果预览

你发一张，AI 接着回一张。

<p align="center">
  <img src="./docs/chat-example.png" alt="斗图示例：吃白饭的大肥鱼，用户发一张，AI 接着回一张" width="80%" />
</p>

![输入框表情选择器：搜索、图库与情绪筛选](./docs/quick-picker.png)

## 图库管理

打开 **设置 → 表情包**：

- **图库**：点卡片管理图片；分类下拉按真实分类筛选；「扫描新增」收编手动拷进目录的图片并清理失效记录。卡片开关决定 AI 能否使用该图库，可多选。支持新建、导入/导出 ZIP、投稿、删除和更新。
- **发现**：预览市场图库并一键安装（Release ZIP 校验 SHA-256）。
- **设置**：改扫描目录、AI 主动发表情、提示词、发送方式（自动/纯文字/图片）、表情排布（并排/独占一行）、局域网访问、`AGENTS.md`。

![图库管理：已安装图库与独立开关](./docs/panel-library.png)

默认扫描 `~/.dsh/meme-packs`，设置存 `~/.dsh/dsh-expression.json`，升级保留。ZIP 支持常规压缩和纯图片目录。

**发送方式**只影响 AI：自动按渠道（Web 写标记、IM 发原图）、纯文字不发图、图片要求每次真发。**表情排布**只影响前端：并排（默认）或图独占一行。

## 常见问题

- **更新失败 / 插件消失**：先在市场点「重试」；仍失败就完全退出 DSH 后再更新。更早版本或仍失败，退出 DSH 后在 profile 目录执行 `pnpm add dsh-meme@latest`。图库和设置都在 `~/.dsh`，重装不丢。详见 [排障手册](https://github.com/yyh-001/dsh-meme/blob/main/docs/troubleshooting.md)。
- **国内网络 / 市场拉不到**：默认多镜像竞速 + 磁盘缓存，通常无需配置；拉不到时先在发现页点「重试」，再把「图库目录源」切到「镜像源」。详见 [排障手册](https://github.com/yyh-001/dsh-meme/blob/main/docs/troubleshooting.md)。
- **手机 / 局域网 / 反向代理**：局域网 IP 访问在设置页打开「局域网访问图库」；反代域名需显式声明可信 Host（`DSH_MEME_TRUSTED_HOSTS` 或 `allowedHosts`）。详见 [排障手册](https://github.com/yyh-001/dsh-meme/blob/main/docs/troubleshooting.md)。

## 分享自己的图库

在「图库」新建图包库并加图 → **导出** ZIP 给朋友 **导入**。想进市场就点 **投稿**，按预填表单附上 ZIP、图片来源与许可。请用插件导出的 ZIP；GitHub 的「Download ZIP」是源码包，不能替代图库包。

## 工具与扩展

| 工具 | 用法 |
| --- | --- |
| `send_meme` | 按情绪 `tag` 随机抽图，或按 `query` 搜描述/关键词/文件名；跨所有启用图库，候选带 `path` / `library`，没命中时返回真实分类统计 |
| `learn_meme` | 收录最近一张用户图片，也可指定 `attachmentId` / `imageUrl`；附件 GIF 被压成单帧时会提示 |
| `meme_list` | 跨启用图库按关键词/分类/图库筛清单，带所属图库、分类、描述、关键词和 path |
| `meme_update` | 改一张图的分类/描述/关键词（只改索引不动文件）；path 用 `meme_list` / `send_meme` 的原样 |

```text
send_meme tag=happy
send_meme query="猫 比心"
learn_meme
meme_list tag=work
meme_update path="memes/work/a.jpg" caption="加班到趴桌"
```

情绪桶：`happy` / `angry` / `sad` / `shy` / `confused` / `daily`。模型应把候选里的 `[表情: 描述]` 原样写进回复；没有合适的候选就换关键词或纯文字回复。

**给 agent 的说明**：包内 `AGENTS.md` 写了发图判定、path 前缀和 GIF 压平的坑；图库整理流程在 skill `.dsh/skills/dsh-meme-maintenance` 里。设置页可直接查看/编辑。

**动图读取**：`learn_meme` 和上传识图会把 GIF 采样成多帧胶片条再送模型，caption 能描述动作；原图仍保留动画。WebP / APNG 只读元数据、按第一帧识别。

**IM 投递**：接入 dsh-im 后，`send_meme` 候选带绝对路径，模型调用 `dsh_im_return_file` 发原生图片；Web 聊天仍用 `[表情: 描述]`。通过 [dsh-companion](https://github.com/yyh-001/dsh-companion) 也可接 QQ。

**QQ 官方机器人（[dsh-qqbot](https://github.com/tencent-connect/dsh-qqbot)）**：候选带 `absPath`，交给 `qqbot_send_file` 的 `file_path`。dsh-qqbot 默认有路径白名单，需要把图库目录加进 `sendFile.extraRoots`：

```yaml
# qqbot profile 的 cordis.patch.yml（或「设置 → QQ 机器人」）
- id: im-qqbot
  config:
    sendFile:
      extraRoots:
        - C:\Users\<你>\.dsh\meme-packs
        - C:\Users\<你>\.dsh\profiles\<profile>\node_modules\dsh-meme\memes
```

`C:\Users\<你>` 在 Linux/macOS 上换成 `~`；图库放哪就加哪个目录，内置图库的路径也要加。

### 给其它插件的只读取图服务

同进程插件可用 `ctx.get('dshMeme')` 直接检索/挑图（只读）：

| 方法 | 返回 |
| --- | --- |
| `packs()` | 已启用图库 `{ id, name, count, path }[]` |
| `search({ query, tag, limit })` | `{ ok, query, memes: [{ path, tag, caption, keywords, pack, packName }] }` |
| `pick({ query, tag })` | 命中 `{ ok: true, path, tag, caption, keywords, pack, packName }`；否则 `{ ok: false, reason, tags, tagStats }` |

`tag` 是情绪桶；未命中时 `tagStats` 给出真实分类分布。返回的 `path` 是磁盘绝对路径且文件存在。自建图库目录或市场源见 [远程图库规范](./docs/remote-pack-spec.md)。

插件 HTTP 接口默认只接受回环 Host；手机/局域网与反向代理的配置见 [排障手册](https://github.com/yyh-001/dsh-meme/blob/main/docs/troubleshooting.md)。

## 交流反馈

[QQ 1 群（已满）](https://qm.qq.com/q/7AD2g70HqS) · [dsh 插件 2 群](https://qm.qq.com/q/HCtId2UY4q)

代码采用 [MIT](./LICENSE) 许可；图库图片的来源与使用许可请分别查看各图库说明。
