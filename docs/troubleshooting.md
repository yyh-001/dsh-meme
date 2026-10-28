# dsh-meme 排障手册

README 只留常用步骤；这里保留完整排查过程、命令和实现背景。

## 插件更新失败 / 更新后消失？

在市场里点「更新」时，宿主会用 pnpm 把 `node_modules/dsh-meme` 整个目录改名替换。**Windows 上只要目录里还有打开的文件，rename 就会 `EPERM`**，pnpm 只能报 `exit 1`；市场界面往往只留一行 `exit 1`，完整报错被截断，看起来像「没报错但失败了」。失败后目录可能只装了一半，再进市场会校验失败（例如提示 `ENOENT ... cordis.patch.yml`），插件列表里也找不到它。

**0.1.59 起插件侧已修（issue [#43](https://github.com/yyh-001/dsh-meme/issues/43)）**：以前的版本在启动时会一直打开内置图库的 `memes/dafeiyu-001/index.db`（管理面板还有一条常驻可写连接），这个文件就在插件包目录里 → 更新时包目录被占住，pnpm 改名必然失败（`ERR_PNPM_EPERM ... rename '..._tmp_...' -> '...dsh-meme'`）。现在图库索引只在启动时读一次进内存，上传/学图时临时打开、写完立刻关闭，内置图库激活时插件不再长期占用包内任何文件。这也解释了以前「有时成功有时失败」：激活的是 `~/.dsh/meme-packs` 里的用户图库时不占包目录，激活内置图库时才会卡住更新。

在 0.1.59 之前更新失败的用户，仍按下面三步处理：

1. **完全退出 DSH**（托盘图标退出，任务管理器里确认没有 dsh / Electron 进程），重新打开后再点一次更新。
2. 还失败，或插件已从列表消失：**退出 DSH 后**到对应 profile 目录手动更新（默认在 `~/.dsh/profiles/<profile>`；桌面版是 `desktop`，Web / CLI 常见 `web`）：

   ```bash
   cd ~/.dsh/profiles/web
   pnpm add dsh-meme@latest
   ```

   然后重新打开 DSH，在「设置 → 表情包」确认插件已启用。
3. 图库和设置都存在 `~/.dsh`（`dsh-expression.json` 等），更新或重装不会丢；仍不行可以先卸载再重装。

升到 0.1.59 之后仍更新失败，说明占用来自插件之外（宿主进程、杀毒软件或其它程序）：把 profile 目录、市场里的 `exit 1` 上下文和是否有 `ERR_PNPM_EPERM` 一并反馈给 DSH 插件市场；插件这边已确认不再占用包内文件，有一个回归测试专门模拟 pnpm 改名（`test/update-lock.test.mjs`）。

## 国内网络 / 图库市场拉不到？

图库目录和预览图托管在 GitHub 上，国内直连 `raw.githubusercontent.com` / `cdn.jsdelivr.net` 经常超时，发现页于是显示「图库目录暂不可用(检查网络或稍后重试)」。插件默认走多镜像，通常无需配置：

- **自动竞速**：目录、清单 JSON、安装 ZIP 和逐图下载都会尝试原始地址和 `ghfast.top`、`gh-proxy.com`、`ghproxy.net`、`cdn.jsdmirror.com`、`fastly.jsdelivr.net` 等镜像，取最先成功的；封面和预览图逐个候选回退，并记住能用的镜像。
- **磁盘缓存**：成功拉到的目录存到 `~/.dsh/dsh-meme-catalog-cache.json`，网络暂时不通时先用它显示，并提示「当前使用本地缓存」。
- **安装仍校验 SHA-256**：镜像只换下载通道，镜像返回的 ZIP 哈希对不上会自动换下一个，不会装进坏包。

拉不到时按顺序排查：

1. 点发现页的 **重试**；
2. 打开 **设置 → 表情包 →「设置」**，看「图库目录源」的 **当前源**，确认自定义地址没写错（地址错也会这样）；
3. 在「图库目录源」下拉框选 **镜像源**（只走国内加速节点，最稳）；还不行再选 **自定义地址**，填一个你能访问的 `catalog.json` 地址并保存，或切回 **自动**。也可以直接改 `~/.dsh/dsh-expression.json` 的 `"remoteDirUrl"`（`""`/`auto` = 自动、`official` = 官方直连、`mirror` = 国内镜像、或自定义 URL），即时生效。

自查镜像连通性（任一返回 `200` 即可）：

```bash
curl -I https://ghfast.top/https://raw.githubusercontent.com/yyh-001/dsh-meme-packs/main/catalog.json
curl -o /dev/null -w '%{http_code}\n' https://cdn.jsdmirror.com/gh/yyh-001/dsh-meme-packs@main/catalog.json
curl -o /dev/null -w '%{http_code}\n' https://gh-proxy.com/https://raw.githubusercontent.com/yyh-001/dsh-meme-packs/main/catalog.json
```

## 局域网与反向代理

插件 HTTP 接口默认只接受本机回环地址（`localhost` / `127.0.0.1` / `[::1]`）。

**手机 / 平板（局域网 IP）**：在插件设置页打开 **「局域网访问图库」**（默认关），只放行 IP 字面量（回环 / RFC1918 私有网段 / 链路本地）。记得系统防火墙放行 DSH Web 端口。

**反向代理**（浏览器 → `https://你的域名` → nginx/frp → `127.0.0.1:2233`）：Host 是运维自己的域名，需要显式声明可信域名（issue [#56](https://github.com/yyh-001/dsh-meme/issues/56)；默认空名单，行为完全不变）：

```bash
# 环境变量：容器/反代场景不用改 profile
DSH_MEME_TRUSTED_HOSTS=feiyu.example.com
```

```yaml
# 或 profile 的 cordis.patch.yml
- id: dsh-expression
  config:
    allowedHosts:
      - feiyu.example.com
```

只做精确主机名匹配（大小写、端口、末尾点不敏感，不支持通配符）；没写进名单的域名仍然拒绝，DNS rebinding 防线不变。插件本身没有鉴权，反代域名务必由代理层做登录/访问控制。
