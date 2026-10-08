/** Actual facade/preload/production main registration against a pinned normal daemon. */
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
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
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createWriteStream, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build, type Plugin } from 'vite';
import type { Fixture } from './main';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const executableHash = '410a7447bdecfd5a76b7b0d8848b05aac6de3a98f84a42122ab46e444d19717f';
const workspaceId = '79974dfe-96f2-4112-8869-7042fb4b6948';
const workspaceOwnerId = '79974dfe-96f2-4112-8869-7042fb4b6950';
const registeredId = '79974dfe-96f2-4112-8869-7042fb4b6951';
const workspaceOwnerToken = 'cd'.repeat(32);
const guestId = '79974dfe-96f2-4112-8869-7042fb4b6949';
const guestToken = 'abababababababababababababababababababababababababababababababab';
const ownerToken = 'cececececececececececececececececececececececececececececececece';
const evidence = process.env.REPOSITORY_SELECTION_EVIDENCE_DIR;
const executable = process.env.REPOSITORY_SELECTION_DAEMON;
if (!evidence || !executable)
  throw new Error('Explicit evidence directory and accepted daemon required');
let bundle: string;
const records: unknown[] = [];
function record(...items: unknown[]) {
  records.push(...items);
  writeFileSync(join(evidence!, 'progress-observations.json'), JSON.stringify(records, null, 2));
}
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
const client = new LiveWorkspacesClient(); const sessions = new Map(); let sequence = 0;
let closeRead = () => {};
window.selectionFixture = { current: null, updates: [], retirements: [], observations: [],
  async begin(key, root) {
    const session = await client.beginRepositorySelectionEdit({root, editId: String(++sequence), admission: 'original-fixture-document'},
      kind => this.retirements.push({key, kind}));
    sessions.set(key, session); return session.preview;
  },
  async confirm(key, command) { const result = await sessions.get(key).confirm(command); this.observations.push({key, result}); return result; },
  async reconcile(key) { const result = await sessions.get(key).reconcile(); this.observations.push({key, result}); return result; },
  async release(key) { await sessions.get(key).release(); sessions.delete(key); },
  async read(workspaceId) {
    closeRead(); this.current = null;
    closeRead = await client.observeRepositoryContext({workspaceId, binding: 'original-document', requestId: String(++sequence)},
      update => { this.updates.push(update); this.current = update.type === 'received' ? update.response.context : null; });
  },
  async close() { closeRead(); this.current = null; await Promise.all([...sessions.values()].map(s => s.release())); sessions.clear(); }
};
`;

test.beforeAll(async () => {
  expect(
    createHash('sha256')
      .update(await readFile(executable!))
      .digest('hex'),
  ).toBe(executableHash);
  const artifact = await stat(executable!);
  expect(artifact.isFile()).toBe(true);
  expect(artifact.size).toBe(283963624);
  expect(artifact.mode & 0o777).toBe(0o555);
  await mkdir(evidence!, { recursive: true });
  record({
    artifact: executable,
    sha256: executableHash,
    bytes: artifact.size,
    mode: artifact.mode & 0o777,
  });
  await mkdir(evidence!, { recursive: true });
  bundle = await mkdtemp(join(tmpdir(), 'selection-electron-code-'));
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
    ['test/fixtures/repository-selection-native/main.ts', 'main.mjs'],
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
        name: 'inline-selection-facade',
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
  record({ stopped: child.pid, exitCode: child.exitCode, signal: child.signalCode });
}
async function boot(base: string, label: string) {
  const dir = join(base, label);
  await mkdir(dir);
  for (const sub of [
    'home',
    'specialists',
    'workspaces',
    'gh',
    'bin',
    'repo',
    'workspace',
    'secondary',
    'replacement',
  ])
    await mkdir(join(dir, sub));
  // Real local Git reads need unborn repositories; no Git write process or remote is used.
  await symlink('/usr/bin/git', join(dir, 'bin/git'));
  for (const root of ['repo', 'secondary']) {
    const git = join(dir, root, '.git');
    await mkdir(join(git, 'objects'), { recursive: true });
    await mkdir(join(git, 'refs', 'heads'), { recursive: true });
    await mkdir(join(git, 'refs', 'tags'), { recursive: true });
    await writeFile(join(git, 'HEAD'), `ref: refs/heads/${label}\n`);
    await writeFile(join(git, 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n');
  }
  record({
    localReadSetup: label,
    gitReader: '/usr/bin/git',
    gitSha256: createHash('sha256')
      .update(await readFile('/usr/bin/git'))
      .digest('hex'),
    roots: ['repo', 'secondary'],
    branch: label,
    commits: 0,
    remotes: 0,
  });
  const config =
    '[providers]\nenabled = {}\n[mcp]\nenableUserServers = false\n[agents]\nresumeInterruptedOnStart = "off"\n[server.wsApi]\nenabled = true\nport = 42800\n';
  await writeFile(join(dir, 'config.toml'), config);
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
    record({
      start: label,
      generation,
      pid: child.pid,
      executableHash,
      args: ['serve'],
      ownedDataDir: dir,
      environment: {
        ...env,
        INTENTD_AUTH_TOKEN: 'synthetic-owner-token',
        INTENTD_TCP_PORT: String(port),
      },
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
    expect(status.protocolVersion).toBe('10.11');
    port = status.port;
    expect(port).toBeGreaterThan(0);
    record({
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
      'INSERT INTO workspace(id,title,branch,path,repository_path,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    ).run(
      workspaceId,
      'Disposable repository',
      label,
      join(dir, 'workspace'),
      join(dir, 'repo'),
      now,
      now,
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
    db.prepare(
      'INSERT INTO principal(id,github_user_id,login,is_primary,created_at,updated_at,identity_provider,instance_host,external_user_id) VALUES(?,?,?,0,?,?,?,?,?)',
    ).run(
      workspaceOwnerId,
      4343,
      'fixture-workspace-owner',
      now,
      now,
      'github',
      'github.com',
      '4343',
    );
    db.prepare(
      'INSERT INTO principal_credential(token_hash,principal_id,created_at) VALUES(?,?,?)',
    ).run(createHash('sha256').update(workspaceOwnerToken).digest('hex'), workspaceOwnerId, now);
    // The insert trigger seeded the daemon owner; replace only this stopped fixture's owner.
    db.prepare("DELETE FROM workspace_member WHERE workspace_id=? AND role='owner'").run(
      workspaceId,
    );
    db.prepare(
      'INSERT INTO workspace_member(workspace_id,principal_id,role,added_at) VALUES(?,?,?,?)',
    ).run(workspaceId, workspaceOwnerId, 'owner', now);
    db.prepare(
      'INSERT INTO workspace_git_root(id,workspace_id,path,source,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    ).run(registeredId, workspaceId, join(dir, 'secondary'), 'auto', now, now);
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

const primary = { workspaceId, kind: 'primary' as const };
const registered = { workspaceId, kind: 'registered' as const, gitRootId: registeredId };
const automatic = { kind: 'save' as const, choice: { mode: 'automatic' as const } };
const explicit = {
  kind: 'save' as const,
  choice: { mode: 'explicit-remote' as const, remoteName: 'saved-local-intent' },
};
async function begin(
  page: Page,
  key: string,
  root = primary as typeof primary | typeof registered,
) {
  return page.evaluate(({ key, root }) => (window as any).selectionFixture.begin(key, root), {
    key,
    root,
  });
}
async function confirm(page: Page, key: string, command: object) {
  return page.evaluate(
    ({ key, command }) => (window as any).selectionFixture.confirm(key, command),
    { key, command },
  );
}
async function reconcile(page: Page, key: string) {
  return page.evaluate((key) => (window as any).selectionFixture.reconcile(key), key);
}
async function readContext(page: Page) {
  await page.evaluate((id) => (window as any).selectionFixture.read(id), workspaceId);
  await expect
    .poll(() => page.evaluate(() => (window as any).selectionFixture.current?.roots.length))
    .toBe(2);
  const context = await page.evaluate(() => (window as any).selectionFixture.current);
  expect(JSON.stringify(context)).not.toContain('accountId');
  return context;
}
async function selectionCapture(page: Page, root = primary as typeof primary | typeof registered) {
  const response = await page.evaluate(
    (root) => window.electronAPI.invoke('backend:repository-selection:capture', { root }),
    root,
  );
  expect(response.ok).toBe(true);
  return { id: response.result.id, root };
}

test('original selection capture, persistence, receipts and retirement use actual host Services', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'selection-native-owned-'));
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
        workspaceOwnerToken,
        collaboratorToken: guestToken,
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
    record({
      electronPid: app.process().pid,
      args: [
        join(bundle, 'main.mjs'),
        profile,
        join(bundle, 'preload.cjs'),
        manifest,
        join(bundle, 'renderer.js'),
      ],
      environment: env,
    });
    app.process().stderr!.pipe(createWriteStream(join(evidence!, 'electron.log')));
    await app.firstWindow();
    await expect
      .poll(() => app!.evaluate(() => !!(globalThis as any).nativeSelectionFixture?.ready))
      .toBe(true);
    const host = app.windows().find((p) => new URL(p.url()).pathname === '/host-A')!;
    const local = app.windows().find((p) => new URL(p.url()).pathname === '/local-B')!;
    expect(host).toBeDefined();
    expect(local).toBeDefined();
    for (const page of [host, local])
      await page.waitForFunction(() => !!(window as any).selectionFixture);
    const principal = await host.evaluate(() =>
      window.electronAPI.invoke('backend:request', { method: 'principal.me', params: {} }),
    );
    expect(principal).toMatchObject({
      ok: true,
      result: { id: workspaceOwnerId, hostRole: 'guest', isAdministrator: false },
    });
    record({ workspaceOwner: principal.result, seededWorkspaceRole: 'owner' });
    const firstContext = await readContext(host);
    const localContext = await readContext(local);
    expect(firstContext.scope.daemonId).not.toBe(localContext.scope.daemonId);
    record({ firstContext, localContext });

    // Both editing snapshots predate either confirmation; no renderer recomputation.
    const first = await begin(host, 'first');
    const competing = await begin(host, 'competing');
    const exact = await begin(host, 'exact', registered);
    expect(first.snapshot.selection.kind).toBe('neverSaved');
    expect(competing.snapshot).toEqual(first.snapshot);
    expect(exact.snapshot.root).toEqual(registered);
    const applied = await confirm(host, 'first', explicit);
    expect(applied).toMatchObject({
      current: false,
      uncertain: false,
      attempt: {
        status: 'settled',
        receipt: {
          result: {
            kind: 'applied',
            snapshot: { selection: { kind: 'saved', value: explicit.choice } },
          },
          persistence: { kind: 'committed' },
        },
      },
    });
    const conflict = await confirm(host, 'competing', automatic);
    expect(conflict).toMatchObject({
      current: false,
      uncertain: false,
      attempt: {
        status: 'settled',
        receipt: { result: { kind: 'conflict' }, persistence: { kind: 'noEffect' } },
      },
    });
    const registeredSaved = await confirm(host, 'exact', automatic);
    expect(registeredSaved).toMatchObject({
      attempt: {
        status: 'settled',
        receipt: {
          result: {
            kind: 'applied',
            snapshot: {
              root: registered,
              selection: { kind: 'saved', value: { mode: 'automatic' } },
            },
          },
          persistence: { kind: 'committed' },
        },
      },
    });
    expect(await reconcile(host, 'first')).toEqual(applied);
    expect(await confirm(host, 'first', explicit)).toEqual(applied);
    expect(
      await host.evaluate(async () => {
        try {
          await (window as any).selectionFixture.confirm('first', { kind: 'reset' });
          return 'accepted';
        } catch {
          return 'rejected';
        }
      }),
    ).toBe('rejected');
    await expect
      .poll(() =>
        host.evaluate(() =>
          (window as any).selectionFixture.retirements.some(
            (e: any) => e.key === 'first' && e.kind === 'admission',
          ),
        ),
      )
      .toBe(true);
    await expect
      .poll(() => host.evaluate(() => (window as any).selectionFixture.current))
      .toBeNull();
    expect((await begin(local, 'local-primary')).snapshot.selection.kind).toBe('neverSaved');
    expect((await begin(local, 'local-registered', registered)).snapshot.selection.kind).toBe(
      'neverSaved',
    );
    expect(await local.evaluate(() => (window as any).selectionFixture.current)).not.toBeNull();
    const persisted = await begin(host, 'reset-primary');
    expect(persisted.snapshot.selection).toEqual({ kind: 'saved', value: explicit.choice });
    const reset = await confirm(host, 'reset-primary', { kind: 'reset' });
    expect(reset).toMatchObject({
      attempt: {
        status: 'settled',
        receipt: {
          result: { kind: 'applied', snapshot: { selection: { kind: 'reset' } } },
          persistence: { kind: 'committed' },
        },
      },
    });
    const registeredBeforeReset = await begin(host, 'reset-exact', registered);
    expect(registeredBeforeReset.snapshot.selection).toEqual({
      kind: 'saved',
      value: { mode: 'automatic' },
    });
    const registeredReset = await confirm(host, 'reset-exact', { kind: 'reset' });
    expect(registeredReset).toMatchObject({
      attempt: {
        status: 'settled',
        receipt: {
          result: { kind: 'applied', snapshot: { root: registered, selection: { kind: 'reset' } } },
          persistence: { kind: 'committed' },
        },
      },
    });
    record({
      applied,
      conflict,
      registeredSaved,
      reset,
      registeredReset,
      retainedAfterLaterReset: await reconcile(host, 'first'),
    });
    expect(await reconcile(host, 'first')).toEqual(applied);

    const ownerHandle = await selectionCapture(host);
    expect(
      await local.evaluate(
        (payload) => window.electronAPI.invoke('backend:repository-selection:reconcile', payload),
        ownerHandle,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await host.evaluate(
        (payload) => window.electronAPI.invoke('backend:repository-selection:reconcile', payload),
        { ...ownerHandle, root: registered },
      ),
    ).toMatchObject({ ok: false });
    const frame = host.frames().find((f) => f.parentFrame())!;
    expect(frame).toBeDefined();
    expect(
      await frame.evaluate(
        (root) => window.electronAPI.invoke('backend:repository-selection:capture', { root }),
        primary,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await host.evaluate(
        (workspaceId) =>
          window.electronAPI.invoke('backend:request', {
            method: 'workspace.repositorySelection.capture',
            params: { workspaceId },
          }),
        workspaceId,
      ),
    ).toMatchObject({ ok: false });

    // A real protected workspace/root binding mutation retires original disclosure.
    await begin(host, 'root-retired');
    await a.control.rpc('workspace.update', { workspaceId, path: join(a.dir, 'replacement') });
    const rootRetired = await reconcile(host, 'root-retired');
    expect(rootRetired).toMatchObject({ current: false, attempt: null, uncertain: true });
    record({ rootRetired, mutation: 'workspace.update.path' });

    // Same physical client object reconnects, but its old operation cannot follow it.
    const reconnectHandle = await selectionCapture(host);
    await a.restart();
    await expect
      .poll(
        () =>
          app!.evaluate(
            () => (globalThis as any).nativeSelectionFixture.snapshot('host-A').confirmed,
          ),
        { timeout: 20000 },
      )
      .toBe(true);
    expect(
      await host.evaluate(
        (payload) => window.electronAPI.invoke('backend:repository-selection:reconcile', payload),
        reconnectHandle,
      ),
    ).toMatchObject({ ok: false });
    const fresh = await begin(host, 'after-reconnect');
    expect(fresh.snapshot.selection.kind).toBe('reset');
    expect(fresh).not.toHaveProperty('attempt'); // Saved state never recovers an old receipt.

    const navigationHandle = await selectionCapture(host);
    await app.evaluate(() =>
      (
        globalThis as unknown as { nativeSelectionFixture: Fixture }
      ).nativeSelectionFixture.navigate(),
    );
    await host.waitForFunction(() => !!(window as any).selectionFixture);
    expect(
      await host.evaluate(
        (payload) => window.electronAPI.invoke('backend:repository-selection:reconcile', payload),
        navigationHandle,
      ),
    ).toMatchObject({ ok: false });
    await begin(host, 'new-document');

    // Replace only the owned remote credential; the actual server decides both roles.
    await app.evaluate(() =>
      (
        globalThis as unknown as { nativeSelectionFixture: Fixture }
      ).nativeSelectionFixture.identity('collaborator'),
    );
    const collaborator = await host.evaluate(() =>
      window.electronAPI.invoke('backend:request', { method: 'principal.me', params: {} }),
    );
    expect(collaborator).toMatchObject({
      ok: true,
      result: { id: guestId, hostRole: 'guest', isAdministrator: false },
    });
    const guestContext = await readContext(host);
    expect(
      await host.evaluate(async (root) => {
        try {
          await (window as any).selectionFixture.begin('denied', root);
          return 'accepted';
        } catch {
          return 'rejected';
        }
      }, primary),
    ).toBe('rejected');
    await a.control.rpc('workspace.members.remove', { workspaceId, principalId: guestId });
    await expect
      .poll(() => host.evaluate(() => (window as any).selectionFixture.current))
      .toBeNull();
    record({
      collaborator: collaborator.result,
      guestContext,
      readRetiredAfter: 'workspace.members.remove',
    });

    await app.evaluate(() =>
      (
        globalThis as unknown as { nativeSelectionFixture: Fixture }
      ).nativeSelectionFixture.identity('workspaceOwner'),
    );
    await begin(host, 'permission-retired');
    // This revokes this disposable principal's own credentials through Services.
    const revocation = await host.evaluate(() =>
      window.electronAPI.invoke('backend:request', { method: 'principal.revokeSelf', params: {} }),
    );
    record({ revocation });
    await expect
      .poll(() =>
        host.evaluate(() =>
          (window as any).selectionFixture.retirements.some(
            (e: any) => e.key === 'permission-retired' && e.kind === 'closed',
          ),
        ),
      )
      .toBe(true);
    const permission = await host.evaluate(async () => {
      try {
        return await (window as any).selectionFixture.reconcile('permission-retired');
      } catch {
        return 'rejected';
      }
    });
    expect(permission).toBe('rejected');
    expect((await begin(local, 'local-still-independent')).snapshot.selection.kind).toBe(
      'neverSaved',
    );
    record({ permission, versions: await app.evaluate(() => process.versions) });
    await app.evaluate(() =>
      (
        globalThis as unknown as { nativeSelectionFixture: Fixture }
      ).nativeSelectionFixture.destroy(),
    );
    expect(
      await app.evaluate(() => (globalThis as any).nativeSelectionFixture.snapshot('host-A')),
    ).toBeNull();
    await local.evaluate(() => (window as any).selectionFixture.close());
    await app.evaluate(() =>
      (
        globalThis as unknown as { nativeSelectionFixture: Fixture }
      ).nativeSelectionFixture.shutdown(),
    );
  } catch (error) {
    record({
      failure:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    throw error;
  } finally {
    if (app) {
      const electronProcess = app.process();
      record(
        await app
          .evaluate(() => ({
            observations: (globalThis as any).nativeSelectionFixture?.observations,
          }))
          .catch(() => ({ mainUnavailable: true })),
      );
      for (const page of app.windows())
        record(
          await page
            .evaluate(() => ({
              url: location.href,
              updates: (window as any).selectionFixture?.updates,
              retirements: (window as any).selectionFixture?.retirements,
              observations: (window as any).selectionFixture?.observations,
            }))
            .catch(() => ({ documentGone: true })),
        );
      await app
        .evaluate(() => (globalThis as any).nativeSelectionFixture?.shutdown())
        .catch(() => {});
      await app.close();
      record({
        electronStopped: electronProcess.pid,
        exitCode: electronProcess.exitCode,
        signal: electronProcess.signalCode,
      });
    }
    for (const daemon of daemons.reverse()) {
      await daemon.close();
      const db = new DatabaseSync(join(daemon.dir, 'intentd.db'), { readOnly: true });
      record({
        host: daemon.dir,
        selectionState: db
          .prepare('SELECT * FROM repository_selection_state WHERE workspace_id=?')
          .all(workspaceId),
      });
      db.close();
      for (const dir of ['repo', 'secondary']) {
        expect(await readdir(join(daemon.dir, dir))).toEqual(['.git']);
        expect(await readdir(join(daemon.dir, dir, '.git', 'objects'))).toEqual([]);
        expect(await readdir(join(daemon.dir, dir, '.git', 'refs', 'heads'))).toEqual([]);
        expect(await readFile(join(daemon.dir, dir, '.git', 'HEAD'), 'utf8')).toBe(
          `ref: refs/heads/${daemon.dir.split('/').at(-1)}\n`,
        );
        expect(await readFile(join(daemon.dir, dir, '.git', 'config'), 'utf8')).toBe(
          '[core]\nrepositoryformatversion = 0\nbare = false\n',
        );
      }
    }
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
          const done = (value: boolean) => {
            probe.destroy();
            resolve(value);
          };
          probe.once('connect', () => done(true));
          probe.once('error', () => done(false));
          probe.once('timeout', () => done(false));
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
    const artifactAfter = createHash('sha256')
      .update(await readFile(executable!))
      .digest('hex');
    record({ cleanup, profileRemoved: removed, owned, artifactAfter });
    await writeFile(join(evidence!, 'observations.json'), JSON.stringify(records, null, 2));
    expect(artifactAfter).toBe(executableHash);
  }
});
