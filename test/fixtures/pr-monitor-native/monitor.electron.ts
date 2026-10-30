/** Actual renderer facade → production preload → main handler → UDS client. */
import { _electron as electron, expect, test } from '@playwright/test';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

const root = resolve('.');
let bundle: string;
test.beforeAll(async () => {
  bundle = await mkdtemp(join(tmpdir(), 'monitor-electron-code-'));
  await symlink(await realpath('node_modules'), join(bundle, 'node_modules'));
  const alias = ['shared', 'features', 'lib', 'store'].map((name) => ({
    find: `$${name}`,
    replacement: join(root, 'src', name),
  }));
  for (const [entry, name] of [
    ['test/fixtures/pr-monitor-native/main.ts', 'main.mjs'],
    ['src/preload/index.ts', 'preload.cjs'],
  ]) {
    await build({
      configFile: false,
      logLevel: 'error',
      resolve: { alias },
      build: {
        target: 'esnext',
        ssr: join(root, entry),
        outDir: bundle,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: name.endsWith('.cjs') ? 'cjs' : 'es', entryFileNames: name },
        },
      },
    });
  }
  const renderer = join(bundle, 'renderer.ts');
  await writeFile(
    renderer,
    `
import { createElectronIpcBackendTransport } from '${join(root, 'src/lib/client/live/electron-ipc-transport.ts')}';

let session;
let transport;
let retained;
const recovery = {monitor:0, chat:0};
const notices = [];
window.monitorFixture = {
  async capture(qualified = false) { transport = createElectronIpcBackendTransport({reviewMonitoring: qualified ? 1 : undefined}); transport.onNotification(n => notices.push(n)); session = await transport.capturePrMonitorSession('ws'); return {origin:session.origin,support:session.support}; },
  async history(method, params) { return transport.request(method, params); },
  notices, recovery,
  async startRecovery() {
    retained = session;
    await session.request('events.subscribe', {workspaceId:'ws',eventTypes:['prMonitor:*']});
    transport.onMonitorReconnected(async () => {
      session = await transport.capturePrMonitorSession('ws');
      await session.request('events.subscribe', {workspaceId:'ws',eventTypes:['prMonitor:*']});
      recovery.monitor++;
    });
    transport.onReconnected(async () => {
      await transport.request('chat.subscribe', {workspaceId:'ws',agentId:'agent',historyDelivery:'progressive'});
      recovery.chat++;
    });
  },
  async retainedControl() { return retained.request('prMonitor.flush',{workspaceId:'ws',monitorId:'m',check:true}); },
  async request(method, params) { return session.request(method, {workspaceId:'ws',...params}); },
  async release() { await session.release(); },
};`,
  );
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias },
    build: {
      outDir: bundle,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        input: renderer,
        output: { format: 'es', entryFileNames: 'renderer.js', inlineDynamicImports: true },
      },
    },
  });
});
test.afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true });
});

