import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let baseUrl: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const chiefStub = resolve(process.cwd(), 'test/fixtures/SidebarShellChiefStub.svelte');
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    plugins: [
      {
        name: 'sidebar-shell-test-stubs',
        enforce: 'pre',
        resolveId(id) {
          return id.endsWith('/cards/ChiefCard.svelte') ? chiefStub : null;
        },
      },
      svelte({ configFile: resolve(process.cwd(), 'svelte.config.js') }),
    ],
    optimizeDeps: { entries: [] },
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
});

test.afterAll(async () => server?.close());

async function mountShell(
  page: Page,
  props: { theme: 'light' | 'dark'; width: number; zoom: number },
) {
  await page.goto(`${baseUrl}src/app.html`);
  await page.evaluate(() => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(async () => {
        await import('/test/fixtures/SidebarShellBackgroundHost.svelte');
      });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForLoadState('domcontentloaded');
      await page.evaluate(() => {
        Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
      });
    }
  }
  await page.addStyleTag({ url: `${baseUrl}src/app.css` });
  await page.addStyleTag({ content: 'body { margin: 0; }' });
  return page.evaluate(async (options) => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    document.documentElement.classList.toggle('dark', options.theme === 'dark');
    const firstPaints: string[] = [];
    const observer = new MutationObserver(() => {
      const shell = document.querySelector<HTMLElement>('.sidebar-panel');
      if (shell) firstPaints.push(getComputedStyle(shell).backgroundColor);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const [{ mount, tick }, { default: Host }] = await Promise.all([
      import('/@id/svelte'),
      import('/test/fixtures/SidebarShellBackgroundHost.svelte'),
    ]);
    document.body.replaceChildren();
    const target = document.createElement('div');
    document.body.append(target);
    mount(Host, { target, props: options });
    await tick();
    await new Promise((resolveFrame) => setTimeout(resolveFrame, 250));
    observer.disconnect();
    return firstPaints[0] ?? null;
  }, props);
}

const background = (page: Page, selector: string) =>
  page.locator(selector).evaluate((node) => getComputedStyle(node).backgroundColor);

