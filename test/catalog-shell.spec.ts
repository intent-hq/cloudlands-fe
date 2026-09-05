import { expect, test, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const artifactDir = path.resolve('test-results/catalog-artifacts');
const catalogReadyTimeout = 90_000;
const catalogSlugs = [
  'badge',
  'breadcrumb',
  'button',
  'button-group',
  'card',
  'checkbox',
  'combobox',
  'dialog',
  'file-input',
  'input',
  'label',
  'list',
  'menu',
  'proposal-card',
  'scroll-area',
  'select',
  'separator',
  'settings-field-row',
  'settings-page-shell',
  'settings-section',
  'sheet',
  'sidebar',
  'skeleton',
  'slider',
  'spinner',
  'switch',
  'textarea',
  'toggle',
  'toggle-group',
  'tooltip',
] as const;

test.use(existsSync(systemChrome) ? { channel: 'chrome' } : {});
test.describe.configure({ mode: 'serial' });

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  mkdirSync(artifactDir, { recursive: true });
  server = await createServer({
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(`${baseUrl}sandbox`, {
            signal: AbortSignal.timeout(10_000),
          });
          await response.arrayBuffer();
          return response.status;
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [100, 250, 500, 1_000] },
    )
    .toBe(200);
  const readinessPage = await browser.newPage();
  try {
    await readinessPage.goto(`${baseUrl}sandbox`, {
      waitUntil: 'domcontentloaded',
      timeout: catalogReadyTimeout,
    });
    await expectCatalogGalleryReady(readinessPage);
  } finally {
    await readinessPage.close();
  }
});

test.afterAll(async () => {
  await server?.close();
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'compact', width: 390, height: 844 },
] as const) {
  test(`${viewport.name} renders every canonical preview without a desktop bridge`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      delete (window as Window & { electronAPI?: unknown }).electronAPI;
    });
    await page.setViewportSize(viewport);
    const faviconResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/favicon.png',
    );
    await page.goto(`${baseUrl}sandbox`, { waitUntil: 'domcontentloaded' });
    expect((await faviconResponse).status()).toBe(200);
    await expectCatalogShellReady(page);

    await assertGallery(page);
    await captureGalleryArtifacts(page, viewport.name);

    for (const slug of catalogSlugs) {
      await navigateToCatalogPreview(page, slug);
      await expectCatalogShellReady(page);
      const previews = page.locator(`[data-catalog-preview="${slug}"]`);
      await expect(previews.first()).toBeAttached({ timeout: catalogReadyTimeout });
      const previewCount = await previews.count();
      expect(previewCount).toBeGreaterThan(0);
      for (let index = 0; index < previewCount; index += 1) {
        await expect(
          previews.nth(index).locator('button,input,a,[data-slot]').first(),
        ).toBeVisible();
        await expect(
          previews.nth(index).locator('[data-catalog-rendered-state]').first(),
        ).toBeAttached({ timeout: catalogReadyTimeout });
      }
      if (viewport.name === 'compact' && (slug === 'combobox' || slug === 'select')) {
        await assertChoiceLongListGeometry(page, slug);
        await captureChoiceLongListInitialState(page, slug);
      }
      await exerciseCanonicalPreview(page, slug);
      if (
        [
          'badge',
          'combobox',
          'dialog',
          'file-input',
          'settings-field-row',
          'settings-page-shell',
          'settings-section',
          'slider',
        ].includes(slug)
      ) {
        await captureCatalogArtifacts(page, viewport.name, slug);
      }
    }
    if (viewport.name === 'desktop') await captureKeyboardFocusEvidence(page);

    const bridge = await page.evaluate(() => {
      const value = (window as Window & { electronAPI?: unknown }).electronAPI;
      return {
        type: typeof value,
        keys: value && typeof value === 'object' ? Object.keys(value) : [],
      };
    });
    expect(bridge).toEqual({ type: 'undefined', keys: [] });
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect((await page.screenshot({ fullPage: true })).byteLength).toBeGreaterThan(10_000);
  });
}

