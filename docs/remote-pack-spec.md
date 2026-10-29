# dsh-meme 远程图库清单格式(remote-pack manifest)

远程图库 = 一个托管在任意 http(s) 地址的 JSON 清单。

> **入口现状**:界面上目前只有「从目录安装」这一条路——设置页「发现」读图库目录,点卡片上的「安装」走 Release ZIP,点卡片本身可以预览图库里的图。按清单地址订阅(逐图增量)的入口收起来了,后端仍在(`subscribeRemote` / `updateRemotePack` / 任务进度),需要时再放回界面;目录源本身可以通过 `remoteDirUrl` 换成你自己的。

插件拿到清单后会:

1. 服务端拉取清单,校验并规范化每个条目;
2. 并发下载全部图片(≤8MB/张),按 `memes/<tag>/<file>` 落盘到扫描目录(默认 `~/.dsh/meme-packs/<id>/`);
3. 生成本地 `index.db` 索引与 `manifest.json`,立刻出现在设置页「图库」列表里,自动切到它并**打开它的模型开关**;
4. 写入 `.dsh-remote.json` 侧车记录来源——**再次提交同一清单地址会自动转为增量更新**(新增条目才下载,已有条目只刷新 caption/keywords/tag)。

## 清单格式

```json
{
  "id": "deepseek-chan",
  "name": "DeepSeek酱语录",
  "description": "128 张 DeepSeek 鲸鱼娘台词级梗图,持续更新",
  "version": "2026-08-31",
  "memes": [
    {
      "url": "https://cdn.example.com/memes/001.webp",
      "tag": "happy",
      "caption": "原来是高等模型",
      "keywords": "高等模型 DeepSeek 原来是",
      "file": "001.webp"
    }
  ]
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 建议 | 包 id,`[a-z0-9_-]{1,40}`,是本地目录名与切换键;缺省时用订阅时填的 id,再缺省按清单 URL 哈希 |
| `name` | 建议 | 显示名(设置页/下拉),≤60 字 |
| `description` | 可选 | 一句话描述,≤200 字 |
| `version` | 可选 | 版本号/日期,仅展示 |
| `memes` | **必填** | 条目数组,1–500 条 |
| `memes[].url` | **必填** | 图片直链,http(s),单张 ≤8MB,支持 jpg/png/gif/webp |
| `memes[].tag` | **必填** | 分类,小写英文/数字/`-`/`_`。建议兼容六情绪桶 `happy / angry / sad / shy / confused / daily`(模型只认这六个桶),或用桶内细类如 `like / meow / sigh / sleep / work / see`(会自动归桶) |
| `memes[].caption` | 建议 | 一句话中文描述——**模型按它选图、前端按它配图**,写清情绪/梗名效果最好,≤200 字 |
| `memes[].keywords` | 可选 | 空格分隔搜索词,≤200 字 |
| `memes[].file` | 可选 | 包内文件名(只取 basename);缺省按 URL 哈希生成,重名自动加后缀 |

### 约束与容错

- 单条非法(url 不是 http(s)、tag 无效)只会**跳过该条**并在下载结果里给警告,不会让整个订阅失败;
- 清单本体 >2MB 或条目 >500 条会被拒绝(拆成多个包);
- 清单可以是 CDN/对象存储上的静态 JSON,更新图片后改清单即可,用户在插件里点「更新」增量同步。

## 图库目录

设置页「图库市场 → 发现」的主目录来自 [`yyh-001/dsh-meme-packs`](https://github.com/yyh-001/dsh-meme-packs) 的 `catalog.json`（经 jsDelivr/raw 双源拉取）。目录既接受原来的数组，也接受更适合独立仓库的 `{ "packs": [] }`：

```json
{
  "schemaVersion": 1,
  "packs": [
    {
      "id": "deepseek-chan",
      "name": "DeepSeek酱语录",
      "version": "1.0.0",
      "description": "128 张台词级梗图",
      "maintainer": "your-name",
      "count": 128,
      "archiveUrl": "https://github.com/owner/repo/releases/download/deepseek-chan-v1.0.0/deepseek-chan-v1.0.0.zip",
      "sha256": "64位小写十六进制哈希",
      "preview": "https://example.com/cover.webp",
      "keywords": ["DeepSeek", "鲸鱼娘"]
    }
  ]
}
```

`archiveUrl` 指向插件「导出图库」生成的 ZIP（根目录含 `index.db`、`manifest.json`、`memes/`；STORE 与 DEFLATE 压缩均可）。插件下载后限制 ZIP ≤200MB，校验 `sha256`，并校验 ZIP 内 `manifest.json.id` 与目录 `id` 一致，再原子安装到用户扫描目录。旧版逐图下载条目仍可写成：

```json
{
  "id": "deepseek-chan",
  "manifestUrl": "https://your-host/deepseek-chan.json",
  "name": "DeepSeek酱语录",
  "description": "128 张台词级梗图,持续更新",
  "count": 128,
  "version": "2026-08-31",
  "author": "the-beating-light-of-the-nail",
  "homepage": "https://ai-meme.cdqyfdbymn.me/",
  "preview": "https://your-host/previews/cover.webp",
  "previews": ["https://your-host/previews/1.webp", "https://your-host/previews/2.webp"],
  "keywords": ["DeepSeek", "鲸鱼娘", "台词梗"]
}
```

| 字段 | 说明 |
|------|------|
| `id` / `name` | 必填;`id` 是安装后的包 id |
| `archiveUrl` 或 `manifestUrl` | 二选一;Release ZIP 直链或逐图清单直链 |
| `sha256` | `archiveUrl` 强烈建议必填;下载完成后校验完整性 |
| `description` / `count` / `version` / `author` / `maintainer` | 设置页「发现」卡片展示 |
| `preview` | 卡片封面图;建议 2:1 左右横图 |
| `previews` | 点卡片弹出的预览弹窗里显示的图片列表;建议 6–30 张。图库已安装时会改读本地图库自己的图,这个列表只在没安装时用 |
| `keywords` | 字符串数组,发现页搜索可命中 |

`archiveUrl` 或 `manifestUrl` 必须可直接 GET。收录标准:来源/版权标注清晰、无盗链争议。

## 图库包本体格式(本地目录 = 导出 ZIP)

远程清单/目录条目只是"怎么拿到图库";装到本地之后，一个图库就是一个目录，导出 ZIP 的根目录和它一一对应：

```text
<图库目录>/                    导出 ZIP 根目录/
  index.db                     index.db                必需。SQLite，一张 memes 表：
                                                        path / tag / file_name / caption / keywords / mtime / captioned_at
  manifest.json                manifest.json           元信息
  memes/<tag>/<file>           memes/<tag>/<file>      图片，子目录名即分类
  .dsh-remote.json             （不打进 ZIP）           仅"下载/订阅来的"包有，记来源，增量更新靠它
