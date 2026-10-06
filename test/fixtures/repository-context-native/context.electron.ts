/** Actual facade/preload/production main registration against a pinned normal daemon. */
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import {
  copyFile,
  cp,
  stat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build, type Plugin } from 'vite';
import type { Fixture } from './main';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const executableHash = '82ca038d0e4e59141c2cff5890fab5a502875702ae61322bcd5424f1712fe0b7';
const workspaceId = '79974dfe-96f2-4112-8869-7042fb4b6948';
const guestId = '79974dfe-96f2-4112-8869-7042fb4b6949';
const guestToken = 'abababababababababababababababababababababababababababababababab';
const ownerToken = 'cececececececececececececececececececececececececececececececece';
const evidence = process.env.REPOSITORY_CONTEXT_EVIDENCE_DIR;
const executable = process.env.REPOSITORY_CONTEXT_DAEMON;
if (!evidence || !executable)
  throw new Error('Explicit evidence directory and accepted daemon required');
let bundle: string;
const records: unknown[] = [];
const cleanEnvironment = (home: string) => ({
  HOME: home,
  XDG_CONFIG_HOME: join(home, 'config'),
  XDG_CACHE_HOME: join(home, 'cache'),
  DD_TRACE_ENABLED: 'false',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});
const renderer = `
import { LiveWorkspacesClient } from '${join(repository, 'src/lib/client/live/live-workspaces-client.ts')}';
const client = new LiveWorkspacesClient();
let close = () => {}; let sequence = 0;
window.contextFixture = { current: null, updates: [], async start(workspaceId) {
  close(); this.current = null; this.updates = [];
  const request = {workspaceId, binding: 'fixture-document', requestId: String(++sequence)};
  close = await client.observeRepositoryContext(request, update => {
    this.updates.push(update); this.current = update.type === 'received' ? update.response.context : null;
  });
}, close() { close(); this.current = null; } };
`;

test.beforeAll(async () => {
  expect(
    createHash('sha256')
      .update(await readFile(executable!))
      .digest('hex'),
  ).toBe(executableHash);
  await mkdir(evidence!, { recursive: true });
  bundle = await mkdtemp(join(tmpdir(), 'context-electron-code-'));
  await symlink(await realpath(join(repository, 'node_modules')), join(bundle, 'node_modules'));
  const moduleEvidence = (label: string): Plugin => ({
    name: 'record-executed-source-inputs',
    async generateBundle(_options, output) {
      const ids = new Set(
        Object.values(output).flatMap((chunk) =>
          chunk.type === 'chunk' ? Object.keys(chunk.modules) : [],
        ),
      );
      const inputs = await Promise.all(
        [...ids].sort().map(async (id) => {
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
              source: id === '\0fixture-renderer' ? renderer : undefined,
            };
          }
        }),
      );
      await writeFile(join(evidence!, `${label}-inputs.json`), JSON.stringify(inputs, null, 2));
    },
  });
  const alias = ['shared', 'features', 'lib', 'store'].map((part) => ({
    find: `$${part}`,
    replacement: join(repository, 'src', part),
  }));
  for (const [entry, name] of [
    ['test/fixtures/repository-context-native/main.ts', 'main.mjs'],
    ['src/preload/index.ts', 'preload.cjs'],
  ]) {
    await build({
      configFile: false,
      logLevel: 'error',
      resolve: { alias },
      plugins: [moduleEvidence(name)],
      build: {
        target: 'es2022',
        ssr: join(repository, entry),
        outDir: bundle,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: name.endsWith('.cjs') ? 'cjs' : 'es', entryFileNames: name },
        },
      },
    });
    await copyFile(join(bundle, name), join(evidence!, name));
  }
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias },
    plugins: [
      moduleEvidence('renderer'),
      {
        name: 'inline-context-facade',
        resolveId(id) {
          if (id === 'fixture-renderer') return '\0fixture-renderer';
        },
        load(id) {
          if (id === '\0fixture-renderer') return renderer;
        },
      },
    ],
    build: {
      outDir: bundle,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        input: 'fixture-renderer',
        output: { format: 'es', entryFileNames: 'renderer.js', inlineDynamicImports: true },
      },
    },
  });
  await copyFile(join(bundle, 'renderer.js'), join(evidence!, 'renderer.js'));
  await cp(join(bundle, 'assets'), join(evidence!, 'assets'), { recursive: true });
});
test.afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true });
});

