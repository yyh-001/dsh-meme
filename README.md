<p align="center">
  <img src="./docs/hero-banner.jpg" alt="dsh-meme — 找得到、发得出、学得会" width="100%" />
</p>

<p align="center"><strong>给 DeepSeek Harness 加上表情包：自己点图发，也能让 AI 接着斗图。</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-meme"><img src="https://img.shields.io/npm/v/dsh-meme?style=flat-square" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/Node-%E2%89%A522.13-blue?style=flat-square" alt="Node ≥ 22.13" />
</p>

<p align="center">
  <strong>中文</strong> · <a href="./README.en.md">English</a><br />
  <a href="https://yyh-001.github.io/dsh-meme/">预览表情包</a> ·
  <a href="https://github.com/yyh-001/dsh-meme-packs">图库市场</a> ·
  <a href="https://github.com/yyh-001/dsh-meme/issues/new/choose">反馈问题</a> ·
  <a href="https://qm.qq.com/q/7AD2g70HqS">QQ 群 993579665</a>
</p>

## 能做什么

- **一键发图**：输入框旁点 😊，搜索、按图库或情绪筛选，点一张就发送。
- **跟 AI 斗图**：按情绪或关键词找图；模型输出文字标记，对话里显示图片，发图无需模型支持图片输入。
- **学会新图**：上传图片后说「把这张图入库」，AI 自动识别分类和描述。
- **管理与分享**：多图库开关、上传与编辑、ZIP 导入导出、市场安装与更新。
- **开箱即用**：内置大肥鱼图库（24 张），零第三方运行依赖，使用 Node 内置 SQLite。

## 安装

在 DSH 中打开 **插件 → 添加插件**，输入 `dsh-meme` 并安装。

也可以安装到指定 profile：

```bash
dsh plugin --profile web add dsh-meme
```

需要 **Node.js ≥ 22.13.0**。旧包名 `dsh-expression` 已弃用，内部插件 ID 保留兼容。

## 开始使用

| 想做什么 | 怎么操作 |
| --- | --- |
| 自己发表情 | 点输入框旁的 😊，选图发送；支持搜索、多选筛选和悬停预览 |
| 让 AI 发图 | 说「发个开心的表情」或「找一张猫猫比心」 |
| 收藏一张新图 | 上传图片，再说「把这张图入库」；自动识图需要支持图片输入的模型 |
| 查看大图 | 点击聊天里的表情；滚轮缩放，双击复位，Esc 或点背景关闭 |

![输入框表情选择器：搜索、图库与情绪筛选](./docs/quick-picker.png)

## 图库管理

打开 **设置 → 表情包**：

- **图库**：点卡片管理图片；卡片开关决定 AI 能否使用该图库，可同时启用多个。支持新建、导入、导出、投稿和删除，有新版时显示「更新」。
- **发现**：预览市场图库，一键安装；Release ZIP 安装时校验 SHA-256。
- **设置**：修改扫描目录，开启或关闭 AI 主动发表情，编辑提示词。

![图库管理：已安装图库与独立开关](./docs/panel-library.png)

默认扫描 `~/.dsh/meme-packs`，设置保存在 `~/.dsh/dsh-expression.json`，升级插件会保留。更多图库可在「发现」安装，也可导入别人分享的 ZIP。

## 分享自己的图库

1. 在「图库」新建图包库，添加图片。
2. 点 **导出** 得到 ZIP，朋友用 **导入图库** 即可安装。
3. 想收录到市场，点 **投稿**：插件导出 ZIP 并打开预填的 GitHub 表单；登录后附上 ZIP、图片来源与许可，再提交审核。

请使用插件导出的 ZIP。GitHub 的「Download ZIP」是仓库源码压缩包，不能替代图库分享包。导出完成后仍需在 GitHub 提交，审核通过才会收录。

## 工具与扩展

| 工具 | 用法 |
| --- | --- |
| `send_meme` | `tag` 按情绪随机抽图，`query` 按描述、关键词或文件名搜索；范围为所有启用的图库 |
| `learn_meme` | 默认收录最近一张用户图片，也可指定 `attachmentId` 或 `imageUrl` |

```text
send_meme tag=happy
send_meme query="猫 比心"
learn_meme
```

情绪桶：`happy` / `angry` / `sad` / `shy` / `confused` / `daily`。模型应把候选中的 `[表情: 描述]` 原样写进回复；前端只在聊天内容中配图。没有合适的候选时，换关键词或用文字回复。

自建图库目录或市场源见 [远程图库规范](./docs/remote-pack-spec.md)。通过 [dsh-companion](https://github.com/yyh-001/dsh-companion) 也可接入 QQ 发图。

插件 HTTP 接口仅支持本机回环地址（`localhost` / `127.0.0.1` / `[::1]`），通过局域网地址或自定义域名访问会被拒绝。

代码采用 [MIT](./LICENSE) 许可；图库图片的来源与使用许可请分别查看各图库说明。
