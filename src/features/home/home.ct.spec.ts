import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';
import IntegrationPreview from './home-integrations.preview.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`Home destination labels remain readable after keyboard selection in ${theme} mode`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
    }, theme);
    const component = await mount(Preview);
    const tabs = component.locator('.home-sidebar-tabs');
    const selectedContrast = () =>
      tabs.evaluate((element) => {
        const selected = element.querySelector('[role="tab"][aria-selected="true"]')!;
        const indicator = element.querySelector('[data-tabs-indicator]');
        if (!indicator) return 0;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        const luminance = (color: number[]) => {
          const linear = color.slice(0, 3).map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
        };
        const foreground = rgba(getComputedStyle(selected).color);
        const background = rgba(getComputedStyle(indicator).backgroundColor);
        if (foreground[3] !== 255 || background[3] !== 255) return 0;
        const fg = luminance(foreground);
        const bg = luminance(background);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      });

    await tabs.getByRole('tab', { name: 'Workspaces', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    const assistant = tabs.getByRole('tab', { name: 'Assistant', exact: true });
    await expect(assistant).toBeFocused();
    await expect(assistant).toHaveAttribute('aria-selected', 'true');
    await expect.poll(selectedContrast).toBeGreaterThanOrEqual(4.5);

    await page.keyboard.press('ArrowLeft');
    const workspaces = tabs.getByRole('tab', { name: 'Workspaces', exact: true });
    await expect(workspaces).toBeFocused();
    await expect(workspaces).toHaveAttribute('aria-selected', 'true');
    await expect.poll(selectedContrast).toBeGreaterThanOrEqual(4.5);
  });
}

