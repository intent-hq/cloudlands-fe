import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import TaskProgressControl from '../TaskProgressControl.svelte';
import TaskProgressControlHost from './TaskProgressControlHost.svelte';

const tasks = [
  { id: 'pending', title: 'Inspect the panel', status: 'pending' },
  { id: 'running', title: 'Move the task progress', status: 'running' },
  { id: 'completed', title: 'Map the native plan', status: 'completed' },
  { id: 'waiting', title: 'Wait for review', status: 'waiting' },
  { id: 'discussion', title: 'Discuss the approach', status: 'discussion_needed' },
  { id: 'blocked', title: 'Resolve the blocker', status: 'blocked' },
  { id: 'review', title: 'Review the result', status: 'review_required' },
] as const;

async function expectSharedDropdownSurface(surface: Locator, reducedMotion: boolean) {
  const contract = await surface.evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.cssText = [
      'background-color:hsl(var(--popover))',
      'color:hsl(var(--popover-foreground))',
      'border-color:hsl(var(--border))',
      'border-radius:var(--radius-medium)',
      'padding:var(--space-1)',
      'z-index:var(--layer-popover)',
    ].join(';');
    document.body.append(probe);
    const style = getComputedStyle(node);
    const tokens = getComputedStyle(probe);
    const result = {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderTopColor,
      borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth],
      borderRadius: style.borderTopLeftRadius,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      zIndex: style.zIndex,
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      transitionProperty: style.transitionProperty,
      tokens: {
        backgroundColor: tokens.backgroundColor,
        color: tokens.color,
        borderColor: tokens.borderTopColor,
        borderRadius: tokens.borderTopLeftRadius,
        padding: tokens.paddingTop,
        zIndex: tokens.zIndex,
      },
    };
    probe.remove();
    return result;
  });
  expect(contract).toMatchObject({
    backgroundColor: contract.tokens.backgroundColor,
    color: contract.tokens.color,
    borderColor: contract.tokens.borderColor,
    borderWidths: ['1px', '1px', '1px'],
    borderRadius: contract.tokens.borderRadius,
    padding: Array(4).fill(contract.tokens.padding),
    zIndex: contract.tokens.zIndex,
    outlineStyle: 'none',
  });
  expect(contract.boxShadow).not.toBe('none');
  expect(contract.transitionProperty === 'none').toBe(reducedMotion);
}

for (const theme of ['light', 'dark'] as const) {
  test(`keeps every task disk borderless with an opaque background in ${theme} mode`, async ({
    mount,
    page,
  }) => {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    await mount(TaskProgressControl, { props: { tasks: [...tasks] } });
    const trigger = page.getByTestId('task-progress-trigger');
    await trigger.focus();
    await expect(page.getByTestId('task-progress-popover')).toBeHidden();
    await trigger.click();
    const popover = page.getByTestId('task-progress-popover');
    await expect(popover).toBeVisible();
    await expectSharedDropdownSurface(popover, false);
    await expect.poll(() => popover.evaluate((node) => getComputedStyle(node).scale)).toBe('none');

    const indicators = page.locator(
      '[data-testid="task-progress-status-icon"], [data-testid="task-progress-row-status-icon"], [data-testid="task-progress-overflow-indicator"]',
    );
    const styles = await indicators.evaluateAll((nodes) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D canvas is unavailable');
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'hsl(var(--background))';
      document.body.append(probe);
      const tokenBackground = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return nodes.map((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          background: style.backgroundColor,
          backgroundAlpha: (() => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = style.backgroundColor;
            context.fillRect(0, 0, 1, 1);
            return context.getImageData(0, 0, 1, 1).data[3] / 255;
          })(),
          tokenBackground,
          borderWidths: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
          outlineWidth: style.outlineWidth,
          boxShadow: style.boxShadow,
          opacity: style.opacity,
          width: rect.width,
          height: rect.height,
        };
      });
    });
    expect(styles.length).toBeGreaterThan(tasks.length);
    expect(
      styles.every(
        (style) =>
          style.background === style.tokenBackground &&
          style.backgroundAlpha === 1 &&
          style.borderWidths.every((width) => width === '0px') &&
          style.outlineWidth === '0px' &&
          style.boxShadow === 'none' &&
          style.opacity === '1' &&
          style.width === 14 &&
          style.height === 14,
      ),
    ).toBe(true);

    await expect(page.getByTestId('task-progress-stack-item')).toHaveCount(5);
    await expect(trigger).toHaveCSS('height', '28px');
  });

  test(`renders one 28px checklist glyph without stack disks in ${theme} mode`, async ({
    mount,
    page,
  }) => {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    await mount(TaskProgressControl, {
      props: { tasks: [...tasks], presentation: 'checklist' },
    });

    const trigger = page.getByTestId('task-progress-trigger');
    const checklist = page.getByTestId('task-progress-checklist-icon');
    await expect(trigger).toHaveCSS('height', '28px');
    await expect(trigger).toHaveCSS('width', '28px');
    await expect(checklist.locator('svg')).toHaveCount(1);
    await expect(page.getByTestId('task-progress-icon-stack')).toHaveCount(0);
    await expect(page.getByTestId('task-progress-status-icon')).toHaveCount(0);
    await expect(page.getByTestId('task-progress-overflow-indicator')).toHaveCount(0);

    await trigger.focus();
    await expect(page.getByTestId('task-progress-popover')).toBeHidden();
    await trigger.click();
    await expect(page.getByTestId('task-progress-popover')).toBeVisible();
    await expect(page.getByTestId('task-progress-row')).toHaveCount(tasks.length);
  });
}

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
  test(`keeps the ${presentation} task list click-only with stable tooltip and focus behavior`, async ({
    mount,
    page,
  }) => {
    const component = await mount(TaskProgressControlHost, {
      props: { tasks: [...tasks], presentation },
    });
    const trigger = component.getByTestId('task-progress-trigger');
    const popover = page.getByTestId('task-progress-popover');
    const tooltip = page.getByRole('tooltip', { name: 'Task progress: 1 of 7 completed' });

    await trigger.focus();
    await expect(popover).toBeHidden();
    await trigger.hover();
    await expect(tooltip).toBeVisible();
    await expect(popover).toBeHidden();

    await trigger.click();
    await expect(popover).toBeVisible();
    await expect(tooltip).toHaveCount(0);
    await page.waitForTimeout(350);
    await expect(tooltip).toHaveCount(0);
    await trigger.click();
    await expect(popover).toBeHidden();

    await page.mouse.move(1, 1);
    await trigger.hover();
    await expect(tooltip).toBeVisible();
    await trigger.click();
    await expect(popover).toBeVisible();
    await component.getByTestId('before-trigger').click();
    await expect(popover).toBeHidden();
    await expect(component.getByTestId('before-trigger')).toBeFocused();
    await trigger.hover();
    await page.waitForTimeout(350);
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(1, 1);
    await trigger.hover();
    await expect(tooltip).toBeVisible();

    await trigger.click();
    await expect(popover).toBeVisible();
    await component.getByTestId('before-trigger').click();
    await expect(popover).toBeHidden();
    await expect(tooltip).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    await expect(tooltip).toBeVisible();

    await trigger.click();
    await expect(popover).toBeVisible();
    await component.getByTestId('before-trigger').click();
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

    await page.mouse.move(1, 1);
    await trigger.hover();
    await expect(tooltip).toBeVisible();
  });
}

