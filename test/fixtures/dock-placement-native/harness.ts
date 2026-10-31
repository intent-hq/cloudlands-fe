import { _electron, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import { build, createServer, type ViteDevServer } from 'vite';

const runFile = promisify(execFile);
const fixture = resolve('test/fixtures/dock-placement-native');
let codeRoot: string;
let server: ViteDevServer;

export async function prepare() {
  if (process.platform === 'darwin')
    await runFile(process.execPath, [resolve('scripts/build-dock-helper.cjs')]);
  codeRoot = await mkdtemp(join(tmpdir(), 'intent-placement-code-'));
  await mkdir(join(codeRoot, 'main'), { recursive: true });
  await mkdir(join(codeRoot, 'preload'));
  const entry = join(codeRoot, 'entry.ts');
  await writeFile(
    entry,
    [
      `export * from ${JSON.stringify(resolve('src/main/dock-window.ts'))};`,
      `export * from ${JSON.stringify(resolve('src/main/dock-cursor.ts'))};`,
      `export * from ${JSON.stringify(resolve('src/main/dock-placement-ipc.ts'))};`,
      `export * from ${JSON.stringify(resolve('src/main/dock-menu-controller.ts'))};`,
      `export * from ${JSON.stringify(resolve('src/features/hud/main/dock-evidence-session.ts'))};`,
      `export * from ${JSON.stringify(resolve('src/main/local-prefs.ts'))};`,
      `export * from ${JSON.stringify(resolve('src/main/dock-lab.ts'))};`,
    ].join('\n'),
  );
  await build({
    configFile: false,
    logLevel: 'error',
    plugins: [
      {
        name: 'isolate-companion-external-backend',
        enforce: 'pre',
        resolveId(id) {
          if (id.endsWith('/connections-store')) return '\0placement-backend';
          if (id.endsWith('/backend.ipc')) return '\0placement-daemon';
        },
        load(id) {
          if (id === '\0placement-backend')
            return 'export async function getActiveId() { return "placement-synthetic-backend"; }\nexport async function list() { return []; }';
          if (id === '\0placement-daemon')
            return `
            export function getBackendClient() { throw new Error('No daemon in placement fixture'); }
            export const getBackendClientForId = getBackendClient;
            export const getBackendClientForConnection = getBackendClient;
            export const getLocalBackendClient = getBackendClient;
            export function getBackendIdForIpcSender() { return 'placement-synthetic-backend'; }
            export function onBackendReconnected() { return () => {}; }
          `;
        },
      },
    ],
    resolve: { alias: { $shared: resolve('src/shared') } },
    ssr: { noExternal: true },
    build: {
      ssr: entry,
      outDir: join(codeRoot, 'main'),
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['electron'],
        output: { format: 'es', entryFileNames: 'native.mjs' },
      },
    },
  });
  // The coordinator regenerates this source from the registry before the run.
  // Preserve the production allowlist/contextBridge instead of adding a fixture preload.
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: resolve('src/preload/index.ts'),
      outDir: join(codeRoot, 'preload'),
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: 'index.js' },
      },
    },
  });
  // The dock window constructor keeps its production relative preload path
  // (main/../preload/index.js), entirely inside the isolated code root.
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: join(codeRoot, 'vite-cache'),
    define: {
      'process.env': JSON.stringify({
        NODE_ENV: 'development',
        IS_ELECTRON: true,
        INTENT_BUILD_TARGET: 'electron',
      }),
      __APP_VERSION__: JSON.stringify('placement-fixture'),
      __DEV_GIT_BRANCH__: JSON.stringify('placement-fixture'),
    },
    optimizeDeps: {
      entries: [join(fixture, 'index.html')],
      include: ['bits-ui', 'svelte', 'flatstr', 'redux-saga', 'typed-redux-saga'],
    },
    plugins: [
      {
        name: 'native-companion-fixture-routes',
        configureServer(vite) {
          vite.middlewares.use((req, _res, next) => {
            if ((req.url || '').split('?')[0] === '/dock') {
              req.url = '/test/fixtures/dock-placement-native/index.html';
            }
            next();
          });
        },
      },
      svelte({ configFile: resolve('svelte.config.js') }),
    ],
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
    server: {
      host: '127.0.0.1',
      port: 0,
      watch: { ignored: ['**/*'] },
      fs: {
        allow: await Promise.all([
          realpath(process.cwd()),
          realpath(resolve('node_modules')),
          realpath(resolve('src/shared/paraglide')),
          realpath(codeRoot),
        ]),
      },
    },
  });
  await server.listen();
}

