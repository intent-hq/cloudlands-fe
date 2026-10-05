import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCtAlignedPlaywrightCli } from '../ct-browser.mjs';
import { CT_SPEC_SUFFIX, CT_TEST_MATCH } from '../../playwright/ct-spec-pattern.mjs';

// Exercise the real aligned runner without a browser or the application bundle.
export function createCtGateFixture(root) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const launcher = resolve(repo, 'scripts/run-ct-tests.mjs');
  const alignedRequire = createRequire(resolveCtAlignedPlaywrightCli().cliPath);
  const testModule = alignedRequire.resolve('playwright/test');
  const spec = `src/control${CT_SPEC_SUFFIX}`;
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, spec),
    `const { test, expect } = require(${JSON.stringify(testModule)});
test('retry control', async ({}, info) => {
  await info.attach('attempt', { body: Buffer.from(String(info.retry)), contentType: 'text/plain' });
  expect(info.retry).toBe(1);
});
test('first pass control', async () => { expect(2 + 2).toBe(4); });
`,
  );
  const config = join(root, 'control.config.cjs');
  writeFileSync(
    config,
    `const fs = require('node:fs');
if (!process.env.TEST_WORKER_INDEX) fs.writeFileSync(${JSON.stringify(join(root, 'argv.json'))}, JSON.stringify(process.argv));
module.exports = {
  testDir: './src', testMatch: ${JSON.stringify(CT_TEST_MATCH)}, retries: 1, workers: 1,
  outputDir: './test-results',
  reporter: [['json', { outputFile: ${JSON.stringify(join(root, 'results.json'))} }], ['html', { outputFolder: ${JSON.stringify(join(root, 'html'))}, open: 'never' }]],
};
`,
  );
  const script = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).scripts['test:ct'];
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      scripts: {
        'test:ct': `${script.replace('scripts/run-ct-tests.mjs', JSON.stringify(launcher))} -c ${JSON.stringify(config)}`,
      },
    }),
  );
  return {
    launcher,
    config,
    spec,
    report: () => JSON.parse(readFileSync(join(root, 'results.json'), 'utf8')),
    argv: () => JSON.parse(readFileSync(join(root, 'argv.json'), 'utf8')),
  };
}
