import { expect, test } from '../../test/ct-test';
import Preview from './home-dismiss.preview.svelte';
import { IPC_CHANNELS } from '$shared/ipc-registry';
const observedReasons = [
  { id: 'workspace:review', revision: 'review-1' },
  { id: 'agent:question', revision: 'question-1' },
];

test('Board dismissal keeps selected details and focus when the card moves', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const component = await mount(Preview);
  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  const board = component.locator('[data-home-board]');
  const card = board.getByRole('button', { name: 'Review onboarding', exact: true });
  await card.click();
  await card.focus();
  await page.keyboard.press('Shift+F10');
  const dismiss = page.getByRole('menuitem', { name: 'Dismiss for now', exact: true });
  await expect(dismiss).toBeVisible();
  await testInfo.attach('home-board-dismiss-before', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await dismiss.click();
  const moved = board
    .getByRole('region', { name: 'Done & idle', exact: true })
    .getByRole('button', { name: 'Review onboarding', exact: true });
  await expect(moved.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
  await expect(moved).toBeFocused();
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await expect(board.getByRole('region', { name: 'PR ready', exact: true })).toBeVisible();
  await testInfo.attach('home-board-dismiss-after', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const surface of ['home', 'sidebar'] as const) {
  test(`${surface} freezes the menu snapshot and acknowledges only observed reasons`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    });
    const component = await mount(Preview, { props: { sidebar: surface === 'sidebar' } });
    const row =
      surface === 'home'
        ? component.getByRole('option', { name: 'Review onboarding' })
        : component.locator('[data-workspace-card-trigger]');
    await row.focus();
    await page.keyboard.press('Shift+F10');
    const dismiss = page.getByRole('menuitem', { name: 'Dismiss for now', exact: true });
    await expect(dismiss).toBeVisible();
    await testInfo.attach(`${surface}-before`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.evaluate(() => {
      window.__homeDismiss!.holdNext();
      window.__homeDismiss!.addReason();
    });
    await dismiss.click();
    await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
    expect(await page.evaluate(() => window.__homeDismiss!.calls[0])).toEqual({
      channel: IPC_CHANNELS.BACKEND.REQUEST,
      method: 'workspace.dismissAttention',
      params: { workspaceId: 'dismiss-review', reasons: observedReasons },
    });
    await page.evaluate(() => window.__homeDismiss!.release());
    await expect(
      surface === 'home'
        ? row.locator('[data-home-status]')
        : component.locator('[data-workspace-status]'),
    ).toHaveAttribute(
      surface === 'home' ? 'data-home-status' : 'data-workspace-status',
      surface === 'home' ? 'needs-you' : 'needs_attention',
    );
    if (surface === 'sidebar') {
      await component.getByRole('button', { name: 'Workspace actions', exact: true }).click();
    } else {
      await row.focus();
      await page.keyboard.press('Shift+F10');
    }
    await dismiss.click();
    await expect(
      surface === 'home'
        ? row.locator('[data-home-status]')
        : component.locator('[data-workspace-status]'),
    ).toHaveAttribute(
      surface === 'home' ? 'data-home-status' : 'data-workspace-status',
      surface === 'home' ? 'idle' : 'waiting',
    );
    await expect(row).toBeFocused();
    await page.evaluate(() => {
      window.__homeDismiss!.refresh();
      window.__homeDismiss!.unchangedEvents();
      window.__homeDismiss!.invalidate();
    });
    await expect
      .poll(() => page.evaluate(() => window.__homeDismiss!.reads))
      .toEqual(['dismiss-review']);
    await expect(
      surface === 'home'
        ? row.locator('[data-home-status]')
        : component.locator('[data-workspace-status]'),
    ).toHaveAttribute(
      surface === 'home' ? 'data-home-status' : 'data-workspace-status',
      surface === 'home' ? 'idle' : 'waiting',
    );
    await expect(page.getByRole('menu')).toHaveCount(0);
    await testInfo.attach(`${surface}-after`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await testInfo.attach(`${surface}-wire`, {
      body: JSON.stringify(await page.evaluate(() => window.__homeDismiss!.calls), null, 2),
      contentType: 'application/json',
    });
    await page.evaluate(() => window.__homeDismiss!.setActivity('agent_running'));
    await expect(
      surface === 'home'
        ? row.locator('[data-home-status]')
        : component.locator('[data-workspace-status]'),
    ).toHaveAttribute(
      surface === 'home' ? 'data-home-status' : 'data-workspace-status',
      surface === 'home' ? 'running' : 'in_progress',
    );
    await testInfo.attach(`${surface}-activity-running`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.evaluate(() => window.__homeDismiss!.setActivity('idle'));
    await expect(
      surface === 'home'
        ? row.locator('[data-home-status]')
        : component.locator('[data-workspace-status]'),
    ).toHaveAttribute(
      surface === 'home' ? 'data-home-status' : 'data-workspace-status',
      surface === 'home' ? 'idle' : 'waiting',
    );
  });
}

for (const incoming of ['new reason', 'activity', 'failure'] as const) {
  test(`A late dismissal reply preserves newer ${incoming}`, async ({ mount, page }, testInfo) => {
    const component = await mount(Preview);
    const row = component.getByRole('option', { name: 'Review onboarding' });
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await page.evaluate(() => window.__homeDismiss!.holdNextResponse());
    await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
    await page.evaluate((edge) => {
      const fixture = window.__homeDismiss!;
      if (edge === 'new reason') {
        fixture.addReason();
        fixture.invalidate();
      } else if (edge === 'activity') fixture.setActivity('agent_running');
      else fixture.setStatus('failed');
    }, incoming);
    if (incoming === 'new reason')
      await expect
        .poll(() => page.evaluate(() => window.__homeDismiss!.reads))
        .toEqual(['dismiss-review']);
    await page.evaluate(() => window.__homeDismiss!.release());
    await expect.poll(() => page.evaluate(() => window.__homeDismiss!.responses.length)).toBe(1);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(row.locator('[data-home-status]')).toHaveAttribute(
      'data-home-status',
      incoming === 'new reason' ? 'needs-you' : incoming === 'activity' ? 'running' : 'blocked',
    );
    if (incoming === 'failure')
      await expect(row.locator('[data-home-status]')).toHaveAccessibleName(/^Failed\./);
    await testInfo.attach(`late-dismiss-${incoming}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await testInfo.attach(`late-dismiss-${incoming}-wire`, {
      body: JSON.stringify(
        await page.evaluate(() => ({
          requests: window.__homeDismiss!.calls,
          responses: window.__homeDismiss!.responses,
        })),
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
}

test('Dismissal keeps active work in Running', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  await page.evaluate(() => window.__homeDismiss!.setStatus('in_progress'));
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  const running = component
    .getByRole('listbox', { name: 'Running', exact: true })
    .getByRole('option', { name: 'Review onboarding' });
  await expect(running.locator('[data-home-status]')).toHaveAttribute(
    'data-home-status',
    'running',
  );
  await expect(running).toBeFocused();
  await testInfo.attach('home-dismiss-running', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Home preserves selected details under Needs you and handles rejection, new reasons and priority states', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  const statuses = component.getByRole('group', { name: 'Status', exact: true });
  await statuses.getByRole('button', { name: /^Needs you/ }).click();
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.click();
  await row.getByRole('button', { name: 'Workspace actions', exact: true }).click();
  await page.evaluate(() => window.__homeDismiss!.failNext());
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
  await expect(row).toBeVisible();
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  const compactFilter = component.getByRole('combobox', { name: 'Status', exact: true });
  await expect(compactFilter).toBeFocused();
  await compactFilter.click();
  await page.getByRole('option', { name: 'All', exact: true }).click();
  const moved = component.getByRole('option', { name: 'Review onboarding' });
  await expect(moved.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
  await page.evaluate(() => window.__homeDismiss!.refresh());
  await expect(moved.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
  await page.evaluate(() => window.__homeDismiss!.setStatus('in_progress'));
  await expect(moved.locator('[data-home-status]')).toHaveAttribute('data-home-status', 'running');
  await page.evaluate(() => window.__homeDismiss!.addReason());
  await expect(moved.locator('[data-home-status]')).toHaveAttribute(
    'data-home-status',
    'needs-you',
  );
  for (const status of ['blocked', 'failed'] as const) {
    await page.evaluate((value) => window.__homeDismiss!.setStatus(value), status);
    await moved.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Dismiss for now', exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
  }
  await testInfo.attach('home-dismiss-priority', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Dismiss menus remain readable for collaborators in dark narrow layout; PR-only and older daemons hide action', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 740 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const component = await mount(Preview, { props: { collaborator: true } });
  for (const title of ['Ready to merge', 'Older daemon reminder']) {
    const row = component.getByRole('option', { name: title });
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Dismiss for now', exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
  }
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Dismiss for now', exact: true })).toBeVisible();
  await testInfo.attach('home-dismiss-dark-narrow', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const destination of ['search', 'another workspace'] as const) {
  test(`Slow Home dismissal preserves focus moved into ${destination}`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(Preview);
    const row = component.getByRole('option', { name: 'Review onboarding' });
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await page.evaluate(() => window.__homeDismiss!.holdNext());
    await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
    const target =
      destination === 'search'
        ? component.getByRole('searchbox')
        : component.getByRole('option', { name: 'Ready to merge' });
    await target.focus();
    await page.evaluate(() => window.__homeDismiss!.release());
    await expect(row.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
    await expect(target).toBeFocused();
    await testInfo.attach(`home-dismiss-focus-${destination}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('A late partial dismissal cannot undo a newer acknowledgement', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview);
  const row = component.getByRole('option', { name: 'Review onboarding' });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.evaluate(() => {
    window.__homeDismiss!.addReason();
    window.__homeDismiss!.holdNextResponse();
  });
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.calls.length)).toBe(1);
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Dismiss for now', exact: true }).click();
  await expect(row.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.responses.length)).toBe(1);
  await page.evaluate(() => window.__homeDismiss!.release());
  await expect.poll(() => page.evaluate(() => window.__homeDismiss!.responses.length)).toBe(2);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(row.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
  await page.evaluate(() => window.__homeDismiss!.refresh());
  await expect(row.locator('[data-home-status]')).toHaveAccessibleName(/Waiting/);
  await testInfo.attach('late-partial-dismissal', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await testInfo.attach('late-partial-dismissal-wire', {
    body: JSON.stringify(
      await page.evaluate(() => ({
        requests: window.__homeDismiss!.calls,
        responses: window.__homeDismiss!.responses,
      })),
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
