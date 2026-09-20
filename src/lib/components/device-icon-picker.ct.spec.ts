import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../test/ct-test';
import DeviceIconPickerHarness from './DeviceIconPicker.test-harness.svelte';

interface StrokeProbe {
  renderedWidth: number;
  effectiveStrokePx: number;
  stroke: string;
  opacity: string;
}

// Measures the stroke the browser paints for the icon's first shape: the computed
// stroke width is in user units, and the screen CTM is the browser's own mapping
// from those units to CSS pixels, so it accounts for the icon's viewBox scale.
function probeStroke(svg: Locator): Promise<StrokeProbe> {
  return svg.evaluate((node) => {
    const shape = node.querySelector<SVGGraphicsElement>('rect, path, circle')!;
    const style = getComputedStyle(shape);
    const scale = shape.getScreenCTM()?.a ?? 1;
    return {
      renderedWidth: node.getBoundingClientRect().width,
      effectiveStrokePx: parseFloat(style.strokeWidth) * scale,
      stroke: style.stroke,
      opacity: style.opacity,
    };
  });
}

const strokeIcons = [
  { option: 'Mac mini', value: 'macMini' },
  { option: 'Mac Studio', value: 'macStudio' },
] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const { option, value } of strokeIcons) {
    test(`selected ${option} keeps a visible stroke inside the trigger button in ${theme}`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate((selectedTheme) => {
        document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      }, theme);
      await mount(DeviceIconPickerHarness);
      const trigger = page.getByRole('combobox');
      await trigger.click();
      await page.getByRole('option', { name: option, exact: true }).click();
      await expect(page.getByTestId('bound-device-icon-value')).toHaveText(value);
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await page.mouse.move(0, 0);

      const svg = trigger.locator('svg');
      await expect(svg).toBeVisible();
      const resting = await probeStroke(svg);
      expect(resting.renderedWidth).toBe(16);
      expect(resting.stroke).not.toBe('none');
      expect(resting.stroke).not.toBe('rgba(0, 0, 0, 0)');
      expect(resting.opacity).toBe('1');
      expect(resting.effectiveStrokePx).toBeGreaterThanOrEqual(1);

      await trigger.hover();
      await expect(page.getByRole('tooltip')).toBeVisible();
      const hovered = await probeStroke(svg);
      expect(hovered.effectiveStrokePx).toBeGreaterThanOrEqual(1);
      expect(hovered.effectiveStrokePx).toBe(resting.effectiveStrokePx);
    });
  }
}

test('a filled device icon still takes the button-owned stroke weight', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DeviceIconPickerHarness);
  const trigger = page.getByRole('combobox');
  await trigger.click();
  await page.getByRole('option', { name: 'Laptop', exact: true }).click();
  await expect(page.getByTestId('bound-device-icon-value')).toHaveText('laptop');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.mouse.move(0, 0);

  const svg = trigger.locator('svg');
  const resting = await probeStroke(svg);
  await trigger.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect
    .poll(async () => (await probeStroke(svg)).effectiveStrokePx)
    .toBeGreaterThan(resting.effectiveStrokePx);
});
