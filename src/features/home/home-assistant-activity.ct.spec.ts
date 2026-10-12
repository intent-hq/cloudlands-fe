import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

test('Assistant sidebar attributes each background activity to its thread', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'assistant-activity' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  const rows = sidebar.getByRole('option');
  await expect(rows).toHaveCount(9);
  for (const [index, kinds] of [
    [0, ['hooks', 'monitors', 'subscriptions']],
    [1, ['hooks']],
    [2, ['monitors']],
    [3, ['monitors']],
    [4, ['subscriptions']],
    [5, ['subscriptions']],
    [6, []],
    [7, []],
    [8, ['hooks', 'monitors', 'subscriptions']],
  ] as const) {
    await expect(rows.nth(index).locator('[data-thread-activity]')).toHaveCount(kinds.length);
    for (const kind of kinds) {
      await expect(rows.nth(index).locator(`[data-thread-activity="${kind}"]`)).toBeVisible();
    }
  }
  await expect(rows.first().getByRole('img', { name: 'Active', exact: true })).toBeVisible();
  await expect(rows.nth(1).getByRole('img', { name: 'Active', exact: true })).toHaveCount(0);
  const calls = await page.evaluate(() => window.__homeAssistantActivity!.calls);
  const reads = calls.filter(({ method }) => method === 'agent.getSubscriptions');
  expect(reads).toHaveLength(9);
  for (let index = 0; index < 9; index++) {
    expect(reads).toContainEqual({
      method: 'agent.getSubscriptions',
      params: { workspaceId: '__chief__', agentId: `home-assistant-${index}` },
    });
  }
  const events = rows.nth(4).locator('[data-thread-activity="subscriptions"]');
  await expect(events).toHaveAttribute('aria-label', /1/);
  await expect(events).toHaveJSProperty('tabIndex', -1);
  await events.hover();
  await expect(page.getByRole('tooltip')).toContainText('1');
  await events.click();
  await expect(rows.nth(4)).toHaveAttribute('aria-selected', 'true');
  await expect(component.getByRole('heading', { name: 'Watch workspace changes' })).toBeVisible();
  await expect(events).not.toBeFocused();
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toHaveAttribute('contenteditable', 'true');
  await expect(rows.nth(4)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(5)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rows.nth(5)).toHaveAttribute('aria-selected', 'true');
  await expect(component.getByRole('heading', { name: 'Wait for a specialist' })).toBeVisible();
  await expect(composer).toHaveAttribute('contenteditable', 'true');
  await expect(rows.nth(5)).toBeFocused();
  await composer.fill('Continue watching this thread');
  await expect(composer).toBeFocused();
  await testInfo.attach('assistant-thread-activity-wire', {
    body: JSON.stringify(calls, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('assistant-thread-activity', {
    body: await page.screenshot({ path: testInfo.outputPath('activity.png') }),
    contentType: 'image/png',
  });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await testInfo.attach('assistant-thread-activity-dark-sidebar', {
    body: await sidebar.screenshot({ path: testInfo.outputPath('activity-sidebar.png') }),
    contentType: 'image/png',
  });
});

test('Assistant sidebar updates active work and removes settled markers without reordering', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview, { props: { scenario: 'assistant-activity' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  const rows = sidebar.getByRole('option');
  await expect(rows.first().locator('[data-thread-activity]')).toHaveCount(3);
  const titles = await rows.locator('[data-slot="list-row-title"]').allTextContents();
  await rows.first().click({ position: { x: 6, y: 6 } });
  await page.evaluate(() => window.__homeAssistantActivity!.settle('home-assistant-0'));
  await expect(rows.first().locator('[data-thread-activity]')).toHaveCount(0);
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
  expect(await rows.locator('[data-slot="list-row-title"]').allTextContents()).toEqual(titles);
  await expect(rows.nth(8).locator('[data-thread-activity]')).toHaveCount(3);
  await page.evaluate(() => window.__homeAssistantActivity!.setEventCount('home-assistant-7', 2));
  await expect(rows.nth(7).locator('[data-thread-activity="subscriptions"]')).toHaveAttribute(
    'aria-label',
    /2/,
  );
  await page.evaluate(() => window.__homeAssistantActivity!.setEventCount('home-assistant-7', 0));
  await expect(rows.nth(7).locator('[data-thread-activity]')).toHaveCount(0);
  await page.evaluate(() => window.__homeAssistantActivity!.settle('home-assistant-5'));
  await expect(rows.nth(5).locator('[data-thread-activity]')).toHaveCount(0);
});

test('Assistant sidebar coalesces subscription reads and keeps the newest snapshot', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'assistant-activity' } });
  const row = component
    .getByRole('navigation', { name: 'Home', exact: true })
    .getByRole('option')
    .nth(4);
  await expect(row.locator('[data-thread-activity="subscriptions"]')).toBeVisible();
  await page.evaluate(() => window.__homeAssistantActivity!.holdNextRead('home-assistant-4'));
  await page.evaluate(() => window.__homeAssistantActivity!.refresh('home-assistant-4'));
  await expect.poll(() => page.evaluate(() => window.__homeAssistantActivity!.held)).toBe(true);
  await page.evaluate(() => {
    window.__homeAssistantActivity!.setEventCount('home-assistant-4', 0);
    window.__homeAssistantActivity!.refresh('home-assistant-4');
    window.__homeAssistantActivity!.release();
  });
  await expect(row.locator('[data-thread-activity]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__homeAssistantActivity!.maxConcurrent)).toBe(1);
  await testInfo.attach('assistant-thread-read-coalescing', {
    body: JSON.stringify(await page.evaluate(() => window.__homeAssistantActivity!.calls), null, 2),
    contentType: 'application/json',
  });
});

test('Assistant sidebar recovers subscription indicators after reconnect', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview, { props: { scenario: 'assistant-activity' } });
  const row = component
    .getByRole('navigation', { name: 'Home', exact: true })
    .getByRole('option')
    .nth(4);
  await expect(row.locator('[data-thread-activity="subscriptions"]')).toHaveAttribute(
    'aria-label',
    /1/,
  );
  await page.evaluate(() =>
    window.__homeAssistantActivity!.reconnectWithEventCount('home-assistant-4', 3),
  );
  await expect(row.locator('[data-thread-activity="subscriptions"]')).toHaveAttribute(
    'aria-label',
    /3/,
  );
});

