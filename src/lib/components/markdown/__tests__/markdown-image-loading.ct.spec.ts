import { expect, test } from '../../../../test/ct-test';
import MarkdownViewer from '../MarkdownViewer.svelte';

const source = 'https://image.test/recover.png?signature=keep%2Fthis';
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="teal"/></svg>';

for (const isStreaming of [false, true]) {
  test(`recovers a transient image failure (${isStreaming ? 'streaming' : 'static'})`, async ({
    mount,
    page,
  }, testInfo) => {
    const requests: string[] = [];
    await page.route(source, async (route) => {
      requests.push(route.request().url());
      await route.fulfill(
        requests.length === 1
          ? { status: 503, body: 'Temporarily unavailable' }
          : { status: 200, contentType: 'image/svg+xml', body: image },
      );
    });
    const component = await mount(MarkdownViewer, {
      props: {
        content: `![chart](${source})`,
        isStreaming,
        media: { [source]: { width: 80, height: 40 } },
      },
    });
    await expect(component.locator('img')).toHaveJSProperty('naturalWidth', 80);
    await expect(component.getByTestId('media-unavailable')).toHaveCount(0);
    await expect(component.locator('[data-loaded]')).toHaveAttribute('data-loaded', 'true');
    expect(requests).toEqual([source, source]);
    await testInfo.attach('recovered-image.png', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
    await testInfo.attach('image-requests.json', {
      body: JSON.stringify(requests),
      contentType: 'application/json',
    });
  });
}

test('bounds persistent failures and lets the reader retry without reattaching', async ({
  mount,
  page,
}, testInfo) => {
  let available = false;
  const requests: string[] = [];
  await page.route(source, async (route) => {
    requests.push(route.request().url());
    await route.fulfill(
      available
        ? { status: 200, contentType: 'image/svg+xml', body: image }
        : { status: 404, body: 'Not available yet' },
    );
  });
  const component = await mount(MarkdownViewer, { props: { content: `![chart](${source})` } });
  const retry = component.getByRole('button', { name: /retry/i });
  await expect(retry).toBeVisible();
  expect(requests).toHaveLength(3);
  await page.clock.install();
  await page.clock.fastForward(10_000);
  expect(requests).toHaveLength(3);
  available = true;
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(component.locator('img')).toHaveJSProperty('naturalWidth', 80);
  await expect(retry).toHaveCount(0);
  await expect(component.locator('img')).toBeFocused();
  expect(requests).toHaveLength(4);
  await testInfo.attach('manual-retry.png', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
  await testInfo.attach('image-requests.json', {
    body: JSON.stringify(requests),
    contentType: 'application/json',
  });
});

for (const removal of ['content', 'unmount'] as const) {
  test(`cancels pending retry after ${removal}`, async ({ mount, page }, testInfo) => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route(source, async (route) => {
      requests += 1;
      await ready;
      await route.fulfill({ status: 503, body: 'Temporarily unavailable' });
    });
    const component = await mount(MarkdownViewer, { props: { content: `![chart](${source})` } });
    await expect.poll(() => requests).toBe(1);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    release();
    await expect(component.locator('img')).toHaveJSProperty('complete', true);
    if (removal === 'content') await component.update({ props: { content: 'New message.' } });
    else await component.unmount();
    await page.clock.fastForward(10_000);
    expect(requests).toBe(1);
    await testInfo.attach('cancelled-retry.json', {
      body: JSON.stringify({ removal, requests }),
      contentType: 'application/json',
    });
  });
}

test('revoking file authority removes a failed workspace image and its retry', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(MarkdownViewer, {
    props: { content: '![chart](intent://local/file/artifacts/plot.png)', workspaceId: 'ws-test' },
  });
  await expect(component.getByRole('button', { name: /retry/i })).toBeVisible();
  await component.update({ props: { allowFileMedia: false } });
  await expect(component.getByRole('button', { name: /retry/i })).toHaveCount(0);
  await expect(component.locator('img[src]')).toHaveCount(0);
  await page.clock.install();
  await page.clock.fastForward(10_000);
  await expect(component.locator('img[src]')).toHaveCount(0);
  await testInfo.attach('file-authority-revoked.png', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
});
