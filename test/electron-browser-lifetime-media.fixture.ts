import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, createServer, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import { closeElectronApp } from './electron-app-close';
import { settleDepsOptimizer, viteHarnessCacheDir } from './vite-harness-cache.mjs';

const workspaceId = 'media-preview';
const filePath = '.intent/artifacts/preview #1%.png';
const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
const assetId = 'saved-preview.png';
type ReadRequest = {
  method: string;
  params: { workspaceId: string; path?: string; asset?: string };
};

test.describe('native Markdown media routes', () => {
  let directory: string;
  let server: ViteDevServer;
  let baseUrl: string;
  let png: Buffer;

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    directory = await mkdtemp(join(tmpdir(), 'intent-markdown-media-'));
    png = await readFile(process.env.MEDIA_PREVIEW_PNG ?? resolve('static/favicon.png'));
    await writeFile(join(directory, 'preview.png'), png);
    const entry = join(directory, 'entry.ts');
    await writeFile(
      entry,
      `export { setupWorkspaceAssetProtocolHandler, setupWorkspaceFileProtocolHandler } from ${JSON.stringify(resolve('src/main/protocol-handlers.ts'))};`,
    );
    await build({
      configFile: false,
      logLevel: 'error',
      plugins: [
        {
          name: 'media-fixture-daemon',
          enforce: 'pre',
          resolveId(id) {
            if (id === '../shared/logger') return '\0media-logger';
            if (id === '../features/backend/main/backend.ipc') return '\0media-backend';
            if (id === '../features/system/main/system.ipc') return '\0media-windows';
            if (id === '../features/backend/main/transfer-connections') return '\0media-transfer';
          },
          load(id) {
            if (id === '\0media-logger')
              return 'export const logger = { info() {}, debug() {}, warn() {}, error() {} };';
            if (id === '\0media-backend')
              return `export const getBackendClient = () => globalThis.mediaBackend;
                export const getBackendClientForConnection = () => globalThis.mediaBackend;
                export const getLiveBackendIds = () => ['local'];`;
            if (id === '\0media-windows')
              return `import { BrowserWindow } from 'electron';
                export const getWindowIdsForWorkspace = () => BrowserWindow.getAllWindows().map(w => w.id);`;
            if (id === '\0media-transfer')
              return 'export const requestRouted = (client, method, params) => client.request(method, params);';
          },
        },
      ],
      resolve: { alias: { $shared: resolve('src/shared') } },
      ssr: { noExternal: true },
      build: {
        ssr: entry,
        outDir: directory,
        emptyOutDir: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'protocols.cjs' },
        },
      },
    });
    await writeFile(
      join(directory, 'main.cjs'),
      `const { app, BrowserWindow, protocol } = require('electron');
      const fs = require('node:fs/promises');
      app.setPath('userData', process.argv[2]);
      protocol.registerSchemesAsPrivileged(['workspace-file', 'workspace-asset'].map(scheme => ({
        scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
      })));
      globalThis.mediaReads = [];
      globalThis.mediaBackend = { async request(method, params) {
        globalThis.mediaReads.push({ method, params });
        if (params.workspaceId !== ${JSON.stringify(workspaceId)}) throw new Error('Unknown workspace');
        const bytes = await fs.readFile(${JSON.stringify(join(directory, 'preview.png'))});
        if (method === 'note.readAsset' && params.asset === ${JSON.stringify(assetId)}) {
          return { assetId: params.asset, mimeType: 'image/png', data: bytes.toString('base64'), sizeKb: Math.ceil(bytes.length / 1024) };
        }
        if (method === 'file.readChunk' && params.path === ${JSON.stringify(filePath)}) {
          const chunk = bytes.subarray(params.offset, params.offset + params.length);
          return { content: chunk.toString('base64'), size: bytes.length, bytesRead: chunk.length };
        }
        throw new Error('Fixture file not found');
      }};
      app.whenReady().then(async () => {
        const protocols = require('./protocols.cjs');
        protocols.setupWorkspaceAssetProtocolHandler();
        protocols.setupWorkspaceFileProtocolHandler();
        const window = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { sandbox: true } });
        await window.loadURL(process.argv[3]);
      });`,
    );
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      cacheDir: viteHarnessCacheDir('native-markdown-media', {
        override: join(directory, 'vite-cache'),
      }),
      optimizeDeps: { entries: ['test/fixtures/browser-lifetime/media.html'] },
      plugins: [svelte({ configFile: resolve('svelte.config.js') })],
      css: { postcss: { plugins: [tailwindcss, autoprefixer] } },
      resolve: {
        alias: [
          ...['lib', 'store', 'features', 'shared'].map((name) => ({
            find: `$${name}`,
            replacement: resolve(`src/${name}`),
          })),
          { find: '$app', replacement: resolve('playwright/app-stubs') },
          {
            find: /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
            replacement: resolve('src/lib/icons/phosphor-icons.ts'),
          },
          {
            find: /^svelte-fa$/,
            replacement: resolve('src/lib/components/shared/icons/fa-proxy.ts'),
          },
        ],
      },
      server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/*'] } },
    });
    await server.listen();
    await settleDepsOptimizer(server);
    baseUrl = server.resolvedUrls!.local[0];
  });

  test.afterAll(async () => {
    try {
      await server?.close();
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });

  const cases = [
    {
      name: 'saved asset',
      source: `workspace-asset://${workspaceId}/${assetId}`,
      method: 'note.readAsset',
    },
    {
      name: 'Intent file link',
      source: `intent://local/file/${encodedPath}`,
      method: 'file.readChunk',
    },
    { name: 'relative file', source: encodedPath, method: 'file.readChunk' },
    {
      name: 'absolute daemon path',
      source:
        '/home/intent/intent/workspaces/cobalt-hawk/trace/.intent/artifacts/staff-waitlist/waitlist-desktop.png',
    },
    { name: 'file URL', source: 'file:///home/intent/preview.png', sanitized: true },
    { name: 'Windows absolute path', source: 'C:/Users/intent/preview.png', sanitized: true },
    { name: 'invalid traversal', source: 'intent://local/file/%2e%2e/preview.png', linkOnly: true },
    { name: 'unsupported SVG', source: 'intent://local/file/preview.svg', linkOnly: true },
    {
      name: 'missing saved asset',
      source: `workspace-asset://${workspaceId}/missing.png`,
      method: 'note.readAsset',
      missing: true,
    },
    {
      name: 'file authority denied',
      source: `intent://local/file/${encodedPath}`,
      allowFileMedia: false,
    },
    {
      name: 'saved asset without file authority',
      source: `workspace-asset://${workspaceId}/${assetId}`,
      method: 'note.readAsset',
      allowFileMedia: false,
    },
  ];

  for (const isStreaming of [false, true]) {
    for (const scenario of cases) {
      test(`${scenario.name} (${isStreaming ? 'streaming' : 'complete'})`, async ({}, testInfo) => {
        const profile = await mkdtemp(join(directory, 'profile-'));
        let app: ElectronApplication | undefined;
        try {
          const env = Object.fromEntries(
            ['PATH', 'TMPDIR', 'DISPLAY', 'XAUTHORITY', 'SYSTEMROOT', 'LD_LIBRARY_PATH'].flatMap(
              (key) => (process.env[key] ? [[key, process.env[key]!]] : []),
            ),
          );
          app = await electron.launch({
            args: [
              join(directory, 'main.cjs'),
              profile,
              `${baseUrl}test/fixtures/browser-lifetime/media.html`,
            ],
            env: {
              ...env,
              NODE_ENV: 'development',
              DEV_PORT: new URL(baseUrl).port,
              DD_TRACE_ENABLED: 'false',
            },
          });
          const page = await app.firstWindow();
          await page.waitForFunction(() => typeof (window as any).renderMedia === 'function');
          await page.evaluate((props) => (window as any).renderMedia(props), {
            content: `![Waitlist admin page](${scenario.source})`,
            workspaceId,
            isStreaming,
            allowFileMedia: scenario.allowFileMedia ?? true,
          });
          const loaded = Boolean(scenario.method && !scenario.missing);
          if (loaded) {
            const size = await app.evaluate(
              ({ nativeImage }, data) =>
                nativeImage.createFromBuffer(Buffer.from(data, 'base64')).getSize(),
              png.toString('base64'),
            );
            await expect(page.locator('.markdown-content img')).toHaveJSProperty(
              'naturalWidth',
              size.width,
            );
            await expect(page.locator('.markdown-content img')).toHaveJSProperty(
              'naturalHeight',
              size.height,
            );
            await expect(page.getByTestId('media-unavailable')).toHaveCount(0);
          } else if (scenario.linkOnly) {
            await expect(page.getByRole('link')).toHaveAttribute('href', scenario.source);
            await expect(page.locator('.markdown-content img')).toHaveCount(0);
          } else if (scenario.sanitized) {
            await expect(page.locator('.markdown-content img')).not.toHaveAttribute('src', /.+/);
          } else {
            await expect(page.getByTestId('media-unavailable')).toBeVisible();
          }
          const reads = (await app.evaluate(() => (globalThis as any).mediaReads)) as ReadRequest[];
          if (scenario.method) {
            expect(reads.length).toBeGreaterThan(0);
            expect(
              reads.every(
                (read) =>
                  read.method === scenario.method && read.params.workspaceId === workspaceId,
              ),
            ).toBe(true);
            if (scenario.method === 'file.readChunk') expect(reads[0].params.path).toBe(filePath);
            else expect(reads[0].params.asset).toBe(scenario.missing ? 'missing.png' : assetId);
          } else {
            expect(reads).toEqual([]);
          }
          await testInfo.attach('media-route.json', {
            body: JSON.stringify(
              {
                ...scenario,
                isStreaming,
                loaded,
                sourceSha256: createHash('sha256').update(png).digest('hex'),
                reads,
              },
              null,
              2,
            ),
            contentType: 'application/json',
          });
          await testInfo.attach('media.png', {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        } finally {
          try {
            if (app) await closeElectronApp(app);
          } finally {
            await rm(profile, { recursive: true, force: true });
          }
        }
      });
    }
  }
});
