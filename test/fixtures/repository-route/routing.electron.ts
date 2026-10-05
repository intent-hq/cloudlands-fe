/** Actual Electron and generated preload, with a disposable local fixture backend only. */
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { Fixture } from './main';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const root = { kind: 'primary', workspaceId: 'same-workspace' } as const;
const channels = {
  capture: 'backend:repository:capture',
  request: 'backend:repository:request',
  release: 'backend:repository:release',
};
let bundleDir: string;

test.beforeAll(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), 'repository-electron-code-'));
  // backend-connection's createRequire loads the installed ws package lazily
  // relative to the bundle. Preserve that production loader in the fixture.
  await symlink(await realpath(join(repository, 'node_modules')), join(bundleDir, 'node_modules'));
  for (const [entry, name] of [
    ['test/fixtures/repository-route/main.ts', 'main.cjs'],
    ['src/preload/index.ts', 'preload.cjs'],
  ]) {
    await build({
      configFile: false,
      logLevel: 'error',
      resolve: {
        alias: ['shared', 'features', 'lib', 'store'].map((part) => ({
          find: `$${part}`,
          replacement: join(repository, 'src', part),
        })),
      },
      ssr: { noExternal: true },
      build: {
        ssr: join(repository, entry),
        outDir: bundleDir,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: name },
        },
      },
    });
    if (process.env.REPOSITORY_ROUTE_EVIDENCE_DIR) {
      const artifacts = join(process.env.REPOSITORY_ROUTE_EVIDENCE_DIR, 'compiled');
      await mkdir(artifacts, { recursive: true });
      await copyFile(join(bundleDir, name), join(artifacts, name));
    }
  }
});
test.afterAll(async () => {
  if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
});

function snapshot(app: ElectronApplication, backend: string) {
  return app.evaluate(
    (_electron, id) =>
      (globalThis as unknown as { repositoryFixture: Fixture }).repositoryFixture.snapshot(id),
    backend,
  );
}

