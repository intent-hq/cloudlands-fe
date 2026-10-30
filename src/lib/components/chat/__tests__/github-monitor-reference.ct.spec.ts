import { mkdir } from 'node:fs/promises';
import { expect, test } from '../../../../test/ct-test';
import MonitoredPrsRowGeometryHost from './MonitoredPrsRowGeometryHost.svelte';

// Capture the shipped components before provider integration. These are review
// artifacts, not new decorative screenshot goldens or live-provider evidence.
for (const width of [360, 720]) {
  for (const referenceState of [
    'pending',
    'failing',
    'passing',
    'unknown',
    'restricted',
    'draft',
    'queued',
    'paused',
    'completed',
    'loading',
    'failed',
    'wake',
  ]) {
    test(`GitHub monitor reference ${referenceState} at ${width}`, async ({ mount, page }) => {
      await page.setViewportSize({ width, height: 520 });
      const component = await mount(MonitoredPrsRowGeometryHost, {
        props: { width, referenceState },
      });
      await page.evaluate(() => document.fonts.ready);
      const summary = component.getByTestId('monitored-pr-summary');
      if (referenceState === 'completed') {
        await expect(summary).toHaveCount(0);
      } else if (referenceState === 'loading') {
        await expect(summary).toHaveCount(0);
        await expect(component.getByTestId('pr-monitors-snapshot-status')).toHaveCount(0);
      } else if (referenceState === 'failed') {
        await expect(component.getByTestId('pr-monitors-snapshot-status')).toHaveAttribute(
          'data-snapshot-status',
          referenceState,
        );
      } else if (referenceState === 'wake') {
        await expect(component.getByTestId('pr-monitor-wake-chip')).toBeVisible();
      } else {
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(summary).toHaveAttribute('aria-expanded', 'true');
        await expect(component.getByTestId('monitored-pr-details')).toBeVisible();
      }
      if (referenceState === 'failing') {
        await expect(component.getByTestId('monitored-pr-details')).toContainText(
          '2 of 4 checks failed.',
        );
        await expect(component.getByTestId('monitored-pr-details')).toContainText(
          'required checks failing',
        );
      }
      await mkdir('.demo-artifacts/github-monitor-reference', { recursive: true });
      await page.screenshot({
        path: `.demo-artifacts/github-monitor-reference/${referenceState}-${width}.png`,
      });
      if (referenceState === 'pending') {
        const menu = component.getByTestId('monitored-pr-chip');
        await menu.click();
        await expect(page.getByTestId('monitored-pr-cancel-item')).toBeVisible();
        await page.screenshot({
          path: `.demo-artifacts/github-monitor-reference/menu-${width}.png`,
        });
        await page.keyboard.press('Escape');
        await expect(menu).toBeFocused();
        await expect(page.getByTestId('monitored-pr-menu')).toHaveCount(0);
      }
    });
  }
}
