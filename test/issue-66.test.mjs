import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * issue #66:Cloudflare quick tunnel 每次启动换域名(`<random>.trycloudflare.com`),
 * 写死的 allowedHosts 必然失效。修法:白名单支持 `*.` 后缀通配,只匹配一级子域,
 * 按「. + 后缀」整体边界比较;精确项/空名单行为不变。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-wildcard-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const memesMod = await import('../memes.js')
const packDir = join(home, '.dsh', 'meme-packs', 'tunnel-pack')
memesMod.ensurePackAt(packDir, { id: 'tunnel-pack', name: '隧道测试' })
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

// 环境变量:精确项 + 通配项 + 大小写;配置项:URL/大小写/路径写法 + 非法通配。
process.env.DSH_MEME_TRUSTED_HOSTS = 'env.example.com,*.trycloudflare.com,*.NGROK-free.app,*,**.multi.example.com'
const mod = await import('../index.js')
mod.apply(ctx, {
  memeRoot: packDir,
  allowedHosts: ['conf.example.org', 'https://*.Trail.Example.com/some/path'],
})

const apiRoute = handlers.find((h) => h.path === '/dsh-memes-api')
const imageRoute = handlers.find((h) => h.kind === 'prefix')
assert.ok(apiRoute && imageRoute)

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
const image = (host) => request(imageRoute, 'GET', '/dsh-memes/tunnel-pack/memes/happy/a.png', host)

test('通配后缀:quick tunnel 随机子域可读索引与图片', async () => {
  const api = await apiGet('random-abc-123.trycloudflare.com:443')
  assert.equal(api.statusCode, 200)
  assert.equal(JSON.parse(api.body).memes.length, 1)

  const img = await image('random-abc-123.trycloudflare.com')
  assert.equal(img.statusCode, 200)
  assert.equal(img.headers['Content-Type'], 'image/png')
})

test('通配后缀:大小写/端口不敏感', async () => {
  assert.equal((await apiGet('ABC.TryCloudflare.COM:8443')).statusCode, 200)
  assert.equal((await apiGet('abc.ngrok-free.app')).statusCode, 200, '环境变量里的通配项也生效')
})

test('通配只认一级子域:裸后缀、多级子域都不放过', async () => {
  for (const host of ['trycloudflare.com', 'a.b.trycloudflare.com', 'ngrok-free.app']) {
    const res = await apiGet(host)
    assert.equal(res.statusCode, 403, host + ' 不应命中一级通配')
  }
})

test('边界匹配:前后缀混淆不放过', async () => {
  for (const host of [
    'evil-trycloudflare.com',
    'trycloudflare.com.attacker.net',
    'evil.trycloudflare.com.attacker.net',
    'attacker.net?x=.trycloudflare.com',
  ]) {
    const res = await apiGet(host)
    assert.equal(res.statusCode, 403, host + ' 不应命中白名单')
  }
})

test('配置项通配:scheme/路径/大小写都归一化', async () => {
  assert.equal((await apiGet('x.trail.example.com')).statusCode, 200)
  assert.equal((await apiGet('TRAIL.EXAMPLE.COM.')).statusCode, 403, '通配不匹配裸后缀')
})

test('非法通配项被忽略:不产生「信任全部」的副作用', async () => {
  for (const host of ['anything.example.com', 'foo.multi.example.com', 'multi.example.com']) {
    const res = await apiGet(host)
    assert.equal(res.statusCode, 403, host + ' 不应命中非法通配项')
  }
})

test('精确项行为不变,未声明域名仍 403', async () => {
  assert.equal((await apiGet('conf.example.org:2233')).statusCode, 200)
  assert.equal((await apiGet('ENV.EXAMPLE.COM')).statusCode, 200)
  assert.equal((await apiGet('feiyu.example.com')).statusCode, 403)
})

test('通配域名下的状态变更请求:同源 Origin 正常通过 CSRF 校验', async () => {
  const host = 'random-abc-123.trycloudflare.com'
  const res = await request(apiRoute, 'POST', '/', host, `https://${host}`, { op: 'setAllowLanAccess', enabled: true })
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true, payload.error)
})

after(() => {
  try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* 常驻连接锁住,留给系统清理 */ }
})
