import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * issue #71:`dsh.client.inject` 里声明了内核中根本不存在的
 * `@deepseek-ai/dsh-client-runtime`,0.2.2-rc.x 宿主启动时客户端 bundle 构建失败,
 * 出现「N entries did not activate」,严重时 DSH 起不来;而且每次升级重装,
 * npm 包里的 package.json 都会把用户手删的那行覆盖回来。
 *
 * 宿主语义(`@deepseek-ai/dsh-client-modules`):inject 条目**只用于激活排序**,
 * 客户端代码不应 require 它们。client.js 唯一的外部依赖是 react,所以保留的
 * 两个条目只是沿用既有顺序;新增条目前必须先确认宿主 app.asar 里真有这个包。
 */

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const inject = pkg.dsh?.client?.inject ?? []

// DSH 0.2.x 宿主确实随包分发的客户端模块(对 0.2.1-rc.3 / 0.2.2 app.asar 逐项核对)
const HOST_CLIENT_PACKAGES = new Set([
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-ui-settings'
])

test('inject 不再声明内核里不存在的 @deepseek-ai/dsh-client-runtime(issue #71)', () => {
  assert.ok(
    !inject.includes('@deepseek-ai/dsh-client-runtime'),
    '@deepseek-ai/dsh-client-runtime 在 DSH 0.2.x app.asar 中出现 0 次,声明它会让宿主激活失败'
  )
})

test('inject 只列宿主真实存在的客户端包,且都是字符串', () => {
  for (const name of inject) {
    assert.equal(typeof name, 'string', 'inject 条目必须是字符串')
    assert.ok(name.trim() !== '', 'inject 条目不可是空串')
    assert.ok(
      HOST_CLIENT_PACKAGES.has(name),
      `${name} 未在 DSH 0.2.x 中核实;新增 inject 前先确认宿主 app.asar 里存在该包`
    )
  }
})

test('client.js 不 require inject 里声明的包(它们只用于激活排序)', () => {
  for (const name of inject) {
    assert.ok(
      !client.includes(`require('${name}')`) && !client.includes(`require("${name}")`),
      `client.js 不要 require ${name}:宿主文档明确 inject 条目只排序、不放行模块`
    )
  }
})

test('dsh.client.platform 仍为 web', () => {
  assert.equal(pkg.dsh?.client?.platform, 'web')
})