test('Home loading stays calm with reduced motion', async ({ mount, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(IntegrationPreview, { props: { scenario: 'loading' } });
  const loading = component.locator('[data-home-loading]');
  await expect(loading).toBeVisible();
  expect(
    await loading
      .locator('[data-slot="skeleton"]')
      .evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).animationName === 'none'),
      ),
  ).toBe(true);
  await testInfo.attach('home-loading-reduced-motion', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Home handles rapid tab and filter changes with motion enabled', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(Preview);
  for (const name of ['Pull requests', 'Linear issues', 'Workspaces']) {
    await component
      .locator('.home-tabs')
      .getByRole('tab', { name: new RegExp(`^${name}`) })
      .click();
  }
  await component
    .getByRole('group', { name: 'Status', exact: true })
    .getByRole('button', { name: /^Needs you/ })
    .click();
  await component
    .getByRole('group', { name: 'Status', exact: true })
    .getByRole('button', { name: /^All \d/ })
    .click();
  const rows = component.getByRole('option');
  await expect(rows).toHaveCount(6);
  await rows.first().focus();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rows.first()).toBeFocused();
  await testInfo.attach('home-motion-settled', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Home filters and previews workspaces without entering them', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  const list = component.locator('.workspace-list');
  await expect(list.getByRole('option')).toHaveCount(6);
  await list.getByRole('option').first().click();
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await list.getByRole('option').first().click();
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await component.getByRole('tab', { name: 'Pull requests', exact: true }).click();
  await expect(component.getByRole('tab', { name: 'Pull requests', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(component.getByRole('tab', { name: 'Pull requests', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(
    component.locator('.home-tabs').getByRole('tab', { name: /^Workspaces/ }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByRole('option')).toHaveCount(6);
  await component
    .getByRole('group', { name: 'Status', exact: true })
    .getByRole('button', { name: /^Needs you/ })
    .click();
  await expect(list.getByRole('option')).toHaveCount(2);
  await list.getByRole('option').first().focus();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await expect(component.getByRole('button', { name: 'Open workspace' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await expect(list.getByRole('option').first()).toBeFocused();
  await component.getByRole('button', { name: /^Archived/ }).click();
  await expect(list).toContainText('Explore alternative layouts');
  await component
    .getByRole('group', { name: 'Status', exact: true })
    .getByRole('button', { name: /^All \d/ })
    .click();
  await component.getByRole('button', { name: 'acme/platform', exact: true }).click();
  await expect(list.getByRole('option')).toHaveCount(2);
  await component.getByRole('searchbox').fill('no matching work');
  await expect(component.getByRole('heading', { name: 'No matching workspaces' })).toBeVisible();
  await component.getByRole('button', { name: 'Clear filters' }).click();
  await expect(list.getByRole('option')).toHaveCount(6);
  await testInfo.attach('home-list', { body: await page.screenshot(), contentType: 'image/png' });
});

test('Home sections start open and all support collapse, expansion and keyboard focus', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  for (const label of ['Needs you', 'Running', 'Done & idle']) {
    const toggle = component
      .locator('[data-home-group]')
      .getByRole('button', { name: label, exact: true });
    const list = component.getByRole('listbox', { name: label, exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText(label);
    await toggle.click();
    await expect(list).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(list).toBeVisible();
    await expect(toggle).toBeFocused();
  }
  const inactive = component.getByRole('listbox', { name: 'Done & idle', exact: true });
  await expect(inactive.getByRole('option')).toHaveCount(3);
  await inactive.getByRole('option').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(inactive.getByRole('option').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inactive.getByRole('option').nth(1)).toBeFocused();
});

test('Home closes list sections while board columns stay expanded', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'board' } });
  await component
    .locator('[data-home-board]')
    .getByRole('button', { name: 'Polish settings accessibility', exact: true })
    .click();
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await component.getByRole('button', { name: 'List view', exact: true }).click();
  const inactive = component.getByRole('listbox', { name: 'Done & idle', exact: true });
  await expect(inactive.getByRole('option')).toHaveCount(3);
  await component.locator('[data-home-group="inactive"]').getByRole('button').click();
  await expect(inactive).toHaveCount(0);
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  const section = component
    .locator('[data-home-board]')
    .getByRole('region', { name: 'Done & idle', exact: true });
  await expect(section.getByRole('button', { name: 'Done & idle', exact: true })).toHaveCount(0);
  await expect(section.locator('[data-home-workspace]')).toHaveCount(3);
});

test('Home board uses the same scope and restores keyboard focus after narrow preview', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'board' } });
  await expect(component.getByRole('button', { name: 'Board view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const board = component.locator('[data-home-board]');
  await expect(board.locator('[data-home-workspace]')).toHaveCount(6);
  expect(
    await board.evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
    ),
  ).toBe(true);
  const card = board.getByRole('button', { name: 'Review the new onboarding flow', exact: true });
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await component.getByRole('button', { name: 'Back to list' }).click();
  await expect(card).toBeFocused();
  expect(
    await component
      .locator('[data-home-page]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await component.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(component.getByRole('option')).toHaveCount(6);
  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  await component.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'Running', exact: true }).click();
  await expect(board.locator('[data-home-workspace]')).toHaveCount(1);
  await expect(board.getByRole('region')).toHaveCount(3);
  expect(await board.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await testInfo.attach('home-board', { body: await page.screenshot(), contentType: 'image/png' });
});

test('Home board right-click menu pins the chosen card and restores focus', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'board' } });
  const board = component.locator('[data-home-board]');
  const card = board.locator('[data-home-workspace="home-complete"]');
  await card.click({ button: 'right' });
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Archive', exact: true })).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Delete Workspace…', exact: true }),
  ).toBeVisible();
  await testInfo.attach('kanban-right-click', {
    body: await page.screenshot({ path: testInfo.outputPath('kanban-right-click.png') }),
    contentType: 'image/png',
  });
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await expect(card).toBeFocused();
  await expect(board.locator('[data-home-workspace]')).toHaveCount(6);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await page.keyboard.press('ContextMenu');
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click();
  await expect(card).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await component.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(component.getByRole('listbox', { name: 'Pinned', exact: true })).toHaveCount(0);
  await expect(component.getByRole('option')).toHaveCount(6);
});

test('Home board menu dismissal keeps an existing preview open', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'board' } });
  const card = component.locator('[data-home-workspace="home-review"]');
  await card.click();
  const detail = component.locator('[data-home-detail]');
  await expect(detail).toBeVisible();
  await card.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Pin', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await expect(card).toBeFocused();
  await expect(detail).toBeVisible();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Escape');
  await expect(detail).toBeVisible();
  await expect(card).toBeFocused();
  expect(
    await component
      .locator('[data-home-board]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await testInfo.attach('kanban-with-preview', {
    body: await page.screenshot({ path: testInfo.outputPath('kanban-with-preview.png') }),
    contentType: 'image/png',
  });
});

test('Home board archived cards offer restore', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'board' } });
  await component
    .getByRole('group', { name: 'Status', exact: true })
    .getByRole('button', { name: 'Archived', exact: true })
    .click();
  const board = component.locator('[data-home-board]');
  await expect(board.locator('[data-home-workspace]')).toHaveCount(1);
  await board.locator('[data-home-workspace]').click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Unarchive Workspace', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Archive', exact: true })).toHaveCount(0);
  await testInfo.attach('kanban-archived-menu', {
    body: await page.screenshot({ path: testInfo.outputPath('kanban-archived-menu.png') }),
    contentType: 'image/png',
  });
});

