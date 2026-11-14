import assert from 'node:assert/strict'
import { test } from 'node:test'
import { challengeFor, generatePkce, generateState } from '../src/main/auth.ts'

test('matches the backend test vector', () => {
  assert.equal(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})

test('generated values fit the backend rules', () => {
  const p = generatePkce()
  assert.equal(p.verifier.length, 43)
  assert.equal(p.challenge.length, 43)
  assert.equal(p.challenge, challengeFor(p.verifier))
  assert.notEqual(p.verifier, generatePkce().verifier)
  const s = generateState()
  assert.equal(s.length, 32)
  assert.match(s, /^[A-Za-z0-9._~-]{16,128}$/)
  assert.notEqual(s, generateState())
})
