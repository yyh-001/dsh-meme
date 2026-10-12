import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * 回归:4 条 HTTP 路由的来源校验有两个缺口。
 *
 * 缺口①:校验只对「状态变更请求」做,GET 分支在校验之前就 return 了 ——
 * 图库清单、导出 ZIP、管理面板这三个读操作一次都没校验过。
 *
 * 缺口②:那道校验的判据是 `new URL(origin).host === req.headers.host`,自己跟自己比。
 * 挡得住普通跨站,挡不住 DNS rebinding:攻击者的页面先用自己的域名解析,再把它切到
 * 127.0.0.1,浏览器发出的 Origin 与 Host 就同是那个域名,判据成立、请求放行。
 *
 * 修法:加一个只看 Host 的回环判定 —— Host 头是浏览器按**实际连接目标**写的,
 * rebinding 时它就是攻击者的域名,直接落选。4 条路由的 handler 开头各拦一道,
 * 原来那段 Origin 校验原样保留(它挡普通跨站仍有价值)。
 */

process.env.DSH_MEME_HOME = mkdtempSync(join(tmpdir(), 'dsh-meme-loopback-'))

const routes = new Map()
const taps = []

const webServer = {
  host: '127.0.0.1',
  port: 3999,
  register(route) {
    const key = route.kind + ' ' + route.path
    if (routes.has(key)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
    routes.set(key, route)
    return () => { routes.delete(key) }
  },
  tapIndex(transform) {
    taps.push(transform)
    return () => {
      const i = taps.indexOf(transform)
      if (i >= 0) taps.splice(i, 1)
    }
  },
}

let effects = []
const unload = () => {
  for (const dispose of effects.reverse()) {
    if (typeof dispose === 'function') dispose()
  }
  effects = []
}
const ctx = {
  effect(body) {
    const dispose = body()
    effects.push(dispose)
    return () => dispose && dispose()
  },
  on() { return () => {} },
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register() { return () => {} } },
  agentDefaultModel: null,
}

const mod = await import('../index.js')
mod.apply(ctx, {})

const ROUTES = {
  '图片路由': 'prefix /dsh-memes',
  '管理 API': 'exact /dsh-memes-api',
  '导出 ZIP': 'exact /dsh-memes-export',
  '管理面板': 'exact /memes-panel',
}

/** 假 req/res:只喂 handler 真正用到的那几个字段 */
const call = (route, { host = '127.0.0.1:3999', method = 'GET', url = '/', origin } = {}) => {
  const headers = { host }
  if (origin !== undefined) headers.origin = origin
  const req = { method, url, headers, on() {} }
  const res = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status },
    end(chunk) { this.body = chunk === undefined ? '' : String(chunk) },
  }
  return Promise.resolve(route.handler(req, res)).then(() => res)
}

test('非回环 Host:4 条路由全部 403(读操作以前一次都没校验过)', async () => {
  for (const [name, key] of Object.entries(ROUTES)) {
    const res = await call(routes.get(key), { host: 'evil.example.com:3999' })
    assert.equal(res.status, 403, name + ' 应当 403,实际 ' + res.status)
    assert.match(res.body, /回环/, name + ' 的错误信息该说明原因,实际:' + res.body)
  }
})

test('DNS rebinding:Origin 与 Host 同为攻击者域名,也必须拦下', async () => {
  // 修复前这条会通过 —— 两个头一致,同源判据成立。
  for (const [name, key] of Object.entries(ROUTES)) {
    const res = await call(routes.get(key), {
      host: 'evil.example.com:3999',
      origin: 'http://evil.example.com:3999',
    })
    assert.equal(res.status, 403, name + ' 在 rebinding 下仍应 403,实际 ' + res.status)
  }
})

test('回环来源放行:127.0.0.1 / localhost / [::1]', async () => {
  for (const host of ['127.0.0.1:3999', 'localhost:3999', '[::1]:3999']) {
    const res = await call(routes.get('exact /memes-panel'), { host })
    assert.notEqual(res.status, 403, host + ' 是回环地址,不该被拦,实际 ' + res.status)
  }
})

test('面板页仍正常返回 HTML(没被新校验误伤)', async () => {
  const res = await call(routes.get('exact /memes-panel'), { host: '127.0.0.1:3999' })
  assert.equal(res.status, 200)
  assert.match(res.body, /<html/i, '面板应返回 HTML')
})

test('图片路由对非回环一律 403,连索引都不去读', async () => {
  const res = await call(routes.get('prefix /dsh-memes'), {
    host: '192.168.1.9:3999',
    url: '/dsh-memes/whatever.jpg',
  })
  assert.equal(res.status, 403)
})

test('hostIsLoopback 纯函数:回环判定与边界', () => {
  const H = (host) => mod.hostIsLoopback({ headers: host === undefined ? {} : { host } })
  assert.equal(H('127.0.0.1:3999'), true)
  assert.equal(H('localhost'), true)
  assert.equal(H('[::1]:3999'), true)
  assert.equal(H('LOCALHOST:3999'), true, '主机名大小写不敏感')
  assert.equal(H('evil.example.com:3999'), false)
  assert.equal(H('127.0.0.1.evil.com:3999'), false, '前缀看着像回环,其实是别人的域名')
  assert.equal(H('192.168.1.9:3999'), false, '局域网地址也不是本机回环')
  assert.equal(H(undefined), true, '没有 Host 头 = 不是浏览器发的,放行')
  assert.equal(H(''), true)
})

test('收尾:卸载后路由与 tapIndex 都不留', () => {
  unload()
  assert.deepEqual([...routes.keys()], [])
  assert.deepEqual(taps, [])
})
