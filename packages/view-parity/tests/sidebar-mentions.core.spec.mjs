import {
  test,
  expect,
  openLeafExample,
  outputJson,
  captureLeaf,
  chooseProp,
  expectActive,
} from '../lib/sidebar-mentions.mjs';

// Source: SidebarActionIconsHarness, SidebarHeaderAction, SidebarGroupHeader,
// ChangesRefreshAction. Only native callbacks/AX, never decorative CSS values.
test('sidebar mentions S1: header and group activations preserve caller identity', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'sidebar-actions', 'sidebar-actions');
  const leaves = host.getByTestId('sidebar-leaves');
  const state = () => outputJson(host.getByTestId('sidebar-callback-state'));
  await captureLeaf(page, leaves, 'actions-before', info);
  const context = leaves.locator('[data-sidebar-fixture="Context"]');
  await context.locator('[data-sidebar-action="search"]').click();
  await context.locator('[data-sidebar-action="plus"]').press('Enter');
  await context.locator('[data-sidebar-action="close"]').press('Space');
  await leaves.locator('[data-sidebar-fixture="Changes"] [data-sidebar-action="close"]').click();
  await leaves.locator('[data-sidebar-fixture="Files"] [data-sidebar-action="search"]').click();
  await leaves.locator('[data-sidebar-fixture="Files"] [data-sidebar-action="close"]').click();
  await expect
    .poll(async () =>
      (await state()).callbacks.filter((entry) => entry.callback === 'header-action'),
    )
    .toEqual([
      {
        callback: 'header-action',
        title: 'Context',
        icon: 'search',
        eventType: 'click',
        detail: 1,
      },
      { callback: 'header-action', title: 'Context', icon: 'plus', eventType: 'click', detail: 0 },
      { callback: 'header-action', title: 'Context', icon: 'close', eventType: 'click', detail: 0 },
      { callback: 'header-action', title: 'Changes', icon: 'close', eventType: 'click', detail: 1 },
      { callback: 'header-action', title: 'Files', icon: 'search', eventType: 'click', detail: 1 },
      { callback: 'header-action', title: 'Files', icon: 'close', eventType: 'click', detail: 1 },
    ]);
  const group = leaves.locator('[data-sidebar-group-header]');
  await group.press('Enter');
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(host.getByTestId('sidebar-group-content')).toHaveCount(0);
  await group.press('Space');
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(host.getByTestId('sidebar-group-content')).toBeVisible();
  await expect
    .poll(async () =>
      (await state()).callbacks.filter((entry) => entry.callback === 'group-toggle'),
    )
    .toEqual([
      { callback: 'group-toggle', expanded: false },
      { callback: 'group-toggle', expanded: true },
    ]);
  await info.attach('decorative-icons-ax.txt', {
    body: await host.getByTestId('sidebar-icon-leaves').ariaSnapshot(),
    contentType: 'text/plain',
  });
  await captureLeaf(page, leaves, 'actions-after', info);
});

// Original mention-results CT exercises the same mixed source list. Source groups
// Files contiguously before Scripts even though the last input item is a File.
test('sidebar mentions M1: grouped display order wraps and selects the exact mention', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'mention-navigation', 'mention-navigation');
  const exercise = host.getByTestId('mention-exercise');
  const input = exercise.getByRole('combobox', { name: 'Filter mentions', exact: true });
  const options = exercise.getByRole('option');
  await expect(options).toHaveCount(5);
  const list = exercise.getByRole('listbox');
  await captureLeaf(page, list, 'grouped-before', info);
  await expectActive(exercise, 'mention', options.nth(0));
  await input.press('ArrowDown');
  await expectActive(exercise, 'mention', options.nth(1));
  await input.press('ArrowDown');
  await expectActive(exercise, 'mention', options.nth(2));
  await input.press('ArrowDown');
  await expectActive(exercise, 'mention', options.nth(3));
  await expect(options.nth(3)).toHaveAccessibleName(
    'developer-preview-component-with-a-very-long-unbroken-filename.svelte',
  );
  await input.press('Enter');
  const state = () => outputJson(exercise.getByTestId('mention-callback-state'));
  await expect
    .poll(async () => (await state()).selections)
    .toEqual([
      {
        id: 'file-long',
        type: 'file',
        label: 'developer-preview-component-with-a-very-long-unbroken-filename.svelte',
        subtitle: 'src/features/developer/components/preview',
        uri: 'file://src/features/developer/components/preview/long.svelte',
        group: 'Files',
      },
    ]);
  await input.press('ArrowDown');
  await expectActive(exercise, 'mention', options.nth(4));
  await expect(options.nth(4)).toHaveAccessibleName('Development preview service');
  await input.press('ArrowDown');
  await expectActive(exercise, 'mention', options.first());
  await input.press('ArrowUp');
  await expectActive(exercise, 'mention', options.last());
  await expect(input).toBeFocused();
  await captureLeaf(page, list, 'grouped-after', info);
});

