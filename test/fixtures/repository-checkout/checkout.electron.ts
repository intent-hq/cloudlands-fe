/** Real Electron/main/preload/renderer consumers; finite wire producer, not native checkout. */
import { _electron as electron, expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';
import type { Fixture } from './main';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let bundle: string;
const renderer = `
import { LiveIntegrationsClient } from '${join(repo, 'src/lib/client/live/live-integrations-client.ts')}';
import { LiveWorkspacesClient } from '${join(repo, 'src/lib/client/live/live-workspaces-client.ts')}';
const integrations=new LiveIntegrationsClient(), workspaces=new LiveWorkspacesClient();
let session, retired=0;
window.checkoutConsumer={
 async capture(){ const r=await integrations.captureRepositoryCheckout({provider:'gitlab',instanceBaseUrl:'https://forge.invalid:8443/Forge'});if(r.status==='ready'){session=r.value;session.onRetired(()=>retired++);return {status:r.status,capture:session.capture};}return r; },
 async projects(q){return session.projects(q);},
 async project(q){return session.project(q);},
 async branches(q){return session.branches(q);},
 async create(selection,contextLinks){return workspaces.create({title:'Qualified checkout',repositoryCheckout:selection,contextLinks});},
 async warm(selection){return session.warm(selection);},
 async release(){await session.release();},
 get retired(){return retired;},
 beginHeld(){this.pending=this.projects({query:'hold'}).then(value=>({value}),error=>({error:String(error)}));},
};
`;
const evidence = process.env.CHECKOUT_ELECTRON_EVIDENCE_DIR;
const moduleProof = (label: string): Plugin => ({
  name: 'checkout-source-proof',
  async generateBundle() {
    if (!evidence) return;
    const inputs = await Promise.all(
      [...this.getModuleIds()]
        .filter((p) => !p.includes('/node_modules/'))
        .map(async (id) => {
          try {
            return {
              id,
              sha256: createHash('sha256')
                .update(await readFile(id))
                .digest('hex'),
            };
          } catch {
            return {
              id,
              virtual: id.startsWith('\0'),
              source: id === '\0checkout-renderer' ? renderer : undefined,
            };
          }
        }),
    );
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, label + '-inputs.json'), JSON.stringify(inputs, null, 2));
  },
});
test.beforeAll(async () => {
  bundle = await mkdtemp(join(tmpdir(), 'checkout-code-'));
  await symlink(await realpath(join(repo, 'node_modules')), join(bundle, 'node_modules'));
  const alias = ['shared', 'features', 'lib', 'store'].map((p) => ({
    find: '$' + p,
    replacement: join(repo, 'src', p),
  }));
  for (const [entry, name] of [
    ['test/fixtures/repository-checkout/main.ts', 'main.mjs'],
    ['src/preload/index.ts', 'preload.cjs'],
  ]) {
    await build({
      configFile: false,
      logLevel: 'error',
      resolve: { alias },
      plugins: [moduleProof(name)],
      build: {
        target: 'es2022',
        ssr: resolve(repo, entry),
        outDir: bundle,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: {
            format: name.endsWith('.cjs') ? 'cjs' : 'es',
            entryFileNames: name,
            inlineDynamicImports: true,
          },
        },
      },
    });
    if (evidence) await copyFile(join(bundle, name), join(evidence, name));
  }
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias },
    plugins: [
      moduleProof('renderer'),
      {
        name: 'checkout-renderer',
        resolveId(id) {
          if (id === 'checkout-renderer') return '\0checkout-renderer';
        },
        load(id) {
          if (id === '\0checkout-renderer') return renderer;
        },
      },
    ],
    build: {
      outDir: bundle,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        input: 'checkout-renderer',
        output: { format: 'es', entryFileNames: 'renderer.js', inlineDynamicImports: true },
      },
    },
  });
  if (evidence) await copyFile(join(bundle, 'renderer.js'), join(evidence, 'renderer.js'));
});
test.afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true });
});

