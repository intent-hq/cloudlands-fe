import { expect, test } from '../../../../test/ct-test';
import AppearanceRowLayout from '../appearance-row-layout.preview.svelte';

for (const width of [420, 1100]) {
  test(`battery setting matches the shared appearance tier at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(AppearanceRowLayout);
    await page.evaluate(() => document.fonts.ready);
    const geometry = await component
      .locator('[data-slot="settings-field-row"]')
      .evaluateAll((rows) =>
        rows.map((row) => {
          const toggle = row.querySelector('[role="switch"]')!;
          const label = document.getElementById(toggle.getAttribute('aria-labelledby')!)!;
          const description = document.getElementById(toggle.getAttribute('aria-describedby')!)!;
          const box = row.getBoundingClientRect();
          const control = toggle.getBoundingClientRect();
          const labelBox = label.getBoundingClientRect();
          const descriptionBox = description.getBoundingClientRect();
          return {
            row: { x: box.x, right: box.right },
            control: {
              x: control.x,
              right: control.right,
              y: control.y,
              width: control.width,
              height: control.height,
            },
            centerOffset: control.y + control.height / 2 - (labelBox.y + labelBox.height / 2),
            labelX: labelBox.x,
            descriptionBottom: descriptionBox.bottom,
          };
        }),
      );
    const [reference, battery, stacked] = geometry;
    expect(geometry).toHaveLength(3);
    expect(battery.labelX).toBeCloseTo(reference.labelX, 1);
    expect(battery.control.width).toBeCloseTo(reference.control.width, 1);
    expect(battery.control.height).toBeCloseTo(reference.control.height, 1);
    for (const row of geometry) {
      expect(row.control.x).toBeGreaterThanOrEqual(row.row.x);
      expect(row.control.right).toBeLessThanOrEqual(row.row.right + 1);
    }
    if (width >= 768) {
      expect(Math.abs(battery.centerOffset)).toBeLessThanOrEqual(1);
      expect(battery.control.right).toBeCloseTo(reference.control.right, 1);
    } else {
      expect(battery.control.y).toBeGreaterThan(battery.descriptionBottom);
      expect(battery.control.x).toBeCloseTo(battery.labelX, 1);
    }
    expect(stacked.control.y).toBeGreaterThan(stacked.descriptionBottom);
    const toggle = component.locator('#reduce-motion-on-battery-switch').getByRole('switch');
    const initial = await toggle.getAttribute('aria-checked');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', initial === 'true' ? 'false' : 'true');
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', initial!);
  });
}
