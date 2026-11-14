// The only place the refresh token lives between launches: the OS credential store. No file, no web storage, no silent fallback (fail closed).
// Process memory is used only when chosen: smoke runs, development builds, or the User's "Continue without saving".
// This is the only module that imports the keyring library (persistence-sentinel.test.ts).
export interface Keychain {
  load(): Promise<string | null>
  store(token: string): Promise<void>
  clear(): Promise<void>
}

export class KeychainError extends Error {}

/** What the keyring library's `AsyncEntry` offers; a test passes a fake. */
export interface Entry {
  getPassword(): Promise<string | null>
  setPassword(p: string): Promise<void>
  deletePassword(): Promise<boolean>
}

const ACCOUNT = 'refresh-token'

/** The Tauri entry `co.klei.bridal` is never touched: the preview has its own service name. */
export class OsKeychain implements Keychain {
  readonly #open: () => Promise<Entry>
  #entry: Promise<Entry> | null = null

  constructor(service: string, open?: () => Promise<Entry>) {
    this.#open = open ?? (async () => new (await import('@napi-rs/keyring')).AsyncEntry(service, ACCOUNT))
  }

  // The native module loads on first use only, so memory mode never touches it.
  #get(): Promise<Entry> {
    return (this.#entry ??= this.#open())
  }

  async #run<T>(what: string, f: (e: Entry) => Promise<T>): Promise<T> {
    try {
      return await f(await this.#get())
    } catch (e) {
      this.#entry = null
      console.warn(`keychain ${what} failed: ${e instanceof Error ? e.message : 'unknown'}`) // the OS error only, never the token
      throw new KeychainError('keychain unavailable')
    }
  }

  load() { return this.#run('read', (e) => e.getPassword()) }
  store(token: string) { return this.#run('write', (e) => e.setPassword(token)) }
  async clear() { await this.#run('delete', (e) => e.deletePassword()) } // false (no entry) is success
}

/** Process memory only: never reaches disk. */
export class MemoryKeychain implements Keychain {
  #slot: string | null = null
  readonly #broken: boolean
  constructor(broken = false) {
    this.#broken = broken
  }
  #check() {
    if (this.#broken) throw new KeychainError('keychain unavailable')
  }
  async load() { this.#check(); return this.#slot }
  async store(token: string) { this.#check(); this.#slot = token }
  async clear() { this.#check(); this.#slot = null }
}

/** The OS store until `useMemory()` is called (or from the start), then process memory. */
export class SwitchKeychain implements Keychain {
  readonly #os: Keychain
  readonly #mem = new MemoryKeychain()
  #memory: boolean
  constructor(os: Keychain, memory: boolean) {
    this.#os = os
    this.#memory = memory
  }
  useMemory() { this.#memory = true }
  get #pick(): Keychain { return this.#memory ? this.#mem : this.#os }
  load() { return this.#pick.load() }
  store(token: string) { return this.#pick.store(token) }
  clear() { return this.#pick.clear() }
}
