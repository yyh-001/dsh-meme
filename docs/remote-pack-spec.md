# dsh-meme 远程图库清单格式(remote-pack manifest)

远程图库 = 一个托管在任意 http(s) 地址的 JSON 清单。插件设置页「远程图库」里粘贴清单地址(或从图库目录点「下载」),插件会:

1. 服务端拉取清单,校验并规范化每个条目;
2. 并发下载全部图片(≤8MB/张),按 `memes/<tag>/<file>` 落盘到扫描目录(默认 `~/.dsh/meme-packs/<id>/`);
3. 生成本地 `index.db` 索引与 `manifest.json`,立刻出现在「当前图库」下拉里并自动切换;
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

## 图库目录(docs/remote-packs.json)

设置页的「远程图库」列表来自本仓库的 [`docs/remote-packs.json`](./remote-packs.json)(经 jsDelivr/raw 双源拉取,可用 patch 配置 `remoteDirUrl` 覆盖)。想进目录:给本仓库发 PR,往数组里加一条:

```json
{
  "id": "deepseek-chan",
  "manifestUrl": "https://your-host/deepseek-chan.json",
  "name": "DeepSeek酱语录",
  "description": "128 张台词级梗图,持续更新",
  "count": 128,
  "version": "2026-08-31",
  "homepage": "https://ai-meme.cdqyfdbymn.me/"
}
```

`manifestUrl` 必须可直接 GET 到上面的清单 JSON。收录标准与宣传页一致:来源/版权标注清晰、无盗链争议。
