import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBlank, sanitizeHtml } from './sanitize';

type Case = { name: string; input: string; forbidden: string[]; kept: string[] };
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), '../docs/fixtures/xss-payloads.json'), 'utf8')) as { cases: Case[] };

describe('sanitizeHtml', () => {
  it('has at least 12 payloads to check', () => expect(fixture.cases.length).toBeGreaterThanOrEqual(12));
  it.each(fixture.cases.map((c) => [c.name, c] as const))('cleans "%s" as the backend does', (_n, c) => {
    const out = sanitizeHtml(c.input);
    for (const f of c.forbidden) expect(out.toLowerCase(), `forbidden ${f}`).not.toContain(f.toLowerCase());
    for (const k of c.kept) expect(out, `kept ${k}`).toContain(k);
  });
  it('drops a scheme split by a tab', () => expect(sanitizeHtml('<a href="java\tscript:alert(1)">x</a>')).toBe('x'));
  it('tells blank from text', () => {
    expect(isBlank('<div><br></div> ')).toBe(true);
    expect(isBlank('<div>hi</div>')).toBe(false);
  });
});