test('Home board collaborator cards hide owner actions', async ({ mount, page }, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'collaborator' } });
  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  await component.locator('[data-home-workspace="home-complete"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Open workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Pin', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Archive', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Delete Workspace…', exact: true })).toHaveCount(
    0,
  );
  await testInfo.attach('kanban-collaborator-menu', {
    body: await page.screenshot({ path: testInfo.outputPath('kanban-collaborator-menu.png') }),
    contentType: 'image/png',
  });
});

for (const { width, scenario, reason } of [
  { width: 900, scenario: 'board-long-content', reason: 'long names in a narrow desktop' },
  { width: 420, scenario: 'board-long-content', reason: 'stacked columns in a small window' },
  { width: 900, scenario: 'board-repositories', reason: 'many repository columns' },
] as const) {
  test(`Home board keeps ${reason} reachable without horizontal scrolling`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const component = await mount(Preview, { props: { scenario } });
    const board = component.locator('[data-home-board]');
    await expect(board.locator('[data-home-workspace]')).toHaveCount(6);
    expect(await board.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    for (const card of await board.locator('[data-home-workspace]').all()) {
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeInViewport();
      expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await card.focus();
      await page.keyboard.press('Shift+F10');
      await expect(
        page.getByRole('menuitem', { name: 'Open workspace', exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(card).toBeFocused();
    }
    await board.evaluate((element) => {
      element.scrollTop = 0;
    });
    await testInfo.attach(`kanban-${scenario}-${width}`, {
      body: await page.screenshot({ path: testInfo.outputPath(`kanban-${scenario}-${width}.png`) }),
      contentType: 'image/png',
    });
  });
}

test('Home keeps Assistant and owner creation hidden for collaborators', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'collaborator' } });
  await expect(component.getByRole('tab', { name: 'Assistant', exact: true })).toHaveCount(0);
  await expect(component.getByRole('button', { name: 'New workspace', exact: true })).toHaveCount(
    0,
  );
  await expect(component.getByRole('option')).toHaveCount(6);
  await testInfo.attach('home-collaborator-sidebar', {
    body: await page.screenshot({ path: testInfo.outputPath('home-collaborator-sidebar.png') }),
    contentType: 'image/png',
  });
});