```

要点：

- **判定标准是「目录里有 `index.db`」**（`isPackDir`）；`manifest.json` 严格说可选，没有它也能用，只是没名字和版本。
- **包 id 以目录名为准**，不是 manifest 里的 `id`；规范化规则 `[a-z0-9_-]{1,40}`（小写、其余字符会被去掉）。manifest 里的 `id` 只用于导入 ZIP 时校验"ZIP 里的包和目标是同一个"。
- `manifest.json` 里插件真正会读的是 `name` / `description` / `version` 三个字段；`maintainer` / `license` / `tags` / `source` 等只是给人和市场看的标注。
- `tag` 建议用六个情绪桶 `happy / angry / sad / shy / confused / daily`，或桶内细类（`like` / `meow` / `givemoney` / `color` → happy，`sigh` → sad，`surprised` / `see` → confused，`sleep` / `morning` / `work` / `cpu` / `reply` → daily，`fool` / `baka` → angry）。**模型只认这六个桶**，桶外的分类搜不到。
- 图片支持 `jpg/png/gif/webp`，单张 ≤8MB；`caption` 是命脉（模型按它选图、前端按它配图）。
- 导出 ZIP 只打包索引里列到的图（不带 `.git`、备份、缩略图等杂物；STORE 与 DEFLATE 压缩均可解析）。导入校验：优先 `index.db`；纯图片 ZIP（无 `index.db`）会自动按目录名建索引导入；ZIP 内 `manifest.json.id` 与请求 id 不一致会拒绝；条目路径越界会拒绝。走市场的 ZIP 还要求 ≤200MB 并核对 `sha256`。
- `previews/` 目录**不是**插件需要的，那是宣传页/市场条目做预览图用的约定。

## 目录源覆盖

插件按顺序试这几个源，每个源再展开成镜像候选分层竞速，第一个成功的为准（细节见下节《国内网络与镜像》）：

1. `raw.githubusercontent.com/.../dsh-meme-packs/main/catalog.json`
2. `cdn.jsdelivr.net/gh/.../dsh-meme-packs@main/catalog.json`（raw 被墙时的兜底）
3. 本仓库 [`docs/remote-packs.json`](./remote-packs.json)（留作兼容回退）

**raw 放前面是因为时效**：jsDelivr 对 `@main` 是按仓库缓存的（边缘 12h、浏览器更久），push 之后它会继续吐旧内容，带时间戳也绕不过它的 shield——所以改了 catalog 记得顺手清一下它的缓存：

```bash
curl https://purge.jsdelivr.net/gh/yyh-001/dsh-meme-packs@main/catalog.json
```

拉目录时会带 `?t=<时间戳>` 挡中间层（透明代理）的缓存，进程内还有 60 秒缓存，不会打爆上游。内网或调试场景可在 `~/.dsh/dsh-expression.json` 里写 `"remoteDirUrl": "https://你的地址/catalog.json"`（或 patch config 的 `remoteDirUrl`），改动即时生效，不用重启。设置页「图库目录源」是下拉框：**自动**（空串，内置多镜像竞速，默认）、**官方源**（`"official"`，只直连 `raw.githubusercontent.com`）、**镜像源**（`"mirror"`，只走 gh 加速前缀，jsDelivr 兜底）、**自定义地址**（任意 http(s) `catalog.json` URL）。

## 国内网络与镜像

默认目录源在 `raw.githubusercontent.com` / `cdn.jsdelivr.net` 上，国内经常不可达，所以目录和资产下载都支持多镜像。镜像**只改写 GitHub 资源**，其它 http(s) URL 原样使用。

### 目录：分层竞速

每个配置源展开成两层候选，同一层内用 `Promise.any` 竞速（单请求超时 6 秒，带 `?t=<时间戳>`），tier0 全部失败才试 tier1：

- **tier0（内容新）**：原始 URL、`https://ghfast.top/<原始 URL>`、`https://gh-proxy.com/<原始 URL>`、`https://ghproxy.net/<原始 URL>`；
- **tier1（可能滞留旧目录，仅兜底）**：jsDelivr 家族。配置源本身是 jsDelivr 时，追加同路径的 `cdn.jsdmirror.com` 与 `fastly.jsdelivr.net`。

