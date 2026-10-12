import { test, expect, openExample } from '../lib/functional.mjs';
import {
  button,
  captureLeaf,
  choose,
  expectContained,
  expectDecoded,
  expectJson,
  observeImages,
  openLeaf,
  openTasks,
  popup,
  radio,
  toggle,
} from './workspace-presentation.helpers.mjs';

test('workspace tooltip focus: rich actions survive native focus transfer and leaving closes only that surface', async ({
  page,
}, info) => {
  const host = await openExample(page, 'tooltip-rich', 'tooltip-forwarding');
  const control = button(host, 'Rich tooltip control');
  const disabled = toggle(host, 'Disable rich tooltip');
  const keepOpen = toggle(host, 'Keep tooltip open on click');
  const action = button(page, 'Tooltip action');
  const close = button(page, 'Close tooltip');
  const open = host.getByLabel('Rich tooltip open', { exact: true });

  await keepOpen.click();
  await keepOpen.press('Shift+Tab');
  await expect(disabled).toBeFocused();
  await disabled.press('Shift+Tab');
  await expect(control).toBeFocused();
  await expect(open).toHaveText('true');
  await captureLeaf(page, popup(page), 'rich-focus-before', info);

  await action.click();
  await expect(action).toBeFocused();
  await expect(host.getByLabel('Rich tooltip actions', { exact: true })).toHaveText('1');
  await action.press('Shift+Tab');
  await expect(close).toBeFocused();
  await expect(open).toHaveText('true');
  await close.press('Tab');
  await expect(action).toBeFocused();
  await expect(open).toHaveText('true');

  await control.click();
  await expect(control).toBeFocused();
  await expect(open).toHaveText('true');
  await expect(host.getByLabel('Rich tooltip clicks', { exact: true })).toHaveText('1');
  await expect(host.getByLabel('Rich tooltip pressed', { exact: true })).toHaveText('true');
  await control.press('Tab');
  await expect(disabled).toBeFocused();
  await expect(open).toHaveText('false');
  await expect(popup(page)).toHaveCount(0);

  await disabled.press('Shift+Tab');
  await expect(control).toBeFocused();
  await action.click();
  await expect(host.getByLabel('Rich tooltip actions', { exact: true })).toHaveText('2');
  await action.press('Shift+Tab');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(open).toHaveText('false');
  await expect(popup(page)).toHaveCount(0);

  await keepOpen.click();
  await keepOpen.press('Shift+Tab');
  await disabled.press('Shift+Tab');
  await expect(control).toBeFocused();
  await expect(open).toHaveText('true');
  await control.press('Escape');
  await expect(open).toHaveText('false');
  await expect(control).toBeFocused();
  await button(host, 'Open rich tooltip').click();
  await close.click();
  await expect(open).toHaveText('false');
  await expect(host.getByLabel('Rich tooltip closes', { exact: true })).toHaveText('1');
  await captureLeaf(page, host, 'rich-focus-after', info);
});

test('workspace tooltip ownership: native outside focus and a second instance dismiss the first tooltip', async ({
  page,
}, info) => {
  const host = await openExample(page, 'tooltip', 'tooltip-public');
  const control = button(host, 'Public tooltip control');
  const disabled = toggle(host, 'Disable public tooltip');
  const keepOpen = toggle(host, 'Keep public tooltip open on click');
  const alternate = button(host, 'Alternate shortcut trigger');
  const open = host.getByLabel('Public tooltip open', { exact: true });
  const first = host.getByTestId('public-tooltip-portal').locator('[data-tooltip-content]');

  await keepOpen.click();
  await keepOpen.press('Shift+Tab');
  await expect(disabled).toBeFocused();
  await disabled.press('Shift+Tab');
  await expect(control).toBeFocused();
  await expect(first).toBeVisible();
  await captureLeaf(page, first, 'public-focus-before', info);
  await control.press('Tab');
  await expect(disabled).toBeFocused();
  await expect(open).toHaveText('false');
  await expect(first).toBeHidden();

  await disabled.press('Shift+Tab');
  await expect(control).toBeFocused();
  await expect(open).toHaveText('true');
  await control.press('Escape');
  await expect(open).toHaveText('false');
  await expect(control).toBeFocused();

  const external = button(host, 'Open public tooltip');
  await external.click();
  await expect(first).toBeVisible();
  await external.press('Tab');
  await expect(alternate).toBeFocused();
  await expect(open).toHaveText('false');
  await expect(first).toBeHidden();
  await expect(popup(page)).toHaveCount(1);
  await expect(popup(page)).toContainText('Open navigation');
  await captureLeaf(page, popup(page), 'public-other-instance-after', info);
  await alternate.press('Escape');
  await expect(popup(page)).toHaveCount(0);
  await expect(alternate).toBeFocused();
  await alternate.press('Shift+Tab');
  await expect(external).toBeFocused();
  await external.press('Tab');
  await expect(alternate).toBeFocused();
  await expect(popup(page)).toHaveCount(1);
  await alternate.press('Shift+Tab');
  await expect(external).toBeFocused();
  await expect(popup(page)).toHaveCount(0);
});

