import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';
import { DOCK_WINDOW_WIDTH } from '$shared/dock-layout';
import { writeFile } from 'node:fs/promises';

// Use native window width and real hovered row geometry. Merely checking that
// the card fits the viewport did not catch a card anchored to the wrong row.
for (const theme of ['light', 'dark'] as const) {
  for (const scene of ['bottom-anchor', 'bottom-overflow'] as const) {
    test(`dock row anchor ${theme} ${scene}`, async ({ mount, page }, testInfo) => {
      const props = dockRailPreview.states[scene].props;
      await page.setViewportSize({ width: DOCK_WINDOW_WIDTH, height: props.viewportHeight });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await mount(DockRailPreview, {
        props: { ...props, viewportWidth: DOCK_WINDOW_WIDTH, theme },
      });
      const strip = (await page.getByTestId('dock-collapsed-hit-strip').boundingBox())!;
      await page.mouse.move(strip.x + strip.width - 1, strip.y + strip.height / 2);
      await expect(page.getByTestId('dock-rail-target')).toHaveAttribute('data-expanded', 'true');
      const rows = page.locator('button[data-workspace-id]');
      const evidence = [];
      for (const position of ['top', 'bottom'] as const) {
        const row = position === 'top' ? rows.first() : rows.last();
        await row.hover();
        const card = page.getByTestId('dock-preview');
        await expect(card).toBeVisible();
        await expect(card).toHaveAttribute(
          'data-preview-workspace-id',
          (await row.getAttribute('data-workspace-id'))!,
        );
        await expect
          .poll(async () => {
            const [anchor, preview] = await Promise.all([row.boundingBox(), card.boundingBox()]);
            if (!anchor || !preview) return false;
            const rowCenter = anchor.y + anchor.height / 2;
            return preview.y <= rowCenter && preview.y + preview.height >= rowCenter;
          })
          .toBe(true);
        const anchor = (await row.boundingBox())!;
        const preview = (await card.boundingBox())!;
        expect(preview.y).toBeGreaterThanOrEqual(0);
        expect(preview.y + preview.height).toBeLessThanOrEqual(props.viewportHeight);
        expect(preview.x + preview.width).toBeLessThanOrEqual(anchor.x);
        await expect(card).toHaveAttribute('inert', '');
        evidence.push({
          position,
          workspace: await row.getAttribute('data-workspace-id'),
          anchor,
          preview,
        });
        const artifact = testInfo.outputPath(`dock-${theme}-${scene}-${position}.png`);
        await page.screenshot({ path: artifact, animations: 'disabled' });
        await testInfo.attach(`Dock ${theme} ${scene} ${position}`, {
          path: artifact,
          contentType: 'image/png',
        });
      }
      expect(evidence[1].anchor.y).toBeGreaterThan(evidence[0].anchor.y);
      expect(evidence[1].preview.y).toBeGreaterThan(evidence[0].preview.y);
      const geometryPath = testInfo.outputPath(`dock-${theme}-${scene}.json`);
      await writeFile(
        geometryPath,
        JSON.stringify(
          {
            synthetic: true,
            nativeWidth: DOCK_WINDOW_WIDTH,
            viewportHeight: props.viewportHeight,
            evidence,
          },
          null,
          2,
        ),
      );
      await testInfo.attach('Dock anchor geometry', {
        path: geometryPath,
        contentType: 'application/json',
      });
    });
  }
}
