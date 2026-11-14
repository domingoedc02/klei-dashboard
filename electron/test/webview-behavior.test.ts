// Clipboard, plain-text paste, beforeunload and hash routing, with the browser calls the original renderer makes (see fixtures/behavior/behavior.js).
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { build, launch, path } from './launch.ts'

const profile = mkdtempSync(join(tmpdir(), 'klei-behavior-'))
before(build)
after(() => rmSync(profile, { recursive: true, force: true }))

type Page = { evaluate<T>(f: (a: never) => T, a?: unknown): Promise<T>; click(s: string): Promise<void>; waitForFunction(f: () => unknown): Promise<void>; setViewportSize?(s: { width: number; height: number }): Promise<void>; url(): string }

const open = async () => {
  const app = await launch(profile, path('./fixtures/behavior'))
  const page = (await app.firstWindow()) as Page
  await page.waitForFunction(() => typeof (window as unknown as { dirty?: unknown }).dirty === 'function')
  return { app, page }
}

test('copy: writeText works from a click on the secure app origin and shows the success text', { timeout: 60_000 }, async () => {
  const { app, page } = await open()
  try {
    assert.equal(page.url(), 'app://klei/')
    assert.equal(await page.evaluate(() => window.isSecureContext), true)
    await page.evaluate(() => { (window as unknown as { toCopy: string }).toCopy = 'recovery-code-1\nrecovery-code-2' })
    await page.click('#copy')
    await page.waitForFunction(() => document.getElementById('status')!.textContent !== '')
    assert.equal(await page.evaluate(() => document.getElementById('status')!.textContent), 'Copied')
    assert.equal((await app.evaluate(({ clipboard }: { clipboard: { readText(): string } }) => clipboard.readText())).replaceAll('\r\n', '\n'), 'recovery-code-1\nrecovery-code-2')
  } finally {
    await app.close()
  }
})

test('paste: only text/plain is inserted, no clipboard HTML, the editor stays usable', { timeout: 60_000 }, async () => {
  const { app, page } = await open()
  try {
    const out = await page.evaluate(() => {
      const box = document.getElementById('box')!
      box.focus()
      const dt = new DataTransfer()
      dt.setData('text/plain', 'plain words')
      dt.setData('text/html', '<b onclick="x()">bold</b><img src="http://example.com/x.png">')
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      const afterPaste = box.innerHTML
      document.execCommand('insertText', false, ' more')
      return { afterPaste, afterTyping: box.textContent }
    })
    assert.equal(out.afterPaste, 'plain words')
    assert.equal(out.afterTyping, 'plain words more')
  } finally {
    await app.close()
  }
})

test('beforeunload: a dirty page asks before closing; keep stays, leave closes', { timeout: 60_000 }, async () => {
  const { app, page } = await open()
  try {
    const calls = await app.evaluate(({ dialog }: { dialog: Record<string, unknown> }) => {
      const g = globalThis as unknown as { asked: unknown[]; answer: number }
      g.asked = []
      g.answer = 0
      dialog.showMessageBoxSync = (_w: unknown, o?: unknown) => { g.asked.push(o ?? _w); return g.answer }
      return 0
    })
    assert.equal(calls, 0)
    const state = () => app.evaluate(({ BrowserWindow }: { BrowserWindow: { getAllWindows(): { isDestroyed(): boolean }[] } }) => {
      const g = globalThis as unknown as { asked: { buttons: string[]; detail: string }[] }
      return { windows: BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length, asked: g.asked.length, buttons: g.asked[0]?.buttons, detail: g.asked[0]?.detail }
    })
    const close = () => app.evaluate(({ BrowserWindow }: { BrowserWindow: { getAllWindows(): { close(): void }[] } }) => BrowserWindow.getAllWindows()[0]!.close())

    await page.evaluate(() => (window as unknown as { dirty(on: boolean): void }).dirty(true))
    await close()
    await new Promise((r) => setTimeout(r, 500))
    assert.deepEqual(await state(), { windows: 1, asked: 1, buttons: ['Keep reviewing', 'Leave'], detail: 'Your changes to this batch will be lost.' }, 'keep reviewing: the window stays')

    await page.evaluate(() => (window as unknown as { dirty(on: boolean): void }).dirty(false))
    await app.evaluate(() => { (globalThis as unknown as { answer: number }).answer = 1 })
    await page.evaluate(() => (window as unknown as { dirty(on: boolean): void }).dirty(true))
    const closed = app.waitForEvent('close')
    await close()
    await closed
    assert.ok(true, 'leave: the window closed')
  } finally {
    await app.close().catch(() => {})
  }
})

test('hash routing: hash changes stay in the document, never ask, and survive a dirty page', { timeout: 60_000 }, async () => {
  const { app, page } = await open()
  try {
    await page.evaluate(() => (window as unknown as { dirty(on: boolean): void }).dirty(true))
    const marker = await page.evaluate(() => (window as unknown as { marker: number }).marker)
    const seen = await page.evaluate(async () => {
      for (const h of ['#/gowns', '#/gowns/abc', '#/inquiries']) { location.hash = h; await new Promise((r) => setTimeout(r, 50)) }
      history.back()
      await new Promise((r) => setTimeout(r, 100))
      return { hashes: (window as unknown as { hashes: string[] }).hashes, now: location.hash, marker: (window as unknown as { marker: number }).marker }
    })
    assert.deepEqual(seen.hashes, ['#/gowns', '#/gowns/abc', '#/inquiries', '#/gowns/abc'])
    assert.equal(seen.now, '#/gowns/abc')
    assert.equal(seen.marker, marker, 'same document, not a reload')
    assert.equal(page.url(), 'app://klei/#/gowns/abc')
    await page.evaluate(() => (window as unknown as { dirty(on: boolean): void }).dirty(false))
  } finally {
    await app.close()
  }
})
