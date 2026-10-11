import { test, expect } from '../lib/functional.mjs';
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

// Source oracles are the six Svelte leaves and their pure presentation helpers.
// These local props/callbacks do not verify workspace, note, or browser-client services.
test('workspace status: every source state exposes its name and decorative mode removes it', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'workspace-status-icon');
  const target = host.getByTestId('workspace-status-target');
  await captureLeaf(page, target, 'status-before', info);
  for (const [value, label] of [
    ['failed', 'Failed'],
    ['blocked', 'Blocked'],
    ['needs_attention', 'Needs attention'],
    ['in_progress', 'In progress'],
    ['waiting', 'Waiting'],
    ['unread', 'Unread'],
    ['not_started', 'Not started'],
    ['idle', 'Idle'],
    ['complete', 'Complete'],
    ['pr_queued', 'PR Queued'],
    ['pr_ready', 'PR Mergeable'],
    ['pr_open', 'PR open'],
    ['pr_merged', 'PR merged'],
  ]) {
    await choose(page, host, 'Workspace status', value);
    await expect(target.getByRole('img')).toHaveAccessibleName(label);
    // Native title is the source tooltip API; browser chrome is not DOM tooltip content.
    await expect(target.getByRole('img')).toHaveAttribute('title', label);
  }
  await toggle(host, 'Decorative status icon').click();
  await expect(target.getByRole('img')).toHaveCount(0);
  await expect(target.locator('[data-workspace-status]')).toHaveAttribute('aria-hidden', 'true');
  await expect(target.locator('[title]')).toHaveCount(0);
  await expect(target.locator('[aria-label]')).toHaveCount(0);
  await captureLeaf(page, target, 'status-decorative-after', info);
  await toggle(host, 'Decorative status icon').press('Space');
  await expect(target.getByRole('img')).toHaveAccessibleName('PR merged');
});

test('workspace driving: here elsewhere offline and hidden inputs retain source tooltip behavior', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'driving-client-indicator');
  const target = host.getByTestId('driving-client-target');
  const trigger = target.getByRole('button');
  await expect(trigger).toHaveAccessibleName('Browser on Office Linux');
  await trigger.hover();
  await expect(popup(page)).toContainText(
    'Agent browser tabs and tunnels for this workspace run on Office Linux.',
  );
  await captureLeaf(page, popup(page), 'driving-elsewhere-before', info);
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);
  await choose(page, host, 'Driving client', 'own');
  await expect(trigger).toHaveAccessibleName('Browser-use on this client');
  await toggle(host, 'Has browser tabs').click();
  await expect(trigger).toHaveCount(0);
  await choose(page, host, 'Driving client', 'offline');
  await expect(trigger).toHaveAccessibleName('Primary client offline');
  await choose(page, host, 'Eligible clients', 'none');
  await expect(trigger).toHaveAccessibleName('Primary client offline');
  await trigger.hover();
  await expect(popup(page)).toContainText('Office Linux is the primary client and is offline.');
  await expectContained(page, popup(page));
  await captureLeaf(page, popup(page), 'driving-offline-after', info);
  await page.keyboard.press('Escape');
  await choose(page, host, 'Driving client', 'none');
  await expect(trigger).toHaveCount(0);
  await choose(page, host, 'Driving client', 'own');
  await choose(page, host, 'Eligible clients', 'own-only');
  await toggle(host, 'Has browser tabs').click();
  await expect(trigger).toHaveCount(0);
});

test('workspace progress: caller ratio and status details stay independent through loading', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'task-status-progress');
  const target = host.getByTestId('task-progress-target');
  const bar = target.getByRole('progressbar', { name: 'Task progress', exact: true });
  const details =
    '1 complete, 1 in progress, 1 review required, 1 discussion needed, 1 blocked, 1 waiting, 1 not started';
  await expect(bar).toHaveAttribute('aria-valuenow', '14');
  await expect(bar).toHaveAttribute('aria-valuemin', '0');
  await expect(bar).toHaveAttribute('aria-valuemax', '100');
  await expect(bar).toHaveAttribute('aria-valuetext', details);
  const before = await captureLeaf(page, target, 'progress-ready-before', info);
  await choose(page, host, 'Canonical progress', 'canonical 0.8');
  await expect(bar).toHaveAttribute('aria-valuenow', '80');
  await expect(bar).toHaveAttribute('aria-valuetext', details);
  await choose(page, host, 'Progress loading', 'loading');
  await expect(bar).toHaveCount(0);
  await expect(target.locator('[data-flame-progress-placeholder]')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  const loading = await captureLeaf(page, target, 'progress-loading-after', info);
  // Loading must reserve the same space so adjacent controls do not jump.
  expect(Math.abs(before.root.width - loading.root.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.root.height - loading.root.height)).toBeLessThanOrEqual(1);
  await choose(page, host, 'Progress loading', 'ready');
  await expect(bar).toHaveAttribute('aria-valuenow', '80');
  await expect(bar).toHaveAttribute('aria-valuetext', details);
});

