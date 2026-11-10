import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderSignature } from './signature';

type Case = { case: string; enabled: boolean; signoff: string; name: string; title: string; phone: string; studioName: string; studioAddress: string; expected: string };
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), '../docs/fixtures/signature.json'), 'utf8')) as { cases: Case[] };

describe('renderSignature', () => {
  it('has golden cases to check', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(5));
  it.each(fixture.cases.map((c) => [c.case, c] as const))('renders "%s" as the backend does', (_name, c) => {
    expect(renderSignature(c)).toBe(c.expected);
  });
});
