<p align="center">
  <img src="./docs/hero-banner-v4.jpg" alt="dsh-meme — find, send and learn memes" width="100%" />
</p>

<p align="center"><strong>Memes for DeepSeek Harness: pick an image yourself, or let your AI join in.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-meme"><img src="https://img.shields.io/npm/v/dsh-meme?style=flat-square" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/Node-%E2%89%A522.13-blue?style=flat-square" alt="Node ≥ 22.13" />
</p>

<p align="center">
  <a href="./README.md">中文</a> · <strong>English</strong><br />
  <a href="https://yyh-001.github.io/dsh-meme/">Pack showcase</a> ·
  <a href="https://github.com/yyh-001/dsh-meme-packs">Pack marketplace</a> ·
  <a href="https://github.com/yyh-001/dsh-meme/issues/new/choose">Report an issue</a> ·
  <a href="https://qm.qq.com/q/7AD2g70HqS">Community &amp; feedback group</a>
</p>

## Features

- **Click to send**: open 😊 beside the composer, search or filter by pack and mood, then pick an image.
- **Chat with memes**: the AI searches by mood or keyword. Web chats render a text marker as an image (no image-input support needed); QQ / WeChat and other IM chats switch to native image delivery through dsh-im.
- **Learn new images**: upload an image and ask to save it; the AI identifies its category and caption. You can also drop image files into a pack folder and click “扫描新增 (Scan)” — the original bytes (including animated GIFs) are kept, and renamed/deleted files have their stale index rows cleaned up.
- **Organize packs**: ask the AI to “list my memes”, “find duplicates” or “recategorize this one” — the `meme_list` / `meme_update` tools handle it (deleting stays in the panel to avoid accidents).
- **Manage and share**: enable multiple packs, upload and edit images, import/export ZIPs, and install or update marketplace packs.
- **Collections survive updates**: uploads and learned images go to the “我的收藏 (My Favorites)” pack under `~/.dsh/meme-packs`, outside the plugin package that updates replace.
- **Phones and tablets**: open DSH Web over your computer's LAN IP and turn on “Allow LAN access” in settings (off by default).
- **Ready to use**: includes Big Fat Fish (24 images), with no third-party runtime dependencies; uses Node's built-in SQLite.

## Install

In DSH, open **插件 (Plugins) → 添加插件 (Add plugin)**, enter `dsh-meme`, and install.

Or install into a specific profile:

```bash
dsh plugin --profile web add dsh-meme
```

Requires **Node.js ≥ 22.13.0**. The old package name `dsh-expression` is deprecated; its internal plugin ID is retained for compatibility.

## Update failed / plugin disappeared?

The marketplace updates a plugin by having pnpm rename and replace the whole `node_modules/dsh-meme` directory. **On Windows, a directory cannot be renamed while any file inside it is still open**, so pnpm fails with `exit 1` (`ERR_PNPM_EPERM ... rename '..._tmp_...' -> '...dsh-meme'`); the marketplace often shows only a truncated one-line error.

