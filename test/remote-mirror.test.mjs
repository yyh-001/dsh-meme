import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ============================================================================
// 国内网络可用性:镜像映射 + 目录多源回退 + 磁盘缓存兜底 + setRemoteDirUrl
//
// 这个文件只碰 test/,不改 index.js 的行为约定。关键点:
// - 纯函数(remoteMirrors / GITHUB_MIRROR_PREFIXES)可以直接 import 断言,不需要起宿主;
// - 目录拉取用本地 http fixture 当「远端」:坏路径返回 500,好路径返回合法 catalog,
//   这样不需要真连 GitHub 就能验证「坏源失败后换好源」;
// - 每个插件实例都是独立模块实例(`import('../index.js?case=xx')`),配合各自的
//   DSH_MEME_HOME 模拟「重启后换网络环境」——磁盘缓存文件在 apply() 时按 home 解析,
//   所以必须在 apply 前切环境变量。
// ============================================================================

// ---- fixture:本地 HTTP 当远端目录源 ----
let base = ''
let failDirectory = false
const hits = [] // 记录每个请求的原始 URL(带 ?t= 时间戳),断言用
const catalogOf = (id, name) => ({
  schemaVersion: 1,
  packs: [{
    id,
    name,
    version: '1.0.0',
    count: 1,
    // 本地 http 地址:fetchDownloadCounts 只认 github.com/releases,不会真的去打外网
    archiveUrl: base + '/pack.zip',
  }],
})
const fixture = createServer((req, res) => {
  const url = req.url || ''
  const path = url.split('?')[0]
  hits.push(url)
  if (path === '/catalog.json' || path === '/catalog2.json') {
    if (failDirectory) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('catalog unavailable')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(path === '/catalog.json'
      ? catalogOf('market-a', '测试图库 A')
      : catalogOf('market-b', '测试图库 B')))
    return
  }
  if (path === '/bad.json') {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('bad catalog')
    return
  }
  if (path === '/bad2.json') {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    res.end('bad catalog 2')
    return
  }
  res.writeHead(404)
  res.end('nope')
})
await new Promise((ok) => fixture.listen(0, '127.0.0.1', ok))
base = 'http://127.0.0.1:' + fixture.address().port

const goodUrl = base + '/catalog.json'
const good2Url = base + '/catalog2.json'
const badUrl = base + '/bad.json'
const bad2Url = base + '/bad2.json'

// ---- 临时 home(每个场景一份,或复用同一份模拟「同一台机器重启」)----
const homeA = mkdtempSync(join(tmpdir(), 'dsh-meme-mirror-a-')) // 主场景:成功过 → 有磁盘缓存
const homeEmpty = mkdtempSync(join(tmpdir(), 'dsh-meme-mirror-empty-')) // 全失败场景:没有任何缓存
const cleanupDirs = [homeA, homeEmpty]

after(() => {
  fixture.close()
  for (const dir of cleanupDirs) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ } }
})

// ---- 模块实例 / mock 宿主 ----
/**
 * 启动一个独立的插件模块实例。
 * @param {string} specifier 带 query 的模块路径,让 Node 为每个场景建独立实例(缓存/内存状态互不串)
 * @param {string} home DSH_MEME_HOME
 * @param {object} config patch 配置
 */
async function startInstance(specifier, home, config) {
  process.env.HOME = home
  process.env.DSH_MEME_HOME = home
  const mod = await import(specifier)
  const handlers = []
  const webServer = {
    host: '127.0.0.1', port: 3999,
    register(r) { handlers.push(r) },
    tapIndex() {},
  }
  const ctx = {
    // cordis 的 ctx.effect(body) 会接管 body 返回的 disposer;这里只关心路由注册发生了
    effect(body) { return body() },
    on() {},
    get(name) { return name === 'webServer' ? webServer : undefined },
    tools: { register() {} },
    agentDefaultModel: null,
  }
  mod.apply(ctx, config)
  const api = handlers.find((h) => h.path === '/dsh-memes-api')
  assert.ok(api, '应注册 /dsh-memes-api 路由')
  return { mod, api, home }
}

