import { expect, test } from '../../../../test/ct-test';
import RtkShellSettings from '../rtk-shell-settings.preview.svelte';
import {
  assertRtkLoading,
  assertRtkShellGeometry,
  exerciseShellAndRtk,
} from './rtk-shell-settings.assertions';

for (const width of [420, 1100]) {
  test(`RTK matches CoW spacing and keeps responsive controls at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const root = await mount(RtkShellSettings);
    await page.evaluate(() => document.fonts.ready);
    await assertRtkShellGeometry(root, width < 768);
  });
}

for (const scenario of ['loading-settings', 'loading-probe'] as const) {
  test(`RTK exposes pending ${scenario} without an unchecked placeholder`, async ({ mount }) => {
    const root = await mount(RtkShellSettings, { props: { scenario } });
    await assertRtkLoading(root);
    await root
      .getByRole('button', {
        name: scenario === 'loading-settings' ? 'Resolve settings' : 'Resolve availability',
        exact: true,
      })
      .click();
    await expect(root.locator('#rtk-enabled').getByRole('switch')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(root.locator('#cli-optimization').getByRole('status')).toHaveCount(0);
    await expect(root.getByTestId('settings-writes')).toHaveText('[]');
  });
}

test('Shell label opens once, direct control and keyboard work, and RTK writes only on toggle', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  const root = await mount(RtkShellSettings);
  await assertRtkShellGeometry(root, false);
  await exerciseShellAndRtk(page, root);
});
