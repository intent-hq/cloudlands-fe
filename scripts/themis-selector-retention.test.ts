import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('reclaims inactive Themis selectors without breaking subscription ownership', () => {
  const fixture = resolve(__dirname, 'fixtures/themis-selector-retention.mjs');
  const result = spawnSync(process.execPath, ['--expose-gc', '--test', fixture], {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
});
