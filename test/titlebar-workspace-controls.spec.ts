import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let baseUrl = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    optimizeDeps: { include: ['bits-ui', 'svelte', 'flatstr', 'redux-saga', 'typed-redux-saga'] },
    plugins: [svelte({ configFile: resolve(process.cwd(), 'svelte.config.js') })],
    resolve: {
      alias: [
        { find: '$lib', replacement: resolve(process.cwd(), 'src/lib') },
        { find: '$store', replacement: resolve(process.cwd(), 'src/store') },
        { find: '$features', replacement: resolve(process.cwd(), 'src/features') },
        { find: '$shared', replacement: resolve(process.cwd(), 'src/shared') },
        { find: '$app', replacement: resolve(process.cwd(), 'playwright/app-stubs') },
        {
          find: /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
          replacement: resolve(process.cwd(), 'src/lib/icons/phosphor-icons.ts'),
        },
        {
          find: /^svelte-fa$/,
          replacement: resolve(process.cwd(), 'src/lib/components/shared/icons/fa-proxy.ts'),
        },
      ],
    },
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => server?.close());

async function mountControls(page: Page, theme: 'light' | 'dark', zoom: number) {
  await page.goto(baseUrl + 'test/fixtures/titlebar-controls.html');
  await page.addStyleTag({ url: baseUrl + 'src/app.css' });
  await page.evaluate(
    async ({ theme, zoom }) => {
      Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
      const [{ mount, tick }, { default: Harness }] = await Promise.all([
        import('/@id/svelte'),
        import('/test/fixtures/TitlebarWorkspaceControlsHarness.svelte'),
      ]);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.body.replaceChildren();
      const target = document.createElement('div');
      document.body.append(target);
      const listeners = new Map<string, EventListener>();
      Object.assign(window, {
        electronAPI: {
          invoke: async (channel: string, params: unknown) => {
            if (channel !== 'window:get-zoom-factor' || params !== undefined) {
              throw new Error('Unexpected titlebar IPC request');
            }
            return { success: true, data: zoom };
          },
          on: (channel: string, handler: (payload: unknown) => void) => {
            const listener = (event: Event) => handler((event as CustomEvent).detail);
            listeners.set(channel, listener);
            window.addEventListener(channel, listener);
            return channel;
          },
          offById: (channel: string) => {
            const listener = listeners.get(channel);
            if (listener) window.removeEventListener(channel, listener);
          },
        },
      });
      document.body.style.zoom = String(zoom);
      mount(Harness, { target });
      const { store } = await import('/src/store/renderer/store.ts');
      const { zoomIpcSaga } =
        await import('/src/store/renderer/slices/user-preferences/sagas/zoom-ipc-saga.ts');
      store.runSaga(zoomIpcSaga);
      await tick();
    },
    { theme, zoom },
  );
}

async function emulatePlatform(page: Page, platform: 'macOS' | 'Windows' | 'Linux') {
  await page.addInitScript((platform) => {
    Object.defineProperty(navigator, 'userAgentData', { value: { platform } });
    Object.defineProperty(navigator, 'userAgent', {
      value: platform === 'macOS' ? 'Macintosh' : platform,
    });
  }, platform);
}

// Browser page scaling models Electron zoom; deliver its existing IPC payload
// through the real saga. Native menu delivery is covered by the main IPC suite.
async function changeZoom(page: Page, zoom: number) {
  await page.evaluate((zoom) => {
    document.body.style.zoom = String(zoom);
    window.dispatchEvent(new CustomEvent('window:zoom-changed', { detail: { zoomFactor: zoom } }));
  }, zoom);
}