class Control {
  socket: Socket;
  id = 0;
  input = '';
  pending = new Map<
    number,
    {
      resolve(value: any): void;
      reject(error: unknown): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(path: string) {
    this.socket = createConnection(path);
    this.socket.on('error', () => {});
    this.socket.on('data', (chunk) => {
      this.input += chunk.toString();
      while (this.input.includes('\n')) {
        const newline = this.input.indexOf('\n');
        const value = JSON.parse(this.input.slice(0, newline));
        this.input = this.input.slice(newline + 1);
        const task = this.pending.get(value.id);
        if (!task) continue;
        this.pending.delete(value.id);
        clearTimeout(task.timer);
        if (value.error) task.reject(new Error(JSON.stringify(value.error)));
        else task.resolve(value.result);
      }
    });
  }
  rpc(method: string, params: unknown = {}) {
    const id = ++this.id;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Control timeout: ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  close() {
    this.socket.destroy();
    for (const task of this.pending.values()) {
      clearTimeout(task.timer);
      task.reject(new Error('Control closed'));
    }
    this.pending.clear();
  }
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
  records.push({ stopped: child.pid, exitCode: child.exitCode, signal: child.signalCode });
}
async function boot(base: string, label: string) {
  const dir = join(base, label);
  await mkdir(dir);
  for (const sub of ['home', 'specialists', 'workspaces', 'gh', 'bin', 'repo', 'workspace'])
    await mkdir(join(dir, sub));
  await symlink('/usr/bin/git', join(dir, 'bin/git'));
  const config =
    '[providers]\nenabled = {}\n[mcp]\nenableUserServers = false\n[agents]\nresumeInterruptedOnStart = "off"\n[server.wsApi]\nenabled = true\nport = 42800\n';
  await writeFile(join(dir, 'config.toml'), config);
  const gitEnv = { ...cleanEnvironment(join(dir, 'home')), PATH: '/usr/bin' };
  for (const args of [
    ['init', `--initial-branch=${label}`],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'disposable fixture',
    ],
  ]) {
    const result = spawnSync('/usr/bin/git', ['-C', join(dir, 'repo'), ...args], {
      env: gitEnv,
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  const env = {
    ...cleanEnvironment(join(dir, 'home')),
    PATH: join(dir, 'bin'),
    INTENTD_DATA_DIR: dir,
    INTENTD_WORKSPACES_DIR: join(dir, 'workspaces'),
    INTENTD_SECRETS_FILE: join(dir, 'secrets.json'),
    INTENTD_AUTH_TOKEN: ownerToken,
    INTENTD_SPECIALISTS_DIR: join(dir, 'specialists'),
    GH_CONFIG_DIR: join(dir, 'gh'),
    INTENTD_TCP_PORT: '0',
    RUST_LOG: 'warn,intentd=info,intent_services::repository_native_wire=debug',
  };
  let generation = 0;
  let child: ChildProcess | undefined;
  let control: Control | undefined;
  let port = 0;
  async function start() {
    const logPath = join(evidence!, `${label}-${++generation}.log`);
    const log = createWriteStream(logPath);
    child = spawn(executable!, ['serve'], {
      env: { ...env, INTENTD_TCP_PORT: String(port) },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr!.pipe(log);
    records.push({
      start: label,
      generation,
      pid: child.pid,
      executableHash,
      args: ['serve'],
      ownedDataDir: dir,
    });
    await expect
      .poll(
        async () => {
          try {
            const s = await readFile(logPath, 'utf8');
            return s.includes('config.toml live-reload watcher ready');
          } catch {
            return false;
          }
        },
        { timeout: 30000 },
      )
      .toBe(true);
    control = new Control(join(dir, 'intentd.sock'));
    const status = await control.rpc('system.status');
    port = status.port;
    expect(port).toBeGreaterThan(0);
    records.push({
      backend: label,
      port,
      fingerprint: status.fingerprint,
      protocolVersion: status.protocolVersion,
    });
    return status;
  }
  try {
    await start();
    control!.close();
    await stop(child!);
    const db = new DatabaseSync(join(dir, 'intentd.db'));
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO workspace(id,title,branch,path,repository_path,created_at,updated_at,pr_number) VALUES(?,?,?,?,?,?,?,?)',
    ).run(
      workspaceId,
      'Disposable repository',
      label,
      join(dir, 'workspace'),
      join(dir, 'repo'),
      now,
      now,
      42,
    );
    db.prepare("UPDATE workspace SET status = 'Active' WHERE id = ?").run(workspaceId);
    db.prepare(
      'INSERT INTO principal(id,github_user_id,login,is_primary,created_at,updated_at,identity_provider,instance_host,external_user_id) VALUES(?,?,?,0,?,?,?,?,?)',
    ).run(guestId, 4242, 'fixture-guest', now, now, 'github', 'github.com', '4242');
    db.prepare(
      'INSERT INTO principal_credential(token_hash,principal_id,created_at) VALUES(?,?,?)',
    ).run(createHash('sha256').update(guestToken).digest('hex'), guestId, now);
    db.prepare(
      'INSERT INTO workspace_member(workspace_id,principal_id,role,added_at) VALUES(?,?,?,?)',
    ).run(workspaceId, guestId, 'collaborator', now);
    // Fixture-only historical state, installed while the normal daemon is stopped.
    db.prepare(
      "UPDATE repository_selection_state SET selection_revision=selection_revision+1,choice_incarnation=root_incarnation,choice_mode='unresolved',historical_source=NULL,historical_record_id=NULL WHERE workspace_id=?",
    ).run(workspaceId);
    db.close();
    const status = await start();
    await writeFile(join(dir, 'config-next.toml'), config + '\n[git]\nautoCommit = false\n');
    await rename(join(dir, 'config-next.toml'), join(dir, 'config.toml'));
    await expect
      .poll(async () => (await control!.rpc('settings.get', { path: 'git.autoCommit' })).value)
      .toBe(false);
    await control!.rpc('settings.update', { changes: [{ path: 'git.autoCommit', value: false }] });
    await copyFile(join(dir, 'config.toml'), join(evidence!, `${label}-config.toml`));
    return {
      dir,
      status,
      get control() {
        return control!;
      },
      async restart() {
        control!.close();
        await stop(child!);
        return start();
      },
      async close() {
        control!.close();
        await stop(child!);
      },
    };
  } catch (error) {
    control?.close();
    if (child) await stop(child);
    throw error;
  }
}

test('actual facade reads and retires original Services inventory across hosts and documents', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'context-native-owned-'));
  const daemons: Awaited<ReturnType<typeof boot>>[] = [];
  let app: ElectronApplication | undefined;
  try {
    const a = await boot(owned, 'host-A');
    daemons.push(a);
    const b = await boot(owned, 'local-B');
    daemons.push(b);
    const profile = join(owned, 'desktop');
    await mkdir(profile);
    const manifest = join(owned, 'desktop-input.json');
    await writeFile(
      manifest,
      JSON.stringify({
        port: a.status.port,
        fingerprint: a.status.fingerprint,
        guestToken,
        localSocket: join(b.dir, 'intentd.sock'),
      }),
    );
    const env = {
      ...cleanEnvironment(profile),
      PATH: process.env.PATH ?? '/usr/bin',
      ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
      ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
    };
    app = await electron.launch({
      args: [
        join(bundle, 'main.mjs'),
        profile,
        join(bundle, 'preload.cjs'),
        manifest,
        join(bundle, 'renderer.js'),
      ],
      env,
      timeout: 30000,
    });
    const log = createWriteStream(join(evidence!, 'electron.log'));
    app.process().stderr!.pipe(log);
    await app.firstWindow();
    await expect
      .poll(() => app!.evaluate(() => !!(globalThis as any).nativeRepositoryFixture?.ready))
      .toBe(true);
    const pages = app.windows();
    const host = pages.find((p) => new URL(p.url()).pathname === '/host-A')!;
    const local = pages.find((p) => new URL(p.url()).pathname === '/local-B')!;
    expect(host).toBeDefined();
    expect(local).toBeDefined();
    for (const [page, branch] of [
      [host, 'host-A'],
      [local, 'local-B'],
    ] as const) {
      await page.waitForFunction(() => !!(window as any).contextFixture);
      await page.evaluate((id) => (window as any).contextFixture.start(id), workspaceId);
      await expect
        .poll(() => page.evaluate(() => (window as any).contextFixture.current?.roots[0]?.branch))
        .toBe(branch);
      const context = await page.evaluate(() => (window as any).contextFixture.current);
      records.push({ branch, context });
      expect(context.roots[0].root.workspaceId).toBe(workspaceId);
      expect(context.roots[0].reviewSelection.saved.mode).toBe('unresolved-historical');
      if (branch === 'host-A') expect(JSON.stringify(context)).not.toContain('accountId');
    }
    const principal = await host.evaluate(() =>
      window.electronAPI.invoke('backend:request', { method: 'principal.me', params: {} }),
    );
    expect(principal.ok).toBe(true);
    expect(principal.result.id).toBe(guestId);
    expect(principal.result.isAdministrator).toBe(false);
    expect(principal.result.hostRole).toBe('guest');
    records.push({ nonadminPrincipal: principal.result });
    const captured = await host.evaluate(
      (workspaceId) =>
        window.electronAPI.invoke('backend:repository:capture', {
          root: { workspaceId, kind: 'primary' },
        }),
      workspaceId,
    );
    expect(captured.ok).toBe(true);
    const request = {
      id: captured.result.id,
      root: { workspaceId, kind: 'primary' },
      method: 'workspace.repositoryContext',
      params: { workspaceId },
    };
    expect(
      await local.evaluate(
        (payload) => window.electronAPI.invoke('backend:repository:request', payload),
        request,
      ),
    ).toMatchObject({ ok: false });
    const frame = host.frames().find((f) => f.parentFrame());
    expect(frame).toBeDefined();
    expect(
      await frame!.evaluate(
        (workspaceId) =>
          window.electronAPI.invoke('backend:repository:capture', {
            root: { workspaceId, kind: 'primary' },
          }),
        workspaceId,
      ),
    ).toMatchObject({ ok: false });
    await a.control.rpc('settings.update', { changes: [{ path: 'git.autoCommit', value: true }] });
    await expect.poll(() => host.evaluate(() => (window as any).contextFixture.current)).toBeNull();
    expect(await local.evaluate(() => (window as any).contextFixture.current.roots[0].branch)).toBe(
      'local-B',
    );
    await host.evaluate((id) => (window as any).contextFixture.start(id), workspaceId);
    await expect
      .poll(() => host.evaluate(() => (window as any).contextFixture.current?.roots[0]?.branch))
      .toBe('host-A');
    const beforeReconnect = await host.evaluate(
      (workspaceId) =>
        window.electronAPI.invoke('backend:repository:capture', {
          root: { workspaceId, kind: 'primary' },
        }),
      workspaceId,
    );
    expect(beforeReconnect.ok).toBe(true);
    const reconnectRequest = { ...request, id: beforeReconnect.result.id };
    expect(
      await host.evaluate(
        (payload) => window.electronAPI.invoke('backend:repository:request', payload),
        reconnectRequest,
      ),
    ).toMatchObject({ ok: true, result: { current: true } });
    await a.restart();
    await expect.poll(() => host.evaluate(() => (window as any).contextFixture.current)).toBeNull();
    await expect
      .poll(
        () =>
          app!.evaluate(
            () => (globalThis as any).nativeRepositoryFixture.snapshot('host-A').confirmed,
          ),
        { timeout: 20000 },
      )
      .toBe(true);
    expect(
      await host.evaluate(
        (payload) => window.electronAPI.invoke('backend:repository:request', payload),
        reconnectRequest,
      ),
    ).toMatchObject({ ok: false });
    await host.evaluate((id) => (window as any).contextFixture.start(id), workspaceId);
    await expect
      .poll(() => host.evaluate(() => (window as any).contextFixture.current?.roots[0]?.branch))
      .toBe('host-A');
    const beforeNavigation = await host.evaluate(
      (workspaceId) =>
        window.electronAPI.invoke('backend:repository:capture', {
          root: { workspaceId, kind: 'primary' },
        }),
      workspaceId,
    );
    expect(beforeNavigation.ok).toBe(true);
    const navigationRequest = { ...request, id: beforeNavigation.result.id };
    expect(
      await host.evaluate(
        (payload) => window.electronAPI.invoke('backend:repository:request', payload),
        navigationRequest,
      ),
    ).toMatchObject({ ok: true, result: { current: true } });
    await app.evaluate(() =>
      (
        globalThis as unknown as { nativeRepositoryFixture: Fixture }
      ).nativeRepositoryFixture.navigate(),
    );
    await host.waitForFunction(() => !!(window as any).contextFixture);
    expect(
      await host.evaluate(
        (payload) => window.electronAPI.invoke('backend:repository:request', payload),
        navigationRequest,
      ),
    ).toMatchObject({ ok: false });
    await host.evaluate((id) => (window as any).contextFixture.start(id), workspaceId);
    await expect
      .poll(() => host.evaluate(() => (window as any).contextFixture.current?.roots[0]?.branch))
      .toBe('host-A');
    records.push(
      await app.evaluate(() => ({
        versions: process.versions,
        observations: (globalThis as any).nativeRepositoryFixture.observations,
      })),
    );
    await app.evaluate(() => (globalThis as any).nativeRepositoryFixture.destroy());
    expect(
      await app.evaluate(() => (globalThis as any).nativeRepositoryFixture.snapshot('host-A')),
    ).toBeNull();
    await app.evaluate(() => (globalThis as any).nativeRepositoryFixture.shutdown());
  } finally {
    if (app) {
      records.push(
        await app
          .evaluate(() => ({
            observations: (globalThis as any).nativeRepositoryFixture?.observations,
          }))
          .catch(() => ({ mainUnavailable: true })),
      );
      for (const page of app.windows())
        records.push(
          await page
            .evaluate(() => ({
              url: location.href,
              updates: (window as any).contextFixture?.updates,
            }))
            .catch(() => ({ documentGone: true })),
        );
      await app.close();
    }
    for (const daemon of daemons.reverse()) await daemon.close();
    await rm(owned, { recursive: true, force: true });
    const cleanup = [];
    for (const record of records as Array<{ pid?: number; port?: number }>) {
      if (record.pid) {
        let alive = true;
        try {
          process.kill(record.pid, 0);
        } catch {
          alive = false;
        }
        cleanup.push({ pid: record.pid, alive });
        expect(alive).toBe(false);
      }
      if (record.port) {
        const listening = await new Promise<boolean>((resolve) => {
          const probe = createConnection({ host: '127.0.0.1', port: record.port! });
          probe.setTimeout(1000);
          probe.once('connect', () => {
            probe.destroy();
            resolve(true);
          });
          probe.once('error', () => {
            probe.destroy();
            resolve(false);
          });
          probe.once('timeout', () => {
            probe.destroy();
            resolve(false);
          });
        });
        cleanup.push({ port: record.port, listening });
        expect(listening).toBe(false);
      }
    }
    const removed = await stat(owned).then(
      () => false,
      () => true,
    );
    expect(removed).toBe(true);
    records.push({ cleanup, profileRemoved: removed, owned });
    await writeFile(join(evidence!, 'observations.json'), JSON.stringify(records, null, 2));
  }
});
