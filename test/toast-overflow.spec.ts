import { expect, type Page, type TestInfo } from '@playwright/test';
import { test } from './root-browser-fixtures';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';
import { loadBundledInterFont } from './test-fonts';

let server: ViteDevServer | undefined;
let baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '') ?? '';
test.describe.configure({ timeout: 120_000 });
test.beforeAll(async () => {
  test.setTimeout(360_000);
  if (baseUrl) return;
  process.env.INTENT_UI_PREVIEW = '1';
  process.env.INTENT_BUILD_TARGET = 'web';
  server = await createServer({
    cacheDir: viteHarnessCacheDir('toast-overflow'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? '';
  expect(baseUrl).not.toBe('');
});
test.afterAll(async () => server?.close());
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await evidence(page, info, 'failure-state');
});

const cards = (page: Page) =>
  page.locator('#toast-overflow-region [data-sonner-toast]:not([data-removed="true"])');
async function open(page: Page, state: string, theme = 'light', scale = 1) {
  await page.emulateMedia({
    reducedMotion: 'reduce',
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  await page.goto(`${baseUrl}/sandbox/toast-overflow?state=${state}&theme=${theme}&motion=reduced`);
  await expect(page.getByTestId('toast-overflow-preview')).toHaveAttribute('data-scenario', state);
  await loadBundledInterFont(page, { baseUrl: `${baseUrl}/` });
  if (scale !== 1)
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = `${size * 100}%`;
    }, scale);
  await expect(cards(page).first()).toBeVisible();
  await expect(cards(page).first()).toHaveAttribute('data-mounted', 'true');
}
async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element) => {
      const { x, y, width, height, top, bottom, left, right } = el.getBoundingClientRect();
      return { x, y, width, height, top, bottom, left, right };
    };
    const region = document.querySelector('#toast-overflow-region')!;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      cards: [
        ...region.querySelectorAll<HTMLElement>('[data-sonner-toast]:not([data-removed="true"])'),
      ].map((card) => ({
        ...rect(card),
        visible: card.dataset.visible,
        expanded: card.dataset.expanded,
        inert: card.inert,
        styled: card.dataset.styled,
        scrollHeight: card.scrollHeight,
        clientHeight: card.clientHeight,
        overflowY: getComputedStyle(card).overflowY,
        text: [
          ...card.querySelectorAll<HTMLElement>(
            '[data-title], [data-description], [data-toast-title], [data-toast-description]',
          ),
        ].map((el) => ({
          ...rect(el),
          kind: el.matches('[data-title], [data-toast-title]') ? 'title' : 'description',
          lineHeight: parseFloat(getComputedStyle(el).lineHeight),
          fullLength: el.textContent?.length,
        })),
        controls: [...card.querySelectorAll<HTMLElement>('button, summary')].map((el) => ({
          ...rect(el),
          label: el.getAttribute('aria-label') ?? el.textContent?.trim(),
        })),
        scrollRegions: [card, ...card.querySelectorAll<HTMLElement>('*')]
          .filter(
            (el) =>
              /auto|scroll/.test(getComputedStyle(el).overflowY) &&
              el.scrollHeight > el.clientHeight + 1,
          )
          .map((el) => ({
            ...rect(el),
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          })),
      })),
      clearAll: document.querySelector('.toast-clear-all')
        ? rect(document.querySelector('.toast-clear-all')!)
        : null,
    };
  });
}
async function evidence(page: Page, info: TestInfo, name: string) {
  const measured = await geometry(page);
  await info.attach(`${name}-geometry`, {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json',
  });
  await info.attach(`${name}-screenshot`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  return measured;
}
async function bounded(page: Page, info: TestInfo, name: string) {
  // Wait for Sonner's measured height and its entry transition to settle before capturing.
  await expect
    .poll(async () => {
      const state = await geometry(page);
      return state.cards.every(
        (card) =>
          card.height <= Math.min(16 * state.rem, state.viewport.height / 2) + 1 &&
          (card.visible === 'false' ||
            (card.top >= -1 && card.bottom <= state.viewport.height + 1)),
      );
    })
    .toBe(true);
  const state = await evidence(page, info, name);
  for (const card of state.cards) {
    if (card.visible === 'false') continue;
    expect(card.left).toBeGreaterThanOrEqual(-1);
    expect(card.right).toBeLessThanOrEqual(state.viewport.width + 1);
    expect(card.top).toBeGreaterThanOrEqual(-1);
    expect(card.bottom).toBeLessThanOrEqual(state.viewport.height + 1);
    for (const text of card.text) {
      expect(text.height).toBeLessThanOrEqual(
        text.lineHeight * (text.kind === 'title' ? 2 : 3) + 1,
      );
    }
    // Scrollable custom cards intentionally contain offscreen descendants; scrollIntoView
    // and real click assertions below prove their actions are reachable.
    if (card.styled === 'true')
      for (const control of card.controls) {
        expect(control.left).toBeGreaterThanOrEqual(card.left - 1);
        expect(control.right).toBeLessThanOrEqual(card.right + 1);
        expect(control.top).toBeGreaterThanOrEqual(card.top - 1);
        expect(control.bottom).toBeLessThanOrEqual(card.bottom + 1);
      }
  }
  return state;
}

for (const environment of [
  { name: 'desktop', width: 1024, height: 768, theme: 'light', scale: 1 },
  { name: 'narrow-short-dark', width: 360, height: 320, theme: 'dark', scale: 1 },
  { name: 'larger-text', width: 420, height: 480, theme: 'light', scale: 1.5 },
]) {
  test(`contains standard and custom content: ${environment.name}`, async ({ page }, info) => {
    await page.setViewportSize(environment);
    for (const scenario of [
      'standard',
      'deleted',
      'url-unicode',
      'empty',
      'actions',
      'details',
      'application-error',
      'discussion',
      'blocker',
      'failure',
      'auth',
      'retrying',
      'update-available',
      'update-downloading',
      'update-downloaded',
      'update-error',
    ]) {
      await open(page, scenario, environment.theme, environment.scale);
      await bounded(page, info, `${environment.name}-${scenario}`);
      if (scenario === 'auth') {
        expect((await geometry(page)).cards[0].scrollRegions.length).toBeGreaterThan(0);
      }
    }
  });
}

test('keeps Undo, long actions, custom callbacks, copy, details and close usable', async ({
  page,
  context,
}, info) => {
  await page.setViewportSize({ width: 360, height: 400 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const [scenario, button, event] of [
    ['deleted', 'Undo', 'undo'],
    ['actions', 'Review all changes in the workspace before continuing', 'action'],
    ['actions', 'Keep working and remind me about these changes later', 'cancel'],
    ['application-error', 'Copy', 'copy'],
    ['application-error', 'Retry', 'retry'],
    ['application-error', 'Debug with AI', 'debug'],
    ['failure', 'Retry the agent with a very long display name', 'retry'],
    ['discussion', 'Switch To', 'switch'],
    ['update-available', 'Download', 'download'],
    ['update-downloaded', 'Install', 'install'],
  ]) {
    await open(page, scenario);
    const action = cards(page).getByRole('button', { name: button, exact: true });
    await action.scrollIntoViewIfNeeded();
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('toast-overflow-events')).toContainText(event);
    await evidence(page, info, `callback-${scenario}-${event}`);
  }
  await open(page, 'retrying');
  await expect(cards(page).getByRole('button', { name: /Retrying/ })).toBeDisabled();
  await open(page, 'details');
  await cards(page).locator('summary').click();
  await expect(cards(page).locator('details')).toHaveAttribute('open', '');
  await cards(page).getByRole('button', { name: 'Copy', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Diagnostic 40:');
  await bounded(page, info, 'details-expanded-scrolled');
  await open(page, 'auth');
  await cards(page).getByRole('button', { name: 'Copy', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('claude auth login');
  await cards(page).getByRole('button', { name: /Close/ }).click();
  await expect(cards(page)).toHaveCount(0);
});

for (const scenario of ['mixed', 'burst']) {
  test(`contains the actual expanded ${scenario} stack and Clear all`, async ({ page }, info) => {
    await page.setViewportSize({ width: 360, height: 320 });
    await open(page, scenario, 'dark');
    await page.locator('#toast-overflow-region [data-sonner-toast][data-front="true"]').hover();
    await expect(cards(page).first()).toHaveAttribute('data-expanded', 'true');
    await bounded(page, info, `${scenario}-expanded`);
    const clear = page.getByRole('button', { name: /Dismiss all/ });
    await expect(clear).toBeInViewport();
    await clear.click();
    await expect(cards(page)).toHaveCount(0);
    await evidence(page, info, `${scenario}-cleared`);
  });
}

test('keyboard expansion unlocks rear actions and resizing keeps the visible stack in the window', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await open(page, 'keyboard-stack');
  const rear = page.locator('#toast-overflow-region [data-sonner-toast][data-index="1"]');
  await expect(rear).toHaveAttribute('inert', '');
  await page.keyboard.press('Alt+t');
  await expect(rear).toHaveAttribute('data-expanded', 'true');
  await expect(rear).not.toHaveAttribute('inert', '');
  const install = rear.getByRole('button', { name: 'Install', exact: true });
  await install.focus();
  await expect(install).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('toast-overflow-events')).toContainText('install');
  await bounded(page, info, 'keyboard-expanded-rear-action');
  await page.keyboard.press('Escape');
  await expect(rear).toHaveAttribute('data-expanded', 'false');
  await expect(rear).toHaveAttribute('inert', '');
  await page.keyboard.press('Alt+t');
  await page.setViewportSize({ width: 360, height: 240 });
  await expect
    .poll(async () =>
      (await geometry(page)).cards
        .filter((card) => card.visible !== 'false')
        .every((card) => card.top >= -1 && card.bottom <= 241),
    )
    .toBe(true);
  const state = await bounded(page, info, 'keyboard-expanded-after-resize');
  for (const card of state.cards.filter((card) => card.visible === 'false')) {
    expect(card.inert).toBe(true);
  }
  await expect(page.getByRole('button', { name: /Dismiss all/ })).toBeInViewport();
});

test('captures an unbounded reference and the bounded result', async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, 'standard');
  const referenceStyle = await page.addStyleTag({
    content: `
    #toast-overflow-region [data-sonner-toast] {
      max-height: none !important;
      height: auto !important;
      overflow: visible !important;
    }
    #toast-overflow-region [data-title],
    #toast-overflow-region [data-description],
    #toast-overflow-region [data-toast-title],
    #toast-overflow-region [data-toast-description] {
      display: block !important;
      -webkit-line-clamp: unset !important;
      line-clamp: unset !important;
      max-height: none !important;
      overflow: visible !important;
    }
  `,
  });
  try {
    await evidence(page, info, 'before-unbounded-reference-css-override-not-exact-baseline');
  } finally {
    await referenceStyle.evaluate((style) => style.remove());
  }
  await bounded(page, info, 'after-production-toast-bounds');
  await info.attach('before-after-context', {
    body: 'Before is an unbounded reference created by temporarily removing text clamps and the toast height cap with page CSS. It is not an exact baseline. After uses the production styles with the override removed. The user-supplied screenshot remains the actual before evidence.',
    contentType: 'text/plain',
  });
});