for (const scenario of ['legacy', 'qualified', 'recovery'])
  test(`document ${scenario} uses actual preload and refuses retired controls`, async () => {
    const qualified = scenario !== 'legacy';
    const recover = scenario === 'recovery';
    const profile = await mkdtemp(join(tmpdir(), 'monitor-electron-profile-'));
    const socketPath = join(profile, 'daemon.sock');
    const frames: Array<{ connection: number; method: string; params: Record<string, unknown> }> =
      [];
    let nextConnection = 0;
    const sockets = new Set<Socket>();
    const byConnection = new Map<number, Socket>();
    const expectedResets = new Set<number>();
    const server = createServer((socket) => {
      const connection = nextConnection++;
      sockets.add(socket);
      byConnection.set(connection, socket);
      socket.on('error', (error: NodeJS.ErrnoException) => {
        // This case deliberately breaks the attachment while main may unsubscribe.
        if (
          expectedResets.has(connection) &&
          (error.code === 'ECONNRESET' || error.code === 'EPIPE')
        )
          return;
        throw error;
      });
      socket.once('close', () => sockets.delete(socket));
      let input = '';
      socket.on('data', (chunk) => {
        input += chunk.toString();
        while (input.includes('\n')) {
          const index = input.indexOf('\n');
          const frame = JSON.parse(input.slice(0, index));
          input = input.slice(index + 1);
          frames.push({ ...frame, connection });
          if (frame.method === 'chat.subscribe')
            socket.write(
              JSON.stringify({
                jsonrpc: '2.0',
                method: 'subscription.push',
                params: {
                  subscriptionId: 'chat-' + connection,
                  kind: 'snapshot',
                  seq: 0,
                  snapshot: { agentId: 'agent', messages: [] },
                },
              }) + '\n',
            );
          const result =
            frame.method === 'client.hello'
              ? {
                  clientId: 'native-monitor-fixture',
                  ...(frame.params?.connectionRole === undefined
                    ? {}
                    : { connectionRole: frame.params.connectionRole }),
                  server: { capabilities: { reviewMonitoring: 1 } },
                }
              : frame.method === 'events.subscribe'
                ? { subscriptionId: 'monitor-' + connection }
                : frame.method === 'prMonitor.list'
                  ? { monitors: [] }
                  : frame.method === 'chat.subscribe'
                    ? { subscriptionId: 'chat-' + connection }
                    : frame.method === 'agent.getConversation'
                      ? { messages: [], totalMessages: 0 }
                      : { ok: true };
          socket.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) + '\n');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    let app;
    try {
      app = await electron.launch({
        env: {
          HOME: profile,
          XDG_CONFIG_HOME: join(profile, 'config'),
          XDG_CACHE_HOME: join(profile, 'cache'),
          PATH: process.env.PATH ?? '/usr/bin',
          DISPLAY: process.env.DISPLAY ?? '',
          XAUTHORITY: process.env.XAUTHORITY ?? '',
          DD_TRACE_ENABLED: 'false',
        },
        timeout: 30_000,
        args: [
          join(bundle, 'main.mjs'),
          profile,
          join(bundle, 'preload.cjs'),
          socketPath,
          join(bundle, 'renderer.js'),
        ],
      });
      console.log(
        'Native main entry',
        await app.evaluate(({ app, BrowserWindow }) => ({
          argv: process.argv,
          ready: app.isReady(),
          windows: BrowserWindow.getAllWindows().length,
        })),
      );
      app.process().stderr?.on('data', (chunk) => process.stderr.write(chunk));
      app.process().stdout?.on('data', (chunk) => process.stdout.write(chunk));
      await expect
        .poll(() => app!.evaluate(() => !!(globalThis as any).monitorFixture?.ready))
        .toBe(true);
      const [first, second] = app.windows();
      for (const page of [first, second])
        await page.waitForFunction(() => !!(window as any).monitorFixture);
      const a = await first.evaluate(
        (qualified) => (window as any).monitorFixture.capture(qualified),
        qualified,
      );
      const b = await second.evaluate(() => (window as any).monitorFixture.capture());
      expect(a.support).toBe(qualified ? 'supported' : 'consumer-pending');
      expect(b.support).toBe('consumer-pending');
      expect(a.origin.sessionId).not.toBe(b.origin.sessionId);
      if (qualified) {
        await first.evaluate(() =>
          (window as any).monitorFixture.history('agent.getConversation', {
            agentId: 'agent',
            workspaceId: 'ws',
            projection: 'slim',
          }),
        );
        await first.evaluate(() =>
          (window as any).monitorFixture.history('chat.subscribe', {
            agentId: 'agent',
            workspaceId: 'ws',
            historyDelivery: 'progressive',
          }),
        );
        await expect
          .poll(() => first.evaluate(() => (window as any).monitorFixture.notices.length))
          .toBe(1);
        expect(await second.evaluate(() => (window as any).monitorFixture.notices)).toEqual([]);
        expect(frames.find((x) => x.method === 'agent.getConversation')?.connection).toBe(1);
        expect(frames.find((x) => x.method === 'chat.subscribe')?.connection).toBe(1);
      }
      if (recover) {
        await first.evaluate(() => (window as any).monitorFixture.startRecovery());
        expectedResets.add(1);
        byConnection.get(1)!.destroy();
        await expect
          .poll(() => first.evaluate(() => (window as any).monitorFixture.recovery))
          .toEqual({ monitor: 1, chat: 1 });
        expect(byConnection.get(0)!.destroyed).toBe(false);
        expect(
          frames.filter((x) => x.connection === 2 && x.method === 'events.subscribe'),
        ).toHaveLength(1);
        expect(
          frames.filter((x) => x.connection === 2 && x.method === 'chat.subscribe'),
        ).toHaveLength(1);
        expect(
          frames.some((x) => x.method === 'prMonitor.cancel' || x.method === 'prMonitor.flush'),
        ).toBe(false);
        await expect(
          first.evaluate(() => (window as any).monitorFixture.retainedControl()),
        ).rejects.toThrow();
        await expect
          .poll(() => first.evaluate(() => (window as any).monitorFixture.notices.length))
          .toBe(2);
        expect(await second.evaluate(() => (window as any).monitorFixture.notices)).toEqual([]);
      }
      await first.evaluate(() =>
        (window as any).monitorFixture.request('prMonitor.cancel', { monitorId: 'm' }),
      );
      if (qualified) expectedResets.add(recover ? 2 : 1);
      await app.evaluate(() => (globalThis as any).monitorFixture.stamp(0, 'host-B'));
      await expect(
        first.evaluate(() =>
          (window as any).monitorFixture.request('prMonitor.flush', { monitorId: 'm' }),
        ),
      ).rejects.toThrow();
      await second.evaluate(() =>
        (window as any).monitorFixture.request('prMonitor.flush', { monitorId: 'm', check: true }),
      );
      expect(frames.filter((x) => x.method === 'prMonitor.cancel')).toHaveLength(1);
      expect(frames.filter((x) => x.method === 'prMonitor.flush')).toHaveLength(1);
      expect(frames.filter((x) => x.method === 'client.hello')).toHaveLength(
        recover ? 3 : qualified ? 2 : 1,
      );
      if (qualified) {
        expect(
          frames.find((x) => x.connection === 1 && x.method === 'client.hello')?.params,
        ).toEqual({
          clientId: 'native-monitor-fixture',
          connectionRole: 'review-monitor',
          capabilities: { reviewMonitoring: 1 },
        });
        expect(frames.find((x) => x.method === 'prMonitor.cancel')?.connection).toBe(
          recover ? 2 : 1,
        );
        expect(frames.find((x) => x.method === 'prMonitor.flush')?.connection).toBe(0);
      }
      expect(frames.find((x) => x.method === 'client.hello')?.params).toEqual({
        clientId: 'native-monitor-fixture',
      });
    } finally {
      console.log('Native UDS frames', frames);
      for (const connection of byConnection.keys()) expectedResets.add(connection);
      await app?.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(profile, { recursive: true, force: true });
    }
  });
