// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

// A global `**/test/**` ignore (cloudlands-fe#39) meant to skip the package-root
// Playwright suite also swallowed src/test/**, so none of the test rules ever ran on
// the shared test helpers or the tests beside them; src/test/layer-exit.test.ts was
// found unlinted while building intent/no-fixed-wait-timeout-in-tests (cloudlands-fe#3986).
// vitest.config.ts made the same narrowing for its exclude list.
const lintedTestHelperFiles = [
  'src/test/layer-exit.test.ts',
  'src/test/layer-exit.ts',
  'src/test/ct-test.ts',
  'src/test/mocks/__tests__/streaming.mock.test.ts',
];
const packageRootPlaywrightFiles = ['test/agent-avatar.spec.ts'];

describe('ESLint file scope', () => {
  const eslint = new ESLint({ cwd: root });

  it.each(lintedTestHelperFiles)('lints %s', async (file) => {
    expect(await eslint.isPathIgnored(file)).toBe(false);
  });

  it('applies the test rules to the shared test helpers', async () => {
    const { rules = {} } = await eslint.calculateConfigForFile('src/test/layer-exit.test.ts');
    expect(rules).toHaveProperty('intent/no-fixed-wait-timeout-in-tests');
  });

  it.each(packageRootPlaywrightFiles)('still ignores the package-root suite: %s', async (file) => {
    expect(await eslint.isPathIgnored(file)).toBe(true);
  });
});