/** GET /dsh-memes-api?...(mock req/res,和 remote-pack.test.mjs 的写法保持一致) */
const getApi = async (api, qs = '') => {
  const req = new EventEmitter()
  req.method = 'GET'
  req.url = '/' + qs
  req.headers = { host: '127.0.0.1:3999' }
  const res = { statusCode: null, body: '' }
  await new Promise((ok) => {
    res.writeHead = (s) => { res.statusCode = s }
    res.end = (b) => { res.body = String(b || ''); ok() }
    api.handler(req, res).catch((error) => { res.body = String(error); ok() })
  })
  return { statusCode: res.statusCode, json: JSON.parse(res.body) }
}

/** POST /dsh-memes-api,JSON body */
const postApi = (api, body) => new Promise((resolve, reject) => {
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/'
  req.headers = { host: '127.0.0.1:3999', 'content-type': 'application/json' }
  const res = { statusCode: null, body: '' }
  res.writeHead = (s) => { res.statusCode = s }
  res.end = (b) => { res.body = String(b || ''); resolve({ statusCode: res.statusCode, json: JSON.parse(res.body) }) }
  api.handler(req, res).catch(reject)
  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
})

const cacheFileOf = (home) => join(home, '.dsh', 'dsh-meme-catalog-cache.json')
const settingsFileOf = (home) => join(home, '.dsh', 'dsh-expression.json')

// ============================================================================
// 1. 纯函数:镜像映射(契约 §1 / §2.1)
// ============================================================================

test('GITHUB_MIRROR_PREFIXES 与契约一致(顺序有用,不要随便加 github.moeyy.xyz)', async () => {
  const { GITHUB_MIRROR_PREFIXES } = await import('../index.js')
  assert.deepEqual(GITHUB_MIRROR_PREFIXES, [
    'https://ghfast.top/',
    'https://gh-proxy.com/',
    'https://ghproxy.net/',
  ])
})

test('remoteMirrors:raw 文件 → jsdmirror 第一、原始直链在 jsDelivr 系列之前、去重', async () => {
  const { remoteMirrors, GITHUB_MIRROR_PREFIXES } = await import('../index.js')
  const raw = 'https://raw.githubusercontent.com/yyh-001/dsh-meme-packs/main/catalog.json'
  const list = remoteMirrors(raw)
  // 国内可达性优先:jsdmirror 必须是第一个(客户端封面同样用它当首候选)
  assert.equal(list[0], 'https://cdn.jsdmirror.com/gh/yyh-001/dsh-meme-packs@main/catalog.json')
  // 3 个 gh 加速前缀原样转发整条 raw
  for (const prefix of GITHUB_MIRROR_PREFIXES) {
    assert.ok(list.includes(prefix + raw), '缺少镜像 ' + prefix + ': ' + JSON.stringify(list))
  }
  // 原始直链必须有
  assert.ok(list.includes(raw), '缺少原始直链: ' + JSON.stringify(list))
  // jsDelivr 家族兜底(顺序里原始直链必须在它们之前,避免拿到 12h 旧文件)
  const jsd = 'https://cdn.jsdelivr.net/gh/yyh-001/dsh-meme-packs@main/catalog.json'
  const fastly = 'https://fastly.jsdelivr.net/gh/yyh-001/dsh-meme-packs@main/catalog.json'
  assert.ok(list.includes(jsd) && list.includes(fastly), '缺少 jsDelivr 家族: ' + JSON.stringify(list))
  assert.ok(list.indexOf(raw) < list.indexOf(jsd), '原始直链应排在 jsDelivr 之前: ' + JSON.stringify(list))
  assert.ok(list.indexOf(raw) < list.indexOf(fastly), '原始直链应排在 fastly 之前')
  // 去重
  assert.equal(new Set(list).size, list.length, '候选不应重复: ' + JSON.stringify(list))
})

