import { expect, test, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

const require = createRequire(import.meta.url);
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const artifactDir = path.resolve('test-results/catalog-artifacts');
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
  'loading-indicator',
  'switch',
  'textarea',
  'toggle',
  'toggle-group',
  'tooltip',
] as const;

test.use(existsSync(systemChrome) ? { channel: 'chrome' } : {});

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async () => {
  mkdirSync(artifactDir, { recursive: true });
  server = await createServer({
    cacheDir: viteHarnessCacheDir('catalog-shell'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => {
  await server?.close();
});

test('SearchableSelect playground keeps the last open option visible', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}sandbox/searchable-select`, { waitUntil: 'networkidle' });
  const preview = page.locator('[data-catalog-preview="searchable-select"]').first();
  await preview.getByRole('combobox').first().click();
  const lastOption = preview.getByRole('option').last();
  await expect(lastOption).toBeInViewport({ ratio: 1 });
  const unobscured = await lastOption.evaluate((option) => {
    const rect = option.getBoundingClientRect();
    return option.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 1));
  });
  expect(unobscured).toBe(true);
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
    await page.goto(`${baseUrl}sandbox`, { waitUntil: 'networkidle' });
    const faviconUrl = await page.locator('link[rel="icon"]').evaluate((link) => {
      return (link as HTMLLinkElement).href;
    });
    expect((await page.request.get(faviconUrl)).status()).toBe(200);
    await expect(page.getByTestId('catalog-shell')).toBeVisible();

    await assertIntroduction(page);
    await captureIntroductionArtifacts(page, viewport.name);

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
  for (const slug of catalogSlugs) {
    test(`${viewport.name} exercises ${slug} on its component route`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);

      await page.goto(`${baseUrl}sandbox/${slug}`, { waitUntil: 'networkidle' });
      const previews = page.locator(`[data-catalog-preview="${slug}"]`);
      const previewCount = await previews.count();
      expect(previewCount).toBeGreaterThan(0);
      for (let index = 0; index < previewCount; index += 1) {
        await expect(
          previews.nth(index).locator('button,input,a,[data-slot]').first(),
        ).toBeVisible();
        await expect(
          previews.nth(index).locator('[data-catalog-rendered-state]').first(),
        ).toBeAttached();
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
    });
  }
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
    await page.goto(`${baseUrl}sandbox`, { waitUntil: 'networkidle' });
    const heading = page.getByRole('heading', { name: 'Intent design system', exact: true });
    const intro = page.getByTestId('catalog-introduction').locator('header > p').last();
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
    // 388bffff replaced the gallery heading; verify scaling against the current rendered text.
    const headingLineHeight = await heading.evaluate((element) =>
      parseFloat(getComputedStyle(element).lineHeight),
    );
    expect(headingBox?.height).toBeGreaterThanOrEqual(headingLineHeight);
    expect((headingBox?.height ?? 0) * evidence.devicePixelRatio).toBeGreaterThan(
      headingBox?.height ?? 0,
    );
    expect((introBox?.height ?? 0) * evidence.devicePixelRatio).toBeGreaterThanOrEqual(32);
    await assertNoPageOverflow(page);

    const capture = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const screenshot = Buffer.from(capture.data, 'base64');
    expect(pngDimensions(screenshot)).toEqual({ width: physicalWidth, height: physicalHeight });
    writeFileSync(path.join(artifactDir, 'zoom-200-introduction.png'), screenshot);
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  }
});

test('keeps the bundled Inter Variable font across scene round trips and theme changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    delete (window as Window & { electronAPI?: unknown }).electronAPI;
  });
  await page.goto(`${baseUrl}sandbox/button?state=default&theme=light&width=960&motion=full`, {
    waitUntil: 'networkidle',
  });
  await expectPreviewReady(page, 'button', 'default');
  const first = await readShellFontEvidence(page);
  expect(first.family).toMatch(/^"?Inter Variable"?/);
  expect(first.loadedFaces).toBeGreaterThan(0);

  await navigateWithinDocument(page, '/sandbox/mention-agent-avatar?state=idle&width=960');
  await expectPreviewReady(page, 'mention-agent-avatar', 'idle');
  await setCatalogTheme(page, 'dark');

  await navigateWithinDocument(page, '/sandbox/button?state=default&width=960');
  await expectPreviewReady(page, 'button', 'default');
  await setCatalogTheme(page, 'light');

  const roundTrip = await readShellFontEvidence(page);
  expect(roundTrip.documentToken).toBe(first.documentToken);
  expect(roundTrip.family).toBe(first.family);
  expect(roundTrip.loadedFaces).toBeGreaterThan(0);
  expect(roundTrip.fontsStatus).toBe('loaded');
  expect(roundTrip.checkPasses).toBe(true);
});

/** Client-side SvelteKit navigation: the router intercepts same-origin anchor clicks. */
async function navigateWithinDocument(page: Page, href: string) {
  await page.evaluate((target) => {
    const anchor = document.createElement('a');
    anchor.href = target;
    anchor.textContent = 'navigate';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, href);
  await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

async function expectPreviewReady(page: Page, slug: string, state: string) {
  const scene = page.locator(
    `[data-testid="catalog-scene"][data-preview-slug="${slug}"][data-preview-state="${state}"]`,
  );
  await expect(scene).toHaveAttribute('data-preview-ready', 'true');
  await expect(scene).toHaveAttribute('data-preview-stable', 'true');
}

async function readShellFontEvidence(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const documentWindow = window as Window & { __catalogDocumentToken?: string };
    documentWindow.__catalogDocumentToken ??= crypto.randomUUID();
    const shell = document.querySelector('[data-testid="catalog-shell"]');
    const family = shell ? getComputedStyle(shell).fontFamily : '';
    let loadedFaces = 0;
    document.fonts.forEach((face) => {
      if (face.family.replace(/["']/g, '') === 'Inter Variable' && face.status === 'loaded') {
        loadedFaces += 1;
      }
    });
    return {
      documentToken: documentWindow.__catalogDocumentToken,
      family,
      loadedFaces,
      fontsStatus: document.fonts.status,
      checkPasses: document.fonts.check("16px 'Inter Variable'"),
    };
  });
}

async function captureKeyboardFocusEvidence(page: Page) {
  await page.goto(`${baseUrl}sandbox/button`, { waitUntil: 'networkidle' });
  await setCatalogTheme(page, 'dark');
  const control = page.getByRole('button', { name: '1. Primary', exact: true });
  // The later Wave 11 focus port replaced the legacy border/shadow ring with an outline.
  for (const reduced of [false, true]) {
    await setReducedMotion(page, reduced);
    await control.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(control).toBeFocused();
    const indicator = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        visible: element.matches(':focus-visible'),
        width: parseFloat(style.outlineWidth),
        style: style.outlineStyle,
      };
    });
    expect(indicator.visible).toBe(true);
    expect(indicator.width).toBeGreaterThanOrEqual(1);
    expect(indicator.style).toBe('solid');
    await page.screenshot({
      path: path.join(artifactDir, `keyboard-focus-button-${reduced ? 'reduced' : 'full'}.png`),
    });
  }
}

function pngDimensions(png: Buffer) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function assertChoiceLongListGeometry(page: Page, slug: 'combobox' | 'select') {
  const state = page.locator(`[data-catalog-state="${slug}-long-list"]`);
  const listbox = state.getByRole('listbox');
  const precedingState = state.locator('xpath=preceding-sibling::*[1]');
  const fixture = state.locator('xpath=ancestor::section[@data-catalog-fixture][1]');
  const heading = fixture.getByRole('heading').first();
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
    .locator('xpath=ancestor::section[@data-catalog-fixture][1]');
  await fixture.screenshot({
    path: path.join(artifactDir, `compact-${slug}-initial-long-list.png`),
  });
}

async function exerciseCanonicalPreview(page: Page, slug: (typeof catalogSlugs)[number]) {
  if (slug === 'badge') {
    await expect(page.locator('[data-slot="badge"]').first()).toContainText('Default badge');
  } else if (slug === 'button') {
    const button = page.getByRole('button', { name: '1. Primary', exact: true });
    await button.click();
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Button click count')).toHaveText('2');
  } else if (slug === 'button-group') {
    await expect(page.getByRole('button', { name: 'Copy' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share' })).toHaveAttribute(
      'data-state',
      'active',
    );
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
    const shell = actionPreview.getByRole('region', {
      name: 'Editorial Settings shell',
      exact: true,
    });
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
    await expect(page.getByRole('region', { name: 'Notifications', exact: true })).toHaveAttribute(
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
    if (slug === 'dialog') {
      const initialDialog = page.getByRole('dialog', {
        name: 'Catalog dialog open state',
        exact: true,
      });
      await expect(initialDialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(initialDialog).toBeHidden();
    }
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

// Wave 11 batch 5a (388bffff) retired the home gallery, search, group filter and hash anchors.
async function assertIntroduction(page: Page) {
  await expect(page.getByTestId('catalog-introduction')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Component catalog', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  for (const slug of catalogSlugs) {
    await expect(page.getByRole('main').locator(`a[href="/sandbox/${slug}"]`)).toBeVisible();
  }
  const dialog = page.getByRole('main').locator('a[href="/sandbox/dialog"]');
  await dialog.focus();
  await dialog.press('Enter');
  await expect(page).toHaveURL(/\/sandbox\/dialog(?:\?|$)/);
  await expect(page.locator('[data-catalog-preview="dialog"]').first()).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-catalog-preview="dialog"]').first()).toBeVisible();
  await page.goto(`${baseUrl}sandbox`, { waitUntil: 'networkidle' });
  await assertNoPageOverflow(page);
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

async function captureIntroductionArtifacts(page: Page, viewport: string) {
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
      path: path.join(artifactDir, `${viewport}-introduction-${theme}.png`),
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
    const navigation = shell.locator('[data-slot="settings-page-navigation"] .overflow-x-auto');
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
  // Slider port 3ac8fcfc retired the native invalid/accent-color specimen.
  if (slug === 'slider') return;
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
  await expandCustomization(page);
  const control = page.getByRole('radio', {
    name: theme === 'dark' ? 'Dark' : 'Light',
    exact: true,
  });
  if ((await control.getAttribute('aria-checked')) !== 'true') await control.click();
  await expect(control).toHaveAttribute('aria-checked', 'true');
}

async function setReducedMotion(page: Page, enabled: boolean) {
  await expandCustomization(page);
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

async function expandCustomization(page: Page) {
  const toggle = page.getByRole('button', { name: 'Customize preview' });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
}

for (const route of ['', '/button', '/checkbox', '/fields']) {
  test(`shell accessibility and preferences on /sandbox${route}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${baseUrl}sandbox${route}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('main')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Component catalog', exact: true }),
    ).toBeVisible();
    await setCatalogTheme(page, 'dark');
    await setReducedMotion(page, true);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-theme', 'dark');
    await expect(page.getByTestId('catalog-shell')).toHaveAttribute(
      'data-catalog-motion',
      'reduced',
    );
    await expandCustomization(page);
    const motion = await page
      .getByRole('switch', { name: 'Reduce motion' })
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(maxDurationMs(motion)).toBeLessThanOrEqual(0.01);
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: () => Promise<{ violations: unknown[] }> } })
        .axe;
      return (await axe.run()).violations;
    });
    expect(violations).toEqual([]);
  });
}