test('checkout consumer retains original document, socket and selected branch across actual IPC', async ({}, info) => {
  const profile = await mkdtemp(join(tmpdir(), 'checkout-profile-'));
  const env = Object.fromEntries(
    ['PATH', 'TMPDIR', 'DISPLAY', 'XAUTHORITY'].flatMap((k) =>
      process.env[k] ? [[k, String(process.env[k])]] : [],
    ),
  );
  const app = await electron.launch({
    args: [
      join(bundle, 'main.mjs'),
      profile,
      join(bundle, 'preload.cjs'),
      join(bundle, 'renderer.js'),
    ],
    env: {
      ...env,
      HOME: profile,
      XDG_CONFIG_HOME: profile,
      XDG_CACHE_HOME: join(profile, 'cache'),
      DD_TRACE_ENABLED: 'false',
    },
    timeout: 30000,
  });
  const output: string[] = [];
  app.process().stderr?.on('data', (d) => output.push(String(d)));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    app.process().once('exit', (code, signal) => resolve({ code, signal })),
  );
  let observation: unknown;
  try {
    await app.firstWindow();
    await expect
      .poll(() => app.evaluate(() => !!(globalThis as any).checkoutElectronFixture?.ready))
      .toBe(true);
    const original = app.windows().find((p) => new URL(p.url()).pathname === '/original');
    const other = app.windows().find((p) => new URL(p.url()).pathname === '/other');
    if (!original || !other) throw new Error('Original fixture windows missing');
    for (const p of [original, other])
      await p.waitForFunction(() => !!(window as any).checkoutConsumer);
    expect(
      await original.evaluate(() =>
        window.electronAPI.invoke('backend:request', {
          method: 'sourceControl.checkout.capture',
          params: { provider: 'gitlab' },
        }),
      ),
    ).toMatchObject({ ok: false });
    const captured = await original.evaluate(() => (window as any).checkoutConsumer.capture());
    expect(captured).toMatchObject({
      status: 'ready',
      capture: { instanceBaseUrl: 'https://forge.invalid:8443/Forge', provider: 'gitlab' },
    });
    const root = 'nested/team/target';
    const url =
      'https://forge.invalid:8443/Forge/' + root + '/-/merge_requests/7/diffs?view=parallel#note_4';
    expect(
      await original.evaluate((url) => (window as any).checkoutConsumer.project({ url }), url),
    ).toMatchObject({
      status: 'ready',
      value: { contextUrl: url, project: { projectPath: root, defaultBranch: 'trunk' } },
    });
    const first = await original.evaluate(
      (root) =>
        (window as any).checkoutConsumer.branches({ projectPath: root, limit: 50, cached: true }),
      root,
    );
    expect(first.value.nextCursor).toBe('branches/page-2');
    const second = await original.evaluate(
      ({ root, cursor }) =>
        (window as any).checkoutConsumer.branches({
          projectPath: root,
          limit: 50,
          cursor,
          cached: true,
        }),
      { root, cursor: first.value.nextCursor },
    );
    const selected = {
      checkoutId: captured.capture.checkoutId,
      revision: captured.capture.revision,
      projectPath: root,
      branch: second.value.items[0].name,
      commitSha: second.value.items[0].commitSha,
      mode: 'direct',
    };
    expect(selected).toMatchObject({ branch: 'release/next', commitSha: 'c'.repeat(40) });
    const links = [{ kind: 'pr', url, owner: 'nested/team', repo: 'target', number: 7 }];
    for (const mode of ['direct', 'cached']) {
      const selection = { ...selected, mode };
      if (mode === 'cached')
        expect(
          await original.evaluate((s) => (window as any).checkoutConsumer.warm(s), selection),
        ).toMatchObject({
          status: 'ready',
          value: { branch: 'release/next', commitSha: selected.commitSha, cached: true },
        });
      expect(
        await original.evaluate(
          ({ s, links }) => (window as any).checkoutConsumer.create(s, links),
          { s: selection, links },
        ),
      ).toMatchObject({ success: true, workspace: { id: 'created-' + mode, contextLinks: links } });
    }
    const before = await app.evaluate(
      () =>
        (globalThis as any).checkoutElectronFixture.wire.filter(
          (r: any) => r.method === 'workspace.create',
        ).length,
    );
    expect(
      await other.evaluate((s) => (window as any).checkoutConsumer.create(s), selected),
    ).toMatchObject({ success: false });
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).checkoutElectronFixture.wire.filter(
            (r: any) => r.method === 'workspace.create',
          ).length,
      ),
    ).toBe(before);
    const frame = original.frames().find((f) => !!f.parentFrame());
    if (!frame) throw new Error('Original child frame missing');
    await frame.waitForFunction(() => !!(window as any).checkoutConsumer);
    await expect(
      frame.evaluate(() => (window as any).checkoutConsumer.capture()),
    ).rejects.toThrow();
    await app.evaluate(() => (globalThis as any).checkoutElectronFixture.holdCreateError(true));
    await original.evaluate((s) => {
      const consumer = (window as any).checkoutConsumer;
      consumer.pending = consumer.create(s);
    }, selected);
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).checkoutElectronFixture.held))
      .toBe(true);
    await app.evaluate(() => {
      const fixture = (globalThis as any).checkoutElectronFixture;
      fixture.changeTarget('original', 'unknown-target');
      fixture.changeTarget('original', 'local');
      fixture.releaseHeld();
      fixture.holdCreateError(false);
    });
    const oldCreate = await original.evaluate(() => (window as any).checkoutConsumer.pending);
    expect(oldCreate).toEqual({
      success: false,
      error: 'REPOSITORY_CHECKOUT_UNAVAILABLE',
    });
    expect(
      await app.evaluate(() => {
        const fixture = (globalThis as unknown as { checkoutElectronFixture: Fixture })
          .checkoutElectronFixture;
        return fixture.ipc.findLast((call) => call.result !== undefined)?.result;
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'REPOSITORY_CHECKOUT_UNAVAILABLE',
        message: 'REPOSITORY_CHECKOUT_UNAVAILABLE',
        rpcCode: -32003,
      },
    });
    expect(JSON.stringify(oldCreate)).not.toContain('/A/private');
    expect(JSON.stringify(oldCreate)).not.toContain('original private creation error');
    const recaptured = await original.evaluate(() => (window as any).checkoutConsumer.capture());
    selected.checkoutId = recaptured.capture.checkoutId;
    selected.revision = recaptured.capture.revision;
    await app.evaluate(() => (globalThis as any).checkoutElectronFixture.setBranchChanged(true));
    expect(
      await original.evaluate((s) => (window as any).checkoutConsumer.create(s), selected),
    ).toMatchObject({ success: false, errorCode: 'CHECKOUT_BRANCH_CHANGED' });
    await app.evaluate(() => (globalThis as any).checkoutElectronFixture.setBranchChanged(false));
    await original.evaluate(() => (window as any).checkoutConsumer.capture());
    await original.evaluate(() => (window as any).checkoutConsumer.beginHeld());
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).checkoutElectronFixture.held))
      .toBe(true);
    await app.evaluate(() =>
      (globalThis as any).checkoutElectronFixture.changeTarget('original', 'unknown-target'),
    );
    await app.evaluate(() => (globalThis as any).checkoutElectronFixture.releaseHeld());
    const late = await original.evaluate(() => (window as any).checkoutConsumer.pending);
    expect(late.value?.status === 'unavailable' || !!late.error).toBe(true);
    expect(JSON.stringify(late)).not.toContain('nested/team/target');
    await expect(
      original.evaluate(() => (window as any).checkoutConsumer.capture()),
    ).rejects.toThrow();
    await app.evaluate(() =>
      (globalThis as any).checkoutElectronFixture.changeTarget('original', 'local'),
    );
    expect(await original.evaluate(() => (window as any).checkoutConsumer.capture())).toMatchObject(
      { status: 'ready' },
    );
    await app.evaluate(() =>
      (globalThis as any).checkoutElectronFixture.setRefusal('access-denied'),
    );
    expect(
      await original.evaluate(
        (root) => (window as any).checkoutConsumer.branches({ projectPath: root }),
        root,
      ),
    ).toEqual({ status: 'unavailable', reason: 'access-denied' });
    const deniedCount = await app.evaluate(
      () =>
        (globalThis as any).checkoutElectronFixture.wire.filter(
          (r: any) => r.method === 'sourceControl.checkout.branches',
        ).length,
    );
    expect(
      await original.evaluate(
        (root) => (window as any).checkoutConsumer.branches({ projectPath: root }),
        root,
      ),
    ).toEqual({ status: 'unavailable', reason: 'access-denied' });
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).checkoutElectronFixture.wire.filter(
            (r: any) => r.method === 'sourceControl.checkout.branches',
          ).length,
      ),
    ).toBe(deniedCount);
    await original.evaluate(() => (window as any).checkoutConsumer.release());
    expect(await original.evaluate(() => (window as any).checkoutConsumer.capture())).toEqual({
      status: 'unavailable',
      reason: 'access-denied',
    });
    await app.evaluate(() => (globalThis as any).checkoutElectronFixture.setRefusal(undefined));
    expect(await original.evaluate(() => (window as any).checkoutConsumer.capture())).toMatchObject(
      { status: 'ready' },
    );
    await app.evaluate(() => (globalThis as any).checkoutElectronFixture.hello(0));
    await expect
      .poll(() => original.evaluate(() => (window as any).checkoutConsumer.retired))
      .toBeGreaterThan(0);
    const count = await app.evaluate(
      () =>
        (globalThis as any).checkoutElectronFixture.wire.filter(
          (r: any) => r.method === 'sourceControl.checkout.capture',
        ).length,
    );
    await expect(
      original.evaluate(() => (window as any).checkoutConsumer.capture()),
    ).rejects.toThrow();
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).checkoutElectronFixture.wire.filter(
            (r: any) => r.method === 'sourceControl.checkout.capture',
          ).length,
      ),
    ).toBe(count);
    await app.evaluate(() => (globalThis as any).checkoutElectronFixture.hello(1));
    expect(await original.evaluate(() => (window as any).checkoutConsumer.capture())).toMatchObject(
      { status: 'ready' },
    );
    await app.evaluate(() => (globalThis as any).checkoutElectronFixture.navigate());
    await original.waitForFunction(() => !!(window as any).checkoutConsumer);
    expect(await original.evaluate(() => (window as any).checkoutConsumer.capture())).toMatchObject(
      { status: 'ready' },
    );
    observation = await app.evaluate(() => {
      const f = (globalThis as unknown as { checkoutElectronFixture: Fixture })
        .checkoutElectronFixture;
      return { wire: f.wire, ipc: f.ipc, versions: process.versions };
    });
    expect(
      (observation as any).wire
        .filter((r: any) => r.method.startsWith('sourceControl.checkout.'))
        .every((r: any) => r.socket === 1),
    ).toBe(true);
  } finally {
    try {
      await app.evaluate(() => (globalThis as any).checkoutElectronFixture?.shutdown());
    } finally {
      await app.close();
    }
    const terminal = await exit;
    await rm(profile, { recursive: true, force: true });
    const path = info.outputPath('checkout-electron.json');
    await writeFile(
      path,
      JSON.stringify(
        {
          scope:
            'finite producer; actual production main/preload/renderer; no native or live-provider claim',
          observation,
          terminal,
          profileRemoved: true,
          log: output,
        },
        null,
        2,
      ),
    );
    await info.attach('actual-checkout-consumer', { path, contentType: 'application/json' });
    expect(terminal).toEqual({ code: 0, signal: null });
  }
});
