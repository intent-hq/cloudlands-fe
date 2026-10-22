import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('electron');
  vi.doUnmock('./build-config.generated.js');
  vi.resetModules();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function load(buildId: string, packaged = true) {
  vi.resetModules();
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ib-')));
  roots.push(home);
  const paths = new Map<string, string>([
    ['home', home],
    ['appData', `${home}/normal`],
    ['userData', `${home}/normal/intent-cloudlands`],
  ]);
  const app = {
    isPackaged: packaged,
    getPath: vi.fn((key: string) => paths.get(key)),
    setPath: vi.fn((key: string, value: string) => paths.set(key, value)),
    setName: vi.fn(),
  };
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    INTENTD_SOCKET: '/normal/intentd.sock',
    GH_TOKEN: 'test-sentinel',
  };
  const fakeProcess = { ...process, platform: 'darwin', env, umask: vi.fn() };
  vi.stubGlobal('process', fakeProcess);
  vi.doMock('electron', () => ({ app }));
  vi.doMock('./build-config.generated.js', () => ({
    BUILD_CONFIG: {
      GIT_COMMIT_HASH: 'test',
      ISOLATED_TEST_BUILD_ID: buildId,
      ISOLATED_TEST_BACKEND_SHA: buildId ? 'a'.repeat(40) : '',
    },
  }));
  return { home, paths, app, env, run: () => import('./isolated-test-bootstrap') };
}

it('establishes private paths and environment before the next application dependency loads', async () => {
  const fixture = await load('manual-321-1');
  await fixture.run();
  const { getIsolatedTestProfile } = await import('./isolated-test-profile');
  const profile = getIsolatedTestProfile()!;
  expect(fixture.paths.get('userData')).toBe(profile.userData);
  expect(fixture.paths.get('sessionData')).toBe(`${profile.root}/sessions`);
  expect(fixture.paths.get('home')).toBe(profile.home);
  expect(fixture.paths.get('logs')).toBe(`${profile.root}/logs`);
  expect(fixture.env.INTENTD_SOCKET).toBeUndefined();
  expect(fixture.env.GH_TOKEN).toBeUndefined();
  expect(fixture.app.setName).toHaveBeenCalledWith('Intent GitLab Test');
  expect(fs.existsSync(`${fixture.home}/normal`)).toBe(false);
});

it('is inert for normal packages even when a runtime variable asks for a test profile', async () => {
  const fixture = await load('');
  fixture.env.INTENT_ISOLATED_TEST_BUILD_ID = 'manual-321-1';
  const before = { ...fixture.env };
  await fixture.run();
  expect(fixture.app.setPath).not.toHaveBeenCalled();
  expect(fixture.app.setName).not.toHaveBeenCalled();
  expect(fixture.env).toEqual(before);
  expect(fs.readdirSync(fixture.home)).toEqual([]);
});

it('fails closed before state creation if a test configuration is used unpackaged', async () => {
  const fixture = await load('manual-321-1', false);
  await expect(fixture.run()).rejects.toThrow('packaged macOS');
  expect(fixture.app.setPath).not.toHaveBeenCalled();
  expect(fs.readdirSync(fixture.home)).toEqual([]);
});
