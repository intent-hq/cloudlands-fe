import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/experimental-ct-svelte';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import ButtonPreview from './button.preview.svelte';

const snapshotPath = fileURLToPath(new URL('./__geometry__/button.geometry.json', import.meta.url));

defineGeometrySnapshotSuite({
  scene: 'button',
  component: ButtonPreview,
  states: ['default', 'loading', 'disabled', 'destructive'],
  widths: [420],
  selector: 'button',
  snapshotPath,
});

if (process.env.SANDBOX_GEOMETRY_UPDATE !== '1') {
  test.describe('button geometry regression detection', () => {
    test.beforeEach(async ({ page }) => {
      await page.addStyleTag({ content: '[data-slot="button"] { width: 200px !important; }' });
    });

    test.afterEach(({}, testInfo) => {
      expect(testInfo.error?.message).toContain('default/420/data-slot=button.width');
      testInfo.fail();
    });

    defineGeometrySnapshotSuite({
      scene: 'button',
      component: ButtonPreview,
      states: ['default'],
      widths: [420],
      selector: 'button',
      snapshotPath,
    });
  });
}

for (const size of ['sm', 'default', 'lg', 'icon-sm', 'icon', 'icon-lg'] as const) {
  test(`button ${size} keeps one radius across variants and states`, async ({ mount }) => {
    const component = await mount(ButtonPreview, {
      props: { size, 'aria-label': 'Radius probe' },
    });
    const button = component.locator('[data-slot="button"]');
    for (const variant of ['primary', 'secondary', 'ghost', 'outline', 'destructive'] as const) {
      for (const state of ['default', 'active', 'disabled', 'loading'] as const) {
        await component.update({
          props: {
            size,
            variant,
            'aria-label': 'Radius probe',
            active: state === 'active',
            disabled: state === 'disabled',
            loading: state === 'loading',
          },
        });
        const shape = await button.evaluate((element) => {
          const root = getComputedStyle(element);
          const surface = element.querySelector('[data-slot="button-surface"]')!;
          const fill = getComputedStyle(surface);
          const bounds = element.getBoundingClientRect();
          const fillBounds = surface.getBoundingClientRect();
          return {
            radius: root.borderRadius,
            fillRadius: fill.borderRadius,
            leftInset: fillBounds.left - bounds.left - parseFloat(root.borderLeftWidth),
            topInset: fillBounds.top - bounds.top - parseFloat(root.borderTopWidth),
            rightInset: bounds.right - fillBounds.right - parseFloat(root.borderRightWidth),
            bottomInset: bounds.bottom - fillBounds.bottom - parseFloat(root.borderBottomWidth),
          };
        });
        expect(shape, `${variant}/${state}`).toEqual({
          radius: '8px',
          fillRadius: '8px',
          leftInset: 0,
          topInset: 0,
          rightInset: 0,
          bottomInset: 0,
        });
      }
    }
  });
}
