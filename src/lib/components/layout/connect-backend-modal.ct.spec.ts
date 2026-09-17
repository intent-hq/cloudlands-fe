import { expect, test } from '@playwright/experimental-ct-svelte';
import ConnectBackendModalPreview from './connect-backend-modal.preview.svelte';

for (const width of [420, 1100]) {
  test(`keeps Add device appearance and switches inline at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(ConnectBackendModalPreview, {
      hooksConfig: { geometrySnapshot: { scene: 'connect-backend-modal', state: 'icloud' } },
    });
    const dialog = page.getByRole('dialog');
    const trigger = dialog.getByRole('combobox');
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
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option', { name: 'Potted plant' })).toBeAttached();
    await page.keyboard.press('End');
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