test('workspace driving keyboard: native Tab opens the tooltip and Escape dismisses it', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'driving-client-indicator');
  const name = host.getByRole('textbox', { name: 'Other host name', exact: true });
  const target = host.getByTestId('driving-client-target');
  const trigger = target.getByRole('button');
  await name.fill('  Office Linux  ');
  await name.press('Tab');
  await expect(trigger).toBeFocused();
  await expect(popup(page)).toContainText('Browser on Office Linux');
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await name.fill('   ');
  await name.press('Tab');
  await expect(trigger).toHaveAccessibleName('Browser on client-preview-…');
  await expect(popup(page)).toContainText('client-preview-…');
  await page.keyboard.press('Escape');
  await name.fill(
    'Office Linux with a very long host name that must remain readable in its full tooltip',
  );
  await name.press('Tab');
  await expectContained(page, target);
  await expectContained(page, popup(page));
  await captureLeaf(page, popup(page), 'driving-long-name', info);
});

test('workspace progress bounds: invalid ratios clamp and undefined follows loading until explicitly ready', async ({
  page,
}) => {
  const host = await openLeaf(page, 'task-status-progress');
  const target = host.getByTestId('task-progress-target');
  const bar = target.getByRole('progressbar');
  for (const [ratio, value] of [
    ['negative', '0'],
    ['overflow', '100'],
    ['NaN', '0'],
    ['Infinity', '0'],
    ['zero', '0'],
  ]) {
    await choose(page, host, 'Canonical progress', ratio);
    await expect(bar).toHaveAttribute('aria-valuenow', value);
  }
  await choose(page, host, 'Canonical progress', 'undefined');
  await expect(bar).toHaveCount(0);
  await choose(page, host, 'Progress loading', 'ready');
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  await choose(page, host, 'Task statuses', 'cancelled');
  await expect(bar).toHaveAttribute('aria-valuetext', 'Task progress');
  await choose(page, host, 'Task statuses', 'empty');
  await expect(bar).toHaveAttribute('aria-valuetext', 'Task progress');
});

test('workspace progress fallback: mismatched counts use the caller summary and matching counts keep detailed statuses', async ({
  page,
}) => {
  const host = await openLeaf(page, 'task-status-progress');
  const bar = host.getByTestId('task-progress-target').getByRole('progressbar');
  await toggle(host, 'Use fallback counts').click();
  await expect(bar).toHaveAttribute('aria-valuetext', '2 complete, 3 in progress, 5 not started');
  await expect(bar).toHaveAttribute('aria-valuenow', '14');
  await host.getByRole('spinbutton', { name: 'Fallback total', exact: true }).fill('7');
  await expect(bar).toHaveAttribute(
    'aria-valuetext',
    '1 complete, 1 in progress, 1 review required, 1 discussion needed, 1 blocked, 1 waiting, 1 not started',
  );
  await host.getByRole('spinbutton', { name: 'Fallback total', exact: true }).fill('3');
  await host.getByRole('spinbutton', { name: 'Fallback completed', exact: true }).fill('9');
  await expect(bar).toHaveAttribute('aria-valuetext', '3 complete');
});

test('workspace progress motion: key changes remount only animated bars and reduced motion stays still', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'task-status-progress');
  const target = host.getByTestId('task-progress-target');
  const bar = target.getByRole('progressbar');
  const original = await bar.elementHandle();
  await choose(page, host, 'Canonical progress', 'canonical 0.8');
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await button(host, 'Switch progress animation key').click();
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  await expect(bar).toHaveAttribute('aria-valuenow', '80');
  // Browser reduced-motion and the route's reduced-motion preference are both real.
  expect(await bar.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  await toggle(host, 'Animate progress').click();
  const staticBar = await bar.elementHandle();
  const before = await captureLeaf(page, target, 'progress-static-before', info);
  await button(host, 'Switch progress animation key').click();
  expect(await staticBar.evaluate((node) => node.isConnected)).toBe(true);
  expect(await bar.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  await toggle(host, 'Compact progress').click();
  await choose(page, host, 'Progress loading', 'loading');
  const loading = await captureLeaf(page, target, 'progress-compact-loading', info);
  await choose(page, host, 'Progress loading', 'ready');
  const ready = await captureLeaf(page, target, 'progress-compact-ready', info);
  expect(Math.abs(loading.root.height - ready.root.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.root.width - ready.root.width)).toBeLessThanOrEqual(1);
});