test('sidebar mentions M2: nested Enter Right Left and Escape preserve breadcrumb ownership', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'mention-navigation', 'mention-navigation');
  const exercise = host.getByTestId('mention-exercise');
  await chooseProp(page, exercise, 'Mention list props', 'nested');
  const input = exercise.getByRole('combobox', { name: 'Filter mentions', exact: true });
  const state = () => outputJson(exercise.getByTestId('mention-callback-state'));
  await captureLeaf(page, exercise.getByRole('listbox'), 'nested-mentions-before', info);
  await input.press('Enter');
  await expectActive(
    exercise,
    'mention',
    exercise.getByRole('option', { name: 'Nested files', exact: true }),
  );
  await input.press('ArrowRight');
  await expectActive(
    exercise,
    'mention',
    exercise.getByRole('option', { name: 'Nested file', exact: true }),
  );
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect
    .poll(async () => (await state()).selections)
    .toEqual([
      {
        id: 'nested-note',
        type: 'note',
        label: 'Nested note',
        uri: 'devspace://note/nested-note',
      },
    ]);
  await input.press('ArrowLeft');
  await expectActive(
    exercise,
    'mention',
    exercise.getByRole('option', { name: 'Nested files', exact: true }),
  );
  await input.press('ArrowRight');
  await input.press('Escape');
  await expectActive(
    exercise,
    'mention',
    exercise.getByRole('option', { name: 'Fixture folder', exact: true }),
  );
  expect((await state()).closeCallbacks).toBe(0);
  await captureLeaf(page, exercise.getByRole('listbox'), 'nested-mentions-after', info);
  await input.press('Escape');
  await expect(exercise.getByRole('listbox')).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await state()).closeCallbacks).toBe(1);
  expect((await state()).keys).toEqual(
    [
      'Enter',
      'ArrowRight',
      'ArrowDown',
      'Enter',
      'ArrowLeft',
      'ArrowRight',
      'Escape',
      'Escape',
    ].map((key) => ({ key, handled: true, defaultPrevented: true, native: true })),
  );
});

test('sidebar mentions K1: skill keyboard selection and dismissal report exact callbacks', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'mention-navigation', 'mention-navigation');
  const exercise = host.getByTestId('skill-exercise');
  const input = exercise.getByRole('combobox', { name: 'Filter skills', exact: true });
  const state = () => outputJson(exercise.getByTestId('skill-callback-state'));
  const list = exercise.getByRole('listbox');
  await captureLeaf(page, list, 'skills-before', info);
  await input.press('ArrowUp');
  await expectActive(
    exercise,
    'skill',
    exercise.getByRole('option', { name: 'fixture-plan', exact: true }),
  );
  await input.press('Enter');
  await expect
    .poll(async () => (await state()).selections)
    .toEqual([
      {
        name: 'fixture-plan',
        description: 'Deterministic planning skill prop',
        location: '/fixture/skills/plan/SKILL.md',
        scope: 'user',
      },
    ]);
  await input.press('ArrowDown');
  await expectActive(
    exercise,
    'skill',
    exercise.getByRole('option', { name: 'fixture-review', exact: true }),
  );
  await captureLeaf(page, list, 'skills-after', info);
  await input.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect.poll(async () => (await state()).dismissCallbacks).toBe(1);
  await input.press('Enter');
  expect((await state()).keys.at(-1)).toEqual({
    key: 'Enter',
    handled: false,
    defaultPrevented: false,
    native: true,
  });
  expect((await state()).selections).toHaveLength(1);
});