**Fixed in 0.1.59 (issue [#43](https://github.com/yyh-001/dsh-meme/issues/43))**: older versions kept a SQLite connection open on the bundled pack index (`memes/dafeiyu-001/index.db`) for the whole session — that file lives inside the plugin package, so the update rename was bound to fail whenever the built-in pack was active (it usually worked with a user pack under `~/.dsh/meme-packs`). The store now loads its index into memory once at startup and opens the database only briefly when writing, so the plugin no longer holds any file in its own package directory.

If you are updating from a version **before 0.1.59** and the update already failed:

1. **Quit DSH completely** (tray → quit; confirm no `dsh` / Electron process is running), then retry the update.
2. If it still fails or the plugin vanished: with DSH closed, update manually in the profile directory (`~/.dsh/profiles/desktop` for the desktop app; `web` is common for Web/CLI):

   ```bash
   cd ~/.dsh/profiles/web
   pnpm add dsh-meme@latest
   ```

3. Packs and settings live in `~/.dsh` (`dsh-expression.json` etc.) and survive updates/reinstalls.

If updating still fails on 0.1.59 or later, the lock comes from outside the plugin, so please report the profile directory and the full `exit 1` context to the DSH marketplace. The regression test `test/update-lock.test.mjs` simulates the pnpm rename to keep this fixed.

## Get started

| Goal | Action |
| --- | --- |
| Send a meme yourself | Click 😊 beside the composer and pick an image; search, multi-select filters and hover previews are available |
| Ask the AI to send one | Say “send a happy meme” or “find a cat making a heart” |
| Save a new image | Upload it and say “save this image to my meme pack”; automatic recognition requires an image-capable model |
| Save an animated meme | Upload a GIF from the panel, or drop it into a pack folder and click “Scan” — the animation is preserved. Chatting a GIF to the AI flattens it to a single frame (host attachment service behaviour), so don't use that path for animated memes |
| Organize a pack | Ask the AI to “list my memes”, “find duplicates” or “recategorize this one”; deleting stays in the panel |
| Phone / tablet | Turn on “Allow LAN access” in settings and open DSH Web via your computer's LAN IP (same Wi-Fi) |
| View a larger image | Click a meme in chat; scroll to zoom, double-click to reset, and press Esc or click the background to close |

In chat: send a meme, and the AI replies with one.

<p align="center">
  <img src="./docs/chat-example.png" alt="Meme exchange: the user teases Big Fat Fish, and the AI replies with a meme" width="80%" />
</p>

![Composer picker with search, pack and mood filters](./docs/quick-picker.png)

## Manage packs

Open **设置 (Settings) → 表情包 (Memes)**:

- **图库 (Packs)**: click a card to manage images. The category dropdown lists the pack's **real categories** (sorted by count, exact-match filtering); “扫描新增 (Scan)” indexes images you copied into the pack folder (category from subfolder, caption from filename) and removes stale rows for renamed/deleted files. Each switch controls whether the AI can use that pack; several can be enabled. Create, import (any standard compression; a plain folder of images zipped up also works — categories come from folder names), export, submit or delete packs; “Update” appears when a newer version is available.
- **发现 (Discover)**: preview marketplace packs and install them directly; Release ZIP installations verify SHA-256.
- **设置 (Settings)**: change the scan directory, toggle proactive memes, edit the prompt, choose how the AI sends memes (automatic / text-only / image) and the layout (side-by-side / full-width row), toggle LAN access, and view/edit `AGENTS.md` (agent instructions).

![Installed packs with independent enable switches](./docs/panel-library.png)

The default scan directory is `~/.dsh/meme-packs`. Settings are saved in `~/.dsh/dsh-expression.json` and survive upgrades. Install more packs from Discover or import a shared ZIP.

**Send mode** only controls how the AI sends memes; the frontend still renders `[表情: caption]` as an image: **automatic** (default) follows the channel (Web writes the marker, IM sends native images), **text-only** never sends images, and **image** requires the AI to actually send a picture every time. Changes apply from the next message. **Layout** decides how an image and text share a message: **side-by-side** (default, compact) or **full-width row** (image on top, text across the full width); it takes effect immediately and only affects rendering.

## Behind a restrictive network?

The catalog and preview images live on GitHub, so `raw.githubusercontent.com` / `cdn.jsdelivr.net` often time out in mainland China and Discover reports that the catalog is unavailable. Mirrors are tried automatically:

- **Racing mirrors**: catalog, manifest JSON, release ZIPs and images try the original URL plus `ghfast.top`, `gh-proxy.com`, `ghproxy.net`, `cdn.jsdmirror.com` and `fastly.jsdelivr.net`; the first response wins, and images fall back one candidate at a time.
- **Disk cache**: the last good catalog is stored in `~/.dsh/dsh-meme-catalog-cache.json` and used, with a local-cache note, while the network is down.
- **SHA-256 still enforced**: a mirror only changes the transport; a ZIP that fails its hash is discarded and the next mirror is tried.

Still failing? Click **重试 (Retry)** on Discover, check the current source under **图库目录源 (Catalog source)** in Settings → Memes, or use the dropdown there: **自动 (Automatic)**, **官方源 (Official GitHub)**, **镜像源 (Mirrors, best for mainland China)** or **自定义地址 (Custom URL)**. The same values can be written to `"remoteDirUrl"` in `~/.dsh/dsh-expression.json` (`""`/`auto`, `official`, `mirror`, or a `catalog.json` URL) and take effect immediately. To test a mirror:

```bash
curl -I https://ghfast.top/https://raw.githubusercontent.com/yyh-001/dsh-meme-packs/main/catalog.json
curl -o /dev/null -w '%{http_code}\n' https://cdn.jsdmirror.com/gh/yyh-001/dsh-meme-packs@main/catalog.json
```

## Share your own pack

1. Create a pack in Packs and add images.
2. Click **导出 (Export)** to get a ZIP. Friends can install it with **导入图库 (Import pack)**.
3. To join the marketplace, click **投稿 (Submit)**. The plugin exports the ZIP and opens a prefilled GitHub form; sign in, attach the ZIP, add image sources and license details, then submit for review.

Use the plugin's exported ZIP for marketplace submissions. GitHub's “Download ZIP” is a source archive, not a pack export. The importer itself is more forgiving: any standard ZIP compression works, and a plain folder of images zipped up installs directly (categories come from folder names). Exporting still requires a separate GitHub submission; listing follows approval.

## Tools and extensions

| Tool | Usage |
| --- | --- |
| `send_meme` | `tag` samples a mood bucket; `query` searches captions, keywords or file names across all enabled packs. Candidates carry `path` / `library` provenance; a miss returns the packs' real category counts to guide a retry |
| `learn_meme` | Saves the most recent user image by default; also accepts `attachmentId` or `imageUrl`. Warns when the host flattened an attached GIF to a single frame |
| `meme_list` | Read-only listing across enabled packs, filtered by keyword/category/pack, with pack, category, caption, keywords and path; use it to spot duplicates and wrong categories |
| `meme_update` | Change one image's category/caption/keywords (index only, at least one field); pass the path exactly as returned by `meme_list` / `send_meme` |

```text
send_meme tag=happy
send_meme query="猫 比心"
learn_meme
meme_list tag=work
meme_update path="memes/work/a.jpg" caption="加班到趴桌"
```

Mood buckets: `happy` / `angry` / `sad` / `shy` / `confused` / `daily`. The model should copy a candidate's `[表情: caption]` marker verbatim; the frontend renders it only in chat content. If no candidate fits, try other keywords or reply with text.

**Agent docs**: `AGENTS.md` in the package documents how sending is decided per channel, the path-prefix convention and the GIF-flattening caveat (agents working inside the plugin directory read it automatically at session start); the full pack-maintenance workflow (duplicates, bulk recategorizing, scan-and-index) lives in the project-level skill `.dsh/skills/dsh-meme-maintenance`, loaded on demand. The settings page can view/edit `AGENTS.md`.

**Animated GIFs are actually read**: `learn_meme` and the upload dialog's AI recognition sample a GIF along its timeline, tile the frames into a labelled filmstrip and send that to the model, so captions can describe the motion (for example “a cat shaking its head wildly”) instead of only the first frame. The original GIF is still what gets saved and it keeps animating in chat. Animated WebP / APNG currently contribute metadata only (frame count, duration) and are still recognized from their first frame; the prompt says so. The decoder is plain JavaScript with no third-party dependencies.

When the conversation comes from QQ / WeChat / Feishu / WeCom or another IM channel through [dsh-im](https://github.com/xmanrui/dsh-im), the sticker is sent as a native image message: the plugin detects the IM source, `send_meme` returns each candidate's **absolute path**, and the model passes it to dsh-im's `dsh_im_return_file`. IM chats never render `[表情: caption]`, so no marker is written. This delivery rule is injected together with the proactive-meme prompt — **no prior user instruction such as “you may send memes on QQ/WeChat” is needed**. Web chats keep the `[表情: caption]` rendering, and both kinds of conversation can coexist in one profile.

For custom catalogs and pack formats, see the [remote pack specification](./docs/remote-pack-spec.md). [dsh-companion](https://github.com/yyh-001/dsh-companion) also provides QQ image delivery.

Plugin HTTP routes accept loopback hosts only (`localhost` / `127.0.0.1` / `[::1]`) by default. To view memes from a phone or tablet over the LAN, turn on **“局域网访问图库 (Allow LAN access)”** in the plugin settings (off by default) — only IP literals are allowed (loopback, RFC1918 private ranges, link-local); hostname Hosts are always rejected (DNS-rebinding defence). Remember to open the port in your firewall.

Code is licensed under [MIT](./LICENSE). Check each pack separately for image provenance and usage rights.