test('remoteMirrors:release 资产 → 3 个 gh 代理 + 原始,顺序与契约 §1.2 一致', async () => {
  const { remoteMirrors } = await import('../index.js')
  const rel = 'https://github.com/yyh-001/dsh-meme/releases/download/v0.1.52/pack.zip'
  assert.deepEqual(remoteMirrors(rel), [
    'https://ghfast.top/' + rel,
    'https://gh-proxy.com/' + rel,
    'https://ghproxy.net/' + rel,
    rel,
  ])
})

test('remoteMirrors:非 GitHub URL 原样返回 [url];空/非 http(s) 返回 []', async () => {
  const { remoteMirrors } = await import('../index.js')
  const other = 'https://img.aigengtu.com/x.jpg'
  assert.deepEqual(remoteMirrors(other), [other])
  // 本地 fixture 不是 GitHub,不能被镜像改写(自定义目录源场景)
  assert.deepEqual(remoteMirrors(goodUrl), [goodUrl])
  for (const bad of ['', '   ', null, undefined, 'file:///c:/tmp/x.jpg', 'ftp://example.com/x.json', '/local/path']) {
    assert.deepEqual(remoteMirrors(bad), [], '非 http(s) 输入应返回 []: ' + JSON.stringify(bad))
  }
})

test('remoteMirrors:jsDelivr 输入先试 jsdmirror(实现比契约 §2.1 更宽,见测试报告)', async () => {
  const { remoteMirrors } = await import('../index.js')
  const jsd = 'https://cdn.jsdelivr.net/gh/yyh-001/dsh-meme-packs@main/catalog.json'
  const list = remoteMirrors(jsd)
  // 契约 §2.2 要求目录兜底时给 jsDelivr 源加 jsdmirror 同路径;
  // 实现把这个行为同样用在 remoteMirrors() 上,这里按实现断言(合理且不丢原始地址)
  assert.equal(list[0], 'https://cdn.jsdmirror.com/gh/yyh-001/dsh-meme-packs@main/catalog.json')
  assert.ok(list.includes(jsd), '原始 jsDelivr 地址不能丢: ' + JSON.stringify(list))
  assert.equal(new Set(list).size, list.length)
})

// ============================================================================
// 2. 目录多源回退:坏源 500 + 好源 → 仍拿到目录,source 指向真正成功的源
// ============================================================================

const instA = await startInstance('../index.js?case=multi-source', homeA, {
  remoteDirUrl: [badUrl, goodUrl],
})

test('目录多源回退:坏源 500 后换好源,响应带 source/cached/error 元信息', async () => {
  failDirectory = false
  const before = hits.length
  const res = await getApi(instA.api, '?remoteDir=1')
  assert.equal(res.statusCode, 200)
  const body = res.json
  assert.equal(body.ok, true)
  // 目录本身:bad 源失败后 good 源仍能拿到
  assert.ok(Array.isArray(body.remoteDir), 'remoteDir 应为数组: ' + JSON.stringify(body))
  assert.equal(body.remoteDir.length, 1)
  assert.equal(body.remoteDir[0].id, 'market-a')
  // 关键:source 必须是真正成功的那个源(精确相等,不能带 ?t= 时间戳)
  assert.equal(body.remoteDirSource, goodUrl)
  assert.equal(body.remoteDirCached, false)
  assert.equal(body.remoteDirError, '')
  // 解析后的源列表仍是配置里的数组顺序,用户设置还是空(自动/配置)
  assert.deepEqual(body.remoteDirUrl, [badUrl, goodUrl])
  assert.equal(body.remoteDirUrlSetting, '')
  // 坏源确实被请求过(不是跳过了坏源直接打好的)
  const round = hits.slice(before)
  assert.ok(round.some((u) => u.split('?')[0] === '/bad.json'), '坏源应被请求: ' + JSON.stringify(round))
  // 目录请求必须带时间戳,绕开中间层缓存(契约 §2.2 保留的旧断言)
  for (const u of round) {
    assert.match(u, /[?&]t=\d+$/, '目录请求应带 ?t= 时间戳: ' + u)
  }
})