test('keeps the Mac sidebar hit target clear of traffic lights through live zoom and reset', async ({
  page,
}) => {
  await emulatePlatform(page, 'macOS');
  await mountControls(page, 'dark', 1);
  const toggle = page.locator('[data-titlebar-spaces-control]');
  const wrapper = page.locator('.window-title-bar-wrapper');
  const initialLeft = (await toggle.boundingBox())!.x;
  // Independent safe-area requirement, not derived from the production padding.
  expect(initialLeft).toBeGreaterThanOrEqual(88);
  for (const zoom of [0.8, 0.67, 0.5, 1, 1.25, 2, 1]) {
    await changeZoom(page, zoom);
    await expect.poll(async () => (await toggle.boundingBox())!.x).toBeCloseTo(initialLeft, 0);
    await expect.poll(async () => (await wrapper.boundingBox())!.height).toBeCloseTo(35, 0);
    const box = (await toggle.boundingBox())!;
    expect(box.width).toBeCloseTo(32, 0);
    expect(box.height).toBeCloseTo(32, 0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  }
});

for (const platform of ['Windows', 'Linux'] as const) {
  test(`${platform} retains its existing sidebar placement`, async ({ page }) => {
    await emulatePlatform(page, platform);
    await mountControls(page, 'light', 1);
    const toggle = page.locator('[data-titlebar-spaces-control]');
    for (const zoom of [1, 0.5, 2, 1]) {
      await changeZoom(page, zoom);
      await expect.poll(async () => (await toggle.boundingBox())!.x).toBeCloseTo(28, 0);
    }
  });
}

test('Mac sidebar activation preserves tab alignment, drag regions and narrow-window controls', async ({
  page,
}) => {
  await emulatePlatform(page, 'macOS');
  await page.setViewportSize({ width: 640, height: 480 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mountControls(page, 'light', 0.67);
  const toggle = page.locator('[data-titlebar-spaces-control]');
  const tabs = page.locator('[data-titlebar-workspace-controls]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await tabs.boundingBox())!.x).toBeCloseTo(296, 0);
  await page.evaluate(async () => {
    const { store } = await import('/src/store/renderer/store.ts');
    const { setPanelWidth } =
      await import('/src/store/renderer/slices/sidebar-nav/sidebar-nav-slice.ts');
    store.dispatch(setPanelWidth(320));
  });
  await expect.poll(async () => (await tabs.boundingBox())!.x).toBeCloseTo(328, 0);
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const toggleBox = (await toggle.boundingBox())!;
  await expect.poll(async () => (await tabs.boundingBox())!.x).toBeLessThan(200);

  for (const selector of ['[data-titlebar-left-drag-handle]', '[data-titlebar-drag-handle]']) {
    const drag = page.locator(selector);
    // Fractional zoom can round an 8px drag surface down by a subpixel.
    expect((await drag.boundingBox())!.width).toBeGreaterThan(7.5);
    expect(
      await drag.evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region')),
    ).toBe('drag');
  }
  expect(toggleBox.x).toBeGreaterThanOrEqual(88);
  for (const control of [
    toggle,
    page.locator('[data-workspace-repo-launcher] button'),
    page.locator('[data-titlebar-settings]'),
  ]) {
    const box = (await control.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(640);
    expect(
      await control.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return node.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
    ).toBe(true);
    expect(
      await control.evaluate((node) =>
        getComputedStyle(node).getPropertyValue('-webkit-app-region'),
      ),
    ).toBe('no-drag');
  }
  await page.locator('[data-workspace-repo-launcher] button').click();
  await expect(page).toHaveURL((url) => url.pathname === '/workspace/new');
});

test('mounts accepted control geometry and shortcut tooltips', async ({ page }, testInfo) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const theme of ['light', 'dark'] as const) {
      for (const zoom of [1, 2]) {
        await mountControls(page, theme, zoom);
        const controls = [
          page.locator('[data-titlebar-spaces-control]'),
          page.locator('[data-workspace-repo-launcher] button'),
        ];
        for (const control of controls) {
          // Startup zoom arrives asynchronously over IPC, then selector readables
          // schedule the titlebar's inverse-zoom layout update.
          await expect.poll(async () => (await control.boundingBox())?.width).toBeCloseTo(32, 0);
          const box = await control.boundingBox();
          expect(box?.height).toBeCloseTo(32, 0);
          await expect(control).not.toHaveAttribute('title', /.+/);
        }
        const sidebarControl = controls[0];
        await expect(sidebarControl).toHaveAttribute('aria-label', 'Toggle sidebar');
        await expect(sidebarControl).not.toHaveAttribute('aria-haspopup');
        await expect(sidebarControl).not.toHaveAttribute('aria-expanded');
        await expect(sidebarControl).not.toHaveAttribute('aria-controls');
        const glyphs = [
          page.locator('[data-titlebar-spaces-control] svg'),
          page.locator('[data-workspace-repo-launcher] svg'),
        ];
        for (const glyph of glyphs) {
          const box = await glyph.boundingBox();
          expect(box?.width).toBeCloseTo(16, 0);
          expect(box?.height).toBeCloseTo(16, 0);
          expect(await glyph.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
        }
        await sidebarControl.hover();
        await expect(page.locator('[data-tooltip-label]')).toBeVisible();
        await expect(page.locator('[data-tooltip-label]')).toHaveText('Toggle sidebar');
        await expect(page.locator('[data-tooltip-shortcut]')).toContainText(/(?:⌘|Ctrl\+)O/);
        await expect(page.locator('.sidebar-hover-card')).toHaveCount(0);
        if (reducedMotion === 'no-preference' && zoom === 1) {
          await testInfo.attach(theme + '-titlebar-controls', {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        }
      }
    }
  }
});