test('workspace flame filtering: linked roots deduplicate and order nested tasks before exact callbacks', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'flame-graph');
  await choose(page, host, 'Flame note inputs', 'linked-tree');
  const target = host.getByTestId('flame-graph-target');
  const tasks = await openTasks(page, target);
  // Independently derived from the input graph: spec order, parent link order,
  // then peerOrder/createdAt. Cancelled, duplicate, unlinked and orphan rows vanish.
  const rows = [
    ['beta', 'Open Beta root, In Progress'],
    ['second', 'Open Second child, Review Required'],
    ['grandchild', 'Open Nested descendant, In Progress'],
    ['first', 'Open First child, Waiting'],
    ['peer', 'Open Earlier peer child, Blocked'],
    ['older', 'Open Older fallback child, Discussion Needed'],
    ['newer', 'Open Newer fallback child, Not Started'],
    ['alpha', 'Open Alpha root, Complete'],
  ];
  await expect(tasks.getByRole('button')).toHaveCount(9);
  expect(
    await tasks
      .getByRole('button')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
  ).toEqual(['Open spec, 1 of 8 tasks complete', ...rows.map(([, label]) => label)]);
  await expect(target.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await captureLeaf(page, tasks, 'flame-linked-tree', info);
  const clicked = [];
  for (const [id, label] of rows) {
    await openTasks(page, target);
    await button(popup(page), label).click();
    clicked.push(id);
    await expectJson(host, 'Flame note callbacks', clicked);
  }
});

test('workspace flame fallback: absent spec links retain root peer ordering and missing spec disables summary', async ({
  page,
}) => {
  const host = await openLeaf(page, 'flame-graph');
  await choose(page, host, 'Flame note inputs', 'no-links');
  const target = host.getByTestId('flame-graph-target');
  let tasks = await openTasks(page, target);
  expect(
    await tasks
      .getByRole('button')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
  ).toEqual([
    'Open spec, 1 of 9 tasks complete',
    'Open Alpha root, Complete',
    'Open Beta root, In Progress',
    'Open Second child, Review Required',
    'Open Nested descendant, In Progress',
    'Open First child, Waiting',
    'Open Earlier peer child, Blocked',
    'Open Older fallback child, Discussion Needed',
    'Open Newer fallback child, Not Started',
    'Open Unlinked root, Not Started',
  ]);
  await page.keyboard.press('Escape');
  await choose(page, host, 'Flame note inputs', 'missing-spec');
  tasks = await openTasks(page, target);
  await expect(button(tasks, 'Open spec, 0 of 1 tasks complete')).toBeDisabled();
  await button(tasks, 'Open Build UI, In Progress').click();
  await expectJson(host, 'Flame note callbacks', ['task-1']);
  await page.keyboard.press('Escape');
  await toggle(host, 'Enable note callback').click();
  tasks = await openTasks(page, target);
  await button(tasks, 'Open Build UI, In Progress').click();
  await expectJson(host, 'Flame note callbacks', ['task-1']);
  await page.keyboard.press('Escape');
  await choose(page, host, 'Flame note inputs', 'empty');
  tasks = await openTasks(page, target);
  await expect(tasks.getByRole('button')).toHaveCount(1);
  await expect(tasks.getByRole('button')).toBeDisabled();
});

test('workspace flame lifecycle: loading reserves progress-bar bounds and same-key data refresh retains the bar', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'flame-graph');
  const target = host.getByTestId('flame-graph-target');
  const bar = target.getByRole('progressbar');
  const original = await bar.elementHandle();
  await captureLeaf(page, target, 'flame-ready-before', info);
  const before = await bar.boundingBox();
  await toggle(host, 'Complete Build locally').click();
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await expect(bar).toHaveAttribute(
    'aria-valuetext',
    '2 complete, 1 review required, 1 not started',
  );
  await expect(bar).toHaveAttribute('aria-valuenow', '25');
  await button(host, 'Switch flame animation key').click();
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  expect(await bar.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  await toggle(host, 'Flame loading').click();
  await expect(bar).toHaveCount(0);
  await expect(target.getByRole('button')).toHaveCount(0);
  await captureLeaf(page, target, 'flame-loading-after', info);
  const loading = await target.locator('[data-task-status-progress]').boundingBox();
  // Source ready content has an inline Tooltip wrapper; loading has no wrapper.
  // Keep both outer probes above, but the shared bar owns loading-slot stability.
  await info.attach('flame-progress-slot-bounds.json', {
    body: JSON.stringify({ before, loading }, null, 2),
    contentType: 'application/json',
  });
  expect(before).not.toBeNull();
  expect(loading).not.toBeNull();
  expect(Math.abs(before.width - loading.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.height - loading.height)).toBeLessThanOrEqual(1);
  await toggle(host, 'Flame loading').click();
  await expect(bar).toHaveAttribute('aria-valuenow', '25');
  await host.getByRole('textbox', { name: 'Flame canonical progress', exact: true }).fill('');
  await expect(bar).toHaveCount(0);
  await host.getByRole('textbox', { name: 'Flame canonical progress', exact: true }).fill('0.8');
  await expect(bar).toHaveAttribute('aria-valuenow', '80');
});

