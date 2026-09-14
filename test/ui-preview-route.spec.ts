import { expect, test } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to a running pnpm run dev:ui server.');

test('renders fit mode as a component-only document', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(
    `${baseUrl}/sandbox/button?state=loading&fit=component&theme=dark&width=420&motion=reduced`,
  );

  const scene = page.getByTestId('catalog-scene');
  const focus = page.getByTestId('catalog-scene-focus');
  await expect(scene).toHaveAttribute('data-preview-ready', 'true', { timeout: 90_000 });
  await expect(scene).toHaveAttribute('data-preview-fit', 'component');
  await expect(focus).toHaveCount(1);
  await expect(page.locator('.catalog-topbar')).toHaveCount(0);
  await expect(scene.locator('header, nav, h1, h2')).toHaveCount(0);
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-theme', 'dark');
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-motion', 'reduced');

  const documentStyles = await page.evaluate(() => ({
    html: {
      margin: getComputedStyle(document.documentElement).margin,
      padding: getComputedStyle(document.documentElement).padding,
    },
    body: {
      margin: getComputedStyle(document.body).margin,
      padding: getComputedStyle(document.body).padding,
      bounds: document.body.getBoundingClientRect().toJSON(),
    },
    focusBounds: document
      .querySelector('[data-testid="catalog-scene-focus"]')
      ?.getBoundingClientRect()
      .toJSON(),
    current: window.__INTENT_PREVIEW__?.current(),
  }));
  expect(documentStyles.html).toEqual({ margin: '0px', padding: '0px' });
  expect(documentStyles.body.margin).toBe('0px');
  expect(documentStyles.body.padding).toBe('0px');
  expect(documentStyles.focusBounds).toBeDefined();
  expect(documentStyles.body.bounds).toEqual(documentStyles.focusBounds);
  expect(documentStyles.current).toMatchObject({
    slug: 'button',
    state: 'loading',
    width: 420,
    status: 'ready',
    fit: 'component',
  });
});

test('selects direct preview states in the browser-only Vite runtime', async ({ page }) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  const remoteRequests: string[] = [];
  const webSockets: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      remoteRequests.push(request.url());
    }
  });
  page.on('websocket', (socket) => webSockets.push(socket.url()));

  await page.goto(`${baseUrl}/sandbox/button?state=loading&theme=dark&width=420&motion=reduced`);
  const scene = page.getByTestId('catalog-scene');
  await expect(scene).toHaveAttribute('data-preview-ready', 'true', { timeout: 90_000 });
  await expect(scene).toHaveAttribute('data-preview-state', 'loading');
  await expect(scene).toHaveAttribute('data-preview-width', '420');
  await expect(page.getByRole('button', { name: 'Saving' })).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-theme', 'dark');
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-motion', 'reduced');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('html')).toHaveClass(/catalog-reduced-motion/);

  for (const [state, label] of [
    ['default', 'Continue'],
    ['loading', 'Saving'],
    ['disabled', 'Unavailable'],
    ['destructive', 'Delete workspace'],
  ] as const) {
    await page.getByRole('link', { name: state }).click();
    await expect(page).toHaveURL(new RegExp(`state=${state}`));
    await expect(scene).toHaveAttribute('data-preview-ready', 'true');
    await expect(scene).toHaveAttribute('data-preview-state', state);
    await expect(page.getByRole('button', { name: label })).toBeVisible();
  }

  const discovery = await page.evaluate(async () => ({
    list: window.__INTENT_PREVIEW__?.list(),
    states: await window.__INTENT_PREVIEW__?.states('button'),
    current: window.__INTENT_PREVIEW__?.current(),
    electronApi: 'electronAPI' in window,
  }));
  expect(discovery.list).toEqual([
    'button',
    'mcp-server-form',
    'mention-agent-avatar',
    'panel-tab-strip',
    'streaming-status',
    'workspace-hover-card',
    'workspace-sidebar',
  ]);
  expect(discovery.states).toEqual(['default', 'loading', 'disabled', 'destructive']);
  expect(discovery.current).toMatchObject({
    slug: 'button',
    state: 'destructive',
    width: 420,
    status: 'ready',
  });
  expect(discovery.electronApi).toBe(false);
  await expect(page.getByTestId('app-ready')).toHaveCount(0);

  await page.goto(
    `${baseUrl}/sandbox/mention-agent-avatar?state=idle&theme=light&width=320&motion=full`,
  );
  const avatarScene = page.getByTestId('catalog-scene');
  const avatar = page.locator('[data-agent-avatar-with-state]');
  for (const [state, avatarState] of [
    ['idle', 'idle'],
    ['waiting', 'waiting'],
    ['error', 'failed'],
  ] as const) {
    await page.getByRole('link', { name: state }).click();
    await expect(avatarScene).toHaveAttribute('data-preview-ready', 'true');
    await expect(avatarScene).toHaveAttribute('data-preview-state', state);
    await expect(avatar).toHaveAttribute('data-avatar-state', avatarState);
  }

  for (const [slug, state, productSelector] of [
    ['workspace-sidebar', 'busy', '[data-workspace-sidebar-preview]'],
    ['panel-tab-strip', 'many-tabs', '[data-panel-tab-strip-preview]'],
    ['streaming-status', 'error', '[data-stream-terminal-error="true"]'],
    ['mcp-server-form', 'validation', '[data-testid="catalog-scene-focus"] input'],
    ['workspace-hover-card', 'working', '[data-workspace-hover-card-preview]'],
  ] as const) {
    await page.goto(`${baseUrl}/sandbox/${slug}?state=${state}&theme=light&width=420&motion=full`);
    const productScene = page.getByTestId('catalog-scene');
    await expect(productScene).toHaveAttribute('data-preview-ready', 'true', { timeout: 90_000 });
    await expect(productScene).toHaveAttribute('data-preview-state', state);
    await expect(page.locator(productSelector).first()).toBeVisible();
  }
  await page.goto(`${baseUrl}/sandbox/button?state=missing&theme=light&width=320&motion=full`);
  await expect(page.getByRole('alert')).toContainText('Unknown state “missing”.', {
    timeout: 90_000,
  });
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'false');

  await expect.poll(() => webSockets.length).toBeGreaterThan(0);
  expect(
    webSockets.every((url) => ['127.0.0.1', 'localhost'].includes(new URL(url).hostname)),
  ).toBe(true);
  expect(remoteRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
