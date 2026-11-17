import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * issue #73:点表情时把原图挂成输入框附件,让模型直接看图。
 *
 * 宿主的公开 slot props 没有 addFiles,只能走 conversation.createDrafts +
 * inputActions.addAttachments 这组私有接口。这里把「成功 / 接口缺失 / 抛错 /
 * 拒绝 attach / 取图失败 / 类型与体积过滤」全部钉死:任何一步失败都必须返回
 * false,让点图退回老的 [表情: 描述] 文字,不能因为宿主改版把发图弄坏。
 */

const makeEl = () => ({
  textContent: '', style: {}, dataset: {}, attrs: {},
  appendChild() {}, remove() {}, setAttribute() {}, replaceWith() {}, click() {},
  insertBefore() {}, closest: () => null, addEventListener() {}, removeEventListener() {},
})
globalThis.document = {
  head: { appendChild() {} },
  body: { appendChild() {}, querySelector: () => null },
  createElement: () => makeEl(),
  createElementNS: () => makeEl(),
  createDocumentFragment: () => makeEl(),
  createTextNode: () => makeEl(),
  createTreeWalker: () => ({ nextNode: () => null }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
}
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.window = {
  location: { origin: 'http://localhost', href: '' },
  __ModuleLoader__: {
    load(def) {
      globalThis.__dshMeme = def.factory((name) => {
        if (name === 'react') return {}
        throw new Error('unexpected require: ' + name)
      })
    },
  },
}

await import('../client.js')

const {
  MEME_ATTACH_TYPES, MEME_ATTACH_MAX_BYTES, memeAttachmentName, memeAttachmentFile,
  attachMemeDraft, fetchMemeAttachment,
} = globalThis.__dshMeme.__test

const png = (size = 16) => ({ size, type: 'image/png' })

test('issue #73 附件文件名:保留原扩展名,没有扩展名按 MIME 补', () => {
  assert.equal(memeAttachmentName({ file_name: 'a.jpg' }, 'image/png'), 'a.jpg')
  assert.equal(memeAttachmentName({ file_name: '开心' }, 'image/jpeg'), '开心.jpg')
  assert.equal(memeAttachmentName({ path: 'memes/happy/c.png' }, 'image/png'), 'c.png')
  assert.equal(memeAttachmentName({ file_name: 'a/b\\c.webp' }, 'image/webp'), 'c.webp')
  assert.equal(memeAttachmentName({ file_name: 'a b:c?.gif' }, 'image/gif'), 'a_b_c_.gif')
  assert.equal(memeAttachmentName({}, 'image/png'), 'meme.png')
  assert.equal(memeAttachmentName({ file_name: 'x' }, 'image/webp'), 'x.webp')
})

test('issue #73 附件类型/体积过滤:只收宿主 image draft 认的四种位图', () => {
  assert.deepEqual(MEME_ATTACH_TYPES, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  assert.ok(MEME_ATTACH_MAX_BYTES >= 5 * 1024 * 1024)

  const file = memeAttachmentFile({ file_name: 'a.png' }, png())
  assert.ok(file instanceof File)
  assert.equal(file.type, 'image/png')
  assert.equal(file.name, 'a.png')

  assert.equal(memeAttachmentFile({}, { size: 12, type: 'image/svg+xml' }), null, 'svg 不是位图')
  assert.equal(memeAttachmentFile({}, { size: 12, type: 'text/plain' }), null)
  assert.equal(memeAttachmentFile({}, { size: 0, type: 'image/png' }), null, '空文件不挂')
  assert.equal(memeAttachmentFile({}, { size: MEME_ATTACH_MAX_BYTES + 1, type: 'image/png' }), null, '超大图不挂')
  assert.equal(memeAttachmentFile({}, null), null)
})

test('issue #73 attachMemeDraft:createDrafts 的参数与成功路径', () => {
  const calls = []
  const conversation = {
    createDrafts(sessionId, files, uploadImages) {
      calls.push({ sessionId, files, uploadImages })
      return [{ id: 'draft-1' }]
    },
  }
  const attached = []
  const actions = { addAttachments: (ids) => { attached.push(ids); return true } }
  const file = memeAttachmentFile({ file_name: 'a.png' }, png())
  assert.equal(attachMemeDraft(conversation, 'sess-1', actions, file), true)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { sessionId: 'sess-1', files: [file], uploadImages: false }, '图片走内联字节')
  assert.deepEqual(attached, [['draft-1']])
})

test('issue #73 attachMemeDraft:接口缺失或 attach 被拒都返回 false,半成品要释放', () => {
  const file = memeAttachmentFile({ file_name: 'a.png' }, png())
  const okActions = { addAttachments: () => true }
  assert.equal(attachMemeDraft(null, 's', okActions, file), false)
  assert.equal(attachMemeDraft({}, null, okActions, file), false)
  assert.equal(attachMemeDraft({}, 's', null, file), false)
  assert.equal(attachMemeDraft({}, 's', okActions, null), false)
  assert.equal(attachMemeDraft({}, 's', okActions, file), false, '没有 createDrafts')

  // createDrafts 抛错
  assert.equal(attachMemeDraft({ createDrafts() { throw new Error('boom') } }, 's', okActions, file), false)

  // createDrafts 返回空 / 没有 id
  assert.equal(attachMemeDraft({ createDrafts: () => [] }, 's', okActions, file), false)
  assert.equal(attachMemeDraft({ createDrafts: () => [{}] }, 's', okActions, file), false)

  // addAttachments 拒绝:释放 draft
  const released = []
  const conversation = { createDrafts: () => [{ id: 'd1' }], releaseDraftAttachment: (id) => released.push(id) }
  assert.equal(attachMemeDraft(conversation, 's', { addAttachments: () => false }, file), false)
  assert.deepEqual(released, ['d1'], '挂不进输入框的 draft 不能留在宿主里')

  // addAttachments 抛错也要释放
  const released2 = []
  const conversation2 = { createDrafts: () => [{ id: 'd2' }], releaseDraftAttachment: (id) => released2.push(id) }
  assert.equal(attachMemeDraft(conversation2, 's', { addAttachments() { throw new Error('x') } }, file), false)
  assert.deepEqual(released2, ['d2'])
})

test('issue #73 fetchMemeAttachment:404 / 跨域 / 非位图都返回 null', async () => {
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => ({ ok: true, blob: async () => png() })
    const file = await fetchMemeAttachment({ url: '/dsh-memes/p1/memes/happy/a.png', file_name: 'a.png' })
    assert.ok(file instanceof File, '正常图片要包成 File')
    assert.equal(file.type, 'image/png')

    globalThis.fetch = async () => ({ ok: false })
    assert.equal(await fetchMemeAttachment({ url: '/x.png' }), null, '404 回退文字')

    globalThis.fetch = async () => ({ ok: true, blob: async () => ({ size: 10, type: 'image/svg+xml' }) })
    assert.equal(await fetchMemeAttachment({ url: '/x.svg' }), null, '非位图回退文字')

    globalThis.fetch = async () => { throw new Error('CORS') }
    assert.equal(await fetchMemeAttachment({ url: 'https://remote/x.png' }), null, '跨域失败回退文字')
    assert.equal(await fetchMemeAttachment({}), null)
  } finally {
    globalThis.fetch = realFetch
  }
})
