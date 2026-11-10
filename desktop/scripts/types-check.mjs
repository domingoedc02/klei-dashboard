// Fails when src/api/schema.d.ts differs from what docs/api/openapi.json generates (AR-14).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(mkdtempSync(join(tmpdir(), 'klei-types-')), 'schema.d.ts');
const run = spawnSync('npx', ['openapi-typescript', '../docs/api/openapi.json', '-o', out], { stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);
if (readFileSync(out, 'utf8') !== readFileSync('src/api/schema.d.ts', 'utf8')) {
  console.error('src/api/schema.d.ts is out of date: run `npm run types`.');
  process.exit(1);
}
