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
