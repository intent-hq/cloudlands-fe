import { expect, test } from '../../../../test/ct-test';
import ChatFileChangesGeometryHost from './ChatFileChangesGeometryHost.svelte';

test.setTimeout(120_000);

for (const zoom of [1, 2]) {
  for (const forcedColors of ['none', 'active'] as const) {
    test(`keeps long file summaries truncated and accessible at ${zoom * 100}% with forced colors ${forcedColors}`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ forcedColors, reducedMotion: 'reduce' });
      const component = await mount(ChatFileChangesGeometryHost, {
        props: { width: 240, zoom },
      });
      const reference = component.getByTestId('reference-operational-row');
      const summary = component.getByTestId('file-summary-row');
      const rows = component.locator(
        '[data-streaming-typing-row], [data-operational-disclosure-row]',
      );
      await expect(rows).toHaveCount(2);
      await expect(summary.getByRole('button')).toHaveAccessibleName(
        '1,234 files changed in conversation so far',
      );

      const summaryGeometry = await summary
        .locator('[data-operational-summary]')
        .evaluate((label) => {
          const style = getComputedStyle(label);
          return {
            clipped: label.scrollWidth > label.clientWidth,
            whiteSpace: style.whiteSpace,
            overflow: style.overflow,
            textOverflow: style.textOverflow,
          };
        });
      expect(summaryGeometry.clipped).toBe(true);
      expect(summaryGeometry.whiteSpace).toBe('nowrap');
      expect(summaryGeometry.overflow).toBe('hidden');
      expect(summaryGeometry.textOverflow).toBe('ellipsis');
      await expect(reference.locator('[data-operational-summary]')).toBeVisible();
    });
  }
}
