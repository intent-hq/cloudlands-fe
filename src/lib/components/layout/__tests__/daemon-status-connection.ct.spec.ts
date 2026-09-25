import { expect, test } from '../../../../test/ct-test';
import DaemonStatusIndicator from '../DaemonStatusIndicator.svelte';

const scenarios = [
  { state: 'healthy', lines: 1, fullValue: true },
  { state: 'remote-route', lines: 2, fullValue: true },
  { state: 'long-endpoint', lines: 2, fullValue: false },
];

for (const { state, lines, fullValue } of scenarios) {
  test(`Connection details stay readable and contained: ${state}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(DaemonStatusIndicator, {
      hooksConfig: { geometrySnapshot: { scene: 'daemon-status-indicator', state } },
    });
    await page.getByRole('button').click();
    await page.getByRole('menuitem', { name: /^Status -/ }).press('ArrowRight');
    const panel = page.getByRole('region', { name: 'Daemon Status', exact: true });
    await expect(panel).toBeVisible();
    await panel.evaluate((element) =>
      window.__INTENT_GEOMETRY_CT__.waitForCaptureStability(element),
    );
    const row = panel.getByText('Connection', { exact: true }).locator('..');
    const value = row.locator('[title]');
    const geometry = await value.evaluate((element) => {
      const box = (node: Element) => {
        const { left, right, top, bottom, height } = node.getBoundingClientRect();
        return { left, right, top, bottom, height };
      };
      const range = document.createRange();
      range.selectNodeContents(element);
      const textLines = Array.from(range.getClientRects(), (rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })).filter(
        (rect, index, rects) => index === 0 || Math.abs(rect.top - rects[index - 1].top) > 1,
      );
      const panel = element.closest('section')!;
      return {
        value: box(element),
        label: box(element.previousElementSibling!),
        row: box(element.parentElement!),
        panel: box(panel),
        lineHeight: parseFloat(getComputedStyle(element).lineHeight),
        textLines,
        valueOverflowsX: element.scrollWidth > element.clientWidth,
        panelOverflowsX: panel.scrollWidth > panel.clientWidth,
      };
    });
    await testInfo.attach('connection-layout.json', {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('expanded-status-panel.png', {
      body: await panel.screenshot(),
      contentType: 'image/png',
    });

    expect(geometry.panelOverflowsX).toBe(false);
    expect(geometry.valueOverflowsX).toBe(false);
    expect(geometry.label.right).toBeLessThan(geometry.value.left);
    expect(geometry.value.right).toBeLessThanOrEqual(geometry.row.right + 1);
    expect(geometry.row.right).toBeLessThanOrEqual(geometry.panel.right);
    expect(geometry.value.height / geometry.lineHeight).toBeCloseTo(lines, 1);

    const visibleLines = geometry.textLines.filter(
      (line) => line.top >= geometry.value.top - 1 && line.bottom <= geometry.value.bottom + 1,
    );
    expect(visibleLines).toHaveLength(lines);
    for (const line of visibleLines) {
      expect(line.left).toBeGreaterThanOrEqual(geometry.value.left - 1);
      expect(Math.abs(line.right - geometry.value.right)).toBeLessThanOrEqual(1);
    }
    if (fullValue) {
      // Every line, including the route suffix, must be inside the visible box.
      expect(geometry.textLines).toHaveLength(lines);
      expect(geometry.textLines.at(-1)!.bottom).toBeLessThanOrEqual(geometry.value.bottom + 1);
    } else {
      expect(geometry.textLines.length).toBeGreaterThan(lines);
      await expect(value).toHaveAttribute('title', (await value.textContent())!);
    }
  });
}