export async function cleanup() {
  try {
    await server?.close();
  } finally {
    if (codeRoot) await rm(codeRoot, { recursive: true, force: true });
  }
}

export async function launch(
  testInfo: TestInfo,
  profile?: string,
  geometry: 'unknown' | 'none' | 'notch' = 'unknown',
  appLayout: 'root' | 'dist-main' = 'root',
) {
  nativePointerInputs.length = 0;
  profile ??= await mkdtemp(join(tmpdir(), 'intent-placement-profile-'));
  if (process.platform === 'darwin') {
    const resources = join(profile, 'resources/dock-helper');
    await mkdir(resources, { recursive: true });
    await copyFile(
      resolve('resources/dock-helper/intent-dock-cursor.node'),
      join(resources, 'intent-dock-cursor.node'),
    );
  }
  const env = Object.fromEntries(
    ['PATH', 'TMPDIR', 'DISPLAY', 'XAUTHORITY', 'SYSTEMROOT'].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]!]] : [],
    ),
  );
  const app = await _electron.launch({
    args: [
      join(fixture, 'main.cjs'),
      profile,
      server.resolvedUrls!.local[0],
      join(codeRoot, 'main/native.mjs'),
      geometry,
      appLayout,
    ],
    env: { ...env, DD_TRACE_ENABLED: 'false' },
    recordVideo: { dir: testInfo.outputPath('video'), size: { width: 1280, height: 800 } },
  });
  const startupOutput: string[] = [];
  for (const stream of [app.process().stdout, app.process().stderr]) {
    stream?.on('data', (chunk) => {
      startupOutput.push(String(chunk));
      if (startupOutput.length > 100) startupOutput.shift();
    });
  }
  let page: Page | undefined;
  try {
    await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = app.windows().find((p) => p.url().endsWith('/dock')) ?? (await app.firstWindow());
    page.on('pageerror', (error) => console.error('Native fixture renderer:', error.stack));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error('Native fixture console:', message.text());
    });
    await page.waitForURL('**/dock');
    await page.waitForSelector('[data-testid="companion-native-fixture"]', {
      state: 'attached',
      timeout: 60_000,
    });
    await page.waitForSelector('[data-testid="dock-surface"]');
  } catch (error) {
    await writeFile(testInfo.outputPath('native-startup.log'), startupOutput.join(''));
    console.error('Native fixture startup:', startupOutput.join('').slice(-12000));
    await page?.screenshot({ path: testInfo.outputPath('mount-failure.png') }).catch(() => {});
    console.error(
      'Native fixture mount diagnostic:',
      await page
        ?.evaluate(() => ({
          body: document.body.innerText.slice(0, 5000),
          html: document.body.innerHTML.slice(0, 2000),
        }))
        .catch(() => 'document unavailable'),
    );
    await app.close().catch(() => {});
    throw error;
  }
  return { app, page, profile };
}

let pointerBuilt = false;
export const nativePointerInputs: Array<{ command: string; point?: { x: number; y: number } }> = [];
export async function nativePointer(
  command: 'move' | 'down' | 'drag' | 'up' | 'escape',
  point?: { x: number; y: number },
) {
  if (process.platform !== 'darwin')
    throw new Error('Native desktop pointer proof requires the macOS fixture lane.');
  const binary = join(codeRoot, 'placement-pointer');
  if (!pointerBuilt) {
    await runFile('xcrun', ['swiftc', join(fixture, 'pointer.swift'), '-o', binary], {
      timeout: 60_000,
    });
    pointerBuilt = true;
  }
  await runFile(binary, [command, ...(point ? [String(point.x), String(point.y)] : [])], {
    timeout: 10_000,
  });
  nativePointerInputs.push({ command, point });
}

export async function sourceEvidence(paths: string[]) {
  return Promise.all(
    paths.map(async (path) => ({
      path,
      sha256: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    })),
  );
}

export async function finish(
  app: ElectronApplication,
  page: Page,
  testInfo: TestInfo,
  evidence: unknown,
) {
  if (app.process().exitCode !== null) return;
  try {
    const json = testInfo.outputPath('placement-evidence.json');
    await writeFile(json, JSON.stringify(evidence, null, 2));
    await testInfo.attach('Ordered companion placement evidence', {
      path: json,
      contentType: 'application/json',
    });
    if (!page.isClosed())
      await page.screenshot({ path: testInfo.outputPath('final.png'), animations: 'disabled' });
    await app.context().tracing.stop({ path: testInfo.outputPath('trace.zip') });
  } finally {
    await app.close();
  }
  const video = page.video();
  if (video)
    await testInfo.attach('Companion interaction video', {
      path: await video.path(),
      contentType: 'video/webm',
    });
}
