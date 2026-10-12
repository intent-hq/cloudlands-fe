import { expect, type Page, type TestInfo } from '@playwright/test';
import { test } from './root-browser-fixtures';
import { createServer, type ViteDevServer } from 'vite';
import { copyFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';
import { inlineHtmlDemo, inlineHtmlMessage } from './fixtures/inline-html-demo';

type HostProps = {
  message?: string;
  isStreaming?: boolean;
  renderer?: 'static' | 'streaming' | 'before';
  role?: 'assistant' | 'user';
};

let server: ViteDevServer | undefined;
let baseUrl = process.env.UI_PREVIEW_BASE_URL ?? '';
const artifactDirectory = resolve('../../.intent/artifacts/inline-html');
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

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await mkdir(artifactDirectory, { recursive: true });
  await copyFile(path, resolve(artifactDirectory, `${name}.png`));
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

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

test('keeps unfinished and empty blocks inert and renders after a matching close', async ({
  page,
}, testInfo) => {
  const unfinished = `~~~ws-block:html\n${inlineHtmlDemo}`;
  await openChat(page, { message: unfinished, isStreaming: true });
  await expect(preview(page)).toBeVisible();
  await expect(preview(page).locator('iframe')).toHaveCount(0);
  await capture(page, testInfo, 'unfinished');
  await updateHost(page, { isStreaming: false });
  await expect(preview(page)).toHaveAttribute('data-inline-html-status', 'incomplete');
  await expect(preview(page).locator('iframe')).toHaveCount(0);
  await capture(page, testInfo, 'incomplete');
  await updateHost(page, { message: `${unfinished}\n~~~` });
  await expect(frame(page).getByRole('slider')).toBeVisible();
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
