import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

const statuses = [
  ['failed', 'Needs attention'],
  ['blocked', 'Needs attention'],
  ['needs_attention', 'Needs attention'],
  ['not_started', 'Not started'],
  ['in_progress', 'In progress'],
  ['idle', 'Done & idle'],
  ['complete', 'Done & idle'],
  ['pr_open', 'PR open'],
  ['pr_ready', 'PR mergeable'],
  ['pr_queued', 'PR queued'],
  ['pr_merged', 'PR merged'],
] as const;

test('Home status groups restore every work stage in list view only', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1320 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  const component = await mount(Preview, {
    props: { scenario: 'status-grouping', height: 1300 },
  });
  await expect(component.locator('[data-home-workspace]')).toHaveCount(13);
  await testInfo.attach('before-activity-groups', {
    body: await page.screenshot({ path: testInfo.outputPath('before-activity-groups.png') }),
    contentType: 'image/png',
  });
  await component.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('combobox', { name: 'Group by', exact: true }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(component.locator('[data-home-group]')).toHaveCount(8);
  for (const [status, label] of statuses) {
    const group = component.getByRole('listbox', { name: label, exact: true });
    await expect(group.locator(`[data-home-workspace="home-status-${status}"]`)).toHaveCount(1);
  }
  const unstarted = component.getByRole('listbox', { name: 'Not started', exact: true });
  await expect(unstarted.locator('[data-home-workspace]')).toHaveCount(3);
  const attention = component.getByRole('listbox', { name: 'Needs attention', exact: true });
  await expect(attention.locator('[data-home-workspace]')).toHaveCount(3);
  const inactive = component.getByRole('listbox', { name: 'Done & idle', exact: true });
  await expect(inactive.locator('[data-home-workspace]')).toHaveCount(2);
  await expect(component.locator('[data-home-workspace]')).toHaveCount(13);
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await testInfo.attach('after-status-list', {
    body: await page.screenshot({ path: testInfo.outputPath('after-status-list.png') }),
    contentType: 'image/png',
  });
  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  const board = component.locator('[data-home-board]');
  await expect(board.locator('section')).toHaveCount(4);
  await expect(board.getByRole('region', { name: 'Needs you', exact: true })).toBeVisible();
  await expect(board.getByRole('region', { name: 'Running', exact: true })).toBeVisible();
  // A PR in the merge queue is waiting on CI, not done.
  await expect(
    board
      .getByRole('region', { name: 'Waiting', exact: true })
      .locator('[data-home-workspace="home-status-pr_queued"]'),
  ).toHaveCount(1);
  await expect(
    board
      .getByRole('region', { name: 'Done & idle', exact: true })
      .locator('[data-home-workspace]'),
  ).toHaveCount(7);
  await expect(board.locator('[data-home-workspace]')).toHaveCount(13);
  await component.getByRole('button', { name: 'View options', exact: true }).click();
  const grouping = page.getByRole('combobox', { name: 'Group by', exact: true });
  await expect(grouping).toContainText('Activity');
  await grouping.click();
  await expect(page.getByRole('option', { name: 'Status', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await testInfo.attach('kanban-activity-columns', {
    body: await page.screenshot({ path: testInfo.outputPath('kanban-activity-columns.png') }),
    contentType: 'image/png',
  });
  await component.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(component.locator('[data-home-group]')).toHaveCount(8);
  await page.evaluate(() =>
    window.__homeWorkspacePreview!.setStatus('home-status-pr_open', 'pr_ready'),
  );
  await expect(component.getByRole('listbox', { name: 'PR open', exact: true })).toHaveCount(0);
  await expect(
    component
      .getByRole('listbox', { name: 'PR mergeable', exact: true })
      .locator('[data-home-workspace]'),
  ).toHaveCount(2);
  await expect(component.locator('[data-home-workspace]')).toHaveCount(13);
  await page.evaluate(() =>
    window.__homeWorkspacePreview!.setStatus('home-status-failed', 'complete'),
  );
  await expect(attention.locator('[data-home-workspace]')).toHaveCount(2);
  await expect(inactive.locator('[data-home-workspace]')).toHaveCount(3);
  await expect(inactive.locator('[data-home-workspace="home-status-failed"]')).toHaveCount(1);
  await expect(component.locator('[data-home-workspace]')).toHaveCount(13);
});

test('Home status grouping keeps pinned work unique and respects filters and saved settings', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const component = await mount(Preview, { props: { scenario: 'status-grouping', height: 980 } });
  await component.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('combobox', { name: 'Group by', exact: true }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__homeWorkspacePreview!.roundTripSettings());
  await expect(component.locator('[data-home-group]')).toHaveCount(8);
  const pinned = component.locator('[data-home-workspace="home-status-pr_ready"]');
  await pinned.getByRole('button').click();
  await page.getByRole('menuitem', { name: /^Pin/ }).click();
  await expect(
    component
      .getByRole('listbox', { name: 'Pinned', exact: true })
      .locator('[data-home-workspace]'),
  ).toHaveCount(1);
  await expect(pinned).toHaveCount(1);
  await expect(component.getByRole('listbox', { name: 'PR mergeable', exact: true })).toHaveCount(
    0,
  );
  const needsYou = component
    .getByRole('group', { name: 'Status', exact: true })
    .getByRole('button', { name: /^Needs you/ });
  await needsYou.click();
  await expect(
    component
      .getByRole('listbox', { name: 'Needs attention', exact: true })
      .locator('[data-home-workspace]'),
  ).toHaveCount(3);
  await expect(component.locator('[data-home-workspace="home-status-pr_open"]')).toHaveCount(0);
  await component
    .getByRole('group', { name: 'Status', exact: true })
    .getByRole('button', { name: /^All \d/ })
    .click();
  await component.getByRole('searchbox').fill('PR open');
  await expect(component.locator('[data-home-workspace]')).toHaveCount(1);
  await expect(component.locator('[data-home-workspace="home-status-pr_open"]')).toBeVisible();
  await component.getByRole('searchbox').clear();
  await component.getByRole('button', { name: 'acme/studio', exact: true }).click();
  await expect(component.locator('[data-home-workspace="home-status-pr_merged"]')).toHaveCount(0);
  await component
    .getByRole('navigation', { name: 'Home', exact: true })
    .getByRole('button', { name: /^All repos/ })
    .click();
  await component.getByRole('button', { name: /^Archived/ }).click();
  await expect(component.locator('[data-home-workspace]')).toHaveCount(1);
  await expect(
    component
      .getByRole('listbox', { name: 'Archived', exact: true })
      .locator('[data-home-workspace="home-status-archived"]'),
  ).toBeVisible();
  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  await expect(
    component
      .locator('[data-home-board]')
      .getByRole('region', { name: 'Archived', exact: true })
      .locator('[data-home-workspace]'),
  ).toHaveCount(1);
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
  await testInfo.attach('filtered-archived-status-groups', {
    body: await page.screenshot({
      path: testInfo.outputPath('filtered-archived-status-groups.png'),
    }),
    contentType: 'image/png',
  });
});

test('Home status groups preserve selection and collapse state with a narrow dark layout', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 760, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const component = await mount(Preview, { props: { scenario: 'status-grouping', height: 720 } });
  await component.getByRole('button', { name: 'View options', exact: true }).click();
  const grouping = page.getByRole('combobox', { name: 'Group by', exact: true });
  await grouping.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.keyboard.press('Escape');
  const attentionCollapse = component
    .locator('[data-home-group="status:needs_attention"]')
    .getByRole('button');
  await attentionCollapse.focus();
  await page.keyboard.press('Enter');
  for (const status of ['failed', 'blocked', 'needs_attention']) {
    await expect(component.locator(`[data-home-workspace="home-status-${status}"]`)).toHaveCount(0);
  }
  await page.evaluate(() => window.__homeWorkspacePreview!.roundTripSettings());
  await expect(component.locator('[data-home-workspace="home-status-failed"]')).toHaveCount(0);
  await attentionCollapse.click();
  await expect(
    component
      .getByRole('listbox', { name: 'Needs attention', exact: true })
      .locator('[data-home-workspace]'),
  ).toHaveCount(3);
  const collapse = component.locator('[data-home-group="status:pr_open"]').getByRole('button');
  await collapse.focus();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-workspace="home-status-pr_open"]')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-workspace="home-status-pr_open"]')).toBeVisible();
  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  await component.locator('[data-home-workspace="home-status-pr_open"]').click();
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await component.getByRole('button', { name: 'Back to list', exact: true }).click();
  await expect(component.locator('[data-home-workspace="home-status-pr_open"]')).toBeFocused();
  await component.locator('[data-home-workspace="home-status-pr_open"]').click();
  await page.setViewportSize({ width: 1440, height: 740 });
  await component.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(
    component.locator('[data-home-workspace="home-status-pr_open"]').locator('..'),
  ).toHaveAttribute('aria-selected', 'true');
  await collapse.click();
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await component.getByRole('button', { name: 'View options', exact: true }).click();
  await grouping.click();
  await page.getByRole('option', { name: 'Activity', exact: true }).click();
  await page.keyboard.press('Escape');
  await component.getByRole('button', { name: 'View options', exact: true }).click();
  await grouping.click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(component.locator('[data-home-workspace="home-status-pr_open"]')).toHaveCount(0);
  await collapse.click();
  await page.setViewportSize({ width: 760, height: 740 });
  await testInfo.attach('after-status-dark-narrow', {
    body: await page.screenshot({ path: testInfo.outputPath('after-status-dark-narrow.png') }),
    contentType: 'image/png',
  });
});

