// @verify-changed-triggers: electron-builder.yml, electron-builder.isolated-test.cjs
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
function getConfig(...args: [string, string, object]) {
  return builderRequire('app-builder-lib/out/util/config/config.js').getConfig(...args);
}
beforeEach(() => vi.stubEnv('JITI_FS_CACHE', 'false'));
afterEach(() => vi.unstubAllEnvs());

it('resolves a distinct package without inheriting the shared protocol or Keychain helper', async () => {
  vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', 'manual-123-1');
  vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', 'a'.repeat(40));
  const normal = await getConfig(process.cwd(), 'electron-builder.yml', {});
  const isolated = await getConfig(process.cwd(), 'electron-builder.isolated-test.cjs', {});
  expect(isolated.appId).toBe('app.cloudlands.intent.gitlab-test');
  expect(isolated.productName).toBe('Intent GitLab Test');
  expect(isolated.protocols).toEqual([]);
  expect(isolated.publish).toBeNull();
  expect(
    isolated.mac.extraResources.some((entry: { to: string }) => entry.to === 'keychain-helper'),
  ).toBe(false);
  expect(isolated.extraResources).toEqual(normal.extraResources);
  expect(isolated.mac.extendInfo.IntentIsolatedTestBackend).toBe('a'.repeat(40));
  expect(normal.appId).toBe('app.cloudlands.intent');
  expect(normal.protocols).toContainEqual({ name: 'intent', schemes: ['intent'] });
  expect(
    normal.mac.extraResources.some((entry: { to: string }) => entry.to === 'keychain-helper'),
  ).toBe(true);
  expect(await getConfig(process.cwd(), 'electron-builder.yml', {})).toEqual(normal);
});

it('refuses a renamed package without the compiled test configuration inputs', async () => {
  vi.stubEnv('INTENT_ISOLATED_TEST_BUILD_ID', '');
  vi.stubEnv('INTENT_ISOLATED_TEST_BACKEND_SHA', '');
  await expect(getConfig(process.cwd(), 'electron-builder.isolated-test.cjs', {})).rejects.toThrow(
    'identity',
  );
});