for (const mode of ['unavailable', 'injected'] as const) {
  test(`real bridge and document lifetime (${mode} authority fixture)`, async ({}, testInfo) => {
    const profile = await mkdtemp(join(tmpdir(), 'repository-electron-profile-'));
    const cache = join(profile, 'cache');
    await mkdir(cache);
    const env = Object.fromEntries(
      ['PATH', 'TMPDIR', 'DISPLAY', 'XAUTHORITY', 'SYSTEMROOT'].flatMap((key) => {
        const value = process.env[key];
        return value ? [[key, value]] : [];
      }),
    );
    let app: ElectronApplication | undefined;
    const observations: unknown[] = [];
    try {
      app = await electron.launch({
        args: [join(bundleDir, 'main.cjs'), profile, join(bundleDir, 'preload.cjs'), mode],
        env: { ...env, DD_TRACE_ENABLED: 'false', XDG_CACHE_HOME: cache },
        timeout: 20_000,
      });
      const running = app;
      running.process().stderr?.on('data', (data) => console.error(data.toString()));
      await running.firstWindow({ timeout: 15_000 });
      await expect
        .poll(() =>
          running.evaluate(
            () => (globalThis as unknown as { repositoryFixture: Fixture }).repositoryFixture.ready,
          ),
        )
        .toBe(true);
      const pages = running.windows();
      const a = pages.find((page) => new URL(page.url()).pathname === '/host-A');
      const b = pages.find((page) => new URL(page.url()).pathname === '/local');
      if (!a || !b) throw new Error('Both fixture windows must be ready');
      await a.waitForFunction(() => typeof window.electronAPI?.invoke === 'function');
      const initial = await snapshot(running, 'host-A');
      const local = await snapshot(running, 'local');
      expect(initial).toMatchObject({
        backendId: 'host-A',
        confirmed: true,
        stamp: expect.any(Number),
      });
      expect(local).toMatchObject({ backendId: 'local', confirmed: true });
      expect(initial?.senderId).not.toBe(local?.senderId);
      observations.push({
        initial,
        local,
        versions: await running.evaluate(() => process.versions),
      });

      for (const [page, backend] of [
        [a, 'host-A'],
        [b, 'local'],
      ] as const) {
        expect(
          await page.evaluate(
            (params) =>
              window.electronAPI.invoke('backend:request', { method: 'git.status', params }),
            { workspaceId: root.workspaceId },
          ),
        ).toMatchObject({ ok: true, result: { branch: `${backend}-branch` } });
      }
      const capture = await a.evaluate(
        ({ channel, root }) => window.electronAPI.invoke(channel, { root }),
        { channel: channels.capture, root },
      );
      if (mode === 'unavailable') {
        expect(capture).toMatchObject({
          ok: false,
          error: { code: 'REPOSITORY_ROUTE_UNAVAILABLE' },
        });
        for (const channel of [channels.request, channels.release]) {
          const payload =
            channel === channels.request
              ? {
                  id: 'forged',
                  root,
                  method: 'git.status',
                  params: { workspaceId: root.workspaceId },
                }
              : { id: 'forged', root };
          expect(
            await a.evaluate(
              ({ channel, payload }) => window.electronAPI.invoke(channel, payload),
              { channel, payload },
            ),
          ).toMatchObject({ ok: false, error: { code: 'REPOSITORY_ROUTE_UNAVAILABLE' } });
        }
        await expect(
          a.evaluate(() => window.electronAPI.invoke('fixture:not-allowed')),
        ).rejects.toThrow('Unauthorized channel');
      } else {
        expect(capture).toMatchObject({ ok: true, result: { id: expect.any(String) } });
        const payload = {
          id: capture.result.id,
          root,
          method: 'git.status',
          params: { workspaceId: root.workspaceId },
        };
        expect(
          await a.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), {
            channel: channels.request,
            payload,
          }),
        ).toMatchObject({
          ok: true,
          result: {
            current: true,
            settlement: { status: 'fulfilled', value: { branch: 'host-A-branch' } },
          },
        });
        expect(
          await b.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), {
            channel: channels.request,
            payload,
          }),
        ).toMatchObject({ ok: false });
        const child = a.frames().find((frame) => frame.parentFrame() !== null);
        if (!child) throw new Error('Expected adversarial child-frame fixture');
        await child.waitForFunction(() => typeof window.electronAPI?.invoke === 'function');
        expect(
          await child.evaluate(
            ({ channel, root }) => window.electronAPI.invoke(channel, { root }),
            { channel: channels.capture, root },
          ),
        ).toMatchObject({ ok: false });
        const navigation = a.goto(new URL('/held', a.url()).href).then(
          () => undefined,
          (error: unknown) => error,
        );
        await expect
          .poll(() =>
            running.evaluate(
              () =>
                (globalThis as unknown as { repositoryFixture: Fixture }).repositoryFixture
                  .navigationHeld,
            ),
          )
          .toBe(true);
        expect((await snapshot(running, 'host-A'))?.stamp).toBeNull();
        await running.evaluate(() =>
          (
            globalThis as unknown as { repositoryFixture: Fixture }
          ).repositoryFixture.releaseNavigation(),
        );
        expect(await navigation).toBeUndefined();
        const afterNavigation = await snapshot(running, 'host-A');
        expect(afterNavigation?.senderId).toBe(initial?.senderId);
        expect(afterNavigation?.stamp).not.toBe(initial?.stamp);
        observations.push({ afterNavigation });
        expect(
          await a.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), {
            channel: channels.request,
            payload,
          }),
        ).toMatchObject({ ok: false });
        const fresh = await a.evaluate(
          ({ channel, root }) => window.electronAPI.invoke(channel, { root }),
          { channel: channels.capture, root },
        );
        expect(fresh).toMatchObject({ ok: true });
        expect(fresh.result.id).not.toBe(capture.result.id);
        await running.evaluate(() =>
          (globalThis as unknown as { repositoryFixture: Fixture }).repositoryFixture.destroy(
            'host-A',
          ),
        );
        expect(await snapshot(running, 'host-A')).toBeNull();
        expect(
          await b.evaluate(
            ({ channel, root, id }) => window.electronAPI.invoke(channel, { root, id }),
            { channel: channels.release, root, id: fresh.result.id },
          ),
        ).toMatchObject({ ok: false });
      }
      const evidence = await running.evaluate(
        () => (globalThis as unknown as { repositoryFixture: Fixture }).repositoryFixture.evidence,
      );
      expect(
        evidence.wire
          .filter((entry) => entry.method === 'client.hello')
          .map((entry) => entry.backendId)
          .sort(),
      ).toEqual(['host-A', 'local']);
      expect(
        evidence.ipc
          .filter((entry) => entry.main)
          .every((entry) => entry.processId > 0 && entry.routingId > 0),
      ).toBe(true);
      if (mode === 'injected') {
        expect(
          evidence.ipc.some((entry) => !entry.main && entry.channel === channels.capture),
        ).toBe(true);
        expect(evidence.destruction).toEqual([{ id: initial?.senderId, retired: true }]);
      }
      observations.push({ evidence });
    } finally {
      try {
        if (app) await app.close();
      } finally {
        await rm(profile, { recursive: true, force: true });
        const path = testInfo.outputPath('observations.json');
        await writeFile(
          path,
          JSON.stringify({ mode, profile, profileRemoved: true, observations }, null, 2),
        );
        await testInfo.attach('actual-electron-observations', {
          path,
          contentType: 'application/json',
        });
      }
    }
  });
}
