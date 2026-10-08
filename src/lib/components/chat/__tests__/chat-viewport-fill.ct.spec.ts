import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import ChatViewportFillHost from './ChatViewportFillHost.svelte';

test.setTimeout(120_000);
test.use({ viewport: { width: 900, height: 1800 } });

test('fills with serial five-row pages despite virtual spacers, then stays at the bottom', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatViewportFillHost);
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');
  await expect
    .poll(
      async () => JSON.parse(await component.getByTestId('requests').innerText()).requests.length,
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      viewport.evaluate((node) => {
        const first = node.querySelector<HTMLElement>('[data-message-id]');
        // With the newest row bottom-pinned, real content reaches the top;
        // a virtual spacer alone cannot satisfy this assertion.
        return !!first && first.getBoundingClientRect().top <= node.getBoundingClientRect().top;
      }),
    )
    .toBe(true);
  const before = JSON.parse(await component.getByTestId('requests').innerText());
  expect(before.maxInFlight).toBe(1);
  expect(before.requests.every((request: { limit: number }) => request.limit === 5)).toBe(true);
  expect(
    new Set(before.requests.map((request: { nextToken: string }) => request.nextToken)).size,
  ).toBe(before.requests.length);
  await expect
    .poll(() =>
      viewport.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop)),
    )
    .toBeLessThan(3);
  await page.waitForTimeout(400);
  expect(JSON.parse(await component.getByTestId('requests').innerText()).requests.length).toBe(
    before.requests.length,
  );
  await page.screenshot({
    path: '../../.intent/artifacts/five-message-filled.png',
    fullPage: true,
  });
});

test('snapshot refresh preserves the cursor when viewport growth needs more history', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(ChatViewportFillHost, { props: { height: 900 } });
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');
  const result = async () => JSON.parse(await component.getByTestId('requests').innerText());
  await expect
    .poll(() =>
      viewport.evaluate((node) => {
        const first = node.querySelector<HTMLElement>('[data-message-id]');
        return !!first && first.getBoundingClientRect().top <= node.getBoundingClientRect().top;
      }),
    )
    .toBe(true);
  await page.waitForTimeout(400);
  const before = (await result()).requests.length;
  expect(before).toBeGreaterThan(0);
  await component.update({ props: { height: 1600, refreshSnapshot: true } });
  await expect.poll(async () => (await result()).requests.length).toBeGreaterThan(before);
  await expect
    .poll(() =>
      viewport.evaluate((node) => {
        const first = node.querySelector<HTMLElement>('[data-message-id]');
        return !!first && first.getBoundingClientRect().top <= node.getBoundingClientRect().top;
      }),
    )
    .toBe(true);
  await page.waitForTimeout(400);
  const { requests, maxInFlight } = await result();
  await testInfo.attach('conversation-requests', {
    body: JSON.stringify({ requests, maxInFlight }, null, 2),
    contentType: 'application/json',
  });
  expect(maxInFlight).toBe(1);
  expect(new Set(requests.map((request: { nextToken: string }) => request.nextToken)).size).toBe(
    requests.length,
  );
  for (const request of requests) {
    expect(request).toMatchObject({
      agentId: 'primary',
      workspaceId: 'viewport-fill',
      limit: 5,
      projection: 'slim',
    });
    expect(request.aroundMessageId).toBeUndefined();
  }
});

test('large hydrated rows need no history, but shrinking their content remeasures', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatViewportFillHost, { props: { scenario: 'large' } });
  await expect(component.locator('[data-lazy-visible="true"]').first()).toBeVisible();
  await page.waitForTimeout(400);
  expect(JSON.parse(await component.getByTestId('requests').innerText()).requests).toEqual([]);
  await component.update({ props: { scenario: 'large', compact: true } });
  await expect
    .poll(
      async () => JSON.parse(await component.getByTestId('requests').innerText()).requests.length,
    )
    .toBeGreaterThan(0);
});

