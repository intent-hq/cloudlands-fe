import { expect, test } from '../../../test/ct-test';
import ConnectBackendModalPreview from './connect-backend-modal.preview.svelte';
import DeviceIconPickerHarness from '../DeviceIconPicker.test-harness.svelte';

for (const { width, height } of [
  { width: 420, height: 1000 },
  { width: 1100, height: 1000 },
  { width: 420, height: 720 },
]) {
  const name = `keeps Add device appearance and switches inline at ${width}×${height}px`;
  test(name, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(ConnectBackendModalPreview, {
      hooksConfig: { geometrySnapshot: { scene: 'connect-backend-modal', state: 'icloud' } },
    });
    const dialog = page.getByRole('dialog');
    const trigger = dialog.getByRole('combobox');
    await expect(dialog.getByLabel('Device name', { exact: true })).toBeFocused();
    await expect(trigger).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const appearance = await dialog.locator('[data-connect-appearance]').evaluate((node) => {
      const accent = node.querySelector('fieldset')!.getBoundingClientRect();
      const picker = node.querySelector('[role=combobox]')!.getBoundingClientRect();
      return { accent: accent.toJSON(), picker: picker.toJSON() };
    });
    expect(appearance.picker.left).toBeGreaterThan(appearance.accent.right);
    expect(Math.abs(appearance.picker.bottom - appearance.accent.bottom)).toBeLessThanOrEqual(1);
    expect(appearance.picker.width).toBeLessThanOrEqual(40);
    expect(appearance.picker.width).toBeCloseTo(appearance.picker.height, 0);
    const geometry = await dialog.evaluate((node) => ({
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
    }));
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);

    for (const label of ['Detect all backend IPs', 'Save to iCloud']) {
      const toggle = dialog.getByRole('switch', { name: label });
      await expect(toggle).toBeChecked();
      const row = await toggle.evaluate((node) => {
        const field = node.closest('[data-slot=settings-field-row]')!;
        const label = field.querySelector('[data-field-label]')!.getBoundingClientRect();
        return {
          toggle: node.getBoundingClientRect().toJSON(),
          label: label.toJSON(),
          right: field.getBoundingClientRect().right,
        };
      });
      expect(row.toggle.left).toBeGreaterThan(row.label.right);
      expect(Math.abs(row.toggle.top - row.label.top)).toBeLessThanOrEqual(2);
      expect(Math.abs(row.toggle.right - row.right)).toBeLessThanOrEqual(1);
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).not.toBeChecked();
      await page.keyboard.press('Space');
      await expect(toggle).toBeChecked();
    }

    const initialIcon = await trigger.locator('svg').innerHTML();
    await trigger.click();
    const laptop = page.getByRole('option', { name: 'Laptop', exact: true });
    await expect(laptop).toBeVisible();
    await expect
      .poll(async () => {
        const box = await laptop.boundingBox();
        return (
          !!box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width &&
          box.y + box.height <= height
        );
      })
      .toBe(true);
    const stacking = await laptop.evaluate((option) => {
      const rect = option.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const dialog = document.querySelector('[role="dialog"]')!;
      const content = option.closest('[data-slot="select-content"]')!;
      const wrapper = content.parentElement!;
      return {
        option: rect.toJSON(),
        dialog: dialog.getBoundingClientRect().toJSON(),
        content: content.getBoundingClientRect().toJSON(),
        contentZIndex: getComputedStyle(content).zIndex,
        wrapperZIndex: getComputedStyle(wrapper).zIndex,
        wrapperPosition: getComputedStyle(wrapper).position,
        contentInsideDialog: dialog.contains(content),
        optionIsTopmost: hit !== null && option.contains(hit),
        hitRole: hit?.getAttribute('role'),
        hitTag: hit?.tagName,
      };
    });
    await testInfo.attach('device-menu-stacking', {
      body: JSON.stringify(stacking),
      contentType: 'application/json',
    });
    await testInfo.attach('device-menu-full-modal', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect(stacking.optionIsTopmost).toBe(true);
    await laptop.click();
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAccessibleName(/Laptop/);
    await expect(trigger).toBeFocused();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(laptop).toHaveAttribute('aria-selected', 'true');
    const lastOption = page.getByRole('option', { name: 'Potted plant' });
    await expect(lastOption).toBeAttached();
    await page.keyboard.press('End');
    // End updates the active option before Bits can scroll it: scrolling is
    // deferred until the reopened floating content has been positioned.
    await expect(trigger).toHaveAttribute(
      'aria-activedescendant',
      (await lastOption.getAttribute('id'))!,
    );
    await expect(lastOption).toBeInViewport({ ratio: 1 });
    const lastOptionStacking = await lastOption.evaluate((option) => {
      const rect = option.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        option: rect.toJSON(),
        listbox: option.closest('[role="listbox"]')!.getBoundingClientRect().toJSON(),
        optionIsTopmost: hit !== null && option.contains(hit),
        hitRole: hit?.getAttribute('role'),
        hitTag: hit?.tagName,
      };
    });
    await testInfo.attach('device-menu-last-option-stacking', {
      body: JSON.stringify(lastOptionStacking),
      contentType: 'application/json',
    });
    await testInfo.attach('device-menu-last-option', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect(lastOptionStacking.optionIsTopmost).toBe(true);
    await page.keyboard.press('Enter');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleName(/Potted plant/);
    await expect(trigger).toHaveText('');
    await expect(trigger.locator('svg')).toBeVisible();
    expect(await trigger.locator('svg').innerHTML()).not.toBe(initialIcon);
    await trigger.hover();
    await expect(page.getByRole('tooltip')).toContainText('Potted plant');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(trigger).toBeFocused();
    // Focus restoration may reveal the trigger's tooltip. Dismiss that hint
    // before testing the dialog: Escape belongs to the topmost open layer.
    await page.mouse.move(1, 1);
    await dialog.getByLabel('Device name', { exact: true }).focus();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}

test('omits unavailable iCloud controls without hiding IP detection', async ({ mount, page }) => {
  await mount(ConnectBackendModalPreview, {
    hooksConfig: { geometrySnapshot: { scene: 'connect-backend-modal', state: 'unsupported' } },
  });
  await expect(page.getByRole('switch', { name: 'Save to iCloud' })).toHaveCount(0);
  const detection = page.getByRole('switch', { name: 'Detect all backend IPs' });
  await detection.focus();
  await page.keyboard.press('Space');
  await expect(detection).not.toBeChecked();
});

test('keeps the non-modal device picker selectable and returns focus on Escape', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DeviceIconPickerHarness);
  const trigger = page.getByRole('combobox');
  await trigger.click();
  await page.getByRole('option', { name: 'Laptop', exact: true }).click();
  await expect(page.getByTestId('bound-device-icon-value')).toHaveText('laptop');
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await trigger.press('End');
  await trigger.press('Enter');
  await expect(page.getByTestId('bound-device-icon-value')).toHaveText('pottedPlant');
  await trigger.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await trigger.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