test('keeps outer shells transparent in both themes without flattening contained states', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 1200 });
  for (const scenario of [
    { theme: 'dark' as const, width: 320, zoom: 1 },
    { theme: 'dark' as const, width: 720, zoom: 2 },
    { theme: 'light' as const, width: 720, zoom: 1 },
  ]) {
    const firstPaint = await mountShell(page, scenario);
    const shell = page.locator('.sidebar-panel');
    const host = page.locator('[data-sidebar-shell-host]');
    const probe = await page.evaluate(() => {
      const element = document.createElement('div');
      element.className = 'bg-sidebar';
      document.body.append(element);
      const color = getComputedStyle(element).backgroundColor;
      element.remove();
      return color;
    });
    const expected = 'rgba(0, 0, 0, 0)';
    expect(firstPaint).toBe(expected);
    expect(await background(page, '.sidebar-panel')).toBe(expected);
    expect(await background(page, '[data-sidebar-panel]')).toBe('rgba(0, 0, 0, 0)');
    expect(await background(page, '[data-chief-card-surface]')).toBe(probe);
    await expect(page.locator('[data-workspace-status="needs_attention"]')).toHaveCount(1);
    await expect(page.locator('[data-workspace-status="in_progress"]')).toHaveCount(1);
    await expect(page.locator('[data-workspace-status="unread"]')).toHaveCount(1);
    await expect(page.locator('[data-workspace-status="idle"]')).toHaveCount(1);
    await expect(page.locator('[data-workspace-status="not_started"]')).toHaveCount(1);
    const question = page.locator('[data-workspace-status="needs_attention"]');
    await expect(question).toHaveAttribute('data-workspace-status-icon', 'circle-question');
    await expect(question.locator('[data-workspace-status-dot]')).toHaveCount(0);

    const dotPresentation = await page.evaluate(() => {
      const styleFor = (status: string) => {
        const indicator = document.querySelector<HTMLElement>(
          `[data-workspace-status="${status}"]`,
        );
        const dot = indicator?.querySelector<HTMLElement>('[data-workspace-status-dot]');
        if (!indicator || !dot) throw new Error(`Missing ${status} dot`);
        const style = getComputedStyle(dot);
        const indicatorRect = indicator.getBoundingClientRect();
        const dotRect = dot.getBoundingClientRect();
        return {
          fill: style.backgroundColor,
          borderWidth: style.borderWidth,
          outlineStyle: style.outlineStyle,
          boxShadow: style.boxShadow,
          width: dotRect.width,
          height: dotRect.height,
          contained:
            dotRect.top >= indicatorRect.top &&
            dotRect.right <= indicatorRect.right &&
            dotRect.bottom <= indicatorRect.bottom &&
            dotRect.left >= indicatorRect.left,
        };
      };
      const tokenColor = (token: string) => {
        const probe = document.createElement('span');
        probe.style.color = `hsl(var(${token}))`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      return {
        activeToken: tokenColor('--agent-avatar-surface-active'),
        unreadToken: tokenColor('--workspace-status-unread'),
        working: styleFor('in_progress'),
        unread: styleFor('unread'),
        idle: styleFor('idle'),
        notStarted: styleFor('not_started'),
      };
    });
    expect(dotPresentation.working.fill).toBe(dotPresentation.activeToken);
    expect(dotPresentation.unread.fill).toBe(dotPresentation.unreadToken);
    expect(dotPresentation.notStarted.fill).toBe(dotPresentation.idle.fill);
    const unreadChannels = dotPresentation.unread.fill
      .match(/[0-9.]+/g)
      ?.slice(0, 3)
      .map(Number);
    expect(unreadChannels?.[2] ?? 0).toBeGreaterThan((unreadChannels?.[0] ?? 0) + 100);
    for (const dot of [
      dotPresentation.working,
      dotPresentation.unread,
      dotPresentation.idle,
      dotPresentation.notStarted,
    ]) {
      expect(dot).toMatchObject({
        borderWidth: '0px',
        outlineStyle: 'none',
        boxShadow: 'none',
        contained: true,
      });
      expect(dot.width).toBeGreaterThan(0);
      expect(dot.width).toBe(dot.height);
    }
    const scrollBox = await page.locator('[data-workspace-list-scroll]').boundingBox();
    const firstRowBox = await page.locator('[data-workspace-card-row]').first().boundingBox();
    expect((firstRowBox?.y ?? 0) - (scrollBox?.y ?? 0)).toBeGreaterThanOrEqual(4 * scenario.zoom);
    const shellBox = await shell.boundingBox();
    const hostBox = await host.boundingBox();
    expect(shellBox?.width).toBeCloseTo(288 * scenario.zoom, 0);
    expect(shellBox?.height).toBeCloseTo(hostBox?.height ?? 0, 0);

    if (scenario.theme === 'dark') {
      const listbox = page.getByRole('listbox');
      const rows = page.locator('[data-workspace-card-row]');
      await expect(rows).toHaveCount(5);
      await rows.first().hover();
      expect(
        await rows.first().evaluate((node) => getComputedStyle(node).backgroundColor),
      ).not.toBe(expected);
      await listbox.focus();
      await listbox.press('ArrowDown');
      expect(await rows.nth(1).evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
        expected,
      );
      expect(await background(page, '[data-combined-panel-divider-border]')).not.toBe(expected);
      expect(await background(page, '.sidebar-panel')).toBe(expected);
    }

    await testInfo.attach(`${scenario.theme}-${scenario.width}-${scenario.zoom}x-sidebar-shell`, {
      body: await page.screenshot({ animations: 'disabled', caret: 'hide' }),
      contentType: 'image/png',
    });
  }
});

test('switches every canonical panel shell without a fill frame', async ({ page }) => {
  await mountShell(page, { theme: 'dark', width: 720, zoom: 1 });
  for (const item of ['active', 'settings', 'all-workspaces'] as const) {
    await page.evaluate(async (panelItem) => {
      const [{ store }, { openPanel }] = await Promise.all([
        import('/src/store/renderer/store.ts'),
        import('/src/store/renderer/slices/sidebar-nav/sidebar-nav-slice.ts'),
      ]);
      store.dispatch(openPanel(panelItem));
    }, item);
    await expect(page.locator('[data-panel-item]')).toHaveAttribute('data-panel-item', item);
    expect(await background(page, '.sidebar-panel')).toBe('rgba(0, 0, 0, 0)');
  }

  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  expect(await background(page, '.sidebar-panel')).toBe('rgba(0, 0, 0, 0)');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  expect(await background(page, '.sidebar-panel')).toBe('rgba(0, 0, 0, 0)');
});
