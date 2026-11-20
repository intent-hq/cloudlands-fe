/**
 * Browser-panel passkeys in real Electron against a scripted helper
 * (test/fixtures/passkeys/fake-sidecar.cjs). Never launches Intent or a daemon.
 * Writes dialog screenshots (both themes) to .demo-artifacts/passkeys-e2e/.
 */
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import { build, createServer, type ViteDevServer } from 'vite';
import { settleDepsOptimizer, viteHarnessCacheDir } from './vite-harness-cache.mjs';

const fixture = resolve('test/fixtures/passkeys');
const artifacts = resolve('.demo-artifacts/passkeys-e2e');
let server: ViteDevServer;
let guestServer: Server;
let guestUrl: string;
let baseUrl: string;
let bundleDir: string;

interface Launched {
  app: ElectronApplication;
  page: Page;
  profile: string;
  log: string;
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  bundleDir = await mkdtemp(join(tmpdir(), 'intent-passkeys-code-'));
  await mkdir(artifacts, { recursive: true });
  const isolate = {
    name: 'isolate-passkey-logger',
    enforce: 'pre' as const,
    resolveId(id: string) {
      if (id.endsWith('/shared/logger')) return '\0fixture-logger';
    },
    load(id: string) {
      if (id === '\0fixture-logger')
        return 'export class Logger { info() {} debug() {} warn() {} error() {} }';
    },
  };
  const bundle = async (entry: string, fileName: string) =>
    build({
      configFile: false,
      logLevel: 'error',
      plugins: [isolate],
      resolve: { alias: { $shared: resolve('src/shared') } },
      ssr: { noExternal: true },
      build: {
        ssr: entry,
        outDir: bundleDir,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: fileName },
        },
      },
    });
  await bundle(resolve('src/features/passkeys/main/passkeys.ipc.ts'), 'passkeys-main.cjs');
  await bundle(resolve('src/preload/passkey-page.ts'), 'passkey-page.js');
  await chmod(join(fixture, 'fake-sidecar.cjs'), 0o755);

  const swa = readFileSync(
    join(
      createRequire(import.meta.url).resolve('@simplewebauthn/browser'),
      '../../dist/bundle/index.umd.min.js',
    ),
  );
  guestServer = createHttpServer((req, res) => {
    const port = String((guestServer.address() as { port: number }).port);
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/swa.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(swa);
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    const file = req.url?.startsWith('/frame') ? 'frame.html' : 'guest.html';
    res.end(readFileSync(join(fixture, file), 'utf8').replaceAll('__PORT__', port));
  });
  await new Promise<void>((done) => guestServer.listen(0, done));
  const address = guestServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
  guestUrl = `http://localhost:${address.port}/`;

  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: viteHarnessCacheDir('electron-passkeys', {
      override: join(bundleDir, 'vite-cache'),
    }),
    optimizeDeps: {
      entries: ['test/fixtures/passkeys/index.html'],
      include: ['bits-ui', 'svelte', 'flatstr', 'qrcode'],
    },
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
    server: {
      host: '127.0.0.1',
      port: 0,
      watch: { ignored: ['**/*'] },
      fs: {
        allow: await Promise.all([
          realpath(process.cwd()),
          realpath(resolve('node_modules')),
          realpath(resolve('src/shared/paraglide')),
          realpath(bundleDir),
        ]),
      },
    },
  });
  await server.listen();
  await settleDepsOptimizer(server);
  baseUrl = server.resolvedUrls!.local[0];
});

test.afterAll(async () => {
  try {
    await server?.close();
  } finally {
    try {
      if (guestServer) await new Promise<void>((done) => guestServer.close(() => done()));
    } finally {
      if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
    }
  }
});

async function launch(bluetooth: 'on' | 'off' = 'on'): Promise<Launched> {
  const env = Object.fromEntries(
    ['PATH', 'TMPDIR', 'DISPLAY', 'XAUTHORITY'].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]!]] : [],
    ),
  );
  const profile = await mkdtemp(join(tmpdir(), 'intent-passkeys-'));
  const log = join(profile, 'sidecar.jsonl');
  const app = await electron.launch({
    args: [
      join(fixture, 'main.cjs'),
      profile,
      `${baseUrl}test/fixtures/passkeys/index.html?guest=${encodeURIComponent(guestUrl)}`,
      bundleDir,
    ],
    env: {
      ...env,
      DD_TRACE_ENABLED: 'false',
      INTENT_PASSKEY_BIN: join(fixture, 'fake-sidecar.cjs'),
      FAKE_PASSKEY_LOG: log,
      FAKE_PASSKEY_BLUETOOTH: bluetooth,
    },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => console.error('Fixture renderer:', error.message));
  await page.waitForFunction(() => 'passkeyFixture' in window);
  await expect.poll(() => guest(app, 'typeof window.passkeyPage')).toBe('object');
  return { app, page, profile, log };
}

