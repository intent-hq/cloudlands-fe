import { expect, type Page, type TestInfo } from '@playwright/test';
import { test } from './root-browser-fixtures';
import { createServer, type ViteDevServer } from 'vite';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';
import { inlineHtmlDemo, inlineHtmlMessage } from './fixtures/inline-html-demo';
import { polishedClampDemo, polishedEscalatorDemo } from './fixtures/inline-html-polished-demo';

type HostProps = {
  message?: string;
  isStreaming?: boolean;
  renderer?: 'static' | 'streaming' | 'before';
  role?: 'assistant' | 'user';
  scrollable?: boolean;
  follow?: boolean;
  tailHeight?: number;
  prompt?: string;
};

let server: ViteDevServer | undefined;
let baseUrl = process.env.UI_PREVIEW_BASE_URL ?? '';
const artifactDirectory = resolve('../../.intent/artifacts/inline-html');
const polishDirectory = resolve(artifactDirectory, 'polish');
const appPolicy = readFileSync(resolve('src/app.html'), 'utf8').match(
  /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
)![1];

test.describe.configure({ mode: 'default', timeout: 90_000 });
test.beforeAll(async () => {
  if (baseUrl) return;
  server = await createServer({
    cacheDir: viteHarnessCacheDir('inline-html-chat'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? '';
  expect(baseUrl).not.toBe('');
});
test.afterAll(async () => server?.close());

async function updateHost(page: Page, props: HostProps) {
  await page.evaluate((next) => {
    const host = (window as unknown as { inlineHtmlHost: { update(props: HostProps): void } })
      .inlineHtmlHost;
    host.update(next);
  }, props);
}

async function openChat(
  page: Page,
  props: HostProps = {},
  theme: 'light' | 'dark' = 'light',
  width = 1024,
) {
  await page.setViewportSize({ width, height: 840 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/src/app.html`);
  await page.evaluate((policy) => {
    if (document.querySelector('meta[http-equiv="Content-Security-Policy"]')) return;
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = policy;
    document.head.prepend(meta);
  }, appPolicy);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    appPolicy,
  );
  await page.addStyleTag({ url: `${baseUrl}/src/app.css` });
  await page.evaluate(async (selectedTheme) => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    const [{ mount }, { default: Host }] = await Promise.all([
      import('/@id/svelte'),
      import('/test/fixtures/InlineHtmlChatHost.svelte'),
    ]);
    document.documentElement.className = selectedTheme;
    document.body.style.margin = '0';
    document.body.replaceChildren();
    Object.assign(window, { inlineHtmlHost: mount(Host, { target: document.body }) });
  }, theme);
  await expect(page.getByTestId('inline-html-chat')).toBeVisible({ timeout: 60_000 });
  await updateHost(page, props);
  await page.evaluate(() => document.fonts.ready);
}

function preview(page: Page) {
  return page.locator('[data-inline-html]').first();
}

function frame(page: Page) {
  return preview(page).locator('iframe').contentFrame().locator('iframe').contentFrame();
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
  directory = artifactDirectory,
) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await mkdir(directory, { recursive: true });
  await copyFile(path, resolve(directory, `${name}.png`));
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function settleWheel(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }),
  );
}

async function saveScrollReceipt(testInfo: TestInfo, name: string, observations: unknown) {
  const body = JSON.stringify(observations, null, 2);
  const directory = resolve(artifactDirectory, 'scroll');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `${name}.json`), body);
  await testInfo.attach(`${name}.json`, { body, contentType: 'application/json' });
}

for (const renderer of ['static', 'streaming'] as const) {
  test(`continues wheel scrolling through a fitted visual in ${renderer} chat`, async ({
    page,
  }, testInfo) => {
    await openChat(page, { renderer, scrollable: true }, renderer === 'static' ? 'light' : 'dark');
    const chat = page.getByTestId('inline-html-scroll-container');
    const scrollTop = () => chat.evaluate((element) => element.scrollTop);
    await expect(frame(page).getByRole('slider')).toBeVisible();
    await frame(page).getByRole('slider').focus();
    await page.keyboard.press('End');
    await chat.evaluate((element) => {
      const visual = element.querySelector('[data-inline-html]')!;
      element.scrollTop += visual.getBoundingClientRect().top - 120;
    });
    await frame(page).locator('svg').hover();
    const before = await scrollTop();
    if (renderer === 'static') await capture(page, testInfo, 'scroll-start');
    await page.mouse.wheel(0, 180);
    await expect.poll(async () => Math.abs((await scrollTop()) - before - 180)).toBeLessThan(2);
    const down = await scrollTop();
    if (renderer === 'static') await capture(page, testInfo, 'scroll-chat-moved');
    await page.mouse.wheel(0, -120);
    await expect.poll(async () => Math.abs((await scrollTop()) - down + 120)).toBeLessThan(2);
    const up = await scrollTop();
    await frame(page).locator('svg').hover();
    const horizontalStart = await scrollTop();
    await page.mouse.wheel(160, 0);
    await settleWheel(page);
    const horizontalEnd = await scrollTop();
    expect(horizontalEnd).toBe(horizontalStart);
    await expect(frame(page).locator('#thickness-value')).toHaveText('80 mm');

    await updateHost(page, { tailHeight: 100, follow: true });
    await expect(chat).toHaveAttribute('data-following', 'true');
    await frame(page).locator('svg').hover();
    const followingStart = await scrollTop();
    await page.mouse.wheel(0, -160);
    await expect(chat).toHaveAttribute('data-following', 'false');
    await expect.poll(() => scrollTop()).toBeLessThan(followingStart - 100);
    const readingPosition = await scrollTop();
    await updateHost(page, {
      message: `${inlineHtmlMessage()}\n\nNew explanation arrives while you read.`,
      isStreaming: renderer === 'streaming',
    });
    await settleWheel(page);
    expect(await scrollTop()).toBe(readingPosition);
    await expect(frame(page).locator('#thickness-value')).toHaveText('80 mm');
    await saveScrollReceipt(testInfo, `fitted-${renderer}`, {
      before,
      down,
      up,
      horizontalStart,
      horizontalEnd,
      followingStart,
      readingPosition,
      afterNewText: await scrollTop(),
      retainedThickness: 80,
    });
  });
}

test('hands wheel scrolling from nested and tall content back to chat at either boundary', async ({
  page,
}, testInfo) => {
  const source = `<h2>Scroll inside the visual</h2>
    <div id="nested" style="height:180px;overflow:auto"><div style="height:900px">Nested content</div></div>
    <div id="pan" style="height:80px">Local gesture: <output id="gestures">0</output></div>
    <script>window.addEventListener('wheel', event => {
      if (event.target.closest('#pan')) {
        event.preventDefault();
        document.getElementById('gestures').textContent = Number(document.getElementById('gestures').textContent) + 1;
      }
    }, { passive: false });</script>`;
  await openChat(page, { message: inlineHtmlMessage(source), scrollable: true });
  const chat = page.getByTestId('inline-html-scroll-container');
  const scrollTop = () => chat.evaluate((element) => element.scrollTop);
  await expect(preview(page)).toHaveAttribute('data-inline-html-status', 'ready');
  await chat.evaluate((element) => {
    element.scrollTop +=
      element.querySelector('[data-inline-html]')!.getBoundingClientRect().top - 120;
  });
  const nested = frame(page).locator('#nested');
  await nested.hover();
  const before = await scrollTop();
  await page.mouse.wheel(0, 160);
  await expect.poll(() => nested.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  expect(await scrollTop()).toBe(before);
  const nestedScroll = await nested.evaluate((element) => element.scrollTop);
  await nested.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => Math.abs((await scrollTop()) - before - 120)).toBeLessThan(2);
  const nestedBottom = await scrollTop();
  await nested.evaluate((element) => (element.scrollTop = 0));
  await nested.hover();
  const reverseStart = await scrollTop();
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Math.abs((await scrollTop()) - reverseStart + 100)).toBeLessThan(2);
  const nestedTop = await scrollTop();
  await frame(page).locator('#pan').hover();
  const gestureStart = await scrollTop();
  await page.mouse.wheel(0, 120);
  await expect(frame(page).locator('#gestures')).toHaveText('1');
  await settleWheel(page);
  const gestureEnd = await scrollTop();
  expect(gestureEnd).toBe(gestureStart);

  await updateHost(page, {
    message: inlineHtmlMessage('<div style="height:3000px"><p>Tall content</p></div>'),
  });
  await expect(preview(page)).toHaveAttribute('data-inline-html-status', 'ready');
  await chat.evaluate((element) => {
    element.scrollTop +=
      element.querySelector('[data-inline-html]')!.getBoundingClientRect().top - 70;
  });
  const outer = await preview(page).locator('iframe').boundingBox();
  await page.mouse.move(outer!.x + 100, outer!.y + 100);
  const tallStart = await scrollTop();
  await page.mouse.wheel(0, 200);
  const innerScroll = () =>
    frame(page)
      .locator('body')
      .evaluate((body) => body.ownerDocument.scrollingElement!.scrollTop);
  await expect.poll(() => innerScroll()).toBeGreaterThan(100);
  expect(await scrollTop()).toBe(tallStart);
  const tallScroll = await innerScroll();
  await frame(page)
    .locator('body')
    .evaluate((body) => {
      const root = body.ownerDocument.scrollingElement!;
      root.scrollTop = root.scrollHeight;
    });
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => Math.abs((await scrollTop()) - tallStart - 100)).toBeLessThan(2);
  const tallBottom = await scrollTop();
  await capture(page, testInfo, 'scroll-tall-handoff');
  await frame(page)
    .locator('body')
    .evaluate((body) => {
      body.ownerDocument.scrollingElement!.scrollTop = 0;
    });
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Math.abs((await scrollTop()) - tallBottom + 100)).toBeLessThan(2);
  await saveScrollReceipt(testInfo, 'nested-and-tall', {
    before,
    nestedScroll,
    nestedBottom,
    nestedTop,
    gestureStart,
    gestureEnd,
    tallStart,
    tallScroll,
    tallBottom,
    tallTop: await scrollTop(),
  });
});

test('keeps scroll input private and preserves modified wheel gestures', async ({
  page,
}, testInfo) => {
  const source = `<div id="surface" style="height:220px">Scroll input stays isolated</div>
    <script>window.addEventListener('message', event => {
      if (event.ports.length) window.stolenScrollPort = event.ports[0];
    }, true);
    const channel = document.head.querySelector('script').textContent.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)[0];
    const forged = new MessageChannel();
    window.forgedScrollPort = forged.port1;
    parent.postMessage({ channel, type: 'scroll-port' }, '*', [forged.port2]);
    forged.port1.postMessage({ deltaY: 120 });
    </script>`;
  await openChat(page, { message: inlineHtmlMessage(source), scrollable: true });
  const chat = page.getByTestId('inline-html-scroll-container');
  const scrollTop = () => chat.evaluate((element) => element.scrollTop);
  await expect(preview(page)).toHaveAttribute('data-inline-html-status', 'ready');
  await frame(page).locator('#surface').hover();
  await settleWheel(page);
  const before = await scrollTop();
  const stolenPort = await frame(page)
    .locator('body')
    .evaluate((body) => {
      const local = body.ownerDocument.defaultView!;
      const channel = body.ownerDocument.head
        .querySelector('script')!
        .textContent!.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)![0];
      (local as unknown as { forgedScrollPort: MessagePort }).forgedScrollPort.postMessage({
        deltaY: 120,
      });
      for (const deltaY of [120, NaN, Infinity, 999999, '120']) {
        local.parent.postMessage({ channel, type: 'wheel', deltaY }, '*');
        local.top!.postMessage({ channel, type: 'wheel', deltaY }, '*');
      }
      body.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
      return 'stolenScrollPort' in local;
    });
  await page.evaluate(() => {
    const source = document.querySelector<HTMLIFrameElement>('[data-inline-html] iframe')!.srcdoc;
    const channel = source.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)![0];
    window.postMessage({ channel, type: 'wheel', deltaY: 120 }, '*');
  });
  await settleWheel(page);
  const afterForged = await scrollTop();
  expect(stolenPort).toBe(false);
  expect(afterForged).toBe(before);
  await page.evaluate(() => {
    const local = window as unknown as { forwardedWheel: number[] };
    local.forwardedWheel = [];
    const shell = document.querySelector<HTMLIFrameElement>('[data-inline-html] iframe')!;
    window.addEventListener('message', (event) => {
      if (event.source === shell.contentWindow && event.data?.type === 'wheel') {
        local.forwardedWheel.push(event.data.deltaY);
      }
    });
  });
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Control');
  await settleWheel(page);
  const afterZoom = await scrollTop();
  const modifiedForwarding = await page.evaluate(
    () => (window as unknown as { forwardedWheel: number[] }).forwardedWheel,
  );
  expect(modifiedForwarding).toEqual([]);
  await page.mouse.wheel(0, -120);
  await expect.poll(() => scrollTop()).toBeLessThan(afterZoom - 100);
  await saveScrollReceipt(testInfo, 'private-input', {
    before,
    afterForged,
    afterZoom,
    modifiedForwarding,
    stolenPort,
    afterTrustedWheel: await scrollTop(),
  });
});

for (const renderer of ['static', 'streaming'] as const) {
  test(`runs the interactive visual in ${renderer} chat`, async ({ page }, testInfo) => {
    await openChat(page, { renderer }, 'dark');
    await expect(frame(page).getByRole('slider')).toBeVisible();
    await expect
      .poll(() =>
        frame(page)
          .locator('body')
          .evaluate((body) =>
            [...body.ownerDocument.fonts].some(
              (font) => font.family.replace(/['"]/g, '') === 'Inter' && font.status === 'loaded',
            ),
          ),
      )
      .toBe(true);
    await expect(frame(page).locator('#fit')).toHaveText('Fits');
    await frame(page).getByRole('slider').focus();
    await page.keyboard.press('End');
    await expect(frame(page).locator('#fit')).toHaveText('Opening too small');
    await expect(frame(page).locator('#clearance')).toHaveText('20 mm over');
    await capture(page, testInfo, `${renderer}-too-thick`);
    await page.keyboard.press('Home');
    await expect(frame(page).locator('#clearance')).toHaveText('50 mm spare');
    await page.keyboard.press('ArrowRight');
    await expect(frame(page).locator('#thickness-value')).toHaveText('11 mm');
    await testInfo.attach('interaction.json', {
      body: JSON.stringify({
        renderer,
        keyboard: ['End', 'Home', 'ArrowRight'],
        finalThickness: 11,
      }),
      contentType: 'application/json',
    });
  });
}

test('shows source and follows themes without resetting input or later streaming', async ({
  page,
}, testInfo) => {
  await openChat(page, { isStreaming: true }, 'light');
  await expect(frame(page).getByRole('slider')).toBeVisible();
  await capture(page, testInfo, 'after-light');
  await frame(page).getByRole('slider').focus();
  await page.keyboard.press('End');
  const beforeColor = await frame(page)
    .locator('body')
    .evaluate((body) => getComputedStyle(body).color);
  await preview(page)
    .getByRole('button', { name: /source/i })
    .click();
  await expect(preview(page).locator('pre')).toContainText('updateFit');
  await capture(page, testInfo, 'source');
  await preview(page)
    .getByRole('button', { name: /preview|hide source/i })
    .click();
  await expect(frame(page).locator('#thickness-value')).toHaveText('80 mm');
  await page.evaluate(() => (document.documentElement.className = 'dark'));
  await expect
    .poll(() =>
      frame(page)
        .locator('body')
        .evaluate((body) => getComputedStyle(body).color),
    )
    .not.toBe(beforeColor);
  await updateHost(page, {
    message: `${inlineHtmlMessage()}\n\nMore explanation arrives after the completed visual.`,
    isStreaming: true,
  });
  await expect(frame(page).locator('#thickness-value')).toHaveText('80 mm');
  await updateHost(page, { isStreaming: false });
  await expect(frame(page).locator('#thickness-value')).toHaveText('80 mm');
  await preview(page)
    .getByRole('button', { name: /reload|restart/i })
    .click();
  await expect(frame(page).locator('#thickness-value')).toHaveText('28 mm');
  await capture(page, testInfo, 'after-dark');
});

test('keeps polished clamp controls usable through themes, narrow layouts, and source inspection', async ({
  page,
}, testInfo) => {
  const message = `\`\`\`ws-block:html\n${polishedClampDemo}\n\`\`\``;
  await openChat(page, { message });
  const slider = frame(page).getByRole('slider', { name: 'Desk thickness' });
  await expect(slider).toBeVisible();
  await capture(page, testInfo, 'clamp-light', polishDirectory);
  await slider.focus();
  await page.keyboard.press('End');
  await expect(frame(page).locator('#fit')).toHaveText('Opening too small');
  await expect(frame(page).locator('#clearance')).toHaveText('20 mm over');
  await capture(page, testInfo, 'clamp-too-thick', polishDirectory);
  await page.evaluate(() => (document.documentElement.className = 'dark'));
  await expect(frame(page).locator('html')).toHaveClass('dark');
  await expect(frame(page).locator('#thickness-value')).toHaveText('80 mm');
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(frame(page).locator('#clearance')).toHaveText('50 mm clearance');
  await page.keyboard.press('ArrowRight');
  await expect(frame(page).locator('#thickness-value')).toHaveText('11 mm');
  await capture(page, testInfo, 'clamp-dark', polishDirectory);
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(slider).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await capture(page, testInfo, 'clamp-narrow-dark', polishDirectory);
  await preview(page)
    .getByRole('button', { name: /source/i })
    .click();
  await expect(preview(page).locator('pre')).toContainText('updateFit');
  await preview(page)
    .getByRole('button', { name: /preview|hide source/i })
    .click();
  await expect(frame(page).locator('#thickness-value')).toHaveText('11 mm');
  await updateHost(page, { message: `${message}\n\nMore explanation.`, isStreaming: true });
  await expect(frame(page).locator('#thickness-value')).toHaveText('11 mm');
  await updateHost(page, { isStreaming: false });
  await preview(page)
    .getByRole('button', { name: /reload|restart/i })
    .click();
  await expect(frame(page).locator('#thickness-value')).toHaveText('28 mm');
  await page.evaluate(() => (document.documentElement.className = 'light'));
  await expect(frame(page).locator('html')).not.toHaveClass(/dark/);
  await capture(page, testInfo, 'clamp-narrow-light', polishDirectory);
  await testInfo.attach('clamp-interaction.json', {
    body: JSON.stringify({
      keyboard: ['End', 'Home', 'ArrowRight'],
      retainedThickness: 11,
      reloadThickness: 28,
      narrowWidth: 360,
    }),
    contentType: 'application/json',
  });
});

test('keeps polished escalator playback and position controls usable as the scene reflows', async ({
  page,
}, testInfo) => {
  const message = `\`\`\`ws-block:html\n${polishedEscalatorDemo}\n\`\`\``;
  await openChat(page, { message, prompt: 'Show me why escalator steps stay level.' });
  const slider = frame(page).getByRole('slider', { name: 'Position' });
  await expect(slider).toBeVisible();
  await capture(page, testInfo, 'escalator-light', polishDirectory);
  await slider.focus();
  await page.keyboard.press('End');
  await expect(frame(page).locator('#position-value')).toHaveText('100%');
  await expect(frame(page).locator('#description')).toContainText('Both tracks are horizontal');
  await capture(page, testInfo, 'escalator-landing', polishDirectory);
  await frame(page).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(frame(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(() => slider.inputValue()).not.toBe('540');
  await frame(page).getByRole('button', { name: 'Pause', exact: true }).click();
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(frame(page).locator('#position-value')).toHaveText('0%');
  await expect(frame(page).locator('#description')).toContainText('Both rollers climb together');
  await page.evaluate(() => (document.documentElement.className = 'dark'));
  await expect(frame(page).locator('html')).toHaveClass('dark');
  await expect(slider).toHaveValue('180');
  await capture(page, testInfo, 'escalator-dark', polishDirectory);
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(slider).toBeVisible();
  await expect(frame(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.keyboard.press('End');
  await expect(frame(page).locator('#position-value')).toHaveText('100%');
  await capture(page, testInfo, 'escalator-narrow-dark', polishDirectory);
  await page.evaluate(() => (document.documentElement.className = 'light'));
  await expect(frame(page).locator('html')).not.toHaveClass(/dark/);
  await capture(page, testInfo, 'escalator-narrow-light', polishDirectory);
  await testInfo.attach('escalator-interaction.json', {
    body: JSON.stringify({
      keyboard: ['End', 'Home'],
      playback: ['Play', 'Pause'],
      retainedPosition: 180,
      narrowWidth: 360,
    }),
    contentType: 'application/json',
  });
});

test('keeps unfinished and empty blocks inert and renders after a matching close', async ({
  page,
}, testInfo) => {
  const unfinished = `~~~ws-block:html\n${inlineHtmlDemo}`;
  await openChat(page, { message: unfinished, isStreaming: true });
  await expect(preview(page)).toBeVisible();
  await expect(preview(page)).toHaveAttribute('aria-busy', 'true');
  await expect(preview(page).locator('iframe')).toHaveCount(0);
  await capture(page, testInfo, 'loading-light');
  await preview(page)
    .getByRole('button', { name: /source/i })
    .click();
  await expect(preview(page).locator('pre')).toContainText('updateFit');
  await capture(page, testInfo, 'loading-source');
  await preview(page)
    .getByRole('button', { name: /preview|hide source/i })
    .click();
  await expect(preview(page).locator('iframe')).toHaveCount(0);
  await page.evaluate(() => (document.documentElement.className = 'dark'));
  await capture(page, testInfo, 'loading-dark');
  await page.setViewportSize({ width: 360, height: 840 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await capture(page, testInfo, 'loading-narrow-dark');
  await page.setViewportSize({ width: 1024, height: 840 });
  await page.evaluate(() => (document.documentElement.className = 'light'));
  await updateHost(page, { isStreaming: false });
  await expect(preview(page)).toHaveAttribute('data-inline-html-status', 'incomplete');
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false');
  await expect(preview(page).locator('iframe')).toHaveCount(0);
  await capture(page, testInfo, 'incomplete');
  await updateHost(page, { message: `${unfinished}\n~~~` });
  await expect(frame(page).getByRole('slider')).toBeVisible();
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false');
  await updateHost(page, { message: '```ws-block:html\n\n```' });
  await expect(preview(page)).toHaveAttribute('data-inline-html-status', 'empty');
  await expect(preview(page).locator('iframe')).toHaveCount(0);
  await capture(page, testInfo, 'empty');
});

test('keeps ordinary HTML, quoted examples, and user-authored fences as source', async ({
  page,
}, testInfo) => {
  await openChat(page, { message: inlineHtmlMessage().replace('ws-block:html', 'html') });
  await expect(page.locator('[data-inline-html]')).toHaveCount(0);
  await expect(page.locator('pre')).toContainText('updateFit');
  await updateHost(page, {
    message: `\`\`\`\`markdown\n${inlineHtmlMessage()}\n\`\`\`\``,
  });
  await expect(page.locator('[data-inline-html]')).toHaveCount(0);
  await expect(page.locator('pre')).toContainText('ws-block:html');
  await updateHost(page, { message: inlineHtmlMessage(), role: 'user' });
  await expect(page.locator('[data-inline-html]')).toHaveCount(0);
  await expect(page.locator('pre')).toContainText('updateFit');
  await capture(page, testInfo, 'literal-user-fence');
  await updateHost(page, { message: inlineHtmlMessage(inlineHtmlDemo, '~~~~'), role: 'assistant' });
  await expect(frame(page).getByRole('slider')).toBeVisible();
});

test('fits a narrow chat and resizes as interactive content grows and shrinks', async ({
  page,
}, testInfo) => {
  await openChat(page, {}, 'dark', 360);
  await expect(frame(page).getByRole('slider')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await capture(page, testInfo, 'narrow-dark');
  const source = `<button id="toggle">Toggle details</button><div id="details"></div>
    <script>document.getElementById('toggle').onclick = () => {
      const details = document.getElementById('details');
      details.style.height = details.style.height ? '' : '440px';
    };</script>`;
  await updateHost(page, { message: inlineHtmlMessage(source) });
  await expect(frame(page).getByRole('button', { name: 'Toggle details' })).toBeVisible();
  const collapsed = (await preview(page).locator('iframe').boundingBox())!.height;
  await frame(page).getByRole('button', { name: 'Toggle details' }).click();
  await expect
    .poll(async () => (await preview(page).locator('iframe').boundingBox())!.height)
    .toBeGreaterThan(collapsed + 300);
  const expanded = (await preview(page).locator('iframe').boundingBox())!.height;
  await frame(page).getByRole('button', { name: 'Toggle details' }).click();
  await expect
    .poll(async () => (await preview(page).locator('iframe').boundingBox())!.height)
    .toBeLessThan(collapsed + 2);
  await updateHost(page, {
    message: inlineHtmlMessage('<div style="height:5000px">Tall visual</div>'),
  });
  await expect(frame(page).getByText('Tall visual')).toBeVisible();
  await expect
    .poll(async () => (await preview(page).locator('iframe').boundingBox())!.height)
    .toBeLessThanOrEqual(1600);
  await capture(page, testInfo, 'tall-bounded');
  await testInfo.attach('sizing.json', {
    body: JSON.stringify({ viewport: 360, overflow, collapsed, expanded }),
    contentType: 'application/json',
  });
});

test('contains runtime failures and retains readable source', async ({ page }, testInfo) => {
  await openChat(page, {
    message: inlineHtmlMessage(
      '<p>Visual content</p><script>throw new Error("Demo failure")</script>',
    ),
  });
  await expect(preview(page)).toHaveAttribute('data-inline-html-status', 'error');
  await expect(preview(page)).toContainText('Demo failure');
  await preview(page)
    .getByRole('button', { name: /source/i })
    .click();
  await expect(preview(page).locator('pre')).toContainText('Demo failure');
  await capture(page, testInfo, 'runtime-error');
});

test('blocks app access, network requests, frames, forms, popups, and top navigation', async ({
  page,
}, testInfo) => {
  const outgoing: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('__inline_html_blocked__')) outgoing.push(request.url());
  });
  await openChat(page);
  const originalUrl = page.url();
  const target = `${baseUrl}/__inline_html_blocked__`;
  const source = `<p id="result">Checking isolation</p><script>
    (async () => {
      const result = {};
      try { parent.document.body.dataset.compromised = 'true'; result.parent = 'accessible'; }
      catch { result.parent = 'blocked'; }
      try { localStorage.setItem('probe', 'secret'); result.storage = 'accessible'; }
      catch { result.storage = 'blocked'; }
      result.bridge = typeof window.electronAPI === 'undefined' ? 'absent' : 'accessible';
      try { await fetch(${JSON.stringify(target)}); result.fetch = 'allowed'; }
      catch { result.fetch = 'blocked'; }
      try { result.socket = await new Promise(resolve => {
        const socket = new WebSocket(${JSON.stringify(target.replace('http:', 'ws:'))});
        socket.onopen = () => { socket.close(); resolve('allowed'); };
        socket.onerror = () => resolve('blocked');
      }); } catch { result.socket = 'blocked'; }
      result.popup = window.open(${JSON.stringify(target)}) === null ? 'blocked' : 'allowed';
      const form = document.createElement('form'); form.action = ${JSON.stringify(target)};
      document.body.append(form); form.submit();
      const nested = document.createElement('iframe'); nested.src = ${JSON.stringify(target)};
      document.body.append(nested);
      const link = document.createElement('a'); link.href = ${JSON.stringify(target)}; link.target = '_top';
      document.body.append(link); link.click();
      document.getElementById('result').textContent = JSON.stringify(result);
    })();</script>`;
  await updateHost(page, { message: inlineHtmlMessage(source) });
  await expect(frame(page).locator('#result')).toContainText('"fetch":"blocked"');
  const result = JSON.parse((await frame(page).locator('#result').textContent())!);
  expect(result).toMatchObject({
    parent: 'blocked',
    storage: 'blocked',
    bridge: 'absent',
    fetch: 'blocked',
    socket: 'blocked',
    popup: 'blocked',
  });
  await expect.poll(() => page.url()).toBe(originalUrl);
  expect(await page.locator('body').getAttribute('data-compromised')).toBeNull();
  expect(outgoing).toEqual([]);
  expect(await preview(page).locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
  const originalHeight = (await preview(page).locator('iframe').boundingBox())!.height;
  await page.evaluate(() => {
    const source = document.querySelector<HTMLIFrameElement>('[data-inline-html] iframe')!.srcdoc;
    const channel = source.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)![0];
    window.postMessage({ type: 'resize', height: 999999, channel }, '*');
  });
  expect((await preview(page).locator('iframe').boundingBox())!.height).toBe(originalHeight);
  await capture(page, testInfo, 'isolated');
  const shell = preview(page).locator('iframe').contentFrame();
  await shell.locator('body').evaluate((body) => {
    body.ownerDocument.addEventListener('securitypolicyviolation', (event) => {
      if (event.effectiveDirective === 'frame-src') body.dataset.navigationBlocked = 'true';
    });
  });
  await frame(page)
    .locator('#result')
    .evaluate((element, url) => {
      element.ownerDocument.defaultView!.location.assign(url);
    }, target);
  await expect(shell.locator('body')).toHaveAttribute('data-navigation-blocked', 'true');
  await expect.poll(() => page.url()).toBe(originalUrl);
  expect(outgoing).toEqual([]);
  await testInfo.attach('isolation.json', {
    body: JSON.stringify({ result, outgoing, originalUrl, originalHeight }),
    contentType: 'application/json',
  });
});

test('captures the same message before inline rendering', async ({ page }, testInfo) => {
  await openChat(page, { renderer: 'before' });
  await expect(page.locator('pre')).toContainText('updateFit');
  await capture(page, testInfo, 'before');
});
