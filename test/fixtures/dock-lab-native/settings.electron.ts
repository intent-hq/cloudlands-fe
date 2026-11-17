import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { WINDOW_CHANNELS } from '../../../src/shared/ipc/channels';
import type { Fixture } from './main';

type FixtureGlobal = typeof globalThis & { dockLabFixture: Fixture };
type Snapshot = Awaited<ReturnType<Fixture['snapshot']>>;
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('dock setting broadcasts reach registered native views and exclude browser content', async ({}, info) => {
  const root = await mkdtemp(join(tmpdir(), 'dock-lab-electron-'));
  let application: ElectronApplication | undefined;
  const observations: { label: string; state: Snapshot }[] = [];
  try {
    await mkdir(join(root, 'profile'));
    await symlink(
      join(repository, 'node_modules'),
      join(root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await build({
      configFile: false,
      logLevel: 'error',
      resolve: { alias: { $shared: join(repository, 'src/shared') } },
      plugins: [
        {
          // Debug-file reporting pulls in unrelated daemon execution services.
          // Keep request validation real and isolate only its diagnostic sink.
          name: 'dock-fixture-disable-ipc-diagnostics',
          enforce: 'pre',
          resolveId(id) {
            if (id === '../shared/main/ipc-debug-tracker') return '\0dock-fixture-diagnostics';
          },
          load(id) {
            if (id === '\0dock-fixture-diagnostics')
              return 'export const ipcDebugTracker = { trackCall() {}, trackSuccess() {}, trackValidationError() {} };';
          },
        },
      ],
      build: {
        ssr: join(repository, 'test/fixtures/dock-lab-native/main.ts'),
        target: 'es2022',
        outDir: root,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'main.cjs' },
        },
      },
    });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' &&
          !entry[0].startsWith('DD_') &&
          !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(entry[0]),
      ),
    );
    application = await electron.launch({
      args: [
        join(root, 'main.cjs'),
        join(root, 'profile'),
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      ],
      env,
    });
    const native = application;
    await expect
      .poll(() => native.evaluate(() => !!(globalThis as FixtureGlobal).dockLabFixture))
      .toBe(true);
    const snapshot = async (label: string) => {
      const state = await native.evaluate(() =>
        (globalThis as FixtureGlobal).dockLabFixture.snapshot(),
      );
      observations.push({ label, state });
      return state;
    };
    const history: boolean[] = [];
    const assertDelivery = async (
      label: string,
      enabled: boolean,
      secondAlive = true,
      remounted = false,
    ) => {
      const state = await snapshot(label);
      expect(state.enabled).toBe(enabled);
      expect(state.persisted).toBe(enabled);
      for (const name of ['outer', 'settings', ...(secondAlive ? ['second-machine'] : [])]) {
        expect(state.recipients[name].current, `${label}: ${name}`).toBe(enabled);
        expect(state.recipients[name].events, `${label}: ${name} events`).toEqual(
          (remounted && name === 'settings' ? [enabled] : history).map((enabled) => ({ enabled })),
        );
      }
      expect(state.recipients['unregistered-browser'].events).toEqual([]);
      expect(state.recipients['unregistered-browser'].current).toBe(false);
      if (!secondAlive) expect(state.recipients['second-machine']).toBeUndefined();
      return state;
    };
    const set = (name: string, enabled: boolean) =>
      native.evaluate(
        (_electron, value) =>
          (globalThis as FixtureGlobal).dockLabFixture.set(value.name, value.enabled),
        { name, enabled },
      );
    const external = (enabled: boolean) =>
      native.evaluate(
        (_electron, value) => (globalThis as FixtureGlobal).dockLabFixture.external(value),
        enabled,
      );

    const initial = await snapshot('initial read');
    expect(initial.enabled).toBe(false);
    for (const recipient of Object.values(initial.recipients)) {
      expect(recipient.current).toBe(false);
      expect(recipient.events).toEqual([]);
    }
    for (const [name, enabled] of [
      ['settings', true],
      ['second-machine', false],
    ] as const) {
      expect(await set(name, enabled)).toEqual({ ok: true, value: { enabled } });
      history.push(enabled);
      const state = await assertDelivery(`Settings SET ${enabled}`, enabled);
      expect(state.requests.at(-1)).toEqual({
        channel: WINDOW_CHANNELS.SET_DOCK_LAB,
        sender: state.recipients[name].id,
        payload: { enabled },
      });
    }
    for (const enabled of [true, false]) {
      expect(await external(enabled)).toBe(enabled);
      history.push(enabled);
      await assertDelivery(`external menu/Hide ${enabled}`, enabled);
    }
    await native.evaluate(() =>
      (globalThis as FixtureGlobal).dockLabFixture.blockPersistence(true),
    );
    try {
      expect(await set('settings', true)).toMatchObject({ ok: false });
      const failed = await snapshot('failed persistence');
      expect(failed.enabled).toBe(false);
      expect(failed.effects).toEqual([
        'show',
        'change',
        'hide',
        'change',
        'show',
        'change',
        'hide',
        'change',
      ]);
      for (const name of Object.keys(failed.recipients)) {
        expect(failed.recipients[name]).toEqual(observations.at(-2)!.state.recipients[name]);
      }
    } finally {
      await native.evaluate(() =>
        (globalThis as FixtureGlobal).dockLabFixture.blockPersistence(false),
      );
    }
    expect(await set('settings', true)).toEqual({ ok: true, value: { enabled: true } });
    history.push(true);
    await assertDelivery('retry after failed save', true);
    await native.evaluate(() => (globalThis as FixtureGlobal).dockLabFixture.destroySecond());
    expect(await external(false)).toBe(false);
    history.push(false);
    await assertDelivery('destroyed view does not interrupt delivery', false, false);
    await native.evaluate(() => (globalThis as FixtureGlobal).dockLabFixture.remount());
    const remounted = await snapshot('remounted Settings reads current state');
    expect(remounted.recipients.settings.current).toBe(false);
    expect(remounted.recipients.settings.events).toEqual([]);
    expect(await set('settings', true)).toEqual({ ok: true, value: { enabled: true } });
    history.push(true);
    await assertDelivery('remounted Settings receives one event', true, false, true);
  } finally {
    const artifact = info.outputPath('dock-lab-native.json');
    await writeFile(
      artifact,
      JSON.stringify(
        {
          boundary:
            'Real Electron BrowserWindow + registered WebContentsViews, production dock-lab/window-backend/validation/local-prefs, actual renderer IPC. Unregistered sibling WebContentsView must receive no broadcasts. Native dock effects are counters; component interaction and appearance are covered separately.',
          observations,
        },
        null,
        2,
      ),
    );
    await info.attach('dock-lab-native', { path: artifact, contentType: 'application/json' });
    if (application) await application.close();
    await rm(root, { recursive: true, force: true });
  }
});
