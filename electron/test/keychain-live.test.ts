import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { KeychainError, OsKeychain } from '../src/main/keychain.ts'

// The real OS store (macOS Keychain, Windows Credential Manager) behind OsKeychain, under a throwaway service name.
// Either it round-trips, or every call fails closed with KeychainError; never a hang, never a silent success.
// Linux is not registered: a headless session without a Secret Service is outside the supported targets.
if (process.platform === 'darwin' || process.platform === 'win32') {
  test(`live OS credential store (${process.platform}): round trip, or every call fails closed`, { timeout: 30_000 }, async () => {
    const k = new OsKeychain(`co.klei.bridal.electron.preview.citest.${randomUUID()}`)
    // RefreshService issues 32 random bytes as base64url (43 characters), within Windows credential limits.
    const replacement = randomBytes(32).toString('base64url')
    try {
      let usable = true
      try {
        await k.store('tok-1')
      } catch (e) {
        usable = false
        assert.ok(e instanceof KeychainError, 'a store failure must be a KeychainError')
      }
      if (!usable) {
        await assert.rejects(k.load(), KeychainError)
        console.log(`keychain-live: ${process.platform} store unavailable here, failed closed`)
        return
      }
      assert.equal(await k.load(), 'tok-1')
      await k.store(replacement)
      assert.equal(await k.load(), replacement)
      await k.clear()
      assert.equal(await k.load(), null)
      await k.clear()
      console.log(`keychain-live: ${process.platform} real store round-tripped`)
    } finally {
      await k.clear().catch(() => {})
    }
  })
}