test('workspace flame: native trigger summary and task callbacks preserve exact note identity', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'flame-graph');
  await choose(page, host, 'Flame note inputs', 'source-single');
  const target = host.getByTestId('flame-graph-target');
  await expect(target.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await expectJson(host, 'Flame note callbacks', []);
  await target.getByRole('button').click();
  await expectJson(host, 'Flame note callbacks', ['spec']);
  let tasks = await openTasks(page, target);
  await captureLeaf(page, tasks, 'flame-single-before', info);
  await button(tasks, 'Open spec, 0 of 1 tasks complete').click();
  await expectJson(host, 'Flame note callbacks', ['spec', 'spec']);
  tasks = await openTasks(page, target);
  await button(tasks, 'Open Build UI, In Progress').press('Enter');
  await expectJson(host, 'Flame note callbacks', ['spec', 'spec', 'task-1']);
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);
  await choose(page, host, 'Flame note inputs', 'source-four');
  tasks = await openTasks(page, target);
  await expect(button(tasks, 'Open spec, 1 of 4 tasks complete')).toBeEnabled();
  await expectContained(page, tasks);
  await captureLeaf(page, tasks, 'flame-four-after', info);
  await button(tasks, 'Open Test, Review Required').click();
  await expectJson(host, 'Flame note callbacks', ['spec', 'spec', 'task-1', 'test']);
});

test('workspace favicon: actual image loads replace URL identity and clearing restores the fallback', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'browser-favicon');
  const target = host.getByTestId('favicon-target');
  const glyph = target.locator(':scope > span');
  const image = target.locator('img');
  const observations = await observeImages(page, target);
  await expect(image).toHaveCount(0);
  const fallback = await glyph.screenshot({ animations: 'allow' });
  await captureLeaf(page, target, 'favicon-empty-before', info);
  await radio(host, 'App PNG').click();
  await expectDecoded(image);
  await expect
    .poll(() =>
      observations.events.some(
        (event) => event.type === 'load' && event.src.endsWith('/favicon.png'),
      ),
    )
    .toBe(true);
  const original = await image.elementHandle();
  expect((await glyph.screenshot({ animations: 'allow' })).equals(fallback)).toBe(false);
  await captureLeaf(page, target, 'favicon-loaded-after', info);
  await radio(host, 'iOS PNG').click();
  await expectDecoded(image);
  await expect
    .poll(() =>
      observations.events.some(
        (event) =>
          event.type === 'load' && event.src.endsWith('/icons/Icon-iOS-Default-68x68@2x.png'),
      ),
    )
    .toBe(true);
  expect(await original.evaluate((node) => node.isConnected)).toBe(false);
  await expect(image).toHaveAttribute('src', '/icons/Icon-iOS-Default-68x68@2x.png');
  await expect(target.getByRole('img')).toHaveCount(0);
  await radio(host, 'No URL').click();
  await expect(image).toHaveCount(0);
  expect((await glyph.screenshot({ animations: 'allow' })).equals(fallback)).toBe(true);
  await info.attach('favicon-native-events.json', {
    body: JSON.stringify(observations, null, 2),
    contentType: 'application/json',
  });
});

test('workspace resource: both kinds and variants remain decorative and contained at 420px', async ({
  page,
}, info) => {
  const host = await openLeaf(page, 'resource-icon-tile');
  const target = host.getByTestId('resource-tile-target');
  await captureLeaf(page, target, 'resource-default-before', info);
  for (const kind of ['Note', 'Changes']) {
    await radio(host, kind).click();
    for (const variant of ['Standard', 'Emphasized']) {
      await radio(host, variant).click();
      await expect(target.getByRole('img')).toHaveCount(0);
      await expect(target.locator(':scope > span')).toHaveAttribute('aria-hidden', 'true');
      await expect(target.locator('button, [tabindex], a[href]')).toHaveCount(0);
      await expectContained(page, target);
      await captureLeaf(page, target, `resource-${kind}-${variant}`, info);
    }
  }
});
