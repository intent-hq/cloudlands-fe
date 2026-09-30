import { expect, test } from '../../../../test/ct-test';
import Preview from '../agent-background-mode.preview.svelte';

test('mode action is reachable by keyboard and Escape returns focus to the agent', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview, { props: { mode: 'foreground' } });
  const row = component.locator('button[data-agent-panel-row]');
  await row.focus();
  await page.keyboard.press('Shift+F10');
  const mode = page.getByRole('menuitem', { name: 'Move to background' });
  await expect(mode).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(mode).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(mode).toHaveCount(0);
  await expect(row).toBeFocused();
  await row.click({ button: 'right' });
  await expect(mode).toBeVisible();
  await mode.click();
  await expect(mode).toHaveCount(0);
});
