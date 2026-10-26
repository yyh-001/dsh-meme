import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * issue #54:手机/平板经局域网 IP 访问 DSH Web 时表情包全空白。两个独立闸门:
 *
 * 1) 图片地址被钉死成 http://127.0.0.1 —— 手机上的 127.0.0.1 是手机自己。
 *    修法:urlPrefix 用相对路径,前端按 window.location.origin 补全(桌面/手机都天然正确)。
 * 2) 四条路由的 loopback 白名单一票否决局域网 Host。修法:设置页「允许局域网访问图库」
 *    (默认关)打开后放行**本机/局域网 IP 字面量**的 Host;域名形式始终拒绝(DNS rebinding)。
 *
 * 这里覆盖:hostIsLocalLan 判定、四条路由在开关开/关下的行为、DNS 名仍被拒。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-lan-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })
const settingsFile = join(home, '.dsh', 'dsh-expression.json')
const writeSettingsFile = (patch) => writeFileSync(settingsFile, JSON.stringify(patch || {}))

const memesMod = await import('../memes.js')
const packDir = join(home, '.dsh', 'meme-packs', 'lan-pack')
memesMod.ensurePackAt(packDir, { id: 'lan-pack', name: 'LAN 测试' })
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
const mod = await import('../index.js')
const api = mod
mod.apply(ctx, { memeRoot: packDir })

const apiRoute = handlers.find((h) => h.path === '/dsh-memes-api')
const imageRoute = handlers.find((h) => h.kind === 'prefix')
assert.ok(apiRoute && imageRoute)

const request = (route, method, url, host) => new Promise((resolve) => {
  const req = new EventEmitter()
  req.method = method; req.url = url; req.headers = host === null ? {} : { host }
  const res = {
    statusCode: null, body: '', headers: null,
    writeHead(s, hh) { res.statusCode = s; res.headers = hh },
    end(b) { if (b) res.body += String(b); resolve(res) },
  }
  route.handler(req, res)
})
const apiGet = (host, url = '/dsh-memes-api') => request(apiRoute, 'GET', url, host)
const apiPost = (body, host = '127.0.0.1:3999') => new Promise((resolve, reject) => {
  const req = new EventEmitter()
  req.method = 'POST'; req.url = '/'; req.headers = { host }
  const res = {
    statusCode: null, body: '',
    writeHead(s) { res.statusCode = s },
    end(b) { if (b) res.body += String(b); resolve(res) },
  }
  apiRoute.handler(req, res).catch(reject)
  process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') })
})

test('hostIsLocalLan:回环/私有网段/链路本地/IPv6 本地地址为真,域名与公网为假', () => {
  const H = mod.hostIsLocalLan
  assert.equal(H({ headers: { host: '127.0.0.1:3999' } }), true)
  assert.equal(H({ headers: { host: 'localhost:3999' } }), true)
  assert.equal(H({ headers: { host: '192.168.1.50:3999' } }), true)
  assert.equal(H({ headers: { host: '10.0.0.2:3999' } }), true)
  assert.equal(H({ headers: { host: '172.16.5.5:3999' } }), true)
  assert.equal(H({ headers: { host: '172.31.255.1:3999' } }), true)
  assert.equal(H({ headers: { host: '172.32.0.1:3999' } }), false, '172.32 不是私有段')
  assert.equal(H({ headers: { host: '169.254.1.2:3999' } }), true)
  assert.equal(H({ headers: { host: '[::1]:3999' } }), true)
  assert.equal(H({ headers: { host: '[fe80::1]:3999' } }), true)
  assert.equal(H({ headers: { host: '[fd00::1]:3999' } }), true)
  assert.equal(H({ headers: { host: '8.8.8.8:3999' } }), false, '公网 IP 不放行')
  assert.equal(H({ headers: { host: 'evil.com:3999' } }), false, '域名不放行(rebinding)')
  assert.equal(H({ headers: { host: '192.168.1.50.evil.com:3999' } }), false, '伪装域名不放行')
  assert.equal(H({ headers: {} }), true, '无 Host 视为非浏览器请求')
})

test('默认仅本机:局域网 Host 访问四条路由全部 403', async () => {
  writeSettingsFile({})
  const api = await apiGet('192.168.1.50:3999')
  assert.equal(api.statusCode, 403)
  assert.match(api.body, /允许局域网访问图库/, '403 文案要指向开关')
  const img = await request(imageRoute, 'GET', '/dsh-memes/lan-pack/memes/happy/a.png', '192.168.1.50:3999')
  assert.equal(img.statusCode, 403)
  // 回环请求照常
  assert.equal((await apiGet('127.0.0.1:3999')).statusCode, 200)
})

test('打开 allowLanAccess 后:局域网 Host 可加载索引与图片,域名仍拒', async () => {
  const saved = JSON.parse((await apiPost({ op: 'setAllowLanAccess', enabled: true })).body)
  assert.equal(saved.ok, true, saved.error)
  assert.equal(saved.allowLanAccess, true, 'payload 要回写开关状态')

  const api = await apiGet('192.168.1.50:3999')
  assert.equal(api.statusCode, 200, '索引接口放行')
  const parsed = JSON.parse(api.body)
  assert.equal(parsed.memes.length, 1)
  assert.equal(parsed.memes[0].url, '/dsh-memes/lan-pack/memes/happy/a.png', '图片 URL 必须是相对路径(#54)')

  const img = await request(imageRoute, 'GET', '/dsh-memes/lan-pack/memes/happy/a.png', '192.168.1.50:3999')
  assert.equal(img.statusCode, 200, '图片路由放行')
  assert.equal(img.headers['Content-Type'], 'image/png')

  const evil = await apiGet('evil.com:3999')
  assert.equal(evil.statusCode, 403, '域名 Host 即使开了开关也拒绝(rebinding 防线)')
  const pub = await apiGet('8.8.8.8:3999')
  assert.equal(pub.statusCode, 403, '公网 IP 不放行')
})

test('关闭 allowLanAccess 恢复仅本机', async () => {
  const off = JSON.parse((await apiPost({ op: 'setAllowLanAccess', enabled: false })).body)
  assert.equal(off.allowLanAccess, false)
  assert.equal((await apiGet('192.168.1.50:3999')).statusCode, 403)
  assert.equal((await apiGet('127.0.0.1:3999')).statusCode, 200)
})

after(() => {
  writeSettingsFile({})
  try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* 常驻连接锁住,留给系统清理 */ }
})
