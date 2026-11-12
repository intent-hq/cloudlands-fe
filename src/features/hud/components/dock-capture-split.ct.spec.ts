import { expect, test } from '../../../test/ct-test';
import ComposerMediaPreview from './dock-composer-media.preview.svelte';
import { expectDismissibleLayerArmed } from '../../../test/dismissible-layer';

test('hover options keep the capture button mounted, the current glyph stable and draft selection intact', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerMediaPreview);
  const editor = component.getByRole('textbox');
  const capture = component.locator('.capture-button');
  await editor.fill('Keep this selected draft');
  await editor.evaluate((node) => {
    const field = node as HTMLTextAreaElement;
    field.setSelectionRange(2, 10);
  });
  const original = await capture.elementHandle();
  if (!original) throw new Error('Missing capture button');
  await capture.hover();
  const menu = page.getByRole('menu', { name: 'Screenshot options' });
  await expect(menu).toBeVisible();
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await expect(capture.locator('[data-dock-glyph="viewfinder"]')).toBeVisible();
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((node) => {
      const field = node as HTMLTextAreaElement;
      return [field.selectionStart, field.selectionEnd];
    }),
  ).toEqual([2, 10]);
  await info.attach('capture-hover-options', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await capture.click();
  await expect(component).toHaveAttribute('data-actions', JSON.stringify(['capture']));
  await expect(menu).toBeHidden();
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await page.mouse.move(0, 0);
  await capture.hover();
  await menu.getByRole('menuitemradio', { name: 'Region', exact: true }).click();
  await expect(capture.locator('[data-dock-glyph="region"]')).toBeVisible();
  await capture.focus();
  await capture.press('ArrowUp');
  await expect(menu.getByRole('menuitemradio', { name: 'Region', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(capture).toBeFocused();
  await capture.press('ArrowDown');
  await expectDismissibleLayerArmed(menu);
  // The menu opens above the footer and can cover the textarea's center.
  // Dismiss from an exposed point that actually hits the field, not the menu.
  const outsidePoint = await editor.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const points = [
      { x: 8, y: 8 },
      { x: rect.width - 8, y: 8 },
      { x: 8, y: rect.height - 8 },
      { x: rect.width - 8, y: rect.height - 8 },
    ];
    const point = points.find(({ x, y }) =>
      node.contains(document.elementFromPoint(rect.left + x, rect.top + y)),
    );
    if (!point) throw new Error('No exposed textbox point for outside menu dismissal');
    return point;
  });
  await editor.click({ position: outsidePoint });
  await expect(menu).toBeHidden();
  await expect(editor).toBeFocused();
  await capture.dispatchEvent('contextmenu');
  await expect(menu).toBeVisible();
  await info.attach('capture-keyboard-and-context-options', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
