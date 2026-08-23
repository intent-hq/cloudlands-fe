import { expect, test, type Page } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';

test.describe.configure({ mode: 'serial' });

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await createServer({
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => server?.close());

async function mountSurface(
  page: Page,
  options: {
    message: string;
    theme: 'light' | 'dark';
    transcriptWidth: number;
    viewport: { width: number; height: number };
    zoom?: number;
  },
) {
  const zoom = options.zoom ?? 1;
  await page.setViewportSize(options.viewport);
  await page.emulateMedia({ colorScheme: options.theme });
  await page.goto(`${baseUrl}src/app.html`);
  await page.addStyleTag({ url: `${baseUrl}src/app.css` });
  await page.evaluate(async ({ message, theme, transcriptWidth, zoom: scale }) => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    const [{ mount, tick }, { default: Host }] = await Promise.all([
      import('/@id/svelte'),
      import('/test/fixtures/UserMessageSurfaceHost.svelte'),
    ]);
    document.documentElement.className = theme;
    document.documentElement.style.height = '100%';
    document.body.style.cssText = 'margin:0;width:100%;height:100%;overflow:auto;';
    document.body.replaceChildren();
    const target = document.createElement('div');
    target.style.cssText = `width:${100 / scale}%;min-height:${100 / scale}%;zoom:${scale};`;
    document.body.append(target);
    mount(Host, { target, props: { message, transcriptWidth } });
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, options);
}

async function readSurface(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-testid="message-host"]')!;
    const transcript = document.querySelector<HTMLElement>('[data-testid="transcript"]')!;
    const surface = document.querySelector<HTMLElement>('[data-testid="user-message-surface"]')!;
    const pinned = document.querySelector<HTMLElement>('[data-testid="pinned-user-prompt"]')!;
    const sidebar = document.querySelector<HTMLElement>('[data-testid="sidebar-reference"]')!;
    const text = surface.querySelector<HTMLElement>('.select-text')!;
    const assistant = document.querySelector<HTMLElement>('[data-testid="assistant-message"]')!;
    const style = getComputedStyle(surface);
    const pinnedStyle = getComputedStyle(pinned);
    const textStyle = getComputedStyle(text);
    const rect = surface.getBoundingClientRect();
    const transcriptRect = transcript.getBoundingClientRect();
    const channels = (color: string) =>
      (color.match(/[0-9.]+/g) ?? [])
        .slice(0, 3)
        .map(Number)
        .map((channel) => channel / 255);
    const luminance = (color: string) => {
      const [red, green, blue] = channels(color).map((channel) =>
        channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const lighter = Math.max(luminance(textStyle.color), luminance(style.backgroundColor));
    const darker = Math.min(luminance(textStyle.color), luminance(style.backgroundColor));
    return {
      background: style.backgroundColor,
      pinnedBackground: pinnedStyle.backgroundColor,
      sidebarBackground: getComputedStyle(sidebar).backgroundColor,
      hostBackground: getComputedStyle(host).backgroundColor,
      assistantBackground: getComputedStyle(assistant).backgroundColor,
      contrast: (lighter + 0.05) / (darker + 0.05),
      borderRadius: style.borderRadius,
      borderWidth: style.borderTopWidth,
      pinnedBorderWidth: pinnedStyle.borderTopWidth,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      userSelect: textStyle.userSelect,
      widthDelta: Math.abs(rect.width - transcriptRect.width),
      clipped: surface.scrollWidth > surface.clientWidth || document.body.scrollWidth > innerWidth,
    };
  });
}

test('uses the computed sidebar surface in light and dark themes', async ({ page }) => {
  const backgrounds: string[] = [];
  const cases = [
    { theme: 'light' as const, zoom: 1, transcriptWidth: 640 },
    { theme: 'dark' as const, zoom: 1, transcriptWidth: 640 },
    { theme: 'light' as const, zoom: 2, transcriptWidth: 440 },
    { theme: 'dark' as const, zoom: 2, transcriptWidth: 440 },
  ];
  for (const scenario of cases) {
    await mountSurface(page, {
      message: 'A short user prompt.\nA second line stays inside the same surface.',
      ...scenario,
      viewport: { width: 960, height: scenario.zoom === 1 ? 720 : 1200 },
    });
    const state = await readSurface(page);
    backgrounds.push(state.background);
    expect(state.background).toBe(state.sidebarBackground);
    expect(state.pinnedBackground).toBe(state.sidebarBackground);
    expect(state.background).not.toBe(state.hostBackground);
    expect(state.assistantBackground).toBe('rgba(0, 0, 0, 0)');
    expect(state.contrast).toBeGreaterThanOrEqual(4.5);
    expect(state.borderRadius).toBe('9px');
    expect(state.borderWidth).toBe('0px');
    expect(state.pinnedBorderWidth).toBe('0px');
    expect(state.padding).toEqual(['8px', '12px', '8px', '12px']);
    expect(state.userSelect).toBe('text');
    expect(state.widthDelta).toBeLessThanOrEqual(1);
    expect(state.clipped).toBe(false);
  }
  expect(new Set(backgrounds).size).toBe(2);

  const pinned = page.getByTestId('pinned-user-prompt');
  await pinned.hover();
  await pinned.focus();
  await expect(pinned).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pinned-activation')).toHaveText('true');
});

test('contains narrow, wide, multiline, and 200% zoom states', async ({ page }) => {
  const message = Array.from(
    { length: 8 },
    (_, index) =>
      `Line ${index + 1} contains enough words to wrap without clipping at narrow widths.`,
  ).join('\n');
  const cases = [
    { viewport: { width: 360, height: 720 }, transcriptWidth: 320, theme: 'dark' as const },
    { viewport: { width: 1200, height: 720 }, transcriptWidth: 880, theme: 'light' as const },
    {
      viewport: { width: 960, height: 1200 },
      transcriptWidth: 440,
      theme: 'dark' as const,
      zoom: 2,
    },
  ];
  for (const scenario of cases) {
    await mountSurface(page, { ...scenario, message });
    const state = await readSurface(page);
    expect(state.widthDelta).toBeLessThanOrEqual(1);
    expect(state.clipped).toBe(false);
  }
});

test('keeps sidebar parity and readable text in forced colors', async ({ page }) => {
  await mountSurface(page, {
    message: 'A forced-colors user prompt remains readable and actionable.',
    theme: 'light',
    transcriptWidth: 320,
    viewport: { width: 360, height: 720 },
  });
  await page.emulateMedia({ forcedColors: 'active' });
  const state = await readSurface(page);

  expect(state.background).toBe(state.sidebarBackground);
  expect(state.pinnedBackground).toBe(state.sidebarBackground);
  expect(state.contrast).toBeGreaterThanOrEqual(4.5);
  expect(state.clipped).toBe(false);
  await page.getByTestId('pinned-user-prompt').focus();
  await expect(page.getByTestId('pinned-user-prompt')).toBeFocused();
});
