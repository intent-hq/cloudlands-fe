import { expect, test, wheelUntilScrolled } from '../../../../test/ct-test';
import { expectDismissibleLayerArmed } from '../../../../test/dismissible-layer';
import TaskProgressControl from '../TaskProgressControl.svelte';
import TaskProgressControlHost from './TaskProgressControlHost.svelte';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<Page['locator']>;

const tasks = [
  { id: 'pending', title: 'Inspect the panel', status: 'pending' },
  { id: 'running', title: 'Move the task progress', status: 'running' },
  { id: 'completed', title: 'Map the native plan', status: 'completed' },
  { id: 'waiting', title: 'Wait for review', status: 'waiting' },
  { id: 'discussion', title: 'Discuss the approach', status: 'discussion_needed' },
  { id: 'blocked', title: 'Resolve the blocker', status: 'blocked' },
  { id: 'review', title: 'Review the result', status: 'review_required' },
] as const;

const overflowTasks = Array.from({ length: 20 }, (_, index) => ({
  id: `comparison-${index}`,
  title: `Comparison task ${index + 1}`,
  status: 'pending' as const,
}));

async function pressScrollKey(page: Page, region: Locator, key: string) {
  // Native keyboard scrolls are not WAAPI animations. Await their end before
  // sending the next key, rather than observing an intermediate scroll offset.
  await Promise.all([
    region.evaluate(
      (node) =>
        new Promise<void>((resolve) => {
          node.addEventListener('scrollend', () => resolve(), { once: true });
        }),
    ),
    page.keyboard.press(key),
  ]);
}