test('viewport growth fills again and inactive panels fetch nothing', async ({ mount, page }) => {
  const component = await mount(ChatViewportFillHost, { props: { active: false, height: 900 } });
  await page.waitForTimeout(400);
  expect(JSON.parse(await component.getByTestId('requests').innerText()).requests).toEqual([]);
  await component.update({ props: { active: true, height: 900 } });
  await expect
    .poll(
      async () => JSON.parse(await component.getByTestId('requests').innerText()).requests.length,
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(500);
  const count = JSON.parse(await component.getByTestId('requests').innerText()).requests.length;
  await component.update({ props: { active: true, height: 1400 } });
  await expect
    .poll(
      async () => JSON.parse(await component.getByTestId('requests').innerText()).requests.length,
    )
    .toBeGreaterThan(count);
});

for (const scenario of ['error', 'stalled'] as const) {
  test(`${scenario} page stops automatic retries through resize`, async ({ mount, page }) => {
    const component = await mount(ChatViewportFillHost, { props: { scenario, height: 1500 } });
    await expect
      .poll(
        async () => JSON.parse(await component.getByTestId('requests').innerText()).requests.length,
      )
      .toBe(1);
    await page.waitForTimeout(400);
    await component.update({ props: { scenario, height: 1600 } });
    await page.waitForTimeout(400);
    expect(JSON.parse(await component.getByTestId('requests').innerText()).requests.length).toBe(1);
  });
}

test('empty rendered pages advance by cursor and switching cannot continue the old fill', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatViewportFillHost, {
    props: { scenario: 'filtered', height: 1400 },
  });
  await expect
    .poll(
      async () => JSON.parse(await component.getByTestId('requests').innerText()).requests.length,
    )
    .toBeGreaterThanOrEqual(3);
  await component.update({ props: { scenario: 'filtered', height: 1400, agent: 'secondary' } });
  await expect
    .poll(async () =>
      JSON.parse(await component.getByTestId('requests').innerText()).requests.some(
        (r: { agentId: string }) => r.agentId === 'secondary',
      ),
    )
    .toBe(true);
  await page.waitForTimeout(800);
  const { requests } = JSON.parse(await component.getByTestId('requests').innerText());
  const switched = requests.findIndex((r: { agentId: string }) => r.agentId === 'secondary');
  expect(
    requests.slice(switched).every((r: { agentId: string }) => r.agentId === 'secondary'),
  ).toBe(true);
});

test('exhaustion stops an underfilled viewport at the first message', async ({ mount, page }) => {
  const component = await mount(ChatViewportFillHost, {
    props: { scenario: 'exhausted', height: 1600 },
  });
  await expect(component.locator('[data-message-id="m-0"]').first()).toBeVisible();
  await page.waitForTimeout(400);
  const result = JSON.parse(await component.getByTestId('requests').innerText());
  expect(result.requests).toHaveLength(1);
  expect(result.requests[0].nextToken).toBe('before-3');
  expect(result.requests[0].limit).toBe(5);
});

test('retained placeholders hydrate before requesting another page', async ({ mount }) => {
  const component = await mount(ChatViewportFillHost, { props: { retained: true, height: 6000 } });
  await expect
    .poll(
      async () => JSON.parse(await component.getByTestId('requests').innerText()).requests.length,
    )
    .toBeGreaterThan(0);
  const result = JSON.parse(await component.getByTestId('requests').innerText());
  expect(result.requests[0].nextToken).toBe('before-60');
  expect(
    result.requests.every((request: { placeholders: number }) => request.placeholders === 0),
  ).toBe(true);
});