test('workspace flame scrolling: native wheel reaches the final long task without moving the page', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'flame-graph');
  await choose(page, host, 'Flame note inputs', 'long-list');
  const target = host.getByTestId('flame-graph-target');
  const tasks = await openTasks(page, target);
  const final = tasks.getByRole('button', {
    name: 'Open Task 24: a long title for checking readable labels and access to the final row, Not Started',
    exact: true,
  });
  const first = tasks.getByRole('button', {
    name: 'Open Task 1: a long title for checking readable labels and access to the final row, Not Started',
    exact: true,
  });
  await first.hover();
  const beforeScroll = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 480);
  await expect(final).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(beforeScroll);
  await expectContained(page, tasks);
  await captureLeaf(page, tasks, 'flame-final-row', info);
  await final.click();
  await expectJson(host, 'Flame note callbacks', ['scroll-24']);
});

test('workspace favicon failure: real non-image bytes reveal the fallback and a new URL recovers', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'browser-favicon');
  const target = host.getByTestId('favicon-target');
  const glyph = target.locator(':scope > span');
  const image = target.locator('img');
  const observations = await observeImages(page, target);
  const fallback = await glyph.screenshot({ animations: 'allow' });
  await captureLeaf(page, target, 'favicon-failure-before', info);
  await radio(host, 'Non-image URL').click();
  await expect(image).toHaveCount(1);
  await expect
    .poll(() =>
      observations.events.some(
        (event) =>
          event.type === 'error' &&
          event.src.endsWith('/runtime-config.js') &&
          event.complete &&
          event.naturalWidth === 0,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      observations.responses.some(
        (response) => response.url.endsWith('/runtime-config.js') && response.status === 200,
      ),
    )
    .toBe(true);
  expect((await glyph.screenshot({ animations: 'allow' })).equals(fallback)).toBe(true);
  await captureLeaf(page, target, 'favicon-natural-error', info);
  const failedImage = await image.elementHandle();
  await radio(host, 'App PNG').click();
  await expectDecoded(image);
  expect(await failedImage.evaluate((node) => node.isConnected)).toBe(false);
  expect((await glyph.screenshot({ animations: 'allow' })).equals(fallback)).toBe(false);
  await captureLeaf(page, target, 'favicon-recovered-after', info);
  await info.attach('favicon-native-failure-events.json', {
    body: JSON.stringify(observations, null, 2),
    contentType: 'application/json',
  });
});

test('workspace favicon sizing: same-URL input changes retain the decoded image', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'browser-favicon');
  const target = host.getByTestId('favicon-target');
  const image = target.locator('img');
  await radio(host, 'App PNG').click();
  await expectDecoded(image);
  const original = await image.elementHandle();
  await captureLeaf(page, target, 'favicon-size-before', info);
  await toggle(host, 'Custom favicon size').click();
  await host.getByRole('spinbutton', { name: 'Favicon size', exact: true }).fill('48');
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await expectDecoded(image);
  await toggle(host, 'Foreground fallback').click();
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await expectContained(page, target);
  await captureLeaf(page, target, 'favicon-size-after', info);
});

test('workspace forced colors: status and resource leaves keep decorative accessibility and usable controls', async ({
  page,
}, info) => {
  await page.emulateMedia({ forcedColors: 'active' });
  let host = await openLeaf(page, 'workspace-status-icon');
  await toggle(host, 'Custom status size').click();
  await host.getByRole('spinbutton', { name: 'Status size', exact: true }).fill('48');
  let target = host.getByTestId('workspace-status-target');
  await expect(target.getByRole('img')).toHaveAccessibleName('In progress');
  await captureLeaf(page, target, 'status-forced-colors', info);
  await choose(page, host, 'Workspace status', 'blocked');
  await expect(target.getByRole('img')).toHaveAccessibleName('Blocked');
  await captureLeaf(page, target, 'status-forced-colors-after', info);
  host = await openLeaf(page, 'resource-icon-tile');
  await radio(host, 'Changes').press('Space');
  await radio(host, 'Emphasized').press('Space');
  target = host.getByTestId('resource-tile-target');
  await expect(target.getByRole('img')).toHaveCount(0);
  await expectContained(page, target);
  await captureLeaf(page, target, 'resource-forced-colors', info);
});