async function close(launched: Launched | undefined) {
  if (!launched) return;
  try {
    await launched.app.close();
  } finally {
    await rm(launched.profile, { recursive: true, force: true });
  }
}

function guest<T = unknown>(app: ElectronApplication, code: string): Promise<T> {
  return app.evaluate(async ({ webContents }, script) => {
    const view = webContents
      .getAllWebContents()
      .find((contents) => contents.getType() === 'webview');
    if (!view) throw new Error('No guest webview');
    return view.executeJavaScript(script);
  }, code) as Promise<T>;
}

type PageResult = {
  state: 'pending' | 'resolved' | 'rejected';
  challenge: string;
  name?: string;
  message?: string;
  value?: Record<string, any>;
};

async function settled(app: ElectronApplication, name: string): Promise<PageResult> {
  let result: PageResult | undefined;
  await expect
    .poll(async () => {
      result = await guest<PageResult>(app, `window.passkeyPage.result(${JSON.stringify(name)})`);
      return result?.state;
    })
    .not.toBe('pending');
  return result!;
}

function sidecarRequests(log: string): Array<{ id: string; method: string; params: any }> {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function shoot(page: Page, name: string) {
  const dialog = page.getByRole('dialog');
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((next) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(next);
    }, theme);
    await dialog.screenshot({
      path: join(artifacts, `${name}--${theme}.png`),
      animations: 'disabled',
    });
  }
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  });
}