test('search and status filters support keyboard activation, reset, Escape and outside focus', async ({
  mount,
  page,
}) => {
  const component = await mount(TaskProgressControlHost, {
    props: {
      tasks: [...tasks, { id: 'extra', title: 'Inspect keyboard navigation', status: 'pending' }],
      presentation: 'checklist',
    },
  });
  const trigger = component.getByTestId('task-progress-trigger');
  const popover = page.getByTestId('task-progress-popover');
  const search = page.getByRole('searchbox');
  const status = page.getByRole('combobox', { name: 'Filter tasks by status' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(popover).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(search).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(status).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option')).toHaveCount(8);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(status).toContainText('Complete');
  await expect(popover).toBeVisible();
  await expect(page.getByTestId('task-progress-row')).toHaveCount(1);
  await page.keyboard.press('Shift+Tab');
  await expect(search).toBeFocused();
  await page.keyboard.type('missing');
  await expect(page.getByTestId('task-progress-no-matches')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('task-progress-scroll-region')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Reset filters' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(page.getByTestId('task-progress-row')).toHaveCount(8);
  await page.keyboard.type('Inspect');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Clear search' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(status).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('task-progress-row')).toHaveCount(2);
  await expect(page.getByTestId('task-progress-row').first()).toHaveAttribute(
    'data-task-status',
    'pending',
  );
  await expect(page.getByTestId('task-progress-row').last()).toHaveAttribute(
    'data-task-status',
    'pending',
  );
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Clear search' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(search).toHaveValue('');
  await page.keyboard.press('ArrowDown');
  await expect(search).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(status).toBeFocused();
  await expect(popover).toBeVisible();
  await status.click();
  await page.getByRole('option', { name: 'Waiting 1' }).click();
  await expect(popover).toBeVisible();
  await expect(status).toContainText('Waiting');
  await expect(page.getByTestId('task-progress-row')).toHaveCount(1);
  await component.getByTestId('after-trigger').click();
  await expect(popover).toBeHidden();
  await expect(component.getByTestId('after-trigger')).toBeFocused();
});

test('clear-search icon supports pointer and keyboard activation without resetting status', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(TaskProgressControlHost, {
    props: {
      tasks: [...tasks, { id: 'extra', title: 'Inspect keyboard navigation', status: 'pending' }],
      presentation: 'checklist',
    },
  });
  await page.getByTestId('task-progress-trigger').click();
  const search = page.getByRole('searchbox');
  const clear = page.getByRole('button', { name: 'Clear search' });
  const status = page.getByRole('combobox', { name: 'Filter tasks by status' });
  const popover = page.getByTestId('task-progress-popover');
  await status.click();
  await page.getByRole('option', { name: /not started 2/i }).click();
  await search.fill('no-such-task');
  await expect(page.getByTestId('task-progress-no-matches')).toBeVisible();
  await expect(clear).toBeVisible();
  const screenshotPath = testInfo.outputPath('search-clear.png');
  await popover.screenshot({ path: screenshotPath });
  await testInfo.attach('Search clear icon', { path: screenshotPath, contentType: 'image/png' });
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(clear).toHaveCount(0);
  await expect(status).toContainText(/not started/i);
  await expect(page.getByTestId('task-progress-row')).toHaveCount(2);
  await search.fill('missing');
  await page.keyboard.press('Tab');
  await expect(clear).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(popover).toBeVisible();
  await expect(status).toContainText(/not started/i);
  await expect(page.getByTestId('task-progress-row')).toHaveCount(2);
});

for (const presentation of ['status-stack', 'checklist'] as const) {
  for (const entryKey of ['ArrowDown', 'PageDown']) {
    test(`${presentation} retains rapid ${entryKey} entry through opening and restores focus`, async ({
      mount,
      page,
    }) => {
      const component = await mount(TaskProgressControlHost, {
        props: { tasks: overflowTasks, presentation },
      });
      const trigger = component.getByTestId('task-progress-trigger');
      const popover = page.getByTestId('task-progress-popover');
      const region = page.getByTestId('task-progress-scroll-region');
      const lastRow = page.getByTestId('task-progress-row').last();

      await trigger.focus();
      await page.keyboard.press('Space');
      await expect(popover).toBeVisible();
      await page.keyboard.press(entryKey);
      if (entryKey === 'ArrowDown') {
        await expect(page.getByRole('searchbox')).toBeFocused();
        await page.keyboard.press('PageDown');
      }
      await popover.evaluate(async (node) => {
        await Promise.all(node.getAnimations().map((animation) => animation.finished));
      });
      await expect(region).toBeFocused();
      await expect(region).toHaveAccessibleName('Agent tasks');
      await pressScrollKey(page, region, 'ArrowDown');
      await expect.poll(() => region.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      const arrowScroll = await region.evaluate((node) => node.scrollTop);
      const halfPage = await region.evaluate((node) => node.clientHeight / 2);
      await pressScrollKey(page, region, 'PageDown');
      await expect
        .poll(() => region.evaluate((node) => node.scrollTop))
        .toBeGreaterThan(arrowScroll + halfPage);
      await pressScrollKey(page, region, 'End');
      await expect(lastRow).toBeInViewport({ ratio: 1 });
      await pressScrollKey(page, region, 'Home');
      await expect.poll(() => region.evaluate((node) => node.scrollTop)).toBe(0);
      await page.keyboard.press('Escape');
      await expect(popover).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  }

  test(`${presentation} allows native Shift+Tab out of the portalled region`, async ({
    mount,
    page,
  }) => {
    const component = await mount(TaskProgressControlHost, {
      props: { tasks: overflowTasks, presentation },
    });
    const trigger = component.getByTestId('task-progress-trigger');
    const popover = page.getByTestId('task-progress-popover');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    await page.keyboard.press('PageDown');
    await expect(page.getByTestId('task-progress-scroll-region')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('combobox', { name: 'Filter tasks by status' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('searchbox')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(popover).toBeHidden();
    await expect(component.getByTestId('after-trigger')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(popover).toBeHidden();
    await expect(component.getByTestId('before-trigger')).toBeFocused();
  });

  test(`${presentation} restores the trigger on immediate Escape after keyboard entry`, async ({
    mount,
    page,
  }) => {
    const component = await mount(TaskProgressControlHost, {
      props: { tasks: overflowTasks, presentation },
    });
    const trigger = component.getByTestId('task-progress-trigger');
    const popover = page.getByTestId('task-progress-popover');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    await page.keyboard.press('PageDown');
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    await popover.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
    });
    await expect(trigger).toBeFocused();
  });

  test(`${presentation} preserves outside pointer focus after keyboard entry`, async ({
    mount,
    page,
  }) => {
    const component = await mount(TaskProgressControlHost, {
      props: { tasks: overflowTasks, presentation },
    });
    const trigger = component.getByTestId('task-progress-trigger');
    const popover = page.getByTestId('task-progress-popover');
    const region = page.getByTestId('task-progress-scroll-region');
    const outside = component.getByTestId('before-trigger');
    await trigger.click();
    await expect(popover).toBeVisible();
    await page.keyboard.press('PageDown');
    await expect(region).toBeFocused();
    await page.getByTestId('task-progress-row').first().click();
    await expect(popover).toBeVisible();
    await wheelUntilScrolled(region, { deltaY: 300 });
    await expectDismissibleLayerArmed(popover);
    await outside.click();
    await expect(popover).toBeHidden();
    await expect(outside).toBeFocused();
  });
}

for (const exitKey of ['Tab', 'Shift+Tab']) {
  test(`keeps native ${exitKey} dismissal from a non-overflowing trigger`, async ({
    mount,
    page,
  }) => {
    const component = await mount(TaskProgressControlHost, { props: { tasks: [tasks[0]] } });
    const trigger = component.getByTestId('task-progress-trigger');
    const popover = page.getByTestId('task-progress-popover');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    const region = page.getByTestId('task-progress-scroll-region');
    expect(await region.evaluate((node) => node.scrollHeight - node.clientHeight)).toBe(0);
    await page.keyboard.press(exitKey);
    await expect(popover).toBeHidden();
    await expect(
      component.getByTestId(exitKey === 'Tab' ? 'after-trigger' : 'before-trigger'),
    ).toBeFocused();
  });
}

async function expectDropdownMotion(surface: Locator, reducedMotion: boolean) {
  const transition = await surface.evaluate((node) => getComputedStyle(node).transitionProperty);
  expect(transition === 'none').toBe(reducedMotion);
}

test('opens the task list from the checklist trigger', async ({ mount, page }) => {
  await mount(TaskProgressControl, {
    props: { tasks: [...tasks], presentation: 'checklist' },
  });

  const trigger = page.getByTestId('task-progress-trigger');
  await trigger.focus();
  await expect(page.getByTestId('task-progress-popover')).toBeHidden();
  await trigger.click();
  await expect(page.getByTestId('task-progress-popover')).toBeVisible();
  await expect(page.getByTestId('task-progress-row')).toHaveCount(tasks.length);
});

test('exposes one atomic live status and keeps the full task list non-live in the accessibility tree', async ({
  mount,
  page,
}) => {
  const component = await mount(TaskProgressControlHost, { props: { tasks: [...tasks] } });
  await component.getByTestId('task-progress-trigger').click();
  await expect(page.getByTestId('task-progress-popover')).toBeVisible();
  const client = await page.context().newCDPSession(page);

  const readLiveNodes = async () => {
    const tree = await client.send('Accessibility.getFullAXTree');
    return tree.nodes.filter((node) =>
      node.properties?.some(
        (property) => property.name === 'live' && property.value?.value === 'polite',
      ),
    );
  };

  const initialLiveNodes = await readLiveNodes();
  expect(initialLiveNodes).toHaveLength(1);
  expect(initialLiveNodes[0]?.role?.value).toBe('status');
  expect(initialLiveNodes[0]?.name?.value).toBe('');
  expect(
    initialLiveNodes[0]?.properties?.some(
      (property) => property.name === 'atomic' && property.value?.value === true,
    ),
  ).toBe(true);

  await component.update({
    props: {
      tasks: tasks.map((task) =>
        task.id === 'running' ? { ...task, status: 'completed' as const } : { ...task },
      ),
    },
  });
  await expect(page.getByTestId('task-progress-announcement')).toHaveText(
    'Complete: Move the task progress',
  );
  expect(await readLiveNodes()).toHaveLength(1);
});

for (const presentation of ['status-stack', 'checklist'] as const) {
  test(`keeps the ${presentation} task list click-only with predictable focus behavior`, async ({
    mount,
    page,
  }) => {
    const component = await mount(TaskProgressControlHost, {
      props: { tasks: [...tasks], presentation },
    });
    const trigger = component.getByTestId('task-progress-trigger');
    const popover = page.getByTestId('task-progress-popover');
    await trigger.focus();
    await expect(popover).toBeHidden();
    await trigger.hover();
    await expect(popover).toBeHidden();
    await trigger.click();
    await expect(popover).toBeVisible();
    await trigger.click();
    await expect(popover).toBeHidden();

    await trigger.press('Enter');
    await expect(popover).toBeVisible();
    await trigger.press('Enter');
    await expect(popover).toBeHidden();
    await trigger.press('Enter');
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.press('Space');
    await expect(popover).toBeVisible();
    await trigger.press('Space');
    await expect(popover).toBeHidden();
    await trigger.press('Space');
    await expect(popover).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(popover).toBeHidden();
    await expect(component.getByTestId('after-trigger')).toBeFocused();

    await trigger.click();
    await expect(popover).toBeVisible();
    await component.getByTestId('before-trigger').focus();
    await expect(popover).toBeHidden();
    await expect(component.getByTestId('before-trigger')).toBeFocused();
  });
}

test('settles rapid reorder reversal and keeps the latest keyed task order', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(TaskProgressControlHost, { props: { tasks: [...tasks] } });
  const trigger = component.getByTestId('task-progress-trigger');
  await trigger.click();
  await expect(page.getByTestId('task-progress-popover')).toBeVisible();

  await component.update({ props: { tasks: [...tasks].reverse() } });
  await component.update({
    props: {
      tasks: tasks.map((task) =>
        task.id === 'running' ? { ...task, status: 'completed' as const } : { ...task },
      ),
    },
  });
  await component.update({ props: { tasks: [...tasks].reverse() } });

  await expect
    .poll(() =>
      page
        .getByTestId('task-progress-row')
        .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.taskId)),
    )
    .toEqual(['review', 'blocked', 'discussion', 'waiting', 'running', 'pending', 'completed']);
  expect(
    await page
      .getByTestId('task-progress-row')
      .evaluateAll((rows) => rows.every((row) => row.getBoundingClientRect().height > 0)),
  ).toBe(true);
});

test('contains mixed-direction long lists at narrow collision boundaries across themes and zoom', async ({
  mount,
  page,
}) => {
  const mixedTasks = Array.from({ length: 14 }, (_, index) => ({
    id: `mixed-${index}`,
    title:
      index % 2 === 0
        ? `Review English and עברית task ${index}`
        : `تحقق من المهمة ${index} with Latin details`,
    status:
      index === 12
        ? ('running' as const)
        : index > 10
          ? ('completed' as const)
          : ('pending' as const),
  }));
  const component = await mount(TaskProgressControlHost, {
    props: { tasks: mixedTasks, width: 180, direction: 'rtl' },
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      await component.update({
        props: { tasks: mixedTasks, width: 180, zoom, direction: 'rtl', theme },
      });
      await component.getByTestId('before-trigger').focus();
      await component.getByTestId('task-progress-trigger').click();
      const popover = page.getByTestId('task-progress-popover');
      await expect(popover).toBeVisible();
      await expectDropdownMotion(popover, true);
      await expect(page.getByTestId('task-progress-row')).toHaveCount(mixedTasks.length);

      const geometry = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="task-progress-host"]') as HTMLElement;
        const popover = document.querySelector(
          '[data-testid="task-progress-popover"]',
        ) as HTMLElement;
        const scroll = document.querySelector(
          '[data-testid="task-progress-scroll-region"]',
        ) as HTMLElement;
        const panelBox = panel.getBoundingClientRect();
        const popoverBox = popover.getBoundingClientRect();
        const popoverStyle = getComputedStyle(popover);
        return {
          panel: { left: panelBox.left, right: panelBox.right },
          popover: { left: popoverBox.left, right: popoverBox.right },
          computedMaxWidth: popoverStyle.maxWidth,
          overflowX: scroll.scrollWidth - scroll.clientWidth,
          overflowY: scroll.scrollHeight - scroll.clientHeight,
          titleDirections: Array.from(
            document.querySelectorAll('[data-testid="task-progress-row"] [dir="auto"]'),
          ).map((title) => getComputedStyle(title).direction),
        };
      });
      expect(geometry.popover.left).toBeGreaterThanOrEqual(geometry.panel.left - 1);
      expect(geometry.popover.right).toBeLessThanOrEqual(geometry.panel.right + 1);
      expect(geometry.computedMaxWidth).not.toBe('none');
      expect(geometry.overflowX).toBeLessThanOrEqual(0);
      expect(geometry.overflowY).toBeGreaterThan(0);
      expect(geometry.titleDirections).toContain('ltr');
      expect(geometry.titleDirections).toContain('rtl');
      await page.keyboard.press('Escape');
    }
  }
});

test('reaches the final row of an overflowed task list using only the keyboard', async ({
  mount,
  page,
}) => {
  const longTasks = Array.from({ length: 20 }, (_, index) => ({
    id: `task-${index}`,
    title: `Task ${index}`,
    status: 'pending' as const,
  }));
  const component = await mount(TaskProgressControlHost, { props: { tasks: longTasks } });
  const trigger = component.getByTestId('task-progress-trigger');
  const popover = page.getByTestId('task-progress-popover');
  const scrollRegion = page.getByTestId('task-progress-scroll-region');
  const lastRow = page.getByTestId('task-progress-row').last();

  await trigger.focus();
  await trigger.press('Enter');
  await expect(popover).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(lastRow).not.toBeInViewport();

  await page.keyboard.press('PageDown');
  await expect(scrollRegion).toBeFocused();
  await expect(popover).toBeVisible();

  await page.keyboard.press('End');
  await expect(lastRow).toBeInViewport();

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
});
