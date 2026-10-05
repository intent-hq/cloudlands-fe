import { test } from '../../../../test/ct-test';
import SettingsContentLayout from '../settings-content-layout.preview.svelte';
import {
  assertSettingsContentLayout,
  exerciseSettingsContent,
} from './settings-content-layout.assertions';

for (const scenario of [
  { name: 'roomy page', width: 1100, narrowPane: false, stacked: false },
  { name: 'narrow viewport', width: 420, narrowPane: false, stacked: true },
  { name: 'narrow pane in a roomy viewport', width: 1100, narrowPane: true, stacked: true },
]) {
  test(`settings controls follow their labels in a ${scenario.name}`, async ({ mount, page }) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const root = await mount(SettingsContentLayout, {
      hooksConfig: {
        geometrySnapshot: {
          scene: 'settings-content-layout',
          state: scenario.narrowPane ? 'narrow-pane' : 'default',
        },
      },
    });
    try {
      await page.evaluate(() => document.fonts.ready);
      await assertSettingsContentLayout(root, scenario.stacked);
    } finally {
      await root.unmount();
    }
  });
}

test('top-right custom controls preserve keyboard, conditional, and save behavior', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const root = await mount(SettingsContentLayout, {
    hooksConfig: { geometrySnapshot: { scene: 'settings-content-layout', state: 'default' } },
  });
  try {
    await exerciseSettingsContent(page, root);
  } finally {
    await root.unmount();
  }
});