test('200% zoom uses DPR2 device metrics and keeps the catalog contained', async ({
  context,
  page,
}) => {
  const physicalWidth = 1280;
  const physicalHeight = 800;
  const zoom = 2;
  const cssWidth = physicalWidth / zoom;
  const cssHeight = physicalHeight / zoom;
  const cdp = await context.newCDPSession(page);

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: cssWidth,
    height: cssHeight,
    deviceScaleFactor: zoom,
    mobile: false,
    screenWidth: physicalWidth,
    screenHeight: physicalHeight,
  });
  try {
    await page.goto(`${baseUrl}sandbox`, { waitUntil: 'domcontentloaded' });
    await expectCatalogShellReady(page);
    const heading = page.getByRole('heading', { name: 'Design system workspace' });
    const intro = page.getByText(/^Explore live semantic foundations/);
    await expect(heading).toBeVisible();

    const [headingBox, introBox] = await Promise.all([heading.boundingBox(), intro.boundingBox()]);
    const evidence = await page.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
    }));
    expect(evidence.devicePixelRatio).toBe(2);
    expect(evidence.innerWidth).toBe(cssWidth);
    expect(evidence.innerHeight).toBe(cssHeight);
    expect(evidence.viewportWidth).toBe(cssWidth);
    expect(evidence.viewportHeight).toBe(cssHeight);
    expect((headingBox?.height ?? 0) * evidence.devicePixelRatio).toBeGreaterThanOrEqual(48);
    expect((introBox?.height ?? 0) * evidence.devicePixelRatio).toBeGreaterThanOrEqual(32);
    await assertNoPageOverflow(page);

    const capture = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const screenshot = Buffer.from(capture.data, 'base64');
    expect(pngDimensions(screenshot)).toEqual({ width: physicalWidth, height: physicalHeight });
    writeFileSync(path.join(artifactDir, 'zoom-200-gallery.png'), screenshot);
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  }
});

