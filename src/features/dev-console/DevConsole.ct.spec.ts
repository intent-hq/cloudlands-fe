import { test, expect } from '../../test/ct-test';
import Fixture from './DevConsoleFixture.svelte';
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
  await page.getByRole('textbox').fill('agent.sendMessage');
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
  await page.getByRole('checkbox').check();
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
  await page.getByRole('tab', { name: 'Outbound RPC', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Events' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('textbox').fill('agent:message');
  await page.locator('[data-index]').last().click();
  await expect(page.locator('pre')).toContainText('"type": "agent:message"');
  await page.getByRole('tab', { name: 'Outbound RPC', exact: true }).click();
  await page.getByRole('textbox').fill('agent.sendMessage');
  await page.locator('[data-index]').first().click();
  await expect(page.locator('pre').first()).toContainText('"workspaceId": "demo-workspace"');
  await page.getByRole('textbox').fill('note.read');
  await page.getByRole('columnheader', { name: 'Bytes' }).getByRole('button').click();
  await page.getByRole('columnheader', { name: 'Bytes' }).getByRole('button').click();
  await page.locator('[data-index]').first().click();
  await expect(page.locator('.payload-heading').last()).toContainText('Truncated');
  await expect(page.locator('pre').last()).toContainText('Fixture diagnostic output.');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy payload' }).first().click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('demo-workspace');
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.locator('pre')).toHaveCount(0);
});

test('Dev Console resumes following from a sorted short list before it grows beyond the viewport', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await mount(Fixture, { props: { count: 120 } });
  await page.getByRole('textbox').fill('workspace.list');
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
