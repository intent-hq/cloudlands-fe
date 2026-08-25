import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatFileChangesGeometryHost from './ChatFileChangesGeometryHost.svelte';

test.setTimeout(120_000);

for (const zoom of [1, 2]) {
  for (const forcedColors of ['none', 'active'] as const) {
    test(`matches operational row geometry at ${zoom * 100}% with forced colors ${forcedColors}`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ forcedColors, reducedMotion: 'reduce' });
      const component = await mount(ChatFileChangesGeometryHost, {
        props: { width: 240, zoom },
      });
      const reference = component.getByTestId('reference-operational-row');
      const summary = component.getByTestId('file-summary-row');
      const rows = reference
        .getByRole('status', { name: 'Reference operational row' })
        .or(summary.getByRole('button', { name: '1,234 files changed in conversation so far' }));
      await expect(rows).toHaveCount(2);
      await expect(summary.getByRole('button')).toHaveAccessibleName(
        '1,234 files changed in conversation so far',
      );

      const geometry = await rows.evaluateAll((elements) =>
        elements.map((row) => {
          const box = row.getBoundingClientRect();
          const leading = row.querySelector<HTMLElement>('[data-operational-leading]')!;
          const icon = leading.querySelector<SVGElement>('svg');
          const label = row.querySelector<HTMLElement>('[data-operational-summary]')!;
          const leadingBox = leading.getBoundingClientRect();
          const iconBox = icon?.getBoundingClientRect();
          const labelBox = label.getBoundingClientRect();
          const labelStyle = getComputedStyle(label);
          const iconStyle = icon ? getComputedStyle(icon) : undefined;
          const probe = document.createElement('span');
          probe.style.cssText =
            'display:inline-block;width:0;height:0;margin:0;padding:0;vertical-align:baseline';
          label.append(probe);
          const baseline = probe.getBoundingClientRect().bottom - box.top;
          probe.remove();
          return {
            height: box.height,
            rowLeft: box.left,
            leadingWidth: leadingBox.width,
            leadingCenterY: (leadingBox.top + leadingBox.bottom) / 2,
            rowCenterY: (box.top + box.bottom) / 2,
            leadingCenterOffset: (leadingBox.top + leadingBox.bottom) / 2 - box.top,
            rowCenterOffset: box.height / 2,
            iconSize: iconBox ? [iconBox.width, iconBox.height] : undefined,
            labelLeft: labelBox.left,
            labelOffset: labelBox.left - box.left,
            baseline,
            fontSize: labelStyle.fontSize,
            lineHeight: labelStyle.lineHeight,
            fontWeight: labelStyle.fontWeight,
            whiteSpace: labelStyle.whiteSpace,
            overflow: labelStyle.overflow,
            textOverflow: labelStyle.textOverflow,
            color: labelStyle.color,
            opacity: labelStyle.opacity,
            iconColor: iconStyle?.color,
            iconOpacity: iconStyle?.opacity,
            clipped: label.scrollWidth > label.clientWidth,
          };
        }),
      );

      const [referenceGeometry, summaryGeometry] = geometry;
      expect(summaryGeometry.height).toBeCloseTo(28 * zoom, 1);
      expect(summaryGeometry.leadingWidth).toBeCloseTo(20 * zoom, 1);
      expect(summaryGeometry.iconSize).toEqual([16 * zoom, 16 * zoom]);
      expect(summaryGeometry.labelLeft - summaryGeometry.rowLeft).toBeCloseTo(36 * zoom, 1);
      expect(summaryGeometry.leadingCenterY).toBeCloseTo(summaryGeometry.rowCenterY, 1);
      expect(summaryGeometry.clipped).toBe(true);
      expect(summaryGeometry.whiteSpace).toBe('nowrap');
      expect(summaryGeometry.overflow).toBe('hidden');
      expect(summaryGeometry.textOverflow).toBe('ellipsis');
      expect(summaryGeometry.fontWeight).toBe('400');
      expect(summaryGeometry.color).not.toBe('rgba(0, 0, 0, 0)');
      expect(summaryGeometry.iconColor).toBe(summaryGeometry.color);
      expect(summaryGeometry.iconOpacity).toBe(summaryGeometry.opacity);
      for (const key of [
        'height',
        'leadingWidth',
        'leadingCenterOffset',
        'rowCenterOffset',
        'labelOffset',
        'baseline',
        'fontSize',
        'lineHeight',
        'fontWeight',
      ] as const) {
        expect(summaryGeometry[key]).toEqual(referenceGeometry[key]);
      }
      await expect(reference.locator('[data-operational-summary]')).toBeVisible();
    });
  }
}
