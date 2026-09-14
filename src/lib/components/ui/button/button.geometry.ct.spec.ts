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