for (const theme of ['dark', 'light'] as const) {
  test(`Assistant background markers remain accessible in the narrow ${theme} sidebar`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 768 });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
      theme,
    );
    const component = await mount(Preview, { props: { scenario: 'assistant-activity' } });
    const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
    const handle = component
      .locator('.home-sidebar-resizable')
      .getByRole('button', { name: 'Resize panel (double-click to reset)', exact: true });
    await handle.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
    const rows = sidebar.getByRole('option');
    const long = rows.nth(8);
    await expect(long.locator('[data-slot="list-row-title"]')).toContainText(
      'Keep watching this release',
    );
    await long.click();
    const markers = long.locator('[data-thread-activity]');
    await expect(markers).toHaveCount(3);
    const geometry = await markers.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const row = element.closest('[role="option"]')!.getBoundingClientRect();
        return (
          rect.left >= row.left &&
          rect.right <= row.right &&
          rect.top >= row.top &&
          rect.bottom <= row.bottom
        );
      }),
    );
    expect(geometry.every(Boolean)).toBe(true);
    expect(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await testInfo.attach(`assistant-thread-activity-${theme}-narrow`, {
      body: await page.screenshot({ path: testInfo.outputPath(`${theme}-narrow.png`) }),
      contentType: 'image/png',
    });
  });
}

test('Assistant background reads follow virtualized thread history', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 768 });
  const component = await mount(Preview, { props: { scenario: 'assistant-activity-many' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  const list = sidebar.getByRole('listbox');
  const rows = list.getByRole('option');
  await expect(rows.first().locator('[data-thread-activity]')).toHaveCount(3);
  const initialReads = await page.evaluate(() =>
    window.__homeAssistantActivity!.calls.filter(
      ({ method }) => method === 'agent.getSubscriptions',
    ),
  );
  expect(initialReads.length).toBeLessThan(40);
  expect(initialReads.some(({ params }) => params.agentId === 'home-assistant-239')).toBe(false);
  await rows.first().focus();
  await page.keyboard.press('End');
  const last = list.locator('[data-list-index="239"]');
  await expect(last).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await expect(last.locator('[data-thread-activity="subscriptions"]')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__homeAssistantActivity!.calls.some(
          ({ params }) => params.agentId === 'home-assistant-239',
        ),
      ),
    )
    .toBe(true);
  await testInfo.attach('assistant-activity-virtual-history', {
    body: await page.screenshot({ path: testInfo.outputPath('virtual-history.png') }),
    contentType: 'image/png',
  });
});