test('目录有 60s 内存缓存:第二次 GET 不再打远端', async () => {
  const before = hits.filter((u) => u.split('?')[0] === '/catalog.json').length
  const res = await getApi(instA.api, '?remoteDir=1')
  assert.equal(res.statusCode, 200)
  assert.equal(res.json.remoteDirSource, goodUrl)
  const afterCount = hits.filter((u) => u.split('?')[0] === '/catalog.json').length
  assert.equal(afterCount, before, '60s 内不应重复请求目录: ' + JSON.stringify(hits))
})

test('磁盘目录缓存:成功拉取后写 {at,url,entries},供网络挂掉时兜底', () => {
  const file = cacheFileOf(homeA)
  assert.ok(existsSync(file), '应写磁盘缓存: ' + file)
  const cached = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(cached.url, goodUrl, '缓存 url 应是真正成功的源')
  assert.equal(typeof cached.at, 'number')
  assert.ok(Array.isArray(cached.entries) && cached.entries.length === 1, '缓存里应有 entries')
  assert.equal(cached.entries[0].id, 'market-a')
})

// ============================================================================
// 3. 新模块实例 + 同一 home:远端全挂 → 用磁盘缓存;恢复后重新拉远端
// ============================================================================

test('新实例 + 远端全挂:回退磁盘缓存 remoteDirCached=true,source 是缓存源', async () => {
  const instB = await startInstance('../index.js?case=disk-cache-1', homeA, { remoteDirUrl: goodUrl })
  failDirectory = true // 模拟「断网/镜像全挂」
  try {
    const res = await getApi(instB.api, '?remoteDir=1')
    assert.equal(res.statusCode, 200)
    const body = res.json
    assert.equal(body.ok, true)
    assert.ok(Array.isArray(body.remoteDir), '有缓存时 remoteDir 仍是数组: ' + JSON.stringify(body))
    assert.equal(body.remoteDir.length, 1)
    assert.equal(body.remoteDir[0].id, 'market-a')
    assert.equal(body.remoteDirCached, true, '应标记为本地缓存')
    assert.equal(body.remoteDirSource, goodUrl, '缓存的 source 应是上次成功的源')
    assert.notEqual(body.remoteDirError, '', '兜底时也要带最后错误,UI 才能解释原因')
    assert.equal(String(body.remoteDirError).length <= 120 + 200, true, '错误摘要应被截断')
  } finally {
    failDirectory = false
  }
})

test('新实例 + 网络恢复:重新拉远端成功,cached=false', async () => {
  const instC = await startInstance('../index.js?case=disk-cache-2', homeA, { remoteDirUrl: goodUrl })
  failDirectory = false
  const before = hits.filter((u) => u.split('?')[0] === '/catalog.json').length
  const res = await getApi(instC.api, '?remoteDir=1')
  assert.equal(res.statusCode, 200)
  const body = res.json
  assert.equal(body.remoteDirCached, false, '网络恢复后不应再用缓存')
  assert.equal(body.remoteDirSource, goodUrl)
  assert.equal(body.remoteDir[0].id, 'market-a')
  const afterCount = hits.filter((u) => u.split('?')[0] === '/catalog.json').length
  assert.ok(afterCount > before, '恢复后应真的重新请求远端目录')
})

// ============================================================================
// 4. 全部失败且无缓存:remoteDir=null + remoteDirError 非空
// ============================================================================

test('全部源失败且无磁盘缓存:remoteDir=null,remoteDirError 非空', async () => {
  const instD = await startInstance('../index.js?case=all-fail', homeEmpty, { remoteDirUrl: [badUrl, bad2Url] })
  const res = await getApi(instD.api, '?remoteDir=1')
  assert.equal(res.statusCode, 200)
  const body = res.json
  assert.equal(body.ok, true)
  assert.equal(body.remoteDir, null, '拉不到目录时必须是 null(前端显示错误 + 重试)')
  assert.equal(body.remoteDirSource, '')
  assert.equal(body.remoteDirCached, false)
  assert.notEqual(body.remoteDirError, '', '必须有最后错误摘要给 UI 显示')
  assert.match(body.remoteDirError, /HTTP 50[03]/, '错误摘要应包含状态码: ' + body.remoteDirError)
  assert.deepEqual(body.remoteDirUrl, [badUrl, bad2Url])
  // 没缓存成功过就不该凭空写出缓存文件
  assert.equal(existsSync(cacheFileOf(homeEmpty)), false, '全失败时不应写磁盘缓存')
})

