import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * 识图模型设置(issue #67):AI 学图与设置页上传识图原先固定用部署默认模型,
 * 想换模型只能改源码。新增可选的 recognizeProvider / recognizeModel:
 * 两个字段同时非空才生效,留空 = 跟随部署默认模型(行为与旧版一致)。
 *
 * 这里覆盖 host 侧:payload 下发、setRecognizeModel 的校验与持久化、
 * 以及「识别这一次调用实际用了哪个 provider/model」——用假 llm 记录入参。
 */

// ---------- host 侧 ----------

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-recognize-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
mkdirSync(join(home, '.dsh'), { recursive: true })
const settingsFile = join(home, '.dsh', 'dsh-expression.json')
const setSettings = (patch) => writeFileSync(settingsFile, JSON.stringify(patch || {}))
const readSettings = () => JSON.parse(readFileSync(settingsFile, 'utf8'))

/** 部署默认模型:识别未配置时必须回退到它。 */
const DEFAULT_SEL = { provider: 'default-provider', model: 'default-model' }
/** 每次识别调用实际使用的 provider/model(按调用顺序)。 */
const recognizeCalls = []
/** 识别返回的 JSON(正文被解析成 tag/caption/keywords)。 */
let recognizeReply = '{"tag":"happy","caption":"测试图","keywords":"测试 图"}'
/** 1x1 PNG:非动图,走 saveImage 直通分支。 */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

function createHost() {
  const handlers = []
  const tools = []
  const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
  const llm = {
    async resolveModelInfo() { return { inputModalities: ['text', 'image'] } },
    async resolveCallConfig(cfg) { return cfg },
    prepareCall(cfg) {
      return {
        stream() {
          recognizeCalls.push({ provider: cfg.provider, model: cfg.model })
          return (async function* () {
            yield { type: 'text-delta', text: recognizeReply }
          })()
        },
      }
    },
  }
  const attachments = { async saveImage() { return { id: 'fake-attachment' } } }
  const ctx = {
    effect(body) { return body() },
    on() { return () => {} },
    get(name) {
      if (name === 'webServer') return webServer
      if (name === 'llm') return llm
      if (name === 'attachments') return attachments
      return undefined
    },
    tools: { register(tool) { tools.push(tool) } },
    agentDefaultModel: { currentSelection: () => DEFAULT_SEL },
  }
  return { ctx, handlers, tools }
}

const host = createHost()
const mod = await import('../index.js')
mod.apply(host.ctx, {})
const api = host.handlers.find((h) => h.path === '/dsh-memes-api')
assert.ok(api, '应注册管理 API')

const callApi = (method, url, body) => new Promise((resolve, reject) => {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3999' }
  const res = {
    statusCode: null, body: null,
    writeHead(status) { res.statusCode = status },
    end(b) { res.body = String(b); resolve(res) },
  }
  api.handler(req, res).catch(reject)
  process.nextTick(() => {
    if (body) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
})
const post = (body) => callApi('POST', '/', body)
const get = (url) => callApi('GET', url)

/** 调一次识别,返回解析后的响应体。 */
const recognize = async () => {
  const res = await post({ op: 'recognize', fileName: 'a.png', dataBase64: PNG.toString('base64') })
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

test('payload 默认不带识图模型:两个字段都是空串(跟随部署默认)', async () => {
  setSettings({})
  const initial = JSON.parse((await post({ op: 'getMemeRoot' })).body)
  assert.equal(initial.recognizeProvider, '', '没设置过时为空')
  assert.equal(initial.recognizeModel, '', '没设置过时为空')
  assert.equal(initial.sendMode, 'auto', '原有设置字段不受影响')
})

test('未配置识图模型时,识别回退到部署默认模型(行为与旧版一致)', async () => {
  setSettings({})
  recognizeCalls.length = 0
  const r = await recognize()
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.tag, 'happy')
  assert.deepEqual(recognizeCalls, [{ provider: DEFAULT_SEL.provider, model: DEFAULT_SEL.model }], '旧行为:用 agentDefaultModel 的选择')
})

test('setRecognizeModel:两个字段同时填才接受,并立即持久化', async () => {
  setSettings({})
  const saved = JSON.parse((await post({ op: 'setRecognizeModel', provider: 'my-provider', model: 'vision-model' })).body)
  assert.equal(saved.ok, true)
  assert.equal(saved.recognizeProvider, 'my-provider')
  assert.equal(saved.recognizeModel, 'vision-model')
  assert.match(saved.message, /vision-model/)

  const persisted = readSettings()
  assert.equal(persisted.recognizeProvider, 'my-provider', '写进设置文件')
  assert.equal(persisted.recognizeModel, 'vision-model')

  const after = JSON.parse((await post({ op: 'getMemeRoot' })).body)
  assert.equal(after.recognizeProvider, 'my-provider', '下次拉 payload 仍然带着')
  assert.equal(after.recognizeModel, 'vision-model')
})

test('配置生效后,识别这一次调用改用配置的 provider/model', async () => {
  setSettings({ recognizeProvider: 'my-provider', recognizeModel: 'vision-model' })
  recognizeCalls.length = 0
  const r = await recognize()
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.deepEqual(recognizeCalls, [{ provider: 'my-provider', model: 'vision-model' }], '只换识别这一步的模型')
})

test('只填一个字段会被拒绝(避免存下半配置)', async () => {
  setSettings({})
  const onlyProvider = await post({ op: 'setRecognizeModel', provider: 'my-provider', model: '' })
  assert.equal(onlyProvider.statusCode, 400)
  assert.match(JSON.parse(onlyProvider.body).error, /同时填写/)

  const onlyModel = await post({ op: 'setRecognizeModel', provider: '', model: 'vision-model' })
  assert.equal(onlyModel.statusCode, 400)
  assert.match(JSON.parse(onlyModel.body).error, /同时填写/)

  assert.deepEqual(readSettings(), {}, '被拒绝时不落盘')
})

test('清空两个字段 = 恢复跟随默认模型', async () => {
  setSettings({ recognizeProvider: 'my-provider', recognizeModel: 'vision-model' })
  const reset = JSON.parse((await post({ op: 'setRecognizeModel', provider: '', model: '' })).body)
  assert.equal(reset.ok, true)
  assert.equal(reset.recognizeProvider, '')
  assert.equal(reset.recognizeModel, '')
  assert.match(reset.message, /跟随当前默认模型/)

  recognizeCalls.length = 0
  await recognize()
  assert.deepEqual(recognizeCalls, [{ provider: DEFAULT_SEL.provider, model: DEFAULT_SEL.model }], '清空后回到默认模型')
})

test('非法 provider/model 字符被拒绝', async () => {
  setSettings({})
  const bad = await post({ op: 'setRecognizeModel', provider: 'uni provider', model: 'm' })
  assert.equal(bad.statusCode, 400)
  assert.match(JSON.parse(bad.body).error, /provider 含非法字符/)
  assert.deepEqual(readSettings(), {}, '被拒绝时不落盘')
})

test('识别失败(返回非 JSON)时仍是 500/400 报错,不静默写坏索引', async () => {
  setSettings({})
  recognizeReply = '模型今天不想说话'
  const r = await recognize()
  assert.notEqual(r.status, 200)
  assert.equal(r.body.ok, false)
  recognizeReply = '{"tag":"happy","caption":"测试图","keywords":"测试 图"}'
})

test('识别入口在索引 GET 里也能拿到设置(面板打开时不丢)', async () => {
  setSettings({ recognizeProvider: 'my-provider', recognizeModel: 'vision-model' })
  const all = JSON.parse((await get('/dsh-memes-api?packId=all')).body)
  assert.equal(all.recognizeProvider, 'my-provider')
  assert.equal(all.recognizeModel, 'vision-model')
  setSettings({})
})

after(() => {
  setSettings({})
  rmSync(home, { recursive: true, force: true })
})