test('clears tooltip suppression after pointer cancellation and task-trigger remount', async ({
  mount,
  page,
}) => {
  const component = await mount(TaskProgressControlHost, { props: { tasks: [...tasks] } });
  let trigger = component.getByTestId('task-progress-trigger');
  const outside = component.getByTestId('before-trigger');
  const popover = page.getByTestId('task-progress-popover');
  const tooltip = page.getByRole('tooltip', { name: 'Task progress: 1 of 7 completed' });

  await trigger.click();
  await expect(popover).toBeVisible();
  await outside.dispatchEvent('pointerdown', {
    pointerType: 'mouse',
    pointerId: 17,
    button: 0,
    isPrimary: true,
  });
  await outside.dispatchEvent('pointercancel', {
    pointerType: 'mouse',
    pointerId: 17,
    isPrimary: true,
  });
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await trigger.hover();
  await expect(tooltip).toBeVisible();

  await trigger.click();
  await expect(popover).toBeVisible();
  await outside.click();
  await expect(popover).toBeHidden();
  await component.update({ props: { tasks: [] } });
  await expect(trigger).toHaveCount(0);
  await component.update({ props: { tasks: [...tasks] } });
  trigger = component.getByTestId('task-progress-trigger');
  await trigger.hover();
  await expect(tooltip).toBeVisible();
});

for (const presentation of ['status-stack', 'checklist'] as const) {
  test(`gives the ${presentation} trigger immediate layout-safe press feedback`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const component = await mount(TaskProgressControlHost, {
      props: { tasks: [...tasks], presentation },
    });
    const trigger = component.getByTestId('task-progress-trigger');
    const box = await trigger.boundingBox();
    if (!box) throw new Error('Task progress trigger has no layout box');
    const before = await trigger.evaluate((node) => ({
      width: (node as HTMLElement).offsetWidth,
      height: (node as HTMLElement).offsetHeight,
    }));

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => trigger.evaluate((node) => getComputedStyle(node).scale)).toBe('0.97');
    expect(
      await trigger.evaluate((node) => ({
        width: (node as HTMLElement).offsetWidth,
        height: (node as HTMLElement).offsetHeight,
      })),
    ).toEqual(before);
    await page.mouse.up();
    await expect.poll(() => trigger.evaluate((node) => getComputedStyle(node).scale)).toBe('none');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.down();
    await expect(trigger).toHaveCSS('scale', '1');
    await page.mouse.up();
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
      await expectSharedDropdownSurface(popover, true);
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
        return {
          panel: { left: panelBox.left, right: panelBox.right },
          popover: { left: popoverBox.left, right: popoverBox.right },
          overflowX: scroll.scrollWidth - scroll.clientWidth,
          overflowY: scroll.scrollHeight - scroll.clientHeight,
          titleDirections: Array.from(
            document.querySelectorAll('[data-testid="task-progress-row"] [dir="auto"]'),
          ).map((title) => getComputedStyle(title).direction),
        };
      });
      expect(geometry.popover.left).toBeGreaterThanOrEqual(geometry.panel.left - 1);
      expect(geometry.popover.right).toBeLessThanOrEqual(geometry.panel.right + 1);
      expect(geometry.overflowX).toBeLessThanOrEqual(0);
      expect(geometry.overflowY).toBeGreaterThan(0);
      expect(geometry.titleDirections).toContain('ltr');
      expect(geometry.titleDirections).toContain('rtl');
      await page.keyboard.press('Escape');
    }
  }
});
