import { expect, test } from '../../../test/ct-test';
import ComposerE2EHarness from './DockComposerE2EHarness.svelte';
import ComposerMediaPreview from './dock-composer-media.preview.svelte';
import { expectDismissibleLayerArmed } from '../../../test/dismissible-layer';

type Harness = {
  native: { log: { captureModes: string[] }; holdCaptures: (hold: boolean) => void };
  close: () => void;
  reopen: () => void;
};

const nativeModes = () => {
  const harness = (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E;
  return harness.native.log.captureModes;
};

test('split capture preserves draft selection and uses the persisted mode through the native boundary', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 452, height: 680 });
  const component = await mount(ComposerE2EHarness);
  const primary = component.locator('.capture-button');
  const picker = component.getByRole('button', { name: 'Screenshot options', exact: true });
  const menu = page.getByRole('menu', { name: 'Screenshot options' });
  const editor = component.locator('.tiptap-editor');
  await expect(primary).toBeEnabled();
  await editor.fill('Keep this selected draft');
  await editor.press('ControlOrMeta+a');
  const selection = () => page.evaluate(() => window.getSelection()?.toString());
  const before = await selection();
  expect(before).toBe('Keep this selected draft');
  const primaryBox = await primary.boundingBox();
  const record = component.locator('.recording-button');
  const recordBox = await record.boundingBox();
  await primary.hover();
  // Observe beyond the removed 150 ms timer: hovering must never open a menu.
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- observes a quiet period beyond the former hover-open timer
  await page.waitForTimeout(350);
  await expect(menu).toBeHidden();
  await expect(primary.locator('[data-dock-glyph="viewfinder"]')).toBeVisible();
  await expect(editor).toBeFocused();
  expect(await selection()).toBe(before);
  expect(await primary.boundingBox()).toEqual(primaryBox);
  expect(await record.boundingBox()).toEqual(recordBox);
  await expect(picker).toHaveCSS('opacity', '1');
  await info.attach('capture-hover-stable', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  await picker.click();
  await expect(menu).toBeVisible();
  await expect(editor).toBeFocused();
  expect(await selection()).toBe(before);
  await info.attach('capture-explicit-picker', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await menu.getByRole('menuitemradio', { name: 'Region', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(primary.locator('[data-dock-glyph="region"]')).toBeVisible();
  await expect.poll(() => page.evaluate(nativeModes)).toEqual(['region']);
  await expect(editor).toHaveText('Keep this selected draft');
  await primary.click();
  await expect.poll(() => page.evaluate(nativeModes)).toEqual(['region', 'region']);

  await primary.focus();
  await page.keyboard.press('Tab');
  await expect(picker).toBeFocused();
  await expect(menu).toBeHidden();
  await picker.press('Space');
  await expect(menu.getByRole('menuitemradio', { name: 'Region', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).toBeFocused();
  await picker.press('ArrowUp');
  await expectDismissibleLayerArmed(menu);
  await editor.click();
  await expect(menu).toBeHidden();
  await expect(editor).toBeFocused();
  await picker.click();
  await expectDismissibleLayerArmed(menu);
  await picker.click();
  await expect(menu).toBeHidden();
  await picker.focus();
  await picker.press('ArrowUp');
  await expect(menu.getByRole('menuitemradio', { name: 'Region', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(primary.locator('[data-dock-glyph="window"]')).toBeVisible();
  await expect.poll(() => page.evaluate(nativeModes)).toEqual(['region', 'region', 'window']);
  await page.evaluate(() => {
    const h = (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E;
    h.close();
    h.reopen();
    h.native.holdCaptures(true);
  });
  await expect(primary).toHaveAttribute('data-capture-mode', 'window');
  // Native Space on the main button captures; it never opens the picker.
  await primary.focus();
  await primary.press('Space');
  await expect(primary).toBeDisabled();
  await expect(picker).toBeDisabled();
  await expect(menu).toBeHidden();
  await expect
    .poll(() => page.evaluate(nativeModes))
    .toEqual(['region', 'region', 'window', 'window']);
  await info.attach('capture-pending', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.native.holdCaptures(
      false,
    ),
  );
  await info.attach('capture-native-modes', {
    body: JSON.stringify(
      { syntheticNative: true, captureModes: await page.evaluate(nativeModes) },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});

test('touch picker stays discoverable and permission and disabled states preserve ownership', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 680 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const component = await mount(ComposerMediaPreview, { props: { width: 320 } });
  const primary = component.locator('.capture-button');
  const picker = component.getByRole('button', { name: 'Screenshot options', exact: true });
  await expect(picker).toHaveCSS('opacity', '1');
  await picker.click();
  const menu = page.getByRole('menu', { name: 'Screenshot options' });
  await expect(menu).toBeVisible();
  await info.attach('capture-touch-picker', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await component.update({
    props: { width: 320, state: { alerts: { capture: 'Allow screen recording' } } },
  });
  await expect(picker).toBeDisabled();
  await primary.click();
  await expect(component).toHaveAttribute(
    'data-actions',
    JSON.stringify(['open-settings:capture']),
  );
  await expect(menu).toBeHidden();
  await expect(primary.locator('.capture-flash')).toHaveCount(0);
  await component.update({ props: { width: 320, disabled: true } });
  await expect(primary).toBeDisabled();
  await expect(picker).toBeDisabled();
  await info.attach('capture-disabled', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