tier0 排在 tier1 之前，是因为 jsDelivr 对 `@main` 有 12h 仓库级缓存，push 之后它仍会吐旧 catalog。成功后记下实际源 URL（设置页「当前源」显示其 host），并写 60 秒内存缓存和磁盘缓存。

### 资产：镜像映射

raw 文件按国内可达性排序：`cdn.jsdmirror.com` → `ghfast.top` → `gh-proxy.com` → `ghproxy.net` → 原始 `raw.githubusercontent.com` → `cdn.jsdelivr.net` → `fastly.jsdelivr.net`。Release 资产（`github.com/<owner>/<repo>/releases/download/<tag>/<file>`）依次用三个 gh 代理套整条原始 URL，最后回落原始地址。清单 JSON、安装 ZIP、逐图下载都按这个顺序逐个尝试；目录拉取成功后，会把当时可用的镜像族排到最前。

### 安全：sha256 仍然强制

镜像只影响下载通道，不改校验：市场条目里的 `sha256` 仍逐候选校验，镜像给了旧文件会校验失败并自动换下一个，全部失败才报错。

### 自定义目录源与缓存

`remoteDirUrl` 优先级：**用户设置（设置页「图库目录源」写入 `~/.dsh/dsh-expression.json`）> patch config 的 `remoteDirUrl` > 内置默认**。设置页下拉框会写入 `""`（自动）、`"official"`、`"mirror"` 或自定义 http(s) 地址（≤500 字符）；patch config 可写 URL 数组。保存后清空目录缓存并立即生效，不用重启。目录源分组由纯函数 `directoryGroupsFor(setting, fallbackUrls)` 计算，每个分组带 `key`（预设名或源 URL），磁盘缓存按它判断是否仍属当前源。

磁盘缓存文件：`~/.dsh/dsh-meme-catalog-cache.json`，内容 `{ at, url, sourceUrl, entries }`（`url` 为实际拉通的镜像 URL，`sourceUrl` 为当时的配置源），仅在拉取成功且条目数 > 0 时写入（写失败静默）。单次尝试 6 秒超时，整轮拉取总预算 12 秒。全部源失败时，若缓存里的 `sourceUrl`（老缓存兼容用 `url`）仍属于当前源列表，目录用缓存返回并标记 `remoteDirCached: true`（界面提示「当前使用本地缓存」），否则按彻底失败处理，返回 `null` 和最后一条错误摘要。