for (const scenario of ['gap-error-once', 'gap-error', 'gap-stalled'] as const) {
  test(`${scenario} stops automatic forward paging but allows one page per retry click`, async ({
    mount,
    page,
  }) => {
    const component = await mount(ChatViewportFillHost, { props: { scenario, height: 1600 } });
    const result = async () => JSON.parse(await component.getByTestId('requests').innerText());
    const retry = component.getByTestId('chat-history-gap-load-button');
    await expect.poll(async () => (await result()).requests.length).toBe(1);
    await expect(retry).toBeVisible();
    await component.update({ props: { scenario, height: 1700 } });
    await page.waitForTimeout(500);
    expect((await result()).requests).toHaveLength(1);
    await retry.click();
    await expect.poll(async () => (await result()).requests.length).toBe(2);
    if (scenario === 'gap-error-once') {
      await expect(component.getByTestId('chat-history-gap')).toHaveCount(0);
      await expect(component.locator('[data-message-id="m-5"]').first()).toBeVisible();
      await expect(component.locator('[data-message-id="m-6"]').first()).toBeVisible();
    } else {
      await expect(retry).toBeVisible();
      await component.update({ props: { scenario, height: 1600 } });
      await page.waitForTimeout(500);
      expect((await result()).requests).toHaveLength(2);
      await retry.click();
      await expect.poll(async () => (await result()).requests.length).toBe(3);
      await expect(retry).toBeVisible();
    }
    await page.waitForTimeout(500);
    const { requests, maxInFlight } = await result();
    expect(requests).toHaveLength(scenario === 'gap-error-once' ? 2 : 3);
    expect(maxInFlight).toBe(1);
    expect(requests.every((request: { limit: number }) => request.limit === 5)).toBe(true);
    expect(requests[0]).toMatchObject({ nextToken: 'after-4', limit: 5 });
    expect(requests[1]).toMatchObject(
      scenario === 'gap-stalled' ? { nextToken: 'after-4' } : { aroundMessageId: 'm-4' },
    );
  });
}

test('a direct message seek keeps the live tail and fills from the sought cursor', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatViewportFillHost, {
    props: { scenario: 'seek', height: 1400 },
  });
  await expect(component.locator('[data-lazy-visible="true"]').first()).toBeVisible();
  const result = async () => JSON.parse(await component.getByTestId('requests').innerText());
  await page.waitForTimeout(400);
  expect((await result()).requests).toHaveLength(0);
  await component.getByTestId('seek-middle').click();
  await expect(component.locator('[data-message-id="m-500"]').first()).toBeVisible();
  // This tall viewport naturally continues forward from the sought window.
  // The real helper/saga tests separately cover backward continuation before
  // forward settlement invalidates the opposite cursor.
  await expect
    .poll(async () =>
      (await result()).requests.some(
        (request: { nextToken?: string }) => request.nextToken === 'after-502',
      ),
    )
    .toBe(true);
  const { requests } = await result();
  expect(requests[0]).toMatchObject({ aroundMessageId: 'm-500', limit: 5 });
  expect(
    requests.every(
      (request: { limit: number; nextToken?: string }) =>
        request.limit === 5 && request.nextToken !== 'before-995',
    ),
  ).toBe(true);
  await expect(component.locator('[data-message-id="m-995"]').first()).toHaveCount(1);
  await expect(component.locator('[data-message-id="m-503"]').first()).toHaveCount(1);
});

async function sampleNewestRow(viewport: Locator) {
  return viewport.evaluate(async (node) => {
    const frames = [];
    for (let i = 0; i < 30; i++) {
      await new Promise(requestAnimationFrame);
      frames.push({
        bottom: node.querySelector('[data-message-id="m-99"]')!.getBoundingClientRect().bottom,
        distance: node.scrollHeight - node.clientHeight - node.scrollTop,
      });
    }
    return frames;
  });
}

