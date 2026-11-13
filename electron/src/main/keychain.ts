// The only place the refresh token lives between launches (16.3 adds the OS store). Interface methods throw on failure; callers turn that into `keychain_unavailable`.
export interface Keychain {
  load(): string | null
  store(token: string): void
  clear(): void
}

export class KeychainError extends Error {}

/** Process memory only: never reaches disk. */
export class MemoryKeychain implements Keychain {
  #slot: string | null = null
  #broken: boolean
  constructor(broken = false) {
    this.#broken = broken
  }
  #check() {
    if (this.#broken) throw new KeychainError('keychain unavailable')
  }
  load() { this.#check(); return this.#slot }
  store(token: string) { this.#check(); this.#slot = token }
  clear() { this.#check(); this.#slot = null }
}
