/** Author feedback against the real production sandbox in an isolated Electron window. */
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { seasonsDemo } from './fixtures/inline-html-seasons-demo';

test('HTML author previews fit, report errors, isolate capabilities, and clean up after timeouts', async () => {
  test.setTimeout(60_000);
  const root = await mkdtemp(join(tmpdir(), 'intent-html-preview-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let requests = 0;
  const server = createServer((_, response) => {
    requests += 1;
    response.end('must never reach this server');
  });
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const entry = join(root, 'entry.ts');
    await writeFile(
      entry,
      `export { previewInlineHtml } from ${JSON.stringify(resolve('src/features/browser/main/inline-html-preview-service.ts'))};
       export { isOffscreenWindow } from ${JSON.stringify(resolve('src/main/offscreen-window.ts'))};`,
    );
    await build({
      configFile: false,
      logLevel: 'error',
      build: {
        ssr: entry,
        outDir: root,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'preview.cjs' },
        },
      },
    });
    await writeFile(
      join(root, 'main.cjs'),
      `
      const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(root, 'profile'))});
      app.whenReady().then(async () => {
        const bundle = require(${JSON.stringify(join(root, 'preview.cjs'))});
        globalThis.appWindowIds = [];
        app.on('browser-window-created', (_event, window) => {
          if (bundle.isOffscreenWindow(window)) return;
          globalThis.appWindowIds.push(window.id);
        });
        globalThis.fixtureWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
        await globalThis.fixtureWindow.loadURL('about:blank');
        globalThis.preview = bundle.previewInlineHtml;
      });
    `,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('DD_') && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key),
      ),
    );
    app = await electron.launch({
      args: [join(root, 'main.cjs')],
      env: { ...env, DD_TRACE_ENABLED: 'false' },
    });
    await expect
      .poll(() => app!.evaluate(() => typeof (globalThis as any).preview))
      .toBe('function');
    const html = `<!doctype html><style>main { height: 1250px; position: relative; } svg { height: 100px; }
      footer { position: absolute; bottom: 0; width: 100%; height: 32px; background: #ff00ff; }</style>
      <main><h2>Author preview</h2><svg viewBox="0 0 100 40"><circle cx="50" cy="20" r="18" fill="var(--chart-1)" /></svg>
      <output id="capabilities"></output><footer></footer></main>
      <script>
        document.querySelector('#capabilities').textContent = [typeof require, typeof process, typeof intent].join(',');
        console.log('capabilities:' + document.querySelector('#capabilities').textContent);
        fetch('http://127.0.0.1:${address.port}/private').catch(() => {});
        throw new Error('author fixture early error');
      </script>`;
    for (const appearance of ['light', 'dark'] as const) {
      const result = await app.evaluate(
        async ({ nativeImage }, args) => {
          const result = await (globalThis as any).preview(args);
          const image = nativeImage.createFromBuffer(Buffer.from(result.base64, 'base64'));
          const bitmapSize = image.getSize();
          const pixels = image.toBitmap();
          let bottomMarkerPixels = 0;
          for (let y = Math.floor(bitmapSize.height * 0.75); y < bitmapSize.height; y += 1) {
            for (let x = 0; x < bitmapSize.width; x += 1) {
              const offset = (y * bitmapSize.width + x) * 4;
              if (pixels[offset] === 255 && pixels[offset + 1] === 0 && pixels[offset + 2] === 255)
                bottomMarkerPixels += 1;
            }
          }
          return { ...result, bitmapSize, bottomMarkerPixels };
        },
        { html, width: 390, appearance },
      );
      expect(result.width).toBe(390);
      expect(result.contentHeight).toBeGreaterThan(1200);
      expect(result.height).toBeGreaterThan(1200);
      expect(result.truncated).toBe(false);
      expect(result.bitmapSize).toEqual({ width: result.width, height: result.height });
      expect(result.bottomMarkerPixels).toBeGreaterThan(1000);
      expect(
        result.consoleMessages.some((item: any) =>
          item.message.includes('author fixture early error'),
        ),
      ).toBe(true);
      expect(
        result.consoleMessages.some((item: any) =>
          item.message.includes('capabilities:undefined,undefined,undefined'),
        ),
      ).toBe(true);
      const png = Buffer.from(result.base64, 'base64');
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      await test
        .info()
        .attach(`author-preview-${appearance}.png`, { body: png, contentType: 'image/png' });
      const windows = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()),
      );
      expect(windows).toEqual(['about:blank']);
    }
    expect(requests).toBe(0);
    const seasons = await app.evaluate(
      async (_, html) => (globalThis as any).preview({ html, width: 800, appearance: 'dark' }),
      seasonsDemo,
    );
    expect(seasons.consoleMessages.filter((item: any) => item.level === 'error')).toEqual([]);
    const seasonsPng = Buffer.from(seasons.base64, 'base64');
    await test
      .info()
      .attach('native-seasons-dark.png', { body: seasonsPng, contentType: 'image/png' });
    const artifacts = resolve('../../.intent/artifacts/inline-html/t3-improvements');
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, 'native-seasons-dark.png'), seasonsPng);
    const timeout = await app.evaluate(async () => {
      try {
        await (globalThis as any).preview(
          { html: '<script>while (true) {}</script>', width: 390 },
          Date.now() + 1500,
        );
        return 'unexpected success';
      } catch (error) {
        return String(error);
      }
    });
    expect(timeout).toContain('timed out');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect(await app.evaluate(() => (globalThis as any).appWindowIds.length)).toBe(1);
    const rejected = await app.evaluate(async () => {
      try {
        await (globalThis as any).preview({ html: 'a'.repeat(512_001) });
        return false;
      } catch {
        return true;
      }
    });
    expect(rejected).toBe(true);
  } finally {
    await app?.close();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