test('Home shows connection errors with a retry action', async ({ mount }) => {
  const component = await mount(Preview, { props: { scenario: 'error' } });
  await expect(component.getByRole('alert')).toContainText(
    'The daemon connection was interrupted.',
  );
  await expect(component.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

test('Home preview resizes and board headers stay visible while scrolling', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'board' } });
  await page.locator('[data-home-preview]').evaluate((element) => {
    element.style.height = '360px';
  });
  const board = component.locator('[data-home-board]');
  const header = board.getByRole('heading').first();
  const before = await header.boundingBox();
  await board.evaluate((element) => {
    element.scrollTop = 100;
  });
  expect(await board.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(async () => Math.abs((await header.boundingBox())!.y - before!.y))
    .toBeLessThan(2);
  await page.locator('[data-home-preview]').evaluate((element) => {
    element.style.height = '720px';
  });
  await board.getByRole('button', { name: 'Review the new onboarding flow', exact: true }).click();
  const detail = component.locator('[data-home-detail]');
  const handle = component
    .locator('.home-surface')
    .getByRole('tabpanel', { name: 'Workspaces', exact: true })
    .getByRole('button', { name: 'Resize panel (double-click to reset)', exact: true });
  await expect(handle).toBeVisible();
  const width = (await detail.boundingBox())!.width;
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await detail.boundingBox())!.width).toBeGreaterThan(width);
  await expect(
    detail.locator('header').getByRole('button', { name: 'Open workspace' }),
  ).toBeVisible();
  await testInfo.attach('home-resizable-preview', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Home sidebar switches threads with the keyboard and keeps workspace filters', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'assistant' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  const tabs = sidebar.getByRole('tablist');
  await testInfo.attach('home-sidebar-workspaces', {
    body: await page.screenshot({ path: testInfo.outputPath('home-sidebar-workspaces.png') }),
    contentType: 'image/png',
  });
  await sidebar.getByRole('button', { name: 'acme/platform', exact: true }).click();
  await component.getByRole('searchbox').fill('sidebar');
  await expect(component.locator('.workspace-list').getByRole('option')).toHaveCount(1);
  await tabs.getByRole('tab', { name: 'Assistant', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: 'All repos', exact: true })).toHaveCount(0);
  const threads = sidebar.getByRole('listbox');
  const planning = threads.getByRole('option', { name: 'Plan the next release', exact: true });
  await planning.click({ position: { x: 6, y: 6 } });
  await expect(component.locator('[data-chief-header-row]').getByRole('heading')).toHaveText(
    'Plan the next release',
  );
  await planning.click({ position: { x: 6, y: 6 } });
  await expect(planning).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(
    threads.getByRole('option', { name: 'Review open pull requests', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(threads.getByRole('option', { selected: true })).toHaveText(
    'Review open pull requests',
  );
  await expect(component.locator('[data-chief-header-row]').getByRole('heading')).toHaveText(
    'Review open pull requests',
  );
  const draft = component.locator('.home-surface [contenteditable="true"]').first();
  await draft.fill('Keep this draft while I check workspaces');
  await testInfo.attach('home-sidebar-assistant', {
    body: await page.screenshot({ path: testInfo.outputPath('home-sidebar-assistant.png') }),
    contentType: 'image/png',
  });
  await tabs.getByRole('tab', { name: 'Workspaces', exact: true }).click();
  await expect(component.getByRole('searchbox')).toHaveValue('sidebar');
  await expect(component.locator('.workspace-list').getByRole('option')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Assistant', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(tabs.getByRole('tab', { name: 'Assistant', exact: true })).toBeFocused();
  await expect(threads.getByRole('option', { selected: true })).toHaveText(
    'Review open pull requests',
  );
  await expect(draft).toHaveText('Keep this draft while I check workspaces');
  await expect
    .poll(() => page.evaluate(() => window.__homeIntegrationBrowser!.calls))
    .toContainEqual({
      method: 'drafts.set',
      params: {
        workspaceId: '__chief__',
        agentId: 'home-assistant-1',
        text: 'Keep this draft while I check workspaces',
      },
    });
  const draftCalls = await page.evaluate(() =>
    window.__homeIntegrationBrowser!.calls.filter(({ method }) => method.startsWith('drafts.')),
  );
  expect(draftCalls).toContainEqual({
    method: 'drafts.get',
    params: { workspaceId: '__chief__', agentId: 'home-assistant-1' },
  });
  await testInfo.attach('home-sidebar-draft-wire', {
    body: JSON.stringify(draftCalls, null, 2),
    contentType: 'application/json',
  });
  await page.evaluate(() => window.__homeAssistantPreview!.removeSelectedThread());
  await expect(threads.getByRole('option')).toHaveCount(2);
  await expect(threads.getByRole('option', { selected: true })).toHaveText('Plan the next release');
  await expect(component.locator('[data-chief-header-row]').getByRole('heading')).toHaveText(
    'Plan the next release',
  );
  await page.evaluate(() => window.__homeAssistantPreview!.removeSelectedThread());
  await expect(threads.getByRole('option')).toHaveCount(1);
  await expect(threads.getByRole('option', { selected: true })).toHaveCount(1);
  await page.evaluate(() => window.__homeAssistantPreview!.removeSelectedThread());
  await expect(sidebar.getByRole('status')).toContainText('No Assistant threads');
});

test('Home sidebar keeps an empty Assistant usable', async ({ mount, page }, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'empty' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  await sidebar.getByRole('tab', { name: 'Assistant', exact: true }).click();
  await expect(sidebar.getByRole('status')).toContainText('No Assistant threads');
  await expect(
    component
      .locator('[data-chief-header-row]')
      .getByRole('button', { name: 'New Assistant thread', exact: true }),
  ).toBeEnabled();
  await testInfo.attach('home-sidebar-empty-assistant', {
    body: await page.screenshot({ path: testInfo.outputPath('home-sidebar-empty-assistant.png') }),
    contentType: 'image/png',
  });
  await sidebar.getByRole('tab', { name: 'Workspaces', exact: true }).click();
  await expect(
    component.locator('.home-header').getByRole('button', { name: 'New workspace', exact: true }),
  ).toBeVisible();
});

test('Home sidebar scrolls long thread history and keeps narrow tabs usable', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'assistant-many' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  const handle = component
    .locator('.home-sidebar-resizable')
    .getByRole('button', { name: 'Resize panel (double-click to reset)', exact: true });
  await handle.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await sidebar.getByRole('tab', { name: 'Assistant', exact: true }).click();
  const threads = sidebar.getByRole('listbox');
  expect(await threads.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  await threads.getByRole('option', { name: /^Find the workspaces/ }).click();
  await expect(
    component
      .locator('[data-chief-header-row]')
      .getByRole('button', { name: 'New Assistant thread', exact: true }),
  ).toBeVisible();
  await testInfo.attach('home-sidebar-long-title', {
    body: await page.screenshot({ path: testInfo.outputPath('home-sidebar-long-title.png') }),
    contentType: 'image/png',
  });
  await threads.getByRole('option').first().focus();
  await page.keyboard.press('End');
  const last = threads.getByRole('option', { name: 'Assistant conversation 240', exact: true });
  await expect(last).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(last).toBeInViewport();
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await expect(component.locator('[data-chief-header-row]').getByRole('heading')).toHaveText(
    'Assistant conversation 240',
  );
  expect(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  const tabs = sidebar.getByRole('tablist');
  expect(await tabs.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await testInfo.attach('home-sidebar-narrow-history', {
    body: await page.screenshot({ path: testInfo.outputPath('home-sidebar-narrow-history.png') }),
    contentType: 'image/png',
  });
});

test('Extra repositories remain visible while filtering', async ({ mount }) => {
  const component = await mount(Preview);
  await component.getByRole('button', { name: 'local-tools', exact: true }).click();
  await expect(component.getByRole('option')).toHaveCount(0);
  await expect(component.getByRole('button', { name: 'local-tools', exact: true })).toBeVisible();
  await component
    .getByRole('navigation', { name: 'Home', exact: true })
    .getByRole('button', { name: /^All repos/ })
    .click();
  await expect(component.getByRole('option')).toHaveCount(6);
});

test('Home grouping switches between status, repository and ungrouped in both views', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview);
  const done = component.locator('[data-home-group="inactive"]');
  await expect(
    component.getByRole('option', { name: /Polish settings accessibility/ }),
  ).toBeVisible();
  await done.getByRole('button').click();
  await expect(
    component.getByRole('option', { name: /Polish settings accessibility/ }),
  ).toHaveCount(0);
  async function groupBy(name: string) {
    await component.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByRole('combobox', { name: 'Group by', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
    await page.keyboard.press('Escape');
  }
  await done.getByRole('button').click();
  await groupBy('Repository');
  await expect(component.locator('[data-home-group]')).toHaveCount(2);
  await expect(component.getByRole('option')).toHaveCount(6);
  await groupBy('None');
  await expect(component.locator('[data-home-group]')).toHaveCount(0);
  await expect(component.getByRole('option')).toHaveCount(6);
  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  const board = component.locator('[data-home-board]');
  await expect(board.locator('section')).toHaveCount(1);
  await groupBy('Repository');
  await expect(board.locator('section')).toHaveCount(2);
  await component.getByRole('searchbox').fill('onboarding');
  await expect(board.locator('[data-home-workspace]')).toHaveCount(1);
  await component.getByRole('searchbox').clear();
  await groupBy('Status');
  await expect(board.locator('section')).toHaveCount(3);
  const inactive = board.getByRole('region', { name: 'Done & idle', exact: true });
  await expect(inactive.locator('[data-home-workspace]')).toHaveCount(3);
  await expect(inactive.getByRole('img', { name: /^Done\./ })).toHaveCount(1);
  await expect(inactive.getByRole('img', { name: /^Idle\./ })).toHaveCount(2);
  await expect(board.locator('[data-home-workspace]')).toHaveCount(6);
});

test('Home workspace menus pin without duplication and support right click and keyboard', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview);
  const row = component.getByRole('option', { name: /Polish settings accessibility/ });
  await row.click({ button: 'right' });
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  const pinned = component.getByRole('listbox', { name: 'Pinned', exact: true });
  await expect(pinned.getByRole('option')).toHaveCount(1);
  await expect(component.getByRole('option')).toHaveCount(6);
  await expect(component.locator('[data-home-group]').first()).toHaveAttribute(
    'data-home-group',
    'pinned',
  );
  await pinned.getByRole('button', { name: 'Workspace actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await pinned.getByRole('option').focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click();
  await expect(pinned).toHaveCount(0);
  await expect(component.getByRole('option')).toHaveCount(6);
  await expect(
    component
      .getByRole('listbox', { name: 'Done & idle', exact: true })
      .getByRole('option', { name: /Polish settings accessibility/ }),
  ).toBeVisible();
});
