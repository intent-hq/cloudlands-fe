import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../../test/ct-test';
import Harness from './DaemonAuditHarness.svelte';

for (const state of [
  'external',
  'long-host',
  'startup',
  'limited',
  'updating',
  'guest-offline',
  'guest-revoked',
  'auth-rejected',
  'auth-disabled',
]) {
  test(`daemon ${state} recovery remains readable in a narrow window`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 360, height: 600 });
    await page.clock.install();
    await mount(Harness, { props: { state } });
    await page.clock.runFor(2600);
    const overlay = page.getByRole('alertdialog');
    await expect(overlay).toBeVisible();
    if (state.startsWith('guest-')) {
      await expect(page.getByTestId('daemon-stopped-guest-leave')).toBeVisible();
      await expect(page.getByTestId('daemon-stopped-spawn-sidecar')).toHaveCount(0);
      await expect(page.getByTestId('daemon-stopped-repair')).toHaveCount(0);
    } else if (state.startsWith('auth-')) {
      await expect(page.getByTestId('daemon-stopped-repair')).toBeVisible();
      await expect(page.getByTestId('daemon-stopped-retrying')).toHaveCount(0);
    }
    if (process.env.MODAL_AUDIT_CAPTURE_DIR) {
      const directory = resolve(process.env.MODAL_AUDIT_CAPTURE_DIR);
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: resolve(directory, `daemon-${state}-light-360.png`) });
    }
    const panel = overlay.locator(':scope > div');
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    if (state === 'updating') {
      await page.clock.runFor(8000);
      await expect(page.getByTestId('daemon-updating-overlay')).toHaveCount(0);
      await expect(page.getByTestId('daemon-stopped-overlay')).toBeVisible();
    }
  });
}
