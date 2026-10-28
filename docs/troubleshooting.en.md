# dsh-meme troubleshooting

The README keeps the common steps; this page keeps the full diagnostics, commands and background.

## Update failed / plugin disappeared?

The marketplace updates a plugin by having pnpm rename and replace the whole `node_modules/dsh-meme` directory. **On Windows, a directory cannot be renamed while any file inside it is still open**, so pnpm fails with `exit 1` (`ERR_PNPM_EPERM ... rename '..._tmp_...' -> '...dsh-meme'`); the marketplace often shows only a truncated one-line error. The directory may end up half-installed, so the next marketplace check fails (for example `ENOENT ... cordis.patch.yml`) and the plugin disappears from the list.

**Fixed in 0.1.59 (issue [#43](https://github.com/yyh-001/dsh-meme/issues/43))**: older versions kept a SQLite connection open on the bundled pack index (`memes/dafeiyu-001/index.db`) for the whole session — that file lives inside the plugin package, so the update rename was bound to fail whenever the built-in pack was active (it usually worked with a user pack under `~/.dsh/meme-packs`). The store now loads its index into memory once at startup and opens the database only briefly when writing, so the plugin no longer holds any file in its own package directory.

If you are updating from a version **before 0.1.59** and the update already failed:

1. **Quit DSH completely** (tray → quit; confirm no `dsh` / Electron process is running), then retry the update.
2. If it still fails or the plugin vanished: with DSH closed, update manually in the profile directory (`~/.dsh/profiles/desktop` for the desktop app; `web` is common for Web/CLI):

   ```bash
   cd ~/.dsh/profiles/web
   pnpm add dsh-meme@latest
   ```

   Then reopen DSH and confirm the plugin is enabled under **Settings → Memes**.
3. Packs and settings live in `~/.dsh` (`dsh-expression.json` etc.) and survive updates/reinstalls. If nothing helps, uninstall and reinstall.

If updating still fails on 0.1.59 or later, the lock comes from outside the plugin, so please report the profile directory and the full `exit 1` context to the DSH marketplace. The regression test `test/update-lock.test.mjs` simulates the pnpm rename to keep this fixed.

## Behind a restrictive network?

The catalog and preview images live on GitHub, so `raw.githubusercontent.com` / `cdn.jsdelivr.net` often time out in mainland China and Discover reports that the catalog is unavailable. Mirrors are tried automatically:

- **Racing mirrors**: catalog, manifest JSON, release ZIPs and images try the original URL plus `ghfast.top`, `gh-proxy.com`, `ghproxy.net`, `cdn.jsdmirror.com` and `fastly.jsdelivr.net`; the first response wins, and images fall back one candidate at a time.
- **Disk cache**: the last good catalog is stored in `~/.dsh/dsh-meme-catalog-cache.json` and used, with a local-cache note, while the network is down.
- **SHA-256 still enforced**: a mirror only changes the transport; a ZIP that fails its hash is discarded and the next mirror is tried.

Still failing? Click **重试 (Retry)** on Discover, check the current source under **图库目录源 (Catalog source)** in Settings → Memes, or use the dropdown there: **自动 (Automatic)**, **官方源 (Official GitHub)**, **镜像源 (Mirrors, best for mainland China)** or **自定义地址 (Custom URL)**. The same values can be written to `"remoteDirUrl"` in `~/.dsh/dsh-expression.json` (`""`/`auto`, `official`, `mirror`, or a `catalog.json` URL) and take effect immediately. To test a mirror:

```bash
curl -I https://ghfast.top/https://raw.githubusercontent.com/yyh-001/dsh-meme-packs/main/catalog.json
curl -o /dev/null -w '%{http_code}\n' https://cdn.jsdmirror.com/gh/yyh-001/dsh-meme-packs@main/catalog.json
curl -o /dev/null -w '%{http_code}\n' https://gh-proxy.com/https://raw.githubusercontent.com/yyh-001/dsh-meme-packs/main/catalog.json
```

## LAN and reverse proxies

Plugin HTTP routes accept loopback hosts only (`localhost` / `127.0.0.1` / `[::1]`) by default.

**Phone / tablet (LAN IP)**: turn on **“局域网访问图库 (Allow LAN access)”** in the plugin settings (off by default). Only IP literals are allowed (loopback, RFC1918 private ranges, link-local). Remember to open the DSH Web port in your firewall.

**Reverse proxy** (browser → `https://your.domain` → nginx/frp → `127.0.0.1:2233`): the Host is your own domain, so declare it explicitly (issue [#56](https://github.com/yyh-001/dsh-meme/issues/56); the list is empty by default and behaviour is unchanged):

```bash
# Environment variable: no profile edits needed for containers/reverse proxies
DSH_MEME_TRUSTED_HOSTS=feiyu.example.com
```

```yaml
# Or in the profile's cordis.patch.yml
- id: dsh-expression
  config:
    allowedHosts:
      - feiyu.example.com
```

Matching is exact (case/port/trailing dot insensitive, no wildcards); hosts not on the list are still rejected, so the DNS-rebinding defence is unchanged. The plugin has no authentication of its own — put login/access control in front of the proxy domain.
