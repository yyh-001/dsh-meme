import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

/**
 * 设置页「Agent 说明(AGENTS.md)」的查看/编辑(issue #53 之后的诉求):
 * - getAgentsMd 返回插件包根目录的 AGENTS.md 内容与路径;
 * - setAgentsMd 写回同一文件,新会话生效(不热刷新,提示里写明);
 * - 超过 1MB 拒绝。
 * setAgentsMd 写的是仓库里的真文件,用例里先备份、finally 恢复。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-agentsmd-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const agentsFile = join(repoRoot, 'AGENTS.md')
const backup = readFileSync(agentsFile, 'utf8')

const tools = []
const handlers = []
const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
const ctx = {
  effect(body) { return body() },
  on() { return () => {} },
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register(tool) { tools.push(tool) } },
  agentDefaultModel: null,
}
const mod = await import('../index.js')
mod.apply(ctx, { memeRoot: join(home, 'pack') })
const api = handlers.find((h) => h.path === '/dsh-memes-api')
assert.ok(api, '应注册管理 API')

const post = (body) => new Promise((resolve_, reject) => {
  const req = new EventEmitter()
  req.method = 'POST'; req.url = '/'; req.headers = { host: '127.0.0.1:3999' }
  const res = {
    statusCode: null, body: null,
    writeHead(s) { res.statusCode = s },
    end(b) { res.body = String(b); resolve_(res) },
  }
  api.handler(req, res).catch(reject)
  process.nextTick(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') })
})

test('getAgentsMd:返回插件包里的 AGENTS.md 内容与路径', async () => {
  const res = JSON.parse((await post({ op: 'getAgentsMd' })).body)
  assert.equal(res.ok, true)
  assert.equal(res.exists, true)
  assert.equal(res.path, agentsFile)
  assert.match(res.content, /send_meme/, '内容就是仓库里那份')
  assert.equal(res.content, backup)
})

test('setAgentsMd:写回并往返;提示新会话生效', async () => {
  try {
    const edited = backup + '\n<!-- 测试追加 -->\n'
    const saved = JSON.parse((await post({ op: 'setAgentsMd', content: edited })).body)
    assert.equal(saved.ok, true, saved.error)
    assert.match(saved.message, /新开的会话生效/)
    assert.equal(readFileSync(agentsFile, 'utf8'), edited, '落盘内容一致')
    const back = JSON.parse((await post({ op: 'getAgentsMd' })).body)
    assert.equal(back.content, edited, '读回来一致')
  } finally {
    writeFileSync(agentsFile, backup) // 恢复仓库文件
  }
  assert.equal(readFileSync(agentsFile, 'utf8'), backup, 'finally 恢复成功')
})

test('setAgentsMd:超过 1MB 拒绝且不落盘', async () => {
  const huge = 'x'.repeat(1024 * 1024 + 1)
  const res = await post({ op: 'setAgentsMd', content: huge })
  assert.equal(res.statusCode, 400)
  assert.match(JSON.parse(res.body).error, /1MB/)
  assert.equal(readFileSync(agentsFile, 'utf8'), backup, '原文件未动')
})

after(() => {
  writeFileSync(agentsFile, backup)
  try { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* 常驻连接锁住 temp,留给系统清理 */ }
})
