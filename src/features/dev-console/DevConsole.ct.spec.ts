import { test, expect } from '../../test/ct-test';
import Fixture from './DevConsoleFixture.svelte';
import type { Locator, Page } from '@playwright/test';
import { nestedRequestText, nestedResponseText } from './traffic-fixture';

const viewer = (page: Page, label: string) =>
  page.locator('[data-payload-viewer]').and(page.getByRole('region', { name: label, exact: true }));
const lines = (region: Locator) => region.locator('.view-lines');
async function ready(region: Locator) {
  // Cold Monaco chunks and workers can outlast the default assertion budget on shared hosts.
  await expect(region.getByRole('button', { name: 'Search', exact: true })).toBeEnabled({
    timeout: 15000,
  });
  await expect(region.locator('.monaco-editor')).toBeVisible();
  await expect(region.locator('pre')).toHaveCount(0);
}
async function copyEditor(page: Page, region: Locator) {
  await region.locator('.view-lines').click({ position: { x: 65, y: 10 } });
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  // Native editor selection uses the browser platform's line endings.
  return (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
}
async function toggleFold(region: Locator, text: string) {
  const line = region.locator('.view-line').filter({ hasText: text });
  const box = await line.boundingBox();
  const margin = region.locator('.margin');
  const gutter = await margin.boundingBox();
  if (!box || !gutter) throw new Error('Expected visible JSON line and folding gutter');
  await margin.click({ position: { x: gutter.width - 7, y: box.y - gutter.y + box.height / 2 } });
}

test('Dev Console virtualizes 10000 records and holds reading position during append', async ({
  mount,
  page,
}) => {
  await mount(Fixture, { props: { count: 10000 } });
  const viewport = page.locator('.viewport');
  const rows = page.locator('[data-index]');
  await expect.poll(() => rows.count()).toBeLessThan(70);
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(30);
  await viewport.evaluate((el) => {
    el.scrollTop = 20000;
    el.dispatchEvent(new Event('scroll'));
  });
  const before = await rows.first().innerText();
  await page.getByRole('button', { name: 'Append fixture traffic' }).click();
  await expect(rows.first()).toHaveText(before);
  await page.getByRole('button', { name: 'Jump to live' }).click();
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(30);
  await page
    .getByRole('textbox', { name: 'Filter method or event', exact: true })
    .fill('agent.sendMessage');
  await expect
    .poll(() =>
      page
        .locator('[data-index] .method')
        .evaluateAll((els) => els.every((el) => el.textContent === 'agent.sendMessage')),
    )
    .toBe(true);
  await page.getByRole('columnheader', { name: 'Duration' }).getByRole('button').click();
  await expect(page.getByRole('columnheader', { name: 'Duration' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await rows.first().click();
  await expect(page.getByRole('checkbox')).toBeVisible();
  await page.getByRole('checkbox').click();
  await expect(page.getByRole('checkbox')).toBeChecked();
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-index')))
    .toBe('1');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});
test('Dev Console switches tabs by keyboard and inspects inbound and truncated payloads', async ({
  mount,
  page,
}) => {
  await mount(Fixture);
  const all = page.getByRole('tab', { name: 'All', exact: true });
  await expect(all).toHaveAttribute('aria-selected', 'true');
  await all.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Outbound RPC', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Inbound RPC', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Home');
  await expect(all).toBeFocused();
  await expect(all).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Events' })).toHaveAttribute('aria-selected', 'true');
  await page
    .getByRole('textbox', { name: 'Filter method or event', exact: true })
    .fill('agent:message');
  await page.locator('[data-index]').last().click();
  await ready(viewer(page, 'Event'));
  await expect(lines(viewer(page, 'Event'))).toContainText('"type": "agent:message"');
  await page.getByRole('tab', { name: 'Outbound RPC', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Filter method or event', exact: true })
    .fill('agent.sendMessage');
  await page.locator('[data-index]').first().click();
  await ready(viewer(page, 'Request'));
  await expect(lines(viewer(page, 'Request'))).toContainText('"workspaceId": "demo-workspace"');
  await page
    .getByRole('textbox', { name: 'Filter method or event', exact: true })
    .fill('note.read');
  await page.getByRole('columnheader', { name: 'Bytes' }).getByRole('button').click();
  await page.getByRole('columnheader', { name: 'Bytes' }).getByRole('button').click();
  await page.locator('[data-index]').first().click();
  await expect(page.locator('.payload-heading').last()).toContainText('Truncated');
  await ready(viewer(page, 'Response / error'));
  await expect(lines(viewer(page, 'Response / error'))).toContainText('Fixture diagnostic output.');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy payload' }).first().click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('demo-workspace');
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.locator('[data-payload-viewer]')).toHaveCount(0);
});

test('Dev Console resumes following from a sorted short list before it grows beyond the viewport', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await mount(Fixture, { props: { count: 120 } });
  await page
    .getByRole('textbox', { name: 'Filter method or event', exact: true })
    .fill('workspace.list');
  const viewport = page.locator('.viewport');
  await expect.poll(() => viewport.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
  await page.getByRole('columnheader', { name: 'Method / event' }).getByRole('button').click();
  await page.getByRole('button', { name: 'Jump to live' }).click();
  await page.getByRole('button', { name: 'Append fixture traffic' }).click();
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(200);
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(25);
});

test('Dev Console keeps selected payload and counters separate at native minimum size', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await mount(Fixture);
  const selectedIndex = await page.locator('[data-index]').last().getAttribute('data-index');
  const selectedRow = page.locator(`[data-index="${selectedIndex}"]`);
  await selectedRow.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.details :focus')).toBeInViewport({ ratio: 1 });
  await ready(viewer(page, 'Request'));
  await ready(viewer(page, 'Response / error'));
  await expect
    .poll(async () => {
      const details = await page.locator('.details').boundingBox();
      const footer = await page.locator('footer').boundingBox();
      return details!.y + details!.height - footer!.y;
    })
    .toBeLessThanOrEqual(0);
  await expect(page.locator('footer')).toBeInViewport({ ratio: 1 });
  const readable = await page
    .locator('[data-payload-viewer] .monaco-editor')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        let top = Math.max(0, rect.top),
          bottom = Math.min(innerHeight, rect.bottom);
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (getComputedStyle(ancestor).overflowY !== 'visible') {
            const bounds = ancestor.getBoundingClientRect();
            top = Math.max(top, bounds.top);
            bottom = Math.min(bottom, bounds.bottom);
          }
        }
        const style = getComputedStyle(element.querySelector('.view-line')!);
        return (
          (bottom - top - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) /
          parseFloat(style.lineHeight)
        );
      }),
    );
  expect(readable).toHaveLength(2);
  for (const lines of readable) expect(lines).toBeGreaterThanOrEqual(2);
  for (const label of ['Request', 'Response / error']) {
    const region = viewer(page, label);
    await expect
      .poll(async () => {
        const host = await region.boundingBox();
        const editor = await region.locator('.monaco-editor').boundingBox();
        return editor!.y + editor!.height - (host!.y + host!.height);
      })
      .toBeLessThanOrEqual(0);
  }
  // Use the longer response so this remains a scroll contract in compact layouts.
  const response = viewer(page, 'Response / error');
  const firstLine = response.locator('.view-line').first();
  const before = (await firstLine.boundingBox())!.y;
  await response.locator('.view-lines').click({ position: { x: 65, y: 10 } });
  await page.keyboard.press('PageDown');
  await expect.poll(async () => (await firstLine.boundingBox())?.y ?? before).toBeLessThan(before);
  await expect
    .poll(() => page.locator('.details').evaluate((element) => element.scrollTop))
    .toBe(0);
  await testInfo.attach('minimum-window', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Copy payload' }).first().click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.locator('[data-payload-viewer]')).toHaveCount(0);
  await expect(selectedRow).toBeInViewport();
  await expect(selectedRow).toBeFocused();
});

for (const [label, raw] of [
  ['Request', nestedRequestText],
  ['Response / error', nestedResponseText],
]) {
  test(`Dev Console ${label} uses native nested folding, find, read-only input and raw copy`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await mount(Fixture, { props: { scenario: 'nested' } });
    await page.locator('[data-index]').filter({ hasText: 'fixture.inspect' }).click();
    const region = viewer(page, label);
    const other = viewer(page, label === 'Request' ? 'Response / error' : 'Request');
    await ready(region);
    await ready(other);
    const formatted = JSON.stringify(JSON.parse(raw), null, 2);
    await expect.poll(() => copyEditor(page, region)).toBe(formatted);
    await page.keyboard.type('attempted edit');
    await page.keyboard.press('Backspace');
    await expect.poll(() => copyEditor(page, region)).toBe(formatted);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+Home');
    // JSON keys and literals must actually be tokenized, not a plaintext fallback.
    await expect
      .poll(() =>
        region
          .locator('.view-line span')
          .evaluateAll(
            (els) =>
              new Set(
                els.filter((el) => el.textContent?.trim()).map((el) => getComputedStyle(el).color),
              ).size,
          ),
      )
      .toBeGreaterThan(1);
    await expect(
      region.locator('.codicon-folding-expanded, .codicon-folding-collapsed'),
    ).not.toHaveCount(0);
    await toggleFold(region, '"object": {');
    await expect(lines(region)).not.toContainText('first');
    await expect(lines(region)).toContainText('second');
    await toggleFold(region, '"array": [');
    await expect(lines(region)).not.toContainText('second');
    await toggleFold(region, '"object": {');
    await expect(lines(region)).toContainText('first');
    await expect(lines(region)).not.toContainText('second');
    await expect(lines(other)).toContainText('second');
    await region.getByRole('button', { name: 'Collapse all', exact: true }).click();
    await expect(lines(region)).not.toContainText('needle');
    await region.getByRole('button', { name: 'Search', exact: true }).click();
    const search = region.getByRole('textbox', { name: 'Find', exact: true });
    await search.fill('needle');
    await expect(region.locator('.matchesCount')).toHaveText('1 of 2');
    await expect(lines(region)).toContainText('first');
    await search.press('Enter');
    await expect(region.locator('.matchesCount')).toHaveText('2 of 2');
    await expect(lines(region)).toContainText('second');
    await search.press('Shift+Enter');
    await expect(region.locator('.matchesCount')).toHaveText('1 of 2');
    await search.fill('no-such-payload-value');
    await expect(region.locator('.matchesCount')).toHaveText('No results');
    await search.press('Escape');
    await expect(search).not.toBeVisible();
    await page.keyboard.press('ControlOrMeta+f');
    await expect(search).toBeFocused();
    await expect(other.getByRole('textbox', { name: 'Find', exact: true })).not.toBeVisible();
    await search.press('Escape');
    await region.getByRole('button', { name: 'Expand all', exact: true }).click();
    await expect(lines(region)).toContainText('first');
    await expect(lines(region)).toContainText('second');
    await region.locator('..').getByRole('button', { name: 'Copy payload', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
  });
}

test('Dev Console replaces selected records and receives a delayed response without stale editors', async ({
  mount,
  page,
}) => {
  await mount(Fixture, { props: { scenario: 'nested' } });
  await page.locator('[data-index]').filter({ hasText: 'fixture.inspect' }).click();
  await ready(viewer(page, 'Response / error'));
  await page.locator('[data-index]').filter({ hasText: 'fixture.pending' }).click();
  await ready(viewer(page, 'Request'));
  await expect(lines(viewer(page, 'Request'))).toContainText('pendingRequest');
  await expect(viewer(page, 'Response / error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deliver fixture reply' }).click();
  await ready(viewer(page, 'Response / error'));
  await expect(lines(viewer(page, 'Response / error'))).toContainText('arrived after selection');
  await expect(lines(viewer(page, 'Request'))).toContainText('pendingRequest');
  await page.locator('[data-index]').filter({ hasText: 'fixture.inspect' }).click();
  await ready(viewer(page, 'Response / error'));
  await expect(lines(viewer(page, 'Response / error'))).toContainText('response first');
  await expect(page.locator('[data-payload-viewer] .monaco-editor')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('[data-payload-viewer]')).toHaveCount(0);
});

test('Dev Console searches the end of an oversized payload with an explained folding limit', async ({
  mount,
  page,
}, testInfo) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 640, height: 400 });
  await mount(Fixture, { props: { scenario: 'oversized' } });
  await page.locator('[data-index]').filter({ hasText: 'fixture.inspect' }).click();
  const region = viewer(page, 'Request');
  await ready(region);
  await expect(region.getByRole('status')).toContainText('Large payload');
  await expect
    .poll(async () => {
      const host = await region.boundingBox();
      const editor = await region.locator('.monaco-editor').boundingBox();
      return editor!.y + editor!.height - (host!.y + host!.height);
    })
    .toBeLessThanOrEqual(0);
  await expect(region.getByRole('button', { name: 'Collapse all', exact: true })).toBeDisabled();
  await expect(region.getByRole('button', { name: 'Expand all', exact: true })).toBeDisabled();
  await expect(region.locator('.codicon-folding-expanded, .codicon-folding-collapsed')).toHaveCount(
    0,
  );
  await region.getByRole('button', { name: 'Search', exact: true }).click();
  const search = region.getByRole('textbox', { name: 'Find', exact: true });
  await search.fill('large-payload-last-match');
  await expect(region.locator('.matchesCount')).toHaveText('1 of 1');
  await expect(lines(region)).toContainText('large-payload-last-match');
  // Long lines may scroll horizontally; the actual search hit must be fully visible.
  await expect(region.locator('.currentFindMatch')).toBeInViewport({ ratio: 1 });
  await expect(search).toBeInViewport({ ratio: 1 });
  await testInfo.attach('oversized-search', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await search.press('Escape');
  await region.locator('..').getByRole('button', { name: 'Copy payload', exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = JSON.parse(copied);
  expect(parsed.items).toHaveLength(100000);
  expect(parsed.items[99999]).toEqual({ value: 'large-payload-last-match' });
  expect(copied).not.toContain('\n');
  await expect(page.locator('footer')).toBeInViewport({ ratio: 1 });
});

for (const scenario of ['nested', 'oversized'] as const) {
  test(`Dev Console keeps ${scenario} payloads usable while resizing between compact and split views`, async ({
    mount,
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 640, height: 400 });
    await mount(Fixture, { props: { scenario } });
    await page.locator('[data-index]').filter({ hasText: 'fixture.inspect' }).click();
    for (const label of ['Request', 'Response / error']) {
      const region = viewer(page, label);
      await ready(region);
      await region.getByRole('button', { name: 'Search', exact: true }).click();
      await region
        .getByRole('textbox', { name: 'Find', exact: true })
        .fill(
          scenario === 'oversized' && label === 'Request' ? 'large-payload-last-match' : 'second',
        );
      await expect(region.locator('.matchesCount')).toHaveText('1 of 1');
    }
    for (const height of [500, 501, 550, 600, 900, 1200, 501, 400]) {
      await test.step(`640×${height} with both searches open`, async () => {
        await page.setViewportSize({ width: 640, height });
        for (const label of ['Request', 'Response / error']) {
          const region = viewer(page, label);
          // Budget actual native find controls, top padding, and two readable text lines.
          await expect
            .poll(
              () =>
                region.evaluate((host) => {
                  const editor = host.querySelector('.monaco-editor');
                  const line = host.querySelector('.view-line');
                  const find = host.querySelector('.find-widget');
                  if (!editor || !line || !find) return -1;
                  return (
                    editor.getBoundingClientRect().height -
                    find.getBoundingClientRect().height -
                    8 -
                    2 * parseFloat(getComputedStyle(line).lineHeight)
                  );
                }),
              { message: `${label} reading area at640×${height}` },
            )
            .toBeGreaterThanOrEqual(0);
          await expect(region.getByRole('textbox', { name: 'Find', exact: true })).toBeInViewport({
            ratio: 1,
          });
          // Resizing may change native scroll position; navigation must reveal the match again.
          await region.getByRole('textbox', { name: 'Find', exact: true }).press('Enter');
          await expect(region.locator('.currentFindMatch')).toBeInViewport({ ratio: 1 });
          await expect(region.getByRole('button', { name: 'Search', exact: true })).toBeInViewport({
            ratio: 1,
          });
          await expect(
            region.locator('..').getByRole('button', { name: 'Copy payload', exact: true }),
          ).toBeInViewport({ ratio: 1 });
          await expect
            .poll(async () => {
              const host = await region.boundingBox();
              const editor = await region.locator('.monaco-editor').boundingBox();
              return editor!.y + editor!.height - (host!.y + host!.height);
            })
            .toBeLessThanOrEqual(0);
        }
        await expect(page.locator('footer')).toBeInViewport({ ratio: 1 });
        await expect(page.getByRole('button', { name: 'Close details' })).toBeInViewport({
          ratio: 1,
        });
        if (scenario === 'oversized') {
          const request = viewer(page, 'Request');
          await expect(request.getByRole('status')).toBeInViewport({ ratio: 1 });
          await expect(
            request.getByRole('button', { name: 'Collapse all', exact: true }),
          ).toBeDisabled();
        }
        if (height === 1200) {
          await expect(page.locator('.traffic-table')).toBeVisible();
          await expect
            .poll(async () => (await page.locator('.viewport').boundingBox())?.height ?? 0)
            .toBeGreaterThan(100);
          const table = await page.locator('.traffic-table').boundingBox();
          const details = await page.locator('.details').boundingBox();
          expect(table!.y + table!.height).toBeLessThanOrEqual(details!.y);
          await testInfo.attach(`${scenario}-split-search`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        }
      });
    }
  });
}

for (const theme of ['light', 'dark']) {
  test(`Dev Console All keeps mixed stream labels and keyboard selection visible in ${theme} mode`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mount(Fixture, { props: { count: 18 } });
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    const rows = page.locator('[data-index]');
    await expect(page.getByRole('table')).toHaveAttribute('aria-rowcount', '19');
    await expect(
      rows.first().getByRole('cell', { name: 'Inbound RPC', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      rows.nth(1).getByRole('cell', { name: 'Outbound RPC', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(rows.nth(3).getByRole('cell', { name: 'Events', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await rows.nth(2).focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(3)).toBeFocused();
    await expect(rows.nth(3)).toHaveAttribute('aria-selected', 'true');
    await ready(viewer(page, 'Event'));
    await expect(lines(viewer(page, 'Event'))).toContainText('agent:message');
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect(rows.nth(3)).toBeFocused();
    await testInfo.attach(`all-streams-${theme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}
