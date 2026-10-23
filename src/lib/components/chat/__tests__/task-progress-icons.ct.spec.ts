import { expect, test } from '../../../../test/ct-test';
import TaskProgressIconsPreview from '../task-progress-icons.preview.svelte';

test('task progress supports keyboard scrolling and restores focus', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(TaskProgressIconsPreview, {
    props: { presentation: 'status-stack' },
  });
  const trigger = component.getByTestId('task-progress-trigger');
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
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('task-progress-scroll-region')).toBeFocused();
  await page.keyboard.press('End');
  await expect(rows.last()).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
});