test('keeps the newest row anchored after each controlled older page', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(ChatViewportFillHost, {
    props: { controlled: true, height: 1600 },
  });
  await expect(component.getByTestId('message-input').locator('.tiptap-editor')).toBeEditable();
  await component.evaluate(() => document.fonts.ready);
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');
  const result = async () => JSON.parse(await component.getByTestId('requests').innerText());
  await expect.poll(async () => (await result()).requests.length).toBe(1);
  expect(await viewport.evaluate((node) => node.scrollHeight - node.clientHeight)).toBe(0);
  const bottom = await viewport.evaluate(
    (node) => node.querySelector('[data-message-id="m-99"]')!.getBoundingClientRect().bottom,
  );
  const samples = [];
  for (let releasedPages = 1; releasedPages <= 5; releasedPages++) {
    await expect.poll(async () => (await result()).requests.length).toBe(releasedPages);
    const sampling = sampleNewestRow(viewport);
    await component.update({ props: { controlled: true, height: 1600, releasedPages } });
    await expect(
      component.locator(`[data-message-id="m-${95 - releasedPages * 5}"]`).first(),
    ).toHaveCount(1);
    samples.push(await sampling);
  }
  expect(await viewport.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(
    0,
  );
  // Delayed content growth in an already-rendered row must retain the same anchor.
  const hydration = sampleNewestRow(viewport);
  await component.update({
    props: { controlled: true, height: 1600, releasedPages: 5, expanded: true },
  });
  samples.push(await hydration);
  await testInfo.attach('pagination-positions', {
    body: JSON.stringify({ bottom, samples }),
    contentType: 'application/json',
  });
  await page.screenshot({ path: '../../.intent/artifacts/chat-pages-after.png', fullPage: true });
  expect(Math.max(...samples.flat().map((frame) => Math.abs(frame.bottom - bottom)))).toBeLessThan(
    3,
  );
});

test('keeps the reading row when the user scrolls up with an older page pending', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatViewportFillHost, {
    props: { controlled: true, height: 1600 },
  });
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');
  const result = async () => JSON.parse(await component.getByTestId('requests').innerText());
  await expect.poll(async () => (await result()).requests.length).toBe(1);
  await component.update({ props: { controlled: true, height: 1600, releasedPages: 1 } });
  await expect.poll(async () => (await result()).requests.length).toBe(2);
  await component.update({ props: { controlled: true, height: 500, releasedPages: 1 } });
  await page.waitForTimeout(500);
  await viewport.hover();
  await page.mouse.wheel(0, -60);
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeGreaterThan(20);
  await page.waitForTimeout(150);
  const reading = await viewport.evaluate((node) => {
    const top = node.getBoundingClientRect().top;
    const row = [...node.querySelectorAll<HTMLElement>('[data-message-id]')].find(
      (row) => row.getBoundingClientRect().top >= top,
    )!;
    return { id: row.dataset.messageId, top: row.getBoundingClientRect().top };
  });
  await component.update({ props: { controlled: true, height: 500, releasedPages: 2 } });
  await expect(component.locator('[data-message-id="m-85"]').first()).toHaveCount(1);
  await page.waitForTimeout(500);
  const after = await component.locator(`[data-message-id="${reading.id}"]`).first().boundingBox();
  expect(Math.abs(after!.y - reading.top)).toBeLessThan(5);
  expect(
    await viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
  ).toBeGreaterThan(20);
});

