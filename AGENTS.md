# AGENTS.md — dsh-meme 硬约定

面向在 DSH 里对 dsh-meme 干活的 agent。只放**必须提前在场**的约定和坑;维护操作手册在 `.dsh/skills/dsh-meme-maintenance/SKILL.md`(整理图库/查重/批量改时先读它);人类视角见 README.md。

## 1. 发图说明以工具结果末尾为准

「发送方式」(自动/纯文字/图片)× 渠道(Web / dsh-im 的 QQ、微信 / companion QQ / **QQ 官方机器人**)的组合每次都可能不同,`send_meme` 每次执行都会在结果末尾给「发图」说明——**以那段说明为准,不要凭记忆**。候选 JSON 里的 `path`/`library` 只是出处信息(用户问「这图哪来的」可以引用),`absPath` 是绝对路径(给 qqbot_send_file 用)。

- **Web 聊天**:把 `[表情: 描述]` 整段写进回复,不要把路径贴进回复。
- **dsh-im 的 IM 会话**:候选行带 `path=`,原样传给 `dsh_im_return_file`。
- **QQ 官方机器人(dsh-qqbot 插件)**:工具表里有 `qqbot_send_file` 时,不要写 `[表情:]` 标记——把挑中候选的 **`absPath` 绝对路径传给 `qqbot_send_file` 的 `file_path`**,正文只写普通文字。它默认启用路径白名单(media + agent cwd + `sendFile.extraRoots`);被拒时提示用户在 dsh-qqbot 配置的 `sendFile.extraRoots` 里加入图库目录(通常 `~/.dsh/meme-packs`)。

## 2. path 前缀约定

候选/清单里的 path:**当前激活库不带前缀,其它库带 `packId/` 前缀**。原样传给 `meme_update`、两步模式的 `send`、`dsh_im_return_file`(IM 模式给的是绝对路径)都能对上。

## 3. GIF 的坑(宿主行为,无法还原)

聊天附件通道会把 GIF **压成单帧**再给工具。`learn_meme` 结果若提示「已被压成单帧」,告知用户保真路径:管理面板上传,或把 GIF 文件放进图库目录后面板点「扫描新增」。

## 4. 收藏落点

上传/AI 学图统一落「我的收藏」稳定图库(`~/.dsh/meme-packs/dsh-meme-user`,自动启用)。当前图库在内置包(插件目录)内时写入会被自动重定向——插件升级不清空收藏;内置图库只读。

## 5. 工具速查

| 工具 | 一句话 |
| --- | --- |
| `send_meme` | 抽候选 + 发图(说明看结果末尾) |
| `learn_meme` | 收录新图(附件/URL);GIF 附件会被压平,见上 |
| `meme_list` | 只读清单,跨启用图库,可筛 |
| `meme_update` | 改 tag/caption/keywords,只改索引 |
| 删除 | 只在管理面板,agent 不删 |