async function captureKeyboardFocusEvidence(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${baseUrl}sandbox/button`, { waitUntil: 'domcontentloaded' });
  await expectCatalogShellReady(page);
  await setCatalogTheme(page, 'dark');

  const control = page.getByRole('button', { name: 'Run action' });
  const readIndicator = () =>
    control.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement('span');
      probe.style.color = 'hsl(var(--ring))';
      document.body.append(probe);
      const ringColor = getComputedStyle(probe).color;
      probe.remove();
      const shadowColors = style.boxShadow.match(/rgba?\([^)]+\)|color\([^)]+\)/g) ?? [];
      const shadowHasVisibleColor = shadowColors.some((color) => {
        const slashAlpha = color.match(/\/\s*([0-9.]+)/)?.[1];
        if (slashAlpha !== undefined) return Number.parseFloat(slashAlpha) > 0;
        const channels = color.match(/[0-9.]+/g)?.map(Number) ?? [];
        return channels.length < 4 || channels[3] > 0;
      });
      const shadowExtent = Math.max(
        0,
        ...(style.boxShadow
          .match(/-?[0-9.]+px/g)
          ?.map((value) => Math.abs(Number.parseFloat(value))) ?? []),
      );
      const preview = element.closest('[data-catalog-preview]');
      return {
        adjacentBackground: preview ? getComputedStyle(preview).backgroundColor : 'transparent',
        borderColor: style.borderColor,
        borderWidth: Number.parseFloat(style.borderWidth),
        boxShadow: style.boxShadow,
        focusVisible: element.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        ringColor,
        shadowExtent,
        shadowHasVisibleColor,
      };
    });
  const focusViaKeyboard = async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (
      let index = 0;
      index < 12 && !(await control.evaluate((node) => node === document.activeElement));
      index += 1
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(control).toBeFocused();
  };
  const waitForVisibleIndicator = async (unfocused: Awaited<ReturnType<typeof readIndicator>>) => {
    await expect
      .poll(
        async () => {
          const focus = await readIndicator();
          const shadowChanged = focus.boxShadow !== unfocused.boxShadow;
          const thickness = Math.max(
            focus.outlineStyle === 'none' ? 0 : focus.outlineWidth,
            focus.borderWidth + (shadowChanged ? focus.shadowExtent : 0),
          );
          return (
            focus.focusVisible &&
            focus.borderColor === focus.ringColor &&
            shadowChanged &&
            focus.shadowHasVisibleColor &&
            thickness >= 2 &&
            contrastRatio(focus.adjacentBackground, focus.borderColor) >= 3
          );
        },
        { timeout: 2_000 },
      )
      .toBe(true);
    return readIndicator();
  };

  const unfocused = await readIndicator();
  await focusViaKeyboard();
  const focus = await waitForVisibleIndicator(unfocused);
  expect(focus.focusVisible).toBe(true);
  expect(focus.borderColor).toBe(focus.ringColor);
  expect(focus.shadowHasVisibleColor).toBe(true);
  expect(focus.boxShadow).not.toBe(unfocused.boxShadow);
  expect(focus.borderWidth + focus.shadowExtent).toBeGreaterThanOrEqual(2);
  expect(contrastRatio(focus.adjacentBackground, focus.borderColor)).toBeGreaterThanOrEqual(3);

  const screenshot = await page.screenshot({
    path: path.join(artifactDir, 'keyboard-focus-button-dark-compact.png'),
  });
  expect(pngDimensions(screenshot)).toEqual({ width: 1280, height: 800 });
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const detail = await page.screenshot({
    path: path.join(artifactDir, 'keyboard-focus-button-detail-dark-compact.png'),
    clip: {
      x: Math.max(0, (box?.x ?? 0) - 24),
      y: Math.max(0, (box?.y ?? 0) - 24),
      width: (box?.width ?? 0) + 48,
      height: (box?.height ?? 0) + 48,
    },
  });
  expect(pngDimensions(detail).width).toBeGreaterThan(box?.width ?? 0);
  expect(pngDimensions(detail).height).toBeGreaterThan(box?.height ?? 0);

  await setReducedMotion(page, true);
  await expect
    .poll(async () => {
      const state = await readIndicator();
      return !state.focusVisible && state.borderColor !== state.ringColor;
    })
    .toBe(true);
  const reducedUnfocused = await readIndicator();
  await focusViaKeyboard();
  await waitForVisibleIndicator(reducedUnfocused);
  await setReducedMotion(page, false);
}

function pngDimensions(png: Buffer) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function assertChoiceLongListGeometry(page: Page, slug: 'combobox' | 'select') {
  const state = page.locator(`[data-catalog-state="${slug}-long-list"]`);
  const listbox = state.getByRole('listbox');
  const precedingState = state.locator('xpath=preceding-sibling::*[1]');
  const fixture = state.locator('xpath=ancestor::*[@data-catalog-fixture][1]');
  const heading = fixture.locator('.fixture-heading');
  await expect(listbox).toBeVisible();

  const [stateBox, listboxBox, precedingBox, headingBox] = await Promise.all([
    state.boundingBox(),
    listbox.boundingBox(),
    precedingState.boundingBox(),
    heading.boundingBox(),
  ]);
  expect(stateBox).not.toBeNull();
  expect(listboxBox).not.toBeNull();
  expect(precedingBox).not.toBeNull();
  expect(headingBox).not.toBeNull();

  expect(listboxBox!.y).toBeGreaterThanOrEqual(stateBox!.y - 1);
  expect(listboxBox!.y + listboxBox!.height).toBeLessThanOrEqual(
    stateBox!.y + stateBox!.height + 1,
  );
  expect(listboxBox!.y).toBeGreaterThanOrEqual(precedingBox!.y + precedingBox!.height - 1);
  expect(listboxBox!.y).toBeGreaterThanOrEqual(headingBox!.y + headingBox!.height - 1);
}

async function captureChoiceLongListInitialState(page: Page, slug: 'combobox' | 'select') {
  const fixture = page
    .locator(`[data-catalog-state="${slug}-long-list"]`)
    .locator('xpath=ancestor::*[@data-catalog-fixture][1]');
  await fixture.screenshot({
    path: path.join(artifactDir, `compact-${slug}-initial-long-list.png`),
  });
}

async function exerciseCanonicalPreview(page: Page, slug: (typeof catalogSlugs)[number]) {
  if (slug === 'badge') {
    await expect(page.locator('[data-slot="badge"]').first()).toContainText('Default badge');
  } else if (slug === 'button') {
    const button = page.getByRole('button', { name: 'Run action' });
    await button.click();
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Button click count')).toHaveText('2');
  } else if (slug === 'button-group') {
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  } else if (slug === 'checkbox') {
    const checkbox = page.getByRole('checkbox', { name: 'Catalog checkbox' });
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
  } else if (slug === 'switch') {
    const control = page.getByRole('switch', { name: 'Catalog switch' });
    await control.click();
    await expect(control).toBeChecked();
    await control.focus();
    await page.keyboard.press('Space');
    await expect(control).not.toBeChecked();
  } else if (slug === 'toggle') {
    const toggle = page.getByRole('button', { name: 'Bold' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  } else if (slug === 'toggle-group') {
    const list = page.getByRole('radio', { name: 'List view' });
    const tree = page.getByRole('radio', { name: 'Tree view' });
    await tree.click();
    await expect(tree).toHaveAttribute('aria-checked', 'true');
    await list.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tree).toBeFocused();
  } else if (slug === 'combobox') {
    const defaultState = page.locator('[data-catalog-rendered-state~="closed"]');
    const input = defaultState.getByRole('combobox', { name: 'Catalog combobox', exact: true });
    await input.click();
    await defaultState.getByRole('option', { name: 'Ada Lovelace' }).click();
    await expect(defaultState.getByLabel('Combobox value', { exact: true })).toContainText('ada');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(defaultState.getByLabel('Combobox value', { exact: true })).toContainText('grace');
  } else if (slug === 'select') {
    const defaultState = page.locator('[data-catalog-rendered-state~="closed"]');
    const trigger = defaultState.getByRole('button', { name: 'Catalog select' });
    await trigger.click();
    await defaultState.getByRole('option', { name: 'Banana' }).click();
    await expect(page.getByLabel('Select value')).toHaveText('banana');
    await trigger.focus();
    await trigger.press('ArrowDown');
    await page.keyboard.press('Enter');
  } else if (slug === 'file-input') {
    const button = page.getByRole('button', { name: 'Choose theme files', exact: true });
    await button.focus();
    await expect(button).toBeFocused();
    const input = page.locator('#catalog-theme-file');
    await expect(input).toHaveAttribute('accept', '.json,application/json');
    await expect(input).toHaveAttribute('multiple', '');
    await expect(input).toHaveAttribute('required', '');
    await expect(input).toHaveAttribute('name', 'themeFiles');
    await input.setInputFiles([
      { name: 'light.json', mimeType: 'application/json', buffer: Buffer.from('{}') },
      { name: 'dark.json', mimeType: 'application/json', buffer: Buffer.from('{}') },
    ]);
    const status = page.locator('[data-slot="file-input"]').first().getByRole('status');
    await expect(status).toContainText('light.json, dark.json');
    await page.getByRole('button', { name: 'Reset form' }).click();
    await expect(status).toHaveText('No theme file selected');
    await input.setInputFiles({
      name: 'parent-reset.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{}'),
    });
    await page.getByRole('button', { name: 'Reset from parent' }).click();
    await expect(status).toHaveText('No theme file selected');
  } else if (slug === 'settings-field-row') {
    const slider = page.getByRole('slider', { name: 'Field row volume' });
    await slider.focus();
    await slider.press('ArrowRight');
    await expect(page.getByLabel('Field row volume value')).toHaveText('46');
  } else if (slug === 'settings-page-shell') {
    const actionPreview = page.locator('[data-catalog-renderer-fixture="editorial-shell"]');
    const linkedPreview = page.locator('[data-catalog-renderer-fixture="busy-shell"]');
    const shell = actionPreview.getByRole('region', { name: 'Application settings' });
    await expect(shell).toBeVisible();
    const actionBack = actionPreview.getByRole('button', { name: 'Back to workspace' });
    await actionBack.focus();
    await expect(actionBack).toBeFocused();
    const shortcut = actionPreview.locator('[data-slot="settings-page-back-shortcut"]');
    await expect(shortcut).toHaveText('⌘,');
    await expect(shortcut).toHaveAttribute('aria-label', 'Command comma');
    await actionBack.click();
    await expect(actionPreview.getByLabel('Catalog back action count')).toHaveText('1');
    const linkedBack = linkedPreview.getByRole('link', { name: 'Back to workspace' });
    await expect(linkedBack).toHaveAttribute('href', '#catalog-settings-shell');
    await assertSettingsShellLayout(page, actionPreview, linkedPreview);
  } else if (slug === 'settings-section') {
    await expect(page.getByRole('region', { name: 'Notifications' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    const reset = page.getByRole('button', { name: 'Reset section' });
    await reset.focus();
    await expect(reset).toBeFocused();
  } else if (slug === 'slider') {
    const slider = page.getByRole('slider', { name: 'Catalog volume', exact: true });
    await slider.focus();
    await slider.press('ArrowRight');
    await expect(page.getByLabel('Catalog slider value')).toHaveText('46');
  } else if (slug === 'menu') {
    const trigger = page.getByRole('button', { name: 'Open catalog menu' });
    await trigger.click();
    const menu = page.getByRole('menu').first();
    await expect(menu).toBeVisible();
    const checkbox = page.getByRole('menuitemcheckbox', { name: 'Show panel' });
    await checkbox.click();
    await expect(checkbox).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    const outsideTarget = page.getByRole('button', { name: 'Menu outside target' });
    if ((page.viewportSize()?.width ?? 0) < 500) await outsideTarget.click({ force: true });
    else await outsideTarget.click();
    await expect(menu).toBeHidden();
  } else if (slug === 'dialog' || slug === 'sheet') {
    const trigger = page.getByRole('button', {
      name: slug === 'dialog' ? 'Open catalog dialog' : 'Open catalog sheet',
    });
    const overlay = page.getByRole('dialog', {
      name: slug === 'dialog' ? 'Catalog dialog' : 'Catalog sheet',
    });
    await trigger.click();
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page
      .locator(`[data-slot="${slug === 'dialog' ? 'dialog-overlay' : 'sheet-overlay'}"]`)
      .click({ position: { x: 5, y: 5 } });
    await expect(overlay).toBeHidden();
  }

  if (slug === 'menu' || slug === 'dialog' || slug === 'sheet') {
    await assertReducedPortalMotion(page, slug);
  } else if (
    [
      'file-input',
      'settings-field-row',
      'settings-page-shell',
      'settings-section',
      'slider',
    ].includes(slug)
  ) {
    await assertReducedComponentMotion(page);
  }
}

async function assertGallery(page: Page) {
  const gallery = await expectCatalogGalleryReady(page);

  const search = page.getByTestId('catalog-search');
  await search.fill('dialog');
  await expect(gallery.locator('[data-catalog-gallery-entry="dialog"]')).toBeVisible();
  await expect(gallery.locator('[data-catalog-gallery-entry="button"]')).toHaveCount(0);
  await search.fill('');

  const groupFilter = page.getByTestId('catalog-group-filter');
  await groupFilter.click();
  await page.getByRole('option', { name: 'Overlays' }).click();
  await expect(gallery.locator('[data-catalog-gallery-entry="dialog"]')).toBeVisible();
  await expect(gallery.locator('[data-catalog-gallery-entry="badge"]')).toHaveCount(0);
  await groupFilter.click();
  await page.getByRole('option', { name: 'All sections' }).click();

  await page.getByRole('link', { name: 'Dialog', exact: true }).first().click();
  await expect(page).toHaveURL(/\/sandbox#component-dialog$/);
  await expect(page.locator('#component-dialog')).toBeInViewport();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/sandbox#component-dialog$/);
  await expectCatalogGalleryReady(page);
  await expect(page.locator('#component-dialog')).toBeInViewport();
  await assertNoPageOverflow(page);
}

async function expectCatalogGalleryReady(page: Page): Promise<Locator> {
  await expectCatalogShellReady(page);
  const gallery = page.getByTestId('catalog-gallery');
  await expect(gallery).toBeVisible({ timeout: catalogReadyTimeout });
  await expect(page.getByRole('navigation', { name: 'Catalog navigation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Foundations' })).toBeVisible();
  await expect(page.getByTestId('foundation-colors')).toBeVisible();
  for (const slug of catalogSlugs) {
    const entry = gallery.locator(`[data-catalog-gallery-entry="${slug}"]`);
    await expect(entry).toBeVisible();
    const preview = entry.locator(`[data-catalog-preview="${slug}"]`).first();
    await expect(preview).toBeVisible();
    await expect(preview.locator('[data-catalog-rendered-state]').first()).toBeAttached({
      timeout: catalogReadyTimeout,
    });
  }
  return gallery;
}

async function expectCatalogShellReady(page: Page) {
  await expect(page.getByTestId('catalog-shell')).toBeVisible({ timeout: catalogReadyTimeout });
}

async function navigateToCatalogPreview(page: Page, slug: (typeof catalogSlugs)[number]) {
  const gallery = page.getByTestId('catalog-gallery');
  if (!(await gallery.isVisible())) {
    await page.getByRole('link', { name: 'View all' }).click();
    await expect(gallery).toBeVisible({ timeout: catalogReadyTimeout });
  }
  const entry = gallery.locator(`[data-catalog-gallery-entry="${slug}"]`);
  const link = entry.locator(`a[href="/sandbox/${slug}"]`).first();
  await expect(link).toBeVisible({ timeout: catalogReadyTimeout });
  await link.click();
  await expect
    .poll(() => page.evaluate(() => window.location.pathname), { timeout: catalogReadyTimeout })
    .toBe(`/sandbox/${slug}`);
}

async function assertNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - window.innerWidth,
    elements: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => !element.closest('[aria-label="Catalog navigation"]'))
      .filter((element) => !element.closest('[aria-label="Catalog display controls"]'))
      .filter((element) => !element.closest('[data-slot="settings-page-navigation"]'))
      .filter((element) => !element.closest('[data-slot="scroll-area-viewport"]'))
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .map((element) => ({
        tag: element.tagName,
        ariaLabel: element.getAttribute('aria-label'),
        className: element.className,
        rect: {
          left: element.getBoundingClientRect().left,
          right: element.getBoundingClientRect().right,
          width: element.getBoundingClientRect().width,
        },
        entry: element.closest<HTMLElement>('[data-catalog-gallery-entry]')?.dataset
          .catalogGalleryEntry,
        preview: element.closest<HTMLElement>('[data-catalog-preview]')?.dataset.catalogPreview,
      }))
      .slice(0, 5),
  }));
  expect(overflow).toEqual({ body: 0, elements: [] });
}

async function captureGalleryArtifacts(page: Page, viewport: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  let lightColors: { background: string; backgroundToken: string } | undefined;
  for (const theme of ['light', 'dark'] as const) {
    await setCatalogTheme(page, theme);
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);
    const colors = await page.getByTestId('catalog-shell').evaluate((shell) => {
      const style = getComputedStyle(shell);
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        background: style.backgroundColor,
        foreground: style.color,
        backgroundToken: rootStyle.getPropertyValue('--background'),
        themeBackground: rootStyle.getPropertyValue('--theme-background'),
        rootClass: document.documentElement.className,
      };
    });
    if (theme === 'light') {
      lightColors = colors;
    } else {
      expect(colors.rootClass).toContain('dark');
      expect(colors.background).not.toBe(lightColors?.background);
      expect(colors.backgroundToken.trim()).not.toBe(lightColors?.backgroundToken.trim());
    }
    expect(contrastRatio(colors.background, colors.foreground)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: path.join(artifactDir, `${viewport}-gallery-${theme}.png`),
      fullPage: true,
    });
  }
}

async function assertSettingsShellLayout(
  page: Page,
  actionPreview: Locator,
  linkedPreview: Locator,
) {
  const shell = actionPreview.locator('[data-slot="settings-page-shell"]');
  const header = shell.locator('[data-slot="settings-page-header"]');
  const scroller = shell.locator('[data-slot="settings-page-content-scroll"]');
  const footer = shell.locator('[data-slot="settings-page-footer"]');
  await expect(actionPreview.locator('[data-slot="settings-page-content"]')).toHaveAttribute(
    'data-measure',
    'standard',
  );
  await expect(linkedPreview.locator('[data-slot="settings-page-content"]')).toHaveAttribute(
    'data-measure',
    'wide',
  );
  await expect(actionPreview.locator('[data-slot="settings-page-header-inner"]')).toHaveAttribute(
    'data-measure',
    'wide',
  );
  await expect(actionPreview.locator('[data-slot="settings-page-footer-inner"]')).toHaveAttribute(
    'data-measure',
    'wide',
  );
  const before = await Promise.all([
    header.evaluate((element) => element.getBoundingClientRect().top),
    footer.evaluate((element) => element.getBoundingClientRect().top),
  ]);
  await scroller.evaluate((element) => (element.scrollTop = 180));
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const after = await Promise.all([
    header.evaluate((element) => element.getBoundingClientRect().top),
    footer.evaluate((element) => element.getBoundingClientRect().top),
  ]);
  expect(after).toEqual(before);
  const placement = await shell.evaluate((element) => {
    const content = element.querySelector<HTMLElement>(
      '[data-slot="settings-page-content-scroll"]',
    );
    const footer = element.querySelector<HTMLElement>('[data-slot="settings-page-footer"]');
    return {
      gridRows: getComputedStyle(element).gridTemplateRows.split(' ').filter(Boolean).length,
      scrollable: Boolean(content && content.scrollHeight > content.clientHeight),
      footerIsRootChild: footer?.parentElement === element,
      footerWidth: footer?.getBoundingClientRect().width,
      shellWidth: element.getBoundingClientRect().width,
    };
  });
  expect(placement.gridRows).toBe(3);
  expect(placement.scrollable).toBe(true);
  expect(placement.footerIsRootChild).toBe(true);
  expect(Math.abs((placement.footerWidth ?? 0) - placement.shellWidth)).toBeLessThanOrEqual(2);

  if ((page.viewportSize()?.width ?? 0) < 500) {
    const navigation = shell.locator('[data-slot="settings-page-navigation"]');
    const overflow = await navigation.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
    expect(overflow.pageOverflow).toBe(0);
    await navigation.evaluate((element) => (element.scrollLeft = 120));
    await expect
      .poll(() => navigation.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
  }
}

async function assertSettingsArtifactContrast(page: Page, slug: string) {
  if (!['settings-section', 'settings-field-row', 'file-input', 'slider'].includes(slug)) return;
  const preview = page.locator(`[data-catalog-preview="${slug}"]`);
  if (slug === 'slider') {
    const invalidSlider = preview.getByRole('slider', { name: 'Invalid catalog volume' });
    const colors = await resolvedArtifactColors(invalidSlider, 'accentColor');
    expect(
      contrastRatio(colors.background, colors.foreground),
      `${slug} invalid accent`,
    ).toBeGreaterThanOrEqual(3);
    return;
  }
  const alert = preview.getByRole('alert').first();
  const colors = await resolvedArtifactColors(alert, 'color');
  expect(colors.opacity, `${slug} alert opacity`).toBe(1);
  expect(
    contrastRatio(colors.background, colors.foreground),
    `${slug} alert`,
  ).toBeGreaterThanOrEqual(4.5);
}

async function resolvedArtifactColors(
  locator: Locator,
  foregroundProperty: 'color' | 'accentColor',
) {
  return locator.evaluate((element, property) => {
    let background = 'rgba(0, 0, 0, 0)';
    let opacity = 1;
    let current: Element | null = element;
    while (current) {
      const style = getComputedStyle(current);
      opacity *= Number.parseFloat(style.opacity || '1');
      const candidate = style.backgroundColor;
      if (!/rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(candidate) && candidate !== 'transparent') {
        background = candidate;
        break;
      }
      current = current.parentElement;
    }
    const style = getComputedStyle(element);
    return {
      background,
      foreground: property === 'accentColor' ? style.accentColor : style.color,
      opacity,
    };
  }, foregroundProperty);
}

async function assertReducedPortalMotion(page: Page, slug: 'menu' | 'dialog' | 'sheet') {
  await setReducedMotion(page, true);
  const triggerName =
    slug === 'menu'
      ? 'Open catalog menu'
      : slug === 'dialog'
        ? 'Open catalog dialog'
        : 'Open catalog sheet';
  await page.getByRole('button', { name: triggerName }).click();
  const portal =
    slug === 'menu'
      ? page.getByRole('menu').first()
      : page.getByRole('dialog', {
          name: slug === 'dialog' ? 'Catalog dialog' : 'Catalog sheet',
        });
  await expect(portal).toBeVisible();
  const durations = await portal.evaluate((element) => {
    const style = getComputedStyle(element);
    return { animation: style.animationDuration, transition: style.transitionDuration };
  });
  expect(maxDurationMs(durations.animation), `${slug} animation`).toBeLessThanOrEqual(0.01);
  expect(maxDurationMs(durations.transition), `${slug} transition`).toBeLessThanOrEqual(0.01);
  await page.keyboard.press('Escape');
  await setReducedMotion(page, false);
}

async function assertReducedComponentMotion(page: Page) {
  await setReducedMotion(page, true);
  const control = page
    .locator('[data-catalog-preview] button, [data-catalog-preview] input')
    .first();
  const durations = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return { animation: style.animationDuration, transition: style.transitionDuration };
  });
  expect(maxDurationMs(durations.animation)).toBeLessThanOrEqual(0.01);
  expect(maxDurationMs(durations.transition)).toBeLessThanOrEqual(0.01);
  await setReducedMotion(page, false);
}

async function setCatalogTheme(page: Page, theme: 'light' | 'dark') {
  const control = page.getByRole('radio', {
    name: theme === 'dark' ? 'Dark' : 'Light',
    exact: true,
  });
  if ((await control.getAttribute('aria-checked')) !== 'true') await control.click();
  await expect(control).toHaveAttribute('aria-checked', 'true');
}

async function setReducedMotion(page: Page, enabled: boolean) {
  const control = page.getByRole('switch', { name: 'Reduce motion' });
  const checked = (await control.getAttribute('aria-checked')) === 'true';
  if (checked !== enabled) await control.click();
  await expect(control).toHaveAttribute('aria-checked', String(enabled));
}

function maxDurationMs(value: string): number {
  return Math.max(
    ...value.split(',').map((duration) => {
      const part = duration.trim();
      return Number.parseFloat(part) * (part.endsWith('ms') ? 1 : 1000);
    }),
  );
}

function contrastRatio(background: string, foreground: string): number {
  const luminance = (color: string) => {
    const channels =
      color
        .match(/[0-9.]+/g)
        ?.slice(0, 3)
        .map(Number) ?? [];
    const values = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
  };
  const [lighter, darker] = [luminance(background), luminance(foreground)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

async function captureCatalogArtifacts(
  page: Page,
  viewport: string,
  slug:
    | 'badge'
    | 'combobox'
    | 'dialog'
    | 'file-input'
    | 'settings-field-row'
    | 'settings-page-shell'
    | 'settings-section'
    | 'slider',
) {
  let lightColors: { background: string; foreground: string } | undefined;
  for (const theme of ['light', 'dark'] as const) {
    await setCatalogTheme(page, theme);
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);
    const colors = await page.getByTestId('catalog-shell').evaluate((shell) => {
      const style = getComputedStyle(shell);
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        background: style.backgroundColor,
        foreground: style.color,
        backgroundToken: rootStyle.getPropertyValue('--background'),
        themeBackground: rootStyle.getPropertyValue('--theme-background'),
        rootClass: document.documentElement.className,
      };
    });
    if (theme === 'light') {
      lightColors = colors;
    } else {
      expect(colors).not.toEqual(lightColors);
    }
    expect(contrastRatio(colors.background, colors.foreground)).toBeGreaterThanOrEqual(4.5);
    await assertSettingsArtifactContrast(page, slug);
    if (slug === 'dialog') {
      await setReducedMotion(page, true);
      await page.getByRole('button', { name: 'Open catalog dialog' }).click();
    } else if (slug === 'combobox') {
      await page.getByRole('combobox', { name: 'Catalog combobox', exact: true }).click();
    }
    const suffix = slug === 'dialog' ? '-reduced-motion' : '';
    await page.screenshot({
      path: path.join(artifactDir, `${viewport}-${slug}-${theme}${suffix}.png`),
      fullPage: true,
    });
    if (slug !== 'badge') await page.keyboard.press('Escape');
  }
}