for (const total of [1, 19, 20, 21]) {
  test(`progressive history keeps newest content visible and anchored for ${total} rows`, async ({
    mount,
    page,
  }) => {
    const component = await mount(ChatViewportFillHost, {
      props: { progressive: total, height: 900, controlled: true },
    });
    const viewport = component.getByTestId('chat-transcript-scroll-viewport');
    const newest = component.locator(`[data-message-id="m-${total - 1}"]`).first();
    await expect(newest).toBeVisible();
    const bottom = (await newest.boundingBox())!.y + (await newest.boundingBox())!.height;
    const requests = async () =>
      JSON.parse(await component.getByTestId('requests').innerText()).requests;
    expect(await requests()).toHaveLength(0);
    if (total === 21)
      await page.screenshot({
        path: '../../.intent/artifacts/chat-progressive-partial.png',
        fullPage: true,
      });
    for (let received = 2; received <= Math.min(20, total); received++) {
      await component.update({
        props: { progressive: total, height: 900, controlled: true, received },
      });
      await expect(
        component.locator(`[data-message-id="m-${total - received}"]`).first(),
      ).toHaveCount(1);
      await expect
        .poll(async () => {
          const rect = await newest.boundingBox();
          return Math.abs(rect!.y + rect!.height - bottom);
        })
        .toBeLessThan(3);
      expect(await requests()).toHaveLength(0);
    }
    if (total >= 19)
      expect(await viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await component.update({
      props: {
        progressive: total,
        height: 900,
        controlled: true,
        received: Math.min(20, total),
        complete: true,
      },
    });
    await expect(newest).toBeVisible();
    expect(await requests()).toHaveLength(0);
    if (total === 1)
      await page.screenshot({
        path: '../../.intent/artifacts/chat-progressive-short.png',
        fullPage: true,
      });
    if (total === 21) {
      await expect(component.getByText('Message 11.', { exact: true })).toBeVisible();
      const layout = await viewport.evaluate((node) =>
        [...node.querySelectorAll<HTMLElement>('[data-message-id]')].map((row) => ({
          id: row.dataset.messageId,
          top: row.getBoundingClientRect().top,
          height: row.getBoundingClientRect().height,
          text: row.innerText,
        })),
      );
      await test.info().attach('progressive-row-layout', {
        body: JSON.stringify(layout),
        contentType: 'application/json',
      });
      expect(layout.map((row) => row.id)).toEqual(
        Array.from({ length: 20 }, (_, index) => `m-${index + 1}`),
      );
      for (let index = 0; index < layout.length; index++) {
        expect(layout[index].text).toContain(`Message ${index + 1}.`);
        if (index > 0) expect(layout[index].top).toBeGreaterThan(layout[index - 1].top);
      }
      await page.screenshot({
        path: '../../.intent/artifacts/chat-progressive-complete.png',
        fullPage: true,
      });
      // The pinned user prompt can cover the top assistant line at the bottom
      // position. Scroll to make the complete turn readable in the evidence.
      await viewport.hover();
      await page.mouse.wheel(0, -120);
      await expect
        .poll(
          async () => (await component.getByText('Message 11.', { exact: true }).boundingBox())!.y,
        )
        .toBeGreaterThan(100);
      await page.screenshot({
        path: '../../.intent/artifacts/chat-progressive-readable.png',
        fullPage: true,
      });
    }
  });
}

test('progressive empty history waits for explicit completion without fetching older rows', async ({
  mount,
}) => {
  const component = await mount(ChatViewportFillHost, { props: { progressive: 0 } });
  await expect(component.locator('[data-message-id]')).toHaveCount(0);
  await component.update({ props: { progressive: 0, complete: true } });
  await expect
    .poll(
      async () => JSON.parse(await component.getByTestId('requests').innerText()).requests.length,
    )
    .toBe(0);
});

test('progressive prepends preserve a reader who scrolls away before completion', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatViewportFillHost, {
    props: { progressive: 21, received: 12, height: 500, controlled: true },
  });
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');
  await expect(component.locator('[data-message-id="m-20"]').first()).toBeVisible();
  await viewport.hover();
  await page.mouse.wheel(0, -160);
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeGreaterThan(80);
  const reading = await viewport.evaluate((node) => {
    const top = node.getBoundingClientRect().top;
    const row = [...node.querySelectorAll<HTMLElement>('[data-message-id]')].find(
      (row) => row.getBoundingClientRect().top >= top,
    )!;
    return { id: row.dataset.messageId, top: row.getBoundingClientRect().top };
  });
  for (let received = 13; received <= 20; received++) {
    await component.update({ props: { progressive: 21, received, height: 500, controlled: true } });
    await expect
      .poll(async () =>
        Math.abs(
          (await component.locator(`[data-message-id="${reading.id}"]`).first().boundingBox())!.y -
            reading.top,
        ),
      )
      .toBeLessThan(5);
  }
  await component.update({
    props: { progressive: 21, received: 20, complete: true, height: 500, controlled: true },
  });
  await expect
    .poll(async () =>
      Math.abs(
        (await component.locator(`[data-message-id="${reading.id}"]`).first().boundingBox())!.y -
          reading.top,
      ),
    )
    .toBeLessThan(5);
  await page.screenshot({
    path: '../../.intent/artifacts/chat-progressive-reader.png',
    fullPage: true,
  });
  expect(JSON.parse(await component.getByTestId('requests').innerText()).requests).toHaveLength(0);
});
