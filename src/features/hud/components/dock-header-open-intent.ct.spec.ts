/**
 * Double-clicking the dock conversation header brings Intent forward as it was
 * (main's app activation), end to end through the real dock conversation (wire
 * fixtures). Main is replaced at its IPC boundary by a counter, so this proves
 * which gestures ask for it: a double-click on the header's identity or empty
 * space does, once; single clicks and double-clicks on the back and open buttons
 * do not, and the open button still opens the workspace as before. Main's side
 * (only the dock may ask; it runs the app-icon activation) is not exercised here.
 */
import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockHeaderOpenIntentHarness.svelte';

test('double-click on the dock header brings Intent forward; its buttons do not', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 420, height: 640 });
  const harness = await mount(Harness);
  const activations = async () => Number(await harness.getAttribute('data-activations'));
  const header = page.locator('[data-dock-chrome]');
  const chooser = page.getByRole('combobox', { name: 'Conversation with' });
  await expect(chooser).toContainText('Wire coordinator');

  // A single click on the identity opens the agent picker, not Intent.
  await chooser.click();
  await expect(page.getByRole('option', { name: 'Wire specialist', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await activations()).toBe(0);

  // Double-click the identity: Intent comes forward once, and the picker is not left open.
  await chooser.dblclick();
  await expect.poll(activations).toBe(1);
  await expect(page.getByRole('option', { name: 'Wire specialist', exact: true })).toHaveCount(0);

  // Double-click the header's own edge, outside the identity and its buttons.
  const box = (await header.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + 1);
  await expect.poll(activations).toBe(2);

  // The header text is chrome: a double-click selects nothing.
  expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');

  // The back and open buttons keep their own meaning.
  await header.getByRole('button', { name: 'Open full conversation', exact: true }).dblclick();
  await expect(page.locator('[data-full-target]')).not.toHaveAttribute('data-full-target', '');
  await page.screenshot({ path: info.outputPath('dock-header-open-intent.png') });
  await header.getByRole('button', { name: 'Go back', exact: true }).dblclick();
  expect(await activations()).toBe(2);
});