// ============================================================================
// 5. setRemoteDirUrl op:校验 / 保存 / 清内存缓存 / 恢复自动
// (放在 B/C 之后,避免 settings 写盘影响前面「重启后」场景)
// ============================================================================

test('setRemoteDirUrl:非法值 → 400 JSON,且不写坏配置', async () => {
  const bad = await postApi(instA.api, { op: 'setRemoteDirUrl', remoteDirUrl: '/local/path' })
  assert.equal(bad.statusCode, 400, '非 http(s) 应 400: ' + JSON.stringify(bad.json))
  assert.equal(bad.json.ok, false)
  assert.match(String(bad.json.error), /http/i)
  // 超长(>500)也要拦住,避免异常配置把设置文件撑坏
  const tooLong = await postApi(instA.api, {
    op: 'setRemoteDirUrl',
    remoteDirUrl: 'https://example.com/' + 'a'.repeat(520),
  })
  assert.equal(tooLong.statusCode, 400)
  assert.equal(tooLong.json.ok, false)
  assert.match(String(tooLong.json.error), /500/)
  // 非法值不应覆盖现有源:目录仍能拉到
  const res = await getApi(instA.api, '?remoteDir=1')
  assert.equal(res.json.remoteDirSource, goodUrl)
})

test('setRemoteDirUrl:保存合法源后立即生效(内存缓存已清),GET 用新源', async () => {
  const saved = await postApi(instA.api, { op: 'setRemoteDirUrl', remoteDirUrl: good2Url })
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.json))
  assert.equal(saved.json.ok, true)
  assert.equal(saved.json.remoteDirUrlSetting, good2Url, 'packPayload 应回传用户设置原值')
  assert.match(String(saved.json.message || ''), /已保存图库目录源/)
  // 刚保存,内存里还有旧源的 60s 缓存;设置后必须清掉,下一次 GET 就要用新源
  const res = await getApi(instA.api, '?remoteDir=1')
  assert.equal(res.json.remoteDirSource, good2Url, '保存新源后应立刻从新源拉目录')
  assert.equal(res.json.remoteDir[0].id, 'market-b')
  assert.equal(res.json.remoteDirCached, false)
  // 落盘到 settings,重启后仍然生效
  const settings = JSON.parse(readFileSync(settingsFileOf(homeA), 'utf8'))
  assert.equal(settings.remoteDirUrl, good2Url)
})

test('setRemoteDirUrl:空串/auto 恢复自动(内置多镜像),remoteDirUrlSetting 回空', async () => {
  for (const value of ['', 'auto']) {
    const res = await postApi(instA.api, { op: 'setRemoteDirUrl', remoteDirUrl: value })
    assert.equal(res.statusCode, 200, value + ': ' + JSON.stringify(res.json))
    assert.equal(res.json.ok, true)
    assert.equal(res.json.remoteDirUrlSetting, '', '恢复自动后设置应为空串')
    assert.match(String(res.json.message || ''), /已恢复自动/)
    const settings = JSON.parse(readFileSync(settingsFileOf(homeA), 'utf8'))
    assert.equal(settings.remoteDirUrl, '', '空/auto 都要在 settings 里写成空串')
  }
  // 回到配置里的源列表(坏源 + 好源),GET 仍应拉到目录
  const res = await getApi(instA.api, '?remoteDir=1')
  assert.equal(res.json.remoteDirSource, goodUrl)
  assert.deepEqual(res.json.remoteDirUrl, [badUrl, goodUrl])
})
