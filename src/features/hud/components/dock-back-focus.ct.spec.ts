import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import ConversationWireHarness from './DockConversationWireHarness.svelte';

/**
 * Keyboard focus on the dock conversation's Back button, in the real notch chrome:
 * a quiet 1px ring on the button's own edge, not the app-wide ring floating outside it.
 */
test('dock Back keyboard focus ring sits on the button edge', async ({ mount, page }, testInfo) => {
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
  const ring = await back.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      focusVisible: el.matches(':focus-visible'),
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      outlineOffset: s.outlineOffset,
      outlineColor: s.outlineColor,
    };
  });
  expect(ring.focusVisible).toBe(true);
  expect(ring.outlineStyle).toBe('solid');
  expect(ring.outlineWidth).toBe('1px');
  expect(ring.outlineOffset).toBe('-1px');
  await surface.screenshot({ path: testInfo.outputPath('back-keyboard-focus.png') });
  await back.screenshot({ path: testInfo.outputPath('back-keyboard-focus-crop.png') });
  await writeFile(testInfo.outputPath('back-focus-receipt.json'), JSON.stringify(ring, null, 2));
});
