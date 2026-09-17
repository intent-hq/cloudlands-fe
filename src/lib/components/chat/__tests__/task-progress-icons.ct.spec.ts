import { expect, test } from '@playwright/experimental-ct-svelte';
import TaskProgressIconsPreview from '../task-progress-icons.preview.svelte';

test('expanded task glyphs fill the regular icon size and align with wrapped titles without enlarging the stack', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(TaskProgressIconsPreview, {
    props: { presentation: 'status-stack' },
  });
  const trigger = component.getByTestId('task-progress-trigger');
  const triggerBefore = await trigger.boundingBox();
  const stackGlyphs = component.getByTestId('task-progress-status-icon').locator('svg');
  const stackBefore = await stackGlyphs.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().width),
  );
  await trigger.focus();
  await page.keyboard.press('Enter');
  const popover = page.getByTestId('task-progress-popover');
  await expect(popover).toBeVisible();
  await expect
    .poll(() =>
      popover.evaluate((node) => {
        const scale = getComputedStyle(node).scale;
        return scale === 'none' || scale.split(/\s+/).every((axis) => Number(axis) === 1);
      }),
    )
    .toBe(true);
  const rows = page.getByTestId('task-progress-row');
  const geometry = await rows.evaluateAll((nodes) =>
    nodes.map((row) => {
      const svg = row.querySelector<SVGSVGElement>(
        '[data-testid="task-progress-row-status-icon"] svg',
      )!;
      const icon = svg.getBoundingClientRect();
      const label = row.querySelector<HTMLElement>('[dir="auto"]')!;
      const text = label.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
      const painted = svg.getBBox();
      const matrix = svg.getScreenCTM()!;
      return {
        width: icon.width,
        height: icon.height,
        firstLineCenterOffset: icon.top + icon.height / 2 - (text.top + lineHeight / 2),
        paintedExtent: Math.max(
          painted.width * Math.abs(matrix.a),
          painted.height * Math.abs(matrix.d),
        ),
        titleHeight: text.height,
        lineHeight,
      };
    }),
  );
  expect(geometry).toHaveLength(7);
  for (const row of geometry) {
    expect(row.width).toBeCloseTo(14, 1);
    expect(row.height).toBeCloseTo(14, 1);
    expect(row.paintedExtent).toBeGreaterThan(10);
    expect(Math.abs(row.firstLineCenterOffset)).toBeLessThanOrEqual(1);
    expect(row.titleHeight).toBeGreaterThan(row.lineHeight);
  }
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('task-progress-scroll-region')).toBeFocused();
  await page.keyboard.press('End');
  await expect(rows.last()).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await trigger.boundingBox()).toEqual(triggerBefore);
  expect(
    await stackGlyphs.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width),
    ),
  ).toEqual(stackBefore);
  expect(stackBefore.every((width) => width <= 8)).toBe(true);
});