test('sidebar mentions S2: refresh disabled and busy blocks native activation', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'sidebar-actions', 'sidebar-actions');
  const refresh = host.locator('[data-changes-refresh]');
  const records = async () =>
    (await outputJson(host.getByTestId('sidebar-callback-state'))).callbacks.filter(
      (entry) => entry.callback === 'refresh',
    );
  await refresh.press('Enter');
  await expect.poll(records).toEqual([{ callback: 'refresh' }]);
  await captureLeaf(page, host.getByTestId('sidebar-search-host'), 'refresh-before', info);
  await host.getByRole('switch', { name: 'Refresh disabled and busy', exact: true }).click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveAttribute('aria-busy', 'true');
  await refresh.scrollIntoViewIfNeeded();
  const bounds = await refresh.boundingBox();
  expect(bounds).not.toBeNull();
  // Real pointer click on a disabled control, without Playwright force or events.
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  expect(await records()).toEqual([{ callback: 'refresh' }]);
  await host.getByRole('switch', { name: 'Refresh disabled and busy', exact: true }).click();
  await expect(refresh).toBeEnabled();
  await expect(refresh).toHaveAttribute('aria-busy', 'false');
  await refresh.press('Space');
  await expect.poll(records).toEqual([{ callback: 'refresh' }, { callback: 'refresh' }]);
  await captureLeaf(page, host.getByTestId('sidebar-search-host'), 'refresh-after', info);
});

// Source native CT: composite-focus.ct.spec.ts, sidebar branch. Source search
// also preserves nonempty blur and collapses empty blur without focus theft.
test('sidebar mentions S3: expanded search preserves rapid input clear and blur focus', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'sidebar-actions', 'sidebar-actions');
  const surface = host.getByTestId('sidebar-search-host');
  const trigger = surface.locator('[data-sidebar-action="search"]');
  const input = surface.getByRole('searchbox');
  const state = () => outputJson(host.getByTestId('sidebar-callback-state'));
  await captureLeaf(page, surface, 'search-before', info);
  await trigger.press('Enter');
  await expect(input).toBeFocused();
  await input.pressSequentially('fast');
  await expect(input).toHaveValue('fast');
  await expect
    .poll(async () =>
      (await state()).callbacks
        .filter((entry) => entry.callback === 'query')
        .map((entry) => entry.value),
    )
    .toEqual(['f', 'fa', 'fas', 'fast']);
  await expect
    .poll(async () => (await state()).callbacks.filter((entry) => entry.callback === 'keydown'))
    .toEqual(
      ['f', 'a', 's', 't'].map((key) => ({
        callback: 'keydown',
        key,
        native: true,
        defaultPrevented: false,
      })),
    );
  const outside = host.getByRole('button', { name: 'Focus after search', exact: true });
  await outside.click();
  await expect(input).toHaveValue('fast');
  await expect(outside).toBeFocused();
  await surface.locator('[data-sidebar-search-clear]').click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await outside.click();
  await expect(input).toHaveCount(0);
  await expect(outside).toBeFocused();
  await trigger.press('Enter');
  await input.pressSequentially('x');
  await input.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(input).toHaveCount(0);
  await expect.poll(async () => (await state()).query).toBe('');
  expect(
    (await state()).callbacks.some(
      (entry) => entry.callback === 'keydown' && entry.key === 'Escape',
    ),
  ).toBe(false);
  await captureLeaf(page, surface, 'search-after', info);
});

test('sidebar mentions S4: Escape closes child search before its dialog and restores focus', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'sidebar-actions', 'sidebar-actions');
  const open = host.getByRole('button', { name: 'Open sidebar dialog', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Sidebar search parent', exact: true });
  await expect(dialog).toBeVisible();
  const surface = dialog.getByTestId('sidebar-search-host');
  const trigger = surface.locator('[data-sidebar-action="search"]');
  await trigger.press('Enter');
  const input = surface.getByRole('searchbox');
  await expect(input).toBeFocused();
  await input.pressSequentially('child');
  await captureLeaf(page, surface, 'nested-before', info);
  await input.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(dialog).toBeVisible();
  await expect(input).toHaveCount(0);
  const state = () => outputJson(host.getByTestId('sidebar-callback-state'));
  expect((await state()).callbacks.filter((entry) => entry.callback === 'dialog-close')).toEqual(
    [],
  );
  await captureLeaf(page, surface, 'nested-after', info);
  await trigger.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect
    .poll(async () =>
      (await state()).callbacks.filter((entry) => entry.callback === 'dialog-close'),
    )
    .toEqual([{ callback: 'dialog-close' }]);
});
