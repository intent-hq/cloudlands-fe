import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockThumbnailRaceHarness.svelte';

test.use({ video: 'on', trace: 'on', viewport: { width: 900, height: 800 } });
for (const scenario of [
  'concurrent failures',
  'first saved failure',
  'retain successful saved',
  'superseded success',
  'stale raw failure',
  'cancel ignores unsaved marks',
  'removed attachment and newer view',
  'dispose fences work',
  'retired authority fences failure',
]) {
  test(scenario, async ({ mount, page }, info) => {
    const fixture = await mount(Harness, { props: { scenario } });
    await page.getByRole('button', { name: 'Run synthetic thumbnail case' }).click();
    await expect(fixture).toHaveAttribute('data-status', 'passed');
    const receipt = await fixture.getAttribute('data-receipt');
    await writeFile(info.outputPath('receipt.json'), receipt!);
    await page.screenshot({ path: info.outputPath('thumbnail-result.png') });
  });
}
