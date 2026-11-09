import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import ConversationWireHarness from './DockConversationWireHarness.svelte';
import BackFocusHarness from './DockBackFocusHarness.svelte';

/**
 * Focus the surface parks on Back after a keyboard-driven conversation switch (no
 * composer request) is not a keyboard move: Back is focused but shows no ring. Control:
 * the same programmatic focus without the opt-out would match :focus-visible.
 */
test('dock Back focus parked by the app shows no ring', async ({ mount, page }, testInfo) => {
  const component = await mount(BackFocusHarness);
  const back = component.locator('[data-dock-conversation-back]');
  const switcher = component.getByTestId('switch');
  await switcher.focus();
  await page.keyboard.press('Enter');
  await expect(back).toBeFocused();
  const parked = await back.evaluate((el) => ({
    focusVisible: el.matches(':focus-visible'),
    outlineStyle: getComputedStyle(el).outlineStyle,
  }));
  expect(parked).toEqual({ focusVisible: false, outlineStyle: 'none' });
  // Control: after the same keyboard switch, a plain programmatic focus shows the ring.
  await switcher.focus();
  await page.keyboard.press('Space');
  await expect(back).toBeFocused();
  const control = await back.evaluate((el) => {
    (document.querySelector('[data-testid="switch"]') as HTMLElement).focus();
    el.focus();
    return el.matches(':focus-visible');
  });
  expect(control).toBe(true);
  await writeFile(
    testInfo.outputPath('back-parked-receipt.json'),
    JSON.stringify({ parked, controlPlainFocusVisible: control }, null, 2),
  );
});

/**
 * Keyboard focus on the dock conversation's Back button, in the real notch chrome, still
 * shows a ring; its look is checked by eye from the screenshots.
 */
test('dock Back keeps its keyboard focus ring after a Tab move', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 380, height: 680 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ConversationWireHarness, {
    props: { width: 320, height: 520, notchChrome: true, dockAppearance: true, syntheticNative: true },
  });
  const surface = component.getByTestId('dock-conversation-surface');
  const back = component.locator('[data-dock-conversation-back]');
  await expect(back).toBeVisible();
  const editor = component.locator('[data-testid="message-input"] [contenteditable]');
  await editor.click();
  await expect(editor).toBeFocused();
  // Keyboard-walk back to Back (bounded), as a keyboard user would.
  for (let i = 0; i < 15 && !(await back.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Shift+Tab');
  await expect(back).toBeFocused();
  // A real Tab move keeps the keyboard ring (manual proof: the screenshots below).
  const ring = { focusVisible: await back.evaluate((el) => el.matches(':focus-visible')) };
  expect(ring.focusVisible).toBe(true);
  await surface.screenshot({ path: testInfo.outputPath('back-keyboard-focus.png') });
  await back.screenshot({ path: testInfo.outputPath('back-keyboard-focus-crop.png') });
  await writeFile(testInfo.outputPath('back-focus-receipt.json'), JSON.stringify(ring, null, 2));
});
