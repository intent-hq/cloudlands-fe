import { expect, test } from '@playwright/experimental-ct-svelte';
import TaskProgressControl from '../TaskProgressControl.svelte';

const tasks = [
  { id: 'pending', title: 'Inspect the panel', status: 'pending' },
  { id: 'running', title: 'Move the task progress', status: 'running' },
  { id: 'completed', title: 'Map the native plan', status: 'completed' },
  { id: 'waiting', title: 'Wait for review', status: 'waiting' },
  { id: 'discussion', title: 'Discuss the approach', status: 'discussion_needed' },
  { id: 'blocked', title: 'Resolve the blocker', status: 'blocked' },
  { id: 'review', title: 'Review the result', status: 'review_required' },
] as const;

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
    await expect(page.getByTestId('task-progress-popover')).toBeVisible();

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

    const popoverBorder = await page
      .getByTestId('task-progress-popover')
      .evaluate((node) => getComputedStyle(node).borderTopWidth);
    expect(popoverBorder).toBe('1px');
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
    await expect(page.getByTestId('task-progress-popover')).toBeVisible();
    await expect(page.getByTestId('task-progress-row')).toHaveCount(tasks.length);
  });
}