test('Home activity groups move script-running and waiting workspaces live', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1320 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const component = await mount(Preview, {
    props: { scenario: 'status-grouping', height: 1300 },
  });
  await expect(component.locator('[data-home-workspace]')).toHaveCount(13);
  const group = (name: string) => component.getByRole('listbox', { name, exact: true });
  const row = (name: string, id: string) =>
    group(name).locator(`[data-home-workspace="home-status-${id}"]`);
  await expect(row('Waiting', 'pr_queued')).toHaveCount(1);
  await expect(row('Done & idle', 'idle')).toHaveCount(1);

  await page.evaluate(() =>
    window.__homeWorkspacePreview!.setFlags('home-status-idle', { scriptsRunning: true }),
  );
  await expect(row('Running', 'idle')).toHaveCount(1);
  await expect(
    row('Running', 'idle').getByRole('img', { name: /^Running\. A command script/ }),
  ).toBeVisible();

  // An agent's background shell (no turn, no script) also counts as Running.
  await page.evaluate(() =>
    window.__homeWorkspacePreview!.setFlags('home-status-idle', {
      scriptsRunning: false,
      backgroundTasksRunning: true,
    }),
  );
  await expect(row('Running', 'idle')).toHaveCount(1);
  await expect(
    row('Running', 'idle').getByRole('img', { name: /^Running\. An agent's background task/ }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  await testInfo.attach('background-task-running', {
    body: await page.screenshot({ path: testInfo.outputPath('background-task-running.png') }),
    contentType: 'image/png',
  });

  await page.evaluate(() =>
    window.__homeWorkspacePreview!.setFlags('home-status-idle', {
      backgroundTasksRunning: false,
      waiting: true,
    }),
  );
  await expect(row('Waiting', 'idle')).toHaveCount(1);
  await expect(group('Waiting').locator('[data-home-workspace]')).toHaveCount(2);
  await page.mouse.move(0, 0);
  await testInfo.attach('waiting-group', {
    body: await page.screenshot({ path: testInfo.outputPath('waiting-group.png') }),
    contentType: 'image/png',
  });

  // Needs you still wins over waiting.
  await page.evaluate(() =>
    window.__homeWorkspacePreview!.setStatus('home-status-idle', 'needs_attention'),
  );
  await expect(row('Needs you', 'idle')).toHaveCount(1);

  // The Waiting filter lists exactly the Waiting group.
  await component
    .locator('.home-workspace-filters-wide')
    .getByRole('button', { name: /^Waiting/ })
    .click();
  await expect(component.locator('[data-home-workspace]')).toHaveCount(1);
  await expect(component.locator('[data-home-workspace="home-status-pr_queued"]')).toHaveCount(1);
});
