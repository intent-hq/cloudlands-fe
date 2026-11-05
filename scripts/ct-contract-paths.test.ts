// @vitest-environment node
// The CT-contract path list that `verify:changed` (scripts/verify-changed.mjs)
// uses to select its local `ct-full` check.
import { describe, expect, it } from 'vitest';
import {
  CT_CONTRACT_DIRECTORIES,
  CT_CONTRACT_FILES,
  isCtContractPath,
  isPlaywrightUnitTest,
} from './ct-contract-paths.mjs';

describe('isCtContractPath', () => {
  it.each([
    'src/app.css',
    'src/lib/styles/tokens.css',
    'src/lib/styles/nested/theme.css',
    'playwright-ct.config.ts',
    'playwright/index.ts',
    'playwright/app-stubs/stores.ts',
    'playwright/index.html',
    'playwright/ct-port.ts',
    'playwright/ct-spec-pattern.mjs',
    'playwright/ct-evidence/first-failure.ct.spec.ts',
    'playwright/ct-lifetime/timeout.ct.spec.ts',
    'playwright/future.spec.ts',
    'playwright/__snapshots__/ct-port.test.ts.snap',
    'scripts/run-ct-tests.mjs',
    'scripts/ct-browser.mjs',
    'scripts/playwright-os-deps-lib.mjs',
    'patches/playwright-core@1.58.2.patch',
    'src/test/ct-test.ts',
    'src/lib/component-catalog/capture-stability.ts',
    'src/lib/component-catalog/preview-definition.ts',
    'package.json',
    'pnpm-lock.yaml',
    './src/app.css',
  ])('matches %s', (file) => {
    expect(isCtContractPath(file)).toBe(true);
  });

  it.each([
    'src/foo.test.ts',
    'src/lib/example.ts',
    'src/lib/styles-legacy/tokens.css',
    'src/app.css.map',
    'src/lib/component-catalog/catalog.ts',
    'src/lib/component-catalog/geometry-probe.ts',
    'src/lib/component-catalog/geometry-probe.test.ts',
    'src/lib/component-catalog/nested/preview-definition.ts',
    'src/test/ct-console-errors.ts',
    'playwright.config.ts',
    'scripts/verify-changed.mjs',
    'scripts/ct-contract-paths.mjs',
    'packages/cloudlands-fe/package.json',
    'e2e/playwright/index.ts',
    '.github/workflows/intent-pr.yml',
    'src/lib/components/ui/button/button.keyboard.ct.spec.ts',
    // Vitest suites that live next to the harness; the harness never loads them.
    'playwright/root-harness-import-guard.test.ts',
    'playwright/ct-port.test.ts',
    'playwright/app-stubs/navigation.test.ts',
    './playwright/ct-workers.test.ts',
    'playwright/nested/helper.test.mjs',
  ])('does not match %s', (file) => {
    expect(isCtContractPath(file)).toBe(false);
  });

  it('classifies only Vitest-style .test files under playwright/ as harness unit tests', () => {
    expect(isPlaywrightUnitTest('playwright/ct-port.test.ts')).toBe(true);
    expect(isPlaywrightUnitTest('playwright/a/b.test.cjs')).toBe(true);
    expect(isPlaywrightUnitTest('playwright/ct-port.ts')).toBe(false);
    expect(isPlaywrightUnitTest('playwright/ct-evidence/first-failure.ct.spec.ts')).toBe(false);
    expect(isPlaywrightUnitTest('playwright/ct-port.test.ts.snap')).toBe(false);
    expect(isPlaywrightUnitTest('playwright/ct-port.TEST.ts')).toBe(false);
    expect(isPlaywrightUnitTest('src/foo.test.ts')).toBe(false);
  });

  it('exports the CT harness dependency paths', () => {
    expect([...CT_CONTRACT_DIRECTORIES].sort()).toEqual(['playwright/', 'src/lib/styles/']);
    expect([...CT_CONTRACT_FILES].sort()).toEqual([
      'package.json',
      'patches/playwright-core@1.58.2.patch',
      'playwright-ct.config.ts',
      'pnpm-lock.yaml',
      'scripts/ct-browser.mjs',
      'scripts/playwright-os-deps-lib.mjs',
      'scripts/run-ct-tests.mjs',
      'src/app.css',
      'src/lib/component-catalog/capture-stability.ts',
      'src/lib/component-catalog/preview-definition.ts',
      'src/test/ct-test.ts',
    ]);
  });
});
