import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';
import { dockCompactWingWidth } from './dock-shell-geometry';
import { DOCK_NOTCH_MIN_WING_WIDTH } from '../../../shared/dock-placement';

/**
 * The collapsed notch with several status groups: the status wing hugs its glyphs (8px outer
 * inset, 3px between glyphs, 4px clear of the camera) and both wings match the width the
 * native window and hit regions are sized from (dockCompactWingWidth). Expanded geometry is
 * not involved.
 */
test('collapsed notch wings hug the logo and status glyphs', async ({ mount, page }, info) => {
  await page.setViewportSize({ width: 900, height: 400 });
  await page.mouse.move(890, 390);
  const component = await mount(DockRailPreview, {
    props: dockRailPreview.states['notch-many-updates'].props,
  });
  const shell = component.getByTestId('dock-shell');
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await expect(component.locator('.notch-status-glyph').first()).toBeVisible();
  const m = await page.evaluate(() => {
    const r = (el: Element | null) => {
      const b = el!.getBoundingClientRect();
      return { left: b.left, right: b.right, width: b.width };
    };
    // The visible collapsed shape inside the window surface (the shell's own `shown` rect).
    const companion = document.querySelector('.companion') as HTMLElement;
    const box = companion.getBoundingClientRect();
    const css = getComputedStyle(companion);
    const shownX = parseFloat(css.getPropertyValue('--header-wing-left')) - 6;
    const shownWidth = parseFloat(css.getPropertyValue('--floating-header-width'));
    const surface = {
      left: box.left + shownX,
      right: box.left + shownX + shownWidth,
      width: shownWidth,
    };
    const glyphs = Array.from(document.querySelectorAll('.notch-status-glyph')).map((el) => r(el));
    return {
      shell: surface,
      camera: r(document.querySelector('[data-testid="dock-camera-exclusion"]')),
      grip: r(document.querySelector('.dock-grip')),
      glyphs,
    };
  });
  const groups = m.glyphs.length;
  const wing = Math.max(DOCK_NOTCH_MIN_WING_WIDTH, dockCompactWingWidth(groups));
  const left = m.camera.left - m.shell.left;
  const right = m.shell.right - m.camera.right;
  const gaps = m.glyphs.slice(1).map((g, i) => Math.round((g.left - m.glyphs[i]!.right) * 10) / 10);
  const inset = m.shell.right - m.glyphs[groups - 1]!.right;
  const cameraClear = m.glyphs[0]!.left - m.camera.right;
  expect(groups).toBeGreaterThan(1);
  expect(Math.abs(right - wing)).toBeLessThan(1);
  expect(Math.abs(left - wing)).toBeLessThan(1);
  expect(Math.abs(inset - 8)).toBeLessThan(0.6);
  for (const gap of gaps) expect(Math.abs(gap - 3)).toBeLessThan(0.6);
  expect(cameraClear).toBeGreaterThanOrEqual(3.5);
  expect(m.grip.right).toBeLessThanOrEqual(m.camera.left + 0.5);
  await component.screenshot({ path: info.outputPath('18-notch-collapsed-many-status.png') });
  const before = 12 + groups * 12 + 6 * (groups - 1) + 4;
  await writeFile(
    info.outputPath('notch-compact-receipt.json'),
    JSON.stringify(
      {
        groups,
        wingBefore: Math.max(36, before),
        wingAfter: wing,
        collapsedWidthBefore: Math.round(m.camera.width + 2 * Math.max(36, before)),
        collapsedWidthAfter: Math.round(m.camera.width + 2 * wing),
        measured: { leftWing: left, rightWing: right, statusInset: inset, gaps, cameraClear },
      },
      null,
      2,
    ),
  );
});
