import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * issue #56:反向代理部署(浏览器 → https://feiyu.example.com → frp → 127.0.0.1:2233)
 * 下,Host 是运维自己的域名,旧的回环/局域网判定一律 403,表情包图片与管理面板全裂。
 *
 * 修法:显式可信 Host 白名单(环境变量 DSH_MEME_TRUSTED_HOSTS 或插件配置
 * allowedHosts),默认空 = 行为完全不变。只做精确主机名匹配、不支持通配符;
 * 没写进白名单的域名(包括 rebinding 用的攻击者域名)照样 403。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-trusted-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const memesMod = await import('../memes.js')
const packDir = join(home, '.dsh', 'meme-packs', 'proxy-pack')
memesMod.ensurePackAt(packDir, { id: 'proxy-pack', name: '反代测试' })
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png')])
mkdirSync(join(packDir, 'memes/happy'), { recursive: true })
writeFileSync(join(packDir, 'memes/happy/a.png'), PNG)
const seed = memesMod.openIndexWriter(packDir)
try {
  seed.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('memes/happy/a.png', 'happy', 'a.png', '开心', '', Date.now(), Date.now())
} finally { seed.close() }

const handlers = []
const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
const ctx = {
  effect(body) { return body() },
  on() { return () => {} },
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register() {} },
  agentDefaultModel: null,
}

// 环境变量与配置项各给一个域名;配置项里故意写 URL/大小写/路径,验证归一化。
process.env.DSH_MEME_TRUSTED_HOSTS = 'env.example.com:8443,[::2]'
const mod = await import('../index.js')
mod.apply(ctx, {
  memeRoot: packDir,
  allowedHosts: ['conf.example.org', 'https://Trail.Example.com/some/path'],
})

const apiRoute = handlers.find((h) => h.path === '/dsh-memes-api')
const imageRoute = handlers.find((h) => h.kind === 'prefix')
const panelRoute = handlers.find((h) => h.path === '/memes-panel')
const exportRoute = handlers.find((h) => h.path === '/dsh-memes-export')
assert.ok(apiRoute && imageRoute && panelRoute && exportRoute)

const request = (route, method, url, host, origin, body) => new Promise((resolve) => {
  const req = new EventEmitter()
  req.method = method; req.url = url; req.headers = host === null ? {} : { host }
  if (origin !== undefined) req.headers.origin = origin
  const res = {
    statusCode: null, body: '', headers: null,
    writeHead(s, hh) { res.statusCode = s; res.headers = hh },
    end(b) { if (b) res.body += String(b); resolve(res) },
  }
  route.handler(req, res)
  if (method === 'POST') {
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body || {})))
      req.emit('end')
    })
  }
})
const apiGet = (host, url = '/dsh-memes-api') => request(apiRoute, 'GET', url, host)
const image = (host) => request(imageRoute, 'GET', '/dsh-memes/proxy-pack/memes/happy/a.png', host)

test('未配置的域名仍按 DNS rebinding 防线拒绝(默认行为不变)', async () => {
  assert.equal(mod.hostIsTrusted({ headers: { host: 'feiyu.example.com' } }), false)
  const res = await apiGet('feiyu.example.com')
  assert.equal(res.statusCode, 403)
  assert.match(res.body, /DSH_MEME_TRUSTED_HOSTS/, '403 文案应告诉反代用户怎么放行')
})

test('配置项 allowedHosts:反代域名可读索引/图片/面板/导出', async () => {
  const api = await apiGet('conf.example.org:2233')
  assert.equal(api.statusCode, 200)
  assert.equal(JSON.parse(api.body).memes.length, 1)

  const img = await image('conf.example.org:2233')
  assert.equal(img.statusCode, 200)
  assert.equal(img.headers['Content-Type'], 'image/png')

  assert.equal((await request(panelRoute, 'GET', '/memes-panel', 'conf.example.org')).statusCode, 200)
  assert.equal((await request(exportRoute, 'GET', '/dsh-memes-export', 'conf.example.org')).statusCode, 200)
})

test('环境变量 DSH_MEME_TRUSTED_HOSTS:逗号分隔、带端口/大小写不敏感', async () => {
  assert.equal((await apiGet('env.example.com:8443')).statusCode, 200)
  assert.equal((await apiGet('ENV.EXAMPLE.COM')).statusCode, 200, '大小写不敏感')
  assert.equal((await apiGet('[::2]:2233')).statusCode, 200, 'IPv6 字面量按方括号匹配')
})

test('配置项归一化:scheme/路径/末尾点/大小写都容忍', async () => {
  assert.equal((await apiGet('trail.example.com:443')).statusCode, 200)
  assert.equal((await apiGet('Trail.Example.Com.')).statusCode, 200, '末尾点也认')
})

test('只做精确匹配:相似域名与子域后缀攻击不放过', async () => {
  for (const host of ['conf.example.org.evil.com', 'evil-conf.example.org', 'conf.example.org.attacker.net']) {
    const res = await apiGet(host)
    assert.equal(res.statusCode, 403, host + ' 不应命中白名单')
  }
})

test('rebinding:Origin 与 Host 同为未信任域名时仍 403', async () => {
  const res = await request(apiRoute, 'POST', '/', 'evil.example.com:2233', 'http://evil.example.com:2233')
  assert.equal(res.statusCode, 403)
})

test('可信域名下的状态变更请求:同源 Origin 正常通过 CSRF 校验', async () => {
  const res = await request(apiRoute, 'POST', '/', 'conf.example.org', 'https://conf.example.org', { op: 'setAllowLanAccess', enabled: true })
  // setAllowLanAccess 是幂等开关,用来验证请求确实进了 handler 而不是被 CSRF 拦下
  assert.notEqual(res.statusCode, 403)
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true, payload.error)
})

after(() => {
  try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* 常驻连接锁住,留给系统清理 */ }
})
