import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import PanelWorkspaceColumnClipHarness from './mocks/PanelWorkspaceColumnClipHarness.svelte';

async function shellStyles(panel: Locator, page: Page) {
  const expectedBackground = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'bg-background';
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  return panel.evaluate((element, background) => {
    const style = getComputedStyle(element);
    const parentStyle = getComputedStyle(element.parentElement!);
    const contentStyle = getComputedStyle(element.querySelector('.panel-content')!);
    return {
      background: style.backgroundColor,
      expectedBackground: background,
      borders: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      borderColors: [
        style.borderTopColor,
        style.borderRightColor,
        style.borderBottomColor,
        style.borderLeftColor,
      ],
      radii: [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ],
      overflow: [style.overflowX, style.overflowY],
      contentOverflow: [contentStyle.overflowX, contentStyle.overflowY],
      parentBackground: parentStyle.backgroundColor,
      ownsEmptySurface: element.getAttribute('data-empty-panel-surface'),
    };
  }, expectedBackground);
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [640, 1280]) {
    for (const zoom of [1, 2]) {
      test(`keeps one rounded shell boundary in ${theme} at ${width}px and ${zoom * 100}% zoom`, async ({
        mount,
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        const component = await mount(PanelWorkspaceColumnClipHarness, {
          props: {
            sidebarWidth: width === 640 ? 120 : 280,
            canvasWidth: width === 640 ? 420 : 760,
            zoomFactor: zoom,
            pristine: true,
          },
        });
        await component.evaluate((node, mode) => {
          document.documentElement.classList.toggle('dark', mode === 'dark');
          node.setAttribute('data-test-theme', mode);
        }, theme);

        const panels = component.locator('.panel');
        await expect(panels).toHaveCount(2);
        for (const panel of await panels.all()) {
          const styles = await shellStyles(panel, page);
          expect(styles.background).toBe(styles.expectedBackground);
          expect(styles.borders).toEqual(['1px', '1px', '1px', '1px']);
          expect(new Set(styles.borderColors).size).toBe(1);
          expect(new Set(styles.radii).size).toBe(1);
          expect(Number.parseFloat(styles.radii[0])).toBeGreaterThan(0);
          expect(styles.overflow).toEqual(['hidden', 'hidden']);
          expect(styles.contentOverflow).toEqual(['hidden', 'hidden']);
          expect(styles.parentBackground).toBe('rgba(0, 0, 0, 0)');
          expect(styles.ownsEmptySurface).toBe('true');
        }

        const handle = component.locator('.panel-split-handle');
        await expect(handle).toBeVisible();
        expect(await handle.evaluate((node) => getComputedStyle(node).width)).toBe('16px');
        expect(
          await handle.locator('xpath=..').evaluate((node) => getComputedStyle(node).width),
        ).toBe('8px');
      });
    }
  }
}

test('keeps all four shell corners portable with an adjacent panel at 200% zoom', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: { sidebarWidth: 96, canvasWidth: 420, zoomFactor: 2, pristine: true },
  });
  await component.evaluate((node) => {
    document.documentElement.classList.add('dark');
    node.setAttribute('data-test-theme', 'dark');
  });
  const panels = component.locator('.panel');
  await expect(panels).toHaveCount(2);
  const geometry = await panels.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        radii: [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ],
      };
    }),
  );
  for (const panel of geometry) {
    expect(new Set(panel.radii).size).toBe(1);
    expect(Number.parseFloat(panel.radii[0])).toBeGreaterThan(0);
    expect(panel.top).toBeGreaterThanOrEqual(0);
    expect(panel.bottom).toBeLessThanOrEqual(900);
  }
  expect(geometry[0].right).toBeLessThanOrEqual(geometry[1].left);
});
