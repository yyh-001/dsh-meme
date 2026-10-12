<p align="center">
  <img src="https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/hero.jpg?v=3" alt="dsh-meme — find it, send it" width="100%" />
</p>

<p align="center">
  <strong>dsh-meme</strong> — a meme / sticker-pack plugin for DeepSeek Harness: find it, send it, and let the model learn it.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" /></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/topic-dsh--plugin-amber?style=flat-square" alt="dsh-plugin" /></a>
  <img src="https://img.shields.io/badge/Host-DeepSeek%20Harness-informational?style=flat-square" alt="DeepSeek Harness" />
  <img src="https://img.shields.io/badge/Deps-node%3Asqlite%20only-blue?style=flat-square" alt="zero third-party deps" />
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="awesome · DSH plugin" /></a>
</p>

<p align="center">
  <a href="./README.md">中文</a> · <strong>English</strong>
</p>

---

Showcase page: **[yyh-001.github.io/dsh-meme](https://yyh-001.github.io/dsh-meme/)** (browse the packs; add the topic [`dsh-meme-pack`](https://github.com/topics/dsh-meme-pack) plus a `previews/` folder to your repo to be listed)

Pack downloads: **[yyh-001/dsh-meme-packs](https://github.com/yyh-001/dsh-meme-packs)** (download a ZIP and import it right from the settings page)

**dsh-meme** (formerly `dsh-expression`) is the meme plugin for DeepSeek Harness — find it, send it, learn it:

- **Memes without image input**: the chat renders pictures, the model only reads and writes a text token (`[表情: 描述]`), so no image-capable model is required
- **The model learns images**: say “save this” and `learn_meme` files the most recent image attachment (no attachment id needed) and auto-labels its mood, caption and keywords
- **Mood-driven sending**: the model picks a mood bucket, gets a handful of captions, and drops one into its reply; use a keyword query to find a specific picture ("cat", "heart", "slacking off")
- **Send like in WeChat/QQ**: the 😊 button next to the composer opens a picker panel — click a thumbnail and it sends
- **Zero third-party dependencies**: `node:sqlite` only, works as soon as it is installed

Community / feedback: **QQ group [993579665](https://qm.qq.com/q/7AD2g70HqS)**

Issues: the settings panel has a “反馈建议 / 提 issue” link that opens the repo’s [feedback form](https://github.com/yyh-001/dsh-meme/issues/new?template=feedback.yml) with the plugin version and environment prefilled. You can also pick a template under [Issues](https://github.com/yyh-001/dsh-meme/issues/new/choose).

> The plugin UI is currently **Chinese only**; Chinese labels mentioned below are followed by our English translation in parentheses.

---

## Install

Published on **npm** (`dsh-meme`). Two ways:

**① From the client (recommended)**

Open dsh → **插件 (Plugins)** in the sidebar → **添加插件 (Add plugin)** in the top right → type **`dsh-meme`** → install. The package name is the npm name, so there is no command to type; the “安装源 (source)” selector can use the official mainland-China mirror. The same box also accepts a GitHub repository URL or a local directory path. Once installed you can toggle or uninstall it from the plugin page.

**② From the command line**

One line installs it into any DSH profile (e.g. `~/.dsh/profiles/web/`):

```bash
dsh plugin --profile web add dsh-meme
# same as:
pnpm add dsh-meme
```

The old package name `dsh-expression` is deprecated — use `dsh-meme`. The internal plugin id is still `dsh-expression`, so existing installs keep working.

Or install straight from GitHub / a local folder (the “Add plugin” box accepts these too):

```bash
pnpm add github:yyh-001/dsh-meme   # or
pnpm add file:/path/to/dsh-meme
```

> Note: pnpm has a “new package safety window” (24h by default) and will silently fall back to an older version of a just-published release; to skip it, add `dsh-meme` to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.

> Runtime requirement: **Node ≥ 22.13.0** (built-in `node:sqlite`; 22.5–22.12 needs `--experimental-sqlite`, Node 20 is not supported).

## Configuration

One pack ships with the plugin — `dafeiyu-001` (Big Fat Fish, 24 images) — and works out of the box with **no configuration**. “官方表情包 1 号” (`official-001`) is no longer bundled; install it from the **发现 (Discover)** tab of the settings page (a Release ZIP with SHA-256 verification).

On the **图库 (Packs)** tab, clicking **编辑 (Edit)** on a card switches to that pack (for managing images), and the switch on the card decides **whether the model may send from that pack** (several can be on at once). The plugin scans the bundled `memes/*` folder plus every subfolder with an `index.db` under the scan directory (default `~/.dsh/meme-packs`). Importing a ZIP also drops the pack into the scan directory and switches to it immediately. Settings live in `~/.dsh/dsh-expression.json` and survive plugin upgrades.

## Works out of the box

```text
User: send a speechless meme
Model: send_meme tag=sad → a few random captions → writes [表情: …] into its reply
Frontend: turns each caption into an image, so the chat shows a meme
```

Or click **😊** (the WeChat-style smiley) left of the composer and pick an image yourself — no model round-trip needed.

<p align="center">
  <img src="https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/chat-example.png" alt="Meme exchange: the user sends one, the model answers with one; the frontend turns [表情: caption] into an image" width="80%" />
</p>

## Tools

| Tool | What it does |
|------|--------------|
| `send_meme` | Fetches candidates two ways: `tag` (random picks from a mood bucket) or `query` (substring search over caption/keywords/file name, several words allowed). Both search **every pack whose switch is on**. In web mode the model writes `[表情: 描述]` into its reply and the frontend renders the image |
| `learn_meme` | **Learn an image**: say “save this” and it files the most recent user attachment; `attachmentId` / `imageUrl` also accepted |

## Message format (default)

**The UI shows pictures; the model only ever reads and writes a text token** — this avoids dsh’s image admission checks:

- Both the model and the picker emit `[表情: 描述]` (no URLs)
- The frontend resolves it **inside chat bubbles only** (Think blocks, trajectories and tool cards stay plain text)
- Quote-style differences (`“”` vs `""`) are folded before matching
- If the model paraphrased a caption: tokens are matched against pack captions/keywords first, and if nothing matches the raw caption is shown as plain text — the `[表情: ...]` marker is never exposed to the user
- Uploaded images stay regular attachments and enter the conversation as-is; learning an image goes through `learn_meme`

## UI

The settings page has an “表情包 (Memes)” panel with three top-level tabs (no second-level tabs):

- **图库 (Packs)**: cards for every installed pack (bundled / imported / custom / marketplace), the cover is taken from the pack itself (served by the plugin’s own route, no remote preview needed), plus image count and tag chips. **Clicking a card switches to that pack and opens its meme page** (the whole card is clickable; buttons and the switch swallow their own clicks); that page supports search, filtering, upload, edit and delete, with “← 图库列表 (back to packs)” in the top left
- **Pack switch**: one switch per card — **only switched-on packs can be used by the model**, and several can be on at once (`send_meme` draws candidates from all of them; with none on, the model is told to turn one on). Installing, importing or creating a pack switches to it and turns its switch on
- **新建图包库 / 导入图库 (New pack / Import pack)**: at the top of the Packs tab; import takes a ZIP exported by the plugin and switches to it. New packs get their switch turned on
- **导出 (Export)**: on every pack card — exports that pack as a ZIP (no need to switch to it first)
- **更新 (Update)**: shown only when the marketplace has a newer version (the pack’s own version is compared with the catalog’s); the Discover tab only installs, already-installed entries have no button there
- **删除 (Delete)**: the single entry point for bundled, marketplace, imported and custom packs (confirmation is an in-app dialog, not a native browser box). Deleting a marketplace pack also removes its subscription; deleting a bundled pack means it comes back on the next plugin upgrade; deleting the active pack switches away first
- **投稿 (Submit)**: on the active pack’s card — exports the ZIP and opens the prefilled GitHub submission form
- **发现 (Discover)**: the GitHub pack catalog. **Clicking a card previews the pack’s images** (installed packs read the local library; manifest-only packs read their manifest and can list hundreds of images; the rest use the catalog’s preview images — click one to open the original). Cards also show downloads (the server fetches GitHub Release `download_count`, summed across versions, cached for 30 minutes; manifest-only packs have no Release to count) and sort by downloads, highest first (entries without downloads go last, ties keep catalog order). “安装 (Install)” downloads the Release ZIP, verifies SHA-256 and switches to it, **with a progress bar on the card** (a percentage when the upstream sends `content-length`, otherwise a striped bar plus bytes downloaded); installed entries show no button
- **设置 (Settings)**: scan directory (with an in-app directory browser), companion-prompt switch (turn it off and the model stops sending memes on its own) and prompt editing
- **Upload dialog**: image preview, tag dropdown (pick / create / delete a tag), caption, keywords
- **Edit dialog**: same tag dropdown, edit caption and keywords
- **Chinese tag labels**: dropdowns and cards show e.g. 「生气 (angry)」
- Tag filtering applies immediately

<p align="center">
  <b>Packs</b>: installed pack cards; click one to open its memes<br />
  <img src="https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/panel-library.png" alt="Packs tab: installed pack cards" width="80%" />
</p>

<p align="center">
  <b>Discover</b>: the pack marketplace (click to preview, sorted by downloads, progress bar while installing)<br />
  <img src="https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/panel-discover.png" alt="Discover tab: the pack marketplace" width="80%" />
</p>

<p align="center">
  <b>Settings</b>: scan directory and the companion-prompt switch<br />
  <img src="https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/panel-settings.png" alt="Settings tab: scan directory and prompt switch" width="80%" />
</p>

One-click picker next to the composer: open the panel → a search box plus a **filter toggle** (collapsed by default; expanded it shows two rows of multi-select chips — **packs** and **moods**; nothing selected means no filter, the toggle shows how many are selected, and “共 N 张 (N images)” updates live — moods are derived from the current pack selection, with counts) → hover a thumbnail for a **large preview** (144 px image plus mood, caption and file name, flipping to the other side near the screen edge) → click to send. The panel shows five thumbnails per row and stays at about half the window height (46vh — anchored to the composer, never covering the host’s top bar), scrolling inside the grid when there are many images (at most 240 thumbnails are drawn at once — narrow the list with search or filters).

<p align="center">
  <img src="https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/quick-picker.png" alt="One-click picker next to the composer" width="80%" />
</p>

## Sharing your packs

Two routes: send a pack to a friend, or submit it to the public [`dsh-meme-packs`](https://github.com/yyh-001/dsh-meme-packs) marketplace.

**Create a pack and submit it**

Settings → Packs → **新建图包库 (New pack)** at the top, fill in name, id and description; the new (empty) pack is created, switched to and switched on. After adding images, click **投稿 (Submit)** on that pack’s card → the ZIP is exported and the submission page opens.

The plugin downloads the pack ZIP and opens a GitHub issue prefilled with name, description and image count. Log into GitHub, drag the ZIP into the “图库 ZIP” field, add the image source and license, then submit manually. No token or paid upload service is needed. If the browser blocks the new tab, click the “打开 GitHub 投稿页” link shown in the panel. Exporting does **not** mean the pack was submitted or accepted.

**Send a pack to a friend**

1. Settings → Packs → **导出 (Export)** on the pack card → `dsh-meme-<pack-id>.zip`
2. Send that ZIP to the other person
3. They go to Settings → Packs → **导入图库 (Import pack)**, pick the ZIP, and the pack is installed and switched to

Please use ZIPs exported by the plugin. The “Download ZIP / Download source” button on GitHub produces a re-compressed archive that will fail to import.

Importing or installing also runs a **high-frequency keyword cleanup**: when a keyword appears in ≥50% of a pack’s entries (external sites like to write a character-wide label into every row, which then matches the whole library), it carries no information for search and is dropped from `keywords`. Packs with fewer than 8 entries are left alone (there a repeated word is usually a real keyword). Only `keywords` change — images and tags are untouched.

**Publish a pack on your own page**

1. Export the ZIP as above and unpack it into a folder (it should contain `index.db`, `manifest.json`, `memes/`)
2. Create a GitHub repo and put the folder contents in its root
3. Add a `previews/` folder with 6–12 thumbnails (jpg/png) — the showcase page uses them
4. Add the topic [`dsh-meme-pack`](https://github.com/topics/dsh-meme-pack) under Settings → Topics

Optional: attach the exported ZIP to a GitHub Release so others can download and import it directly. You can also `git clone` a pack repo and put it into the scan directory (change the path under Settings → scan directory, or browse to it).

## Pack marketplace

The settings page’s **发现 (Discover)** tab reads [`dsh-meme-packs/catalog.json`](https://github.com/yyh-001/dsh-meme-packs/blob/main/catalog.json) by default: click a card to preview the pack’s images, click “安装 (Install)” to download its GitHub Release ZIP, verify SHA-256, install and switch to it — no manual download needed.

- Both formats are supported: a Release ZIP and a per-image manifest — see **[docs/remote-pack-spec.md](./docs/remote-pack-spec.md)**
- The catalog source can be replaced: raw is tried first with jsDelivr as fallback (raw is more current, jsDelivr works on some networks where raw does not). Point it at your own catalog with `settings.remoteDirUrl` or `config.remoteDirUrl` in the plugin patch
- The UI currently only offers “install from a catalog”; the manifest-subscription backend (incremental downloads) is still there and will get an entry point when needed

## What it does

| Capability | Notes |
|------------|-------|
| **Random pick by mood** | Six mood buckets: happy / angry / sad / shy / confused / daily; N random captions are handed to the model to choose from |
| **Search by keyword** | `query` substring-searches caption / keywords / file name, several space-separated words allowed; entries matching all words rank first, random within a tier (search again for a fresh batch) |
| **Learn images** | `learn_meme` files the most recent user attachment by default, or any URL; recognition needs an image-capable model |
| **Text-token sending** | `[表情: 描述]` → the frontend renders the image; chat bubbles only |
| **One-click picker** | 😊 left of the composer → picker panel (multi-select pack/mood filters, search, hover preview) → click to send |
| **Mood-driven sending** | When the moment fits, the model sends a meme on its own and then keeps its reply short |
| **Management API** | Upload / edit / delete / delete a tag, all in the settings page, persisted |
| **Pack switching** | Settings → Packs → “编辑 (Edit)” on a card switches to that pack; scan directory defaults to `~/.dsh/meme-packs` |
| **Export / import** | One-click ZIP of a pack for sharing; importing someone else’s pack switches to it (implemented without dependencies) |
| **Marketplace** | Discover reads a GitHub catalog and installs SHA-256-verified Release ZIPs; the Packs tab only shows “Update” when a newer version exists |

## Everyday commands (from the model’s point of view)

```text
send_meme tag=sad limit=8          # 8 random picks from the sad bucket; copy one [表情: …] line into the reply
send_meme tag=happy                # happy / cute / affectionate
send_meme query="猫"                # keyword search: caption/keywords/file name containing 猫 (cat) — more precise than a mood
send_meme query="生气 猫"           # several words: entries matching all of them rank first; tag+query = filter inside that mood
learn_meme                         # file the most recent user image (no id needed)
learn_meme imageUrl="https://…"    # file any image URL
```

Mood dictionary: `happy` 开心 (cute / affectionate) / `angry` 生气 / `sad` 难过 (speechless, begging) / `shy` 害羞 / `confused` 困惑惊讶 / `daily` 日常 (sleeping, work, good morning). With `tag` only, you get a fresh random batch; with `query` it searches words, falls back to splitting a word into bigrams, and only then falls back to a random pick from the inferred mood.

## Three rules for the model

The full contract lives in the `send_meme` tool description.

1. Copy a candidate’s `[表情: 描述]` **verbatim** into the reply — no URLs, no markdown images
2. If nothing fits, try other words or another mood, or just reply with text — do not force a meme
3. Keep it short afterwards and let the image speak — do not paraphrase or describe it

## Pack sources

Only one pack ships with the plugin; the other two are opt-in:

- **Big Fat Fish** (`id: dafeiyu-001`, 24 chibi whale-girl images) — bundled: `happy` ×3, `confused` ×2, `sad` ×2, `shy` ×2, and one each of `angry` / `baka` / `color` / `cpu` / `daily` / `fool` / `givemoney` / `like` / `meow` / `morning` / `see` / `sigh` / `sleep` / `surprised` / `work`.
- **Big Fat Fish · learned** (`id: dafeiyu-learned`, 25 images, maintained by [hZsFN](https://github.com/hZsFN)) — **not bundled**: these are the “auto-learned” memes from [PR #3](https://github.com/yyh-001/dsh-meme/pull/3); they used to be merged into `dafeiyu-001` and are now a separate pack.
- **Official meme pack 1** (`id: official-001`, now installed from the marketplace instead of bundled) comes from **Astrbot mememanager’s official starter pack**:

- Upstream: [anka-afk/astrbot-meme-pack-official-01](https://github.com/anka-afk/astrbot-meme-pack-official-01) (`main` branch), maintained by **anka-afk**
- Contents: `index.db` (SQLite index with a caption and keywords per image) + `manifest.json` (tag legend and provenance) + `memes/<tag>/` images + `previews/`
- ⚠️ Upstream ships **no LICENSE**: the pack has no explicit redistribution license. Shipping it as a personal default library is fine; if you redistribute it publicly, keep the upstream attribution in `manifest.json`.

## Wiring it into your agent

| Component | Notes |
|-----------|-------|
| **dsh-meme** | This plugin: `MemesStore` (mood sampling) + `send_meme` (sending) + `learn_meme` (learning) + management API |
| **[dsh-companion](https://github.com/yyh-001/dsh-companion)** | Persona + Hermes memory + message channels; provides the image-sending service |
| **Packs** | `dafeiyu-001` is bundled; `official-001` and other packs install from the Discover tab, or import a shared ZIP |

```text
dsh-meme/
  index.js          plugin entry: memeRoot config + management API + learn_meme/recognition
  memes.js          MemesStore: SQLite index + mood sampling + path safety
  client.js         frontend: settings panel (upload/edit/delete) + 😊 picker + [表情: 描述] rendering
  cordis.patch.yml  bundle patch (pure inserts, hot-mounts without restart)
  locale/           plugin display metadata for the dsh plugin page (en / zh)
  memes/
    dafeiyu-001/    bundled Big Fat Fish (24 whale-girl images)
  package.json      name / inject / peer deps
  README.md         Chinese
  README.en.md      English
  LICENSE
```

## Known limitations

- `learn_meme` auto-recognition needs the current default model to accept image input (otherwise pass tag/caption manually);
- On disk the tags stay fine-grained (angry/baka/…); the model only knows the six mood buckets. When a caption does not match exactly, the frontend folds quotes before rendering.

## License

[MIT](./LICENSE)
