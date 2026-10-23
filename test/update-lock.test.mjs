// issue #43 回归测试:插件运行期不能占用插件包目录里的文件。
//
// 背景:插件市场更新用 pnpm 把 node_modules/dsh-meme 整个目录 rename 替换。
// Windows 上目录里只要还有打开的文件(以前是常驻的 SQLite 连接),rename 就 EPERM,
// 更新必失败(ERR_PNPM_EPERM ... rename '..._tmp_...' -> '...dsh-meme')。
// 这里用「rename 包目录」直接模拟 pnpm 的替换动作:修好之后任何时刻都能改名。
// 注意:非 Windows 上目录改名没有共享冲突,断言恒过;在 Windows 上修复前必然失败。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  MemesStore, openIndexWriter, isInsidePluginPackage, pluginPackageDir,
  bundledPacksDir, defaultMemeRoot, liveStore,
} from '../memes.js'

/** 造一个最小可用的图库目录(index.db + 一张图)。 */
function makePack(dir, rows = [['memes/happy/a.jpg', 'happy', 'a.jpg', '开心', '猫']]) {
  mkdirSync(join(dir, 'memes', 'happy'), { recursive: true })
  writeFileSync(join(dir, 'memes', 'happy', 'a.jpg'), 'fake-image')
  const db = new DatabaseSync(join(dir, 'index.db'))
  db.exec('CREATE TABLE memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
  const ins = db.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, 0, 0)')
  for (const row of rows) ins.run(...row)
  db.close()
  return dir
}

/** 模拟 pnpm 更新时的目录替换:整个包目录改名(有打开的文件时 Windows 会 EPERM)。 */
function renamePackageAway(pkgDir) {
  const target = pkgDir + '-replaced'
  renameSync(pkgDir, target)
  renameSync(target, pkgDir)
}

function withTemp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-meme-update-lock-'))
  try {
    return fn(tmp)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

test('更新前能改名包目录:MemesStore 不再长期占用索引文件 (#43)', () => {
  withTemp((tmp) => {
    const pkg = join(tmp, 'dsh-meme')
    const pack = makePack(join(pkg, 'memes', 'builtin'))
    const store = new MemesStore(pack)
    assert.equal(store.list().memes.length, 1)
    // 旧实现:构造后 index.db 一直被打开 → Windows 上这一行 EPERM。
    renamePackageAway(pkg)
    store.close()
  })
})

test('包内图库写入:每写完立刻释放,写后 refresh 能读到新行 (#43)', () => {
  withTemp((tmp) => {
    const pkg = join(tmp, 'dsh-meme')
    const pack = makePack(join(pkg, 'memes', 'builtin'))
    const store = new MemesStore(pack)
    const writer = openIndexWriter(pack, { packageDir: pkg })
    writer.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, 0, 0)')
      .run('memes/happy/b.jpg', 'happy', 'b.jpg', '开心', '狗')
    // 写语句也应是开→写→关,写完就能改名
    renamePackageAway(pkg)
    assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM memes').get().n, 2)
    assert.equal(writer.prepare('SELECT path FROM memes ORDER BY path').all().length, 2)
    store.refresh()
    assert.equal(store.list().memes.length, 2)
    writer.close()
    store.close()
  })
})

test('包外用户图库仍用常驻可写连接(行为不变)', () => {
  withTemp((tmp) => {
    const pkg = join(tmp, 'dsh-meme')
    mkdirSync(pkg, { recursive: true })
    const userPack = makePack(join(tmp, 'meme-packs', 'mine'))
    const writer = openIndexWriter(userPack, { packageDir: pkg })
    assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM memes').get().n, 1)
    writer.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, 0, 0)')
      .run('memes/happy/c.jpg', 'happy', 'c.jpg', '开心', '')
    // 同一个常驻连接立即可见,不需要重开
    assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM memes').get().n, 2)
    writer.exec('PRAGMA user_version = 7')
    assert.equal(writer.prepare('PRAGMA user_version').get().user_version, 7)
    writer.close()
  })
})

test('包内/包外判断:默认按本模块所在插件包推,内置图库在包内', () => {
  assert.equal(pluginPackageDir(), resolve(bundledPacksDir(), '..'))
  assert.equal(isInsidePluginPackage(defaultMemeRoot()), true)
  assert.equal(isInsidePluginPackage(join(bundledPacksDir(), 'dafeiyu-001', 'memes')), true)
  assert.equal(isInsidePluginPackage(join(tmpdir(), 'not-in-package', 'x')), false)
})

test('liveStore 代理透传 refresh:热切换后的 store 也能刷新快照 (#43)', () => {
  withTemp((tmp) => {
    const pkg = join(tmp, 'dsh-meme')
    const pack = makePack(join(pkg, 'memes', 'builtin'))
    const live = liveStore(new MemesStore(pack))
    assert.equal(live.list().memes.length, 1)
    const writer = openIndexWriter(pack, { packageDir: pkg })
    writer.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, 0, 0)')
      .run('memes/happy/d.jpg', 'happy', 'd.jpg', '开心', '')
    // 没有 refresh 前快照还是旧的
    assert.equal(live.list().memes.length, 1)
    live.refresh()
    assert.equal(live.list().memes.length, 2)
    renamePackageAway(pkg)
    writer.close()
    live.replace(new MemesStore(pack))
    assert.equal(live.list().memes.length, 2)
  })
})
