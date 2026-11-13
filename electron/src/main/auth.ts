import { createHash, randomBytes } from 'node:crypto'

const b64 = (b: Buffer) => b.toString('base64url')

export const challengeFor = (verifier: string) => b64(createHash('sha256').update(verifier).digest())

/** 32 random bytes give a 43-character verifier, the shortest RFC 7636 allows. */
export function generatePkce() {
  const verifier = b64(randomBytes(32))
  return { verifier, challenge: challengeFor(verifier) }
}

/** 24 bytes give 32 characters, inside the backend's `[A-Za-z0-9._~-]{16,128}`. */
export const generateState = () => b64(randomBytes(24))
