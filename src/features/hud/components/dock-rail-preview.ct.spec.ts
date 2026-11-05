import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

test('Assistant and every workspace remain reachable in the bounded legacy rail', async ({
  mount,
  page,
}) => {
  const component = await mount(DockRailPreview, { props: dockRailPreview.states.overflow.props });
  const assistant = component.locator('[data-dock-assistant]');
  await assistant.focus();
  await assistant.press('Enter');
  await expect(component).toHaveAttribute('data-preview-action', 'assistant');
  const workspace = component.locator('[data-workspace-id]').first();
  await workspace.focus();
  await workspace.press('Enter');
  await expect(component).toHaveAttribute(
    'data-preview-action',
    `workspace:${await workspace.getAttribute('data-workspace-id')}`,
  );
  // The Assistant is the last entry, below every workspace.
  await workspace.press('End');
  const last = assistant;
  await expect(last).toBeFocused();
  const scroller = component.locator('[data-dock-scroll]');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() =>
      last.evaluate((el) => {
        const scroll = el.closest('[data-dock-scroll]');
        if (!scroll) return false;
        const r = el.getBoundingClientRect(),
          s = scroll.getBoundingClientRect();
        return r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
      }),
    )
    .toBe(true);
  await expect(component.getByTestId('dock-overflow')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(component).toHaveAttribute('data-preview-action', 'assistant');
  await last.press('Home');
  await expect(workspace).toBeFocused();
  await assistant.focus();
  await expect(assistant).toBeFocused();
  await assistant.press('Escape');
  await expect(component.getByTestId('dock-rail-target')).toHaveAttribute('data-expanded', 'false');
});