test.describe.serial('browser-panel passkeys', () => {
  let launched: Launched | undefined;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    launched = await launch();
  });
  test.afterAll(async () => close(launched));

  test('shims navigator.credentials and reports no platform authenticator', async () => {
    const { app } = launched!;
    expect(await guest(app, 'window.passkeyPage.shimmed()')).toBe(true);
    expect(await guest(app, 'window.passkeyPage.capabilities()')).toMatchObject({
      uvpaa: false,
      conditional: false,
      capabilities: { hybridTransport: true, passkeyPlatformAuthenticator: false },
    });
  });

  test('create round trip through a phone (QR) with @simplewebauthn/browser', async () => {
    const { app, page, log } = launched!;
    await guest(app, `window.passkeyPage.start('create', 'swa-create')`);
    await expect(page.getByRole('dialog')).toContainText('Create a passkey for localhost');
    await shoot(page, '1-choose');
    await page.getByText('Phone or tablet').click();
    await expect(page.getByRole('img', { name: 'QR code to scan with your phone' })).toBeVisible();
    await shoot(page, '2-qr');
    await writeFile(`${log}.proceed`, '');
    const result = await settled(app, 'create');
    expect(result.state).toBe('resolved');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const value = result.value!;
    const clientDataJSON = Buffer.from(value.response.clientDataJSON, 'base64url');
    expect(JSON.parse(clientDataJSON.toString())).toEqual({
      type: 'webauthn.create',
      challenge: result.challenge,
      origin: guestUrl.slice(0, -1),
      crossOrigin: false,
    });
    expect(value).toMatchObject({
      id: Buffer.from('cred-hybrid').toString('base64url'),
      type: 'public-key',
      authenticatorAttachment: 'cross-platform',
      clientExtensionResults: { credProps: { rk: true } },
      response: { transports: ['hybrid', 'internal'], publicKeyAlgorithm: -7 },
    });
    expect(value.response.publicKey).toBeTruthy();
    expect(value.response.authenticatorData).toBeTruthy();

    const create = sidecarRequests(log).find((request) => request.method === 'create')!;
    expect(create.params).toMatchObject({
      transport: 'hybrid',
      origin: guestUrl.slice(0, -1),
      crossOrigin: false,
      rpId: 'localhost',
      challenge: result.challenge,
      rp: { id: 'localhost', name: 'Fixture' },
      extensions: { credProps: true },
    });
    expect(create.params).not.toHaveProperty('topOrigin');
  });

  test('get through a security key with PIN retry and account chooser', async () => {
    const { app, page, log } = launched!;
    await guest(app, `window.passkeyPage.start('get', 'get')`);
    await expect(page.getByRole('dialog')).toContainText('Use a passkey for localhost');
    await page.getByText('Security key').click();
    const pin = page.getByLabel('Security key PIN');
    await expect(pin).toBeVisible();
    await shoot(page, '3-pin');
    await pin.fill('0000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('dialog')).toContainText('Wrong PIN. 3 tries left.');
    await shoot(page, '4-pin-wrong');
    await page.getByLabel('Security key PIN').fill('1234');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Grace Hopper')).toBeVisible();
    await shoot(page, '5-accounts');
    await page.getByText('Grace Hopper').click();

    const result = await settled(app, 'get');
    expect(result.state).toBe('resolved');
    expect(result.value).toMatchObject({
      isPublicKeyCredential: true,
      isAssertion: true,
      id: Buffer.from('cred-usb').toString('base64url'),
      userHandle: Buffer.from('user-1').toString('base64url'),
      clientData: { type: 'webauthn.get', challenge: result.challenge, crossOrigin: false },
      json: {
        type: 'public-key',
        response: { userHandle: Buffer.from('user-1').toString('base64url') },
      },
    });
    const requests = sidecarRequests(log);
    expect(requests.filter((request) => request.method === 'pin').map((r) => r.params.pin)).toEqual(
      ['0000', '1234'],
    );
    expect(requests.find((request) => request.method === 'choose')?.params.index).toBe(1);
  });

  test('rejects an RP ID the origin does not own without asking the helper', async () => {
    const { app, page, log } = launched!;
    const before = sidecarRequests(log).length;
    await guest(app, `window.passkeyPage.start('spoof', 'create', { rpId: 'example.com' })`);
    const result = await settled(app, 'spoof');
    expect(result).toMatchObject({ state: 'rejected', name: 'SecurityError' });
    expect(sidecarRequests(log).slice(before)).toEqual([]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('page abort cancels the helper ceremony and closes the dialog', async () => {
    const { app, page, log } = launched!;
    await guest(app, `window.passkeyPage.start('abort', 'get')`);
    await page.getByText('Phone or tablet').click();
    await expect(page.getByRole('img', { name: 'QR code to scan with your phone' })).toBeVisible();
    await guest(app, 'window.passkeyPage.abort()');
    const result = await settled(app, 'abort');
    expect(result).toMatchObject({ state: 'rejected', name: 'AbortError' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const requests = sidecarRequests(log);
    const ceremony = requests.filter((request) => request.method === 'get').at(-1)!;
    await expect
      .poll(() =>
        sidecarRequests(log).some(
          (r) => r.method === 'cancel' && r.params.ceremony === ceremony.id,
        ),
      )
      .toBe(true);
  });

  test('rejects a cross-origin iframe', async () => {
    const { app, page, log } = launched!;
    const before = sidecarRequests(log).length;
    await expect
      .poll(() => guest(app, `window.passkeyPage.result('frameProbe')`))
      .toEqual({ shimmed: true });
    await guest(app, 'window.passkeyPage.frameGet()');
    const result = await settled(app, 'frame');
    expect(result).toMatchObject({ state: 'rejected', name: 'NotAllowedError', shimmed: true });
    expect(sidecarRequests(log).slice(before)).toEqual([]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('rejects helper client data that names another origin', async () => {
    const { app, page, log } = launched!;
    await writeFile(`${log}.tamper`, '');
    try {
      await guest(app, `window.passkeyPage.start('tampered', 'create')`);
      await page.getByText('Security key').click();
      await page.getByLabel('Security key PIN').fill('1234');
      await page.getByRole('button', { name: 'Continue' }).click();
      expect(await settled(app, 'tampered')).toMatchObject({
        state: 'rejected',
        name: 'NotAllowedError',
      });
      await expect(page.getByRole('dialog')).toContainText('The request did not finish');
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {
      await rm(`${log}.tamper`, { force: true });
    }
  });

  test('a locked security key shows why and rejects the page', async () => {
    const { app, page } = launched!;
    await guest(app, `window.passkeyPage.start('locked', 'create')`);
    await page.getByText('Security key').click();
    await page.getByLabel('Security key PIN').fill('9999');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('dialog')).toContainText('locked after too many wrong PINs');
    await shoot(page, '6-error-pin-locked');
    expect(await settled(app, 'locked')).toMatchObject({
      state: 'rejected',
      name: 'NotAllowedError',
    });
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe.serial('browser-panel passkeys without Bluetooth', () => {
  let launched: Launched | undefined;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    launched = await launch('off');
  });
  test.afterAll(async () => close(launched));

  test('phone choice explains that Bluetooth is off and never shows a QR', async () => {
    const { app, page, log } = launched!;
    await guest(app, `window.passkeyPage.start('bt', 'get')`);
    await expect(page.getByRole('dialog')).toContainText('Bluetooth is off');
    await shoot(page, '7-choose-bluetooth-off');
    await page.getByText('Phone or tablet').click();
    await expect(page.getByRole('dialog')).toContainText('Turn it on to use a phone');
    await expect(page.getByRole('img', { name: 'QR code to scan with your phone' })).toHaveCount(0);
    await shoot(page, '8-error-bluetooth-off');
    expect(await settled(app, 'bt')).toMatchObject({ state: 'rejected', name: 'NotAllowedError' });
    expect(sidecarRequests(log).map((request) => request.method)).toEqual(['hello']);
  });
});
