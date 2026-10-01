/** Production capture service against real Electron CDP; no Intent app or daemon. */
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'vite';

test('captures failures from the first document script, retrieves artifacts and removes instrumentation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'intent-browser-capture-'));
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/failure')) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('fixture module response token=private-value');
    } else if (req.url?.startsWith('/closed')) {
      req.socket.destroy();
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><title>capture fixture</title>
        <script>throw new Error('fixture early throw')</script>
        <script>Promise.reject(new Error('fixture early rejection')); fetch('/closed').catch(() => {}); fetch('/failure-fetch?token=private-value').then(r => r.text());</script>
        <script type="module">import '/failure?token=private-value';</script>`);
    }
  });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const url = `http://127.0.0.1:${address.port}/`;
    const entry = join(root, 'entry.ts');
    await writeFile(
      entry,
      `export { browserCapture } from ${JSON.stringify(resolve('src/features/browser/main/browser-capture-service.ts'))};`,
    );
    await build({
      configFile: false,
      logLevel: 'error',
      plugins: [
        {
          name: 'capture-fixture-transport',
          enforce: 'pre',
          resolveId(id) {
            if (id === './embedded-browser-cdp-service') return '\0capture-cdp';
            if (id === '../../backend/main/connections-store') return '\0capture-backend';
            if (id === '../../../shared/logger') return '\0capture-logger';
          },
          load(id) {
            if (id === '\0capture-backend')
              return 'export async function getActiveId() { return "local"; }';
            if (id === '\0capture-logger')
              return 'export class Logger { info() {} debug() {} warn() {} error() {} }';
            if (id === '\0capture-cdp')
              return `
            const wc = () => globalThis.captureFixtureWindow.webContents;
            export const embeddedBrowserCdp = {
              listAllTabs: async () => ({ tabs: [{ tabId: 'fixture', webContentsId: wc().id, mounted: true, url: wc().getURL(), title: wc().getTitle() }] }),
              ensureAttached: async () => { if (!wc().debugger.isAttached()) wc().debugger.attach('1.3'); },
              sendCdpCommand: async (_id, method, params) => wc().debugger.sendCommand(method, params),
              onCdpMessage: (_id, callback) => { const listener = (_event, method, params) => callback(method, params); wc().debugger.on('message', listener); return () => wc().debugger.off('message', listener); },
            };`;
          },
        },
      ],
      build: {
        ssr: entry,
        outDir: root,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'capture.cjs' },
        },
      },
    });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('DD_') && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key),
      ),
    );
    app = await electron.launch({
      args: [
        resolve('test/fixtures/browser-capture/main.cjs'),
        join(root, 'profile'),
        join(root, 'capture.cjs'),
      ],
      env: { ...env, DD_TRACE_ENABLED: 'false' },
    });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).captureFixture)).toBe(true);
    const session = await app.evaluate(async () => {
      const service = (globalThis as any).captureFixture;
      const session = await service.startSession({
        workspaceId: 'fixture',
        ownerAgentId: 'fixture-agent',
      });
      await service.startCapture(session.id, 'fixture');
      return { id: session.id, captureId: session.captureId };
    });
    await app.evaluate(async (_, url) => {
      await (globalThis as any).captureFixtureWindow.loadURL(url);
    }, url);
    await expect
      .poll(() =>
        app!.evaluate((_, id) => {
          const session = (globalThis as any).captureFixture.getSession(id, 'fixture');
          return {
            sources: session.consoleBuffer.map((m: any) => m.source).filter(Boolean),
            bodies: session.networkBuffer.filter((r: any) => r.body).map((r: any) => r.body),
            transport: session.networkBuffer.some((r: any) => r.failureReason),
          };
        }, session.id),
      )
      .toMatchObject({
        sources: expect.arrayContaining(['window.error', 'unhandledrejection', 'exception']),
        bodies: expect.arrayContaining([expect.stringContaining('fixture module response')]),
        transport: true,
      });
    const result = await app.evaluate(async (_, session) => {
      const service = (globalThis as any).captureFixture;
      const wc = (globalThis as any).captureFixtureWindow.webContents;
      await service.endSession(session.id, 'fixture');
      const consoleFile = await service.readCapture(
        'fixture',
        session.captureId,
        'console.jsonl',
        'fixture-agent',
      );
      const networkFile = await service.readCapture(
        'fixture',
        session.captureId,
        'network.jsonl',
        'fixture-agent',
      );
      const consoleText = Buffer.from(consoleFile.data, 'base64').toString();
      const networkText = Buffer.from(networkFile.data, 'base64').toString();
      await wc.loadURL(wc.getURL());
      const bindings = await wc.executeJavaScript(
        'Object.keys(globalThis).filter(k => k.startsWith("__intentCapture_") && k.endsWith("_cleanup"))',
      );
      return {
        consoleText,
        networkText,
        bindings,
        listeners: wc.debugger.listenerCount('message'),
      };
    }, session);
    await test.info().attach('capture-diagnostics.json', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
    expect(result.consoleText).toContain('fixture early throw');
    expect(result.consoleText).toContain('fixture early rejection');
    expect(result.networkText).toContain('fixture module response');
    expect(result.networkText).toContain('initiator');
    expect(result.consoleText + result.networkText).not.toContain('private-value');
    expect(result.bindings).toEqual([]);
    expect(result.listeners).toBe(0);
  } finally {
    await app?.close();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
