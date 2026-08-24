import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import PanelWorkspaceColumnClipHarness from './mocks/PanelWorkspaceColumnClipHarness.svelte';

async function shellStyles(panel: Locator, page: Page, expectedBackgroundClass = 'bg-sidebar') {
  const expected = await page.evaluate((backgroundClass) => {
    const backgroundProbe = document.createElement('div');
    backgroundProbe.className = backgroundClass;
    const borderProbe = document.createElement('div');
    borderProbe.className = 'border border-border';
    document.body.append(backgroundProbe, borderProbe);
    const background = getComputedStyle(backgroundProbe).backgroundColor;
    const border = getComputedStyle(borderProbe).borderTopColor;
    backgroundProbe.remove();
    borderProbe.remove();
    return { background, border };
  }, expectedBackgroundClass);
  return panel.evaluate((element, expected) => {
    const style = getComputedStyle(element);
    const parentStyle = getComputedStyle(element.parentElement!);
    const contentStyle = getComputedStyle(element.querySelector('.panel-content')!);
    const emptyState = element.querySelector('[data-panel-empty-state]');
    return {
      background: style.backgroundColor,
      expectedBackground: expected.background,
      expectedBorder: expected.border,
      emptyStateBackground: emptyState ? getComputedStyle(emptyState).backgroundColor : null,
      borders: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
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
      focused: element.getAttribute('data-focused'),
      focusBorderVisible: element.getAttribute('data-focus-border-visible'),
    };
  }, expected);
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
        for (const [index, panel] of (await panels.all()).entries()) {
          const styles = await shellStyles(panel, page);
          expect(styles.background).toBe(styles.expectedBackground);
          expect(styles.emptyStateBackground).toBe(styles.expectedBackground);
          expect(styles.borders).toEqual(['0px', '0px', '0px', '0px']);
          expect(styles.focused).toBe(index === 0 ? 'true' : 'false');
          expect(styles.focusBorderVisible).toBe(index === 0 ? 'true' : 'false');
          if (index === 0) expect(styles.outlineColor).toBe(styles.expectedBorder);
          expect(styles.outlineOffset).toBe(index === 0 ? '-1px' : '0px');
          expect(styles.outlineStyle).toBe(index === 0 ? 'solid' : 'none');
          expect(styles.outlineWidth).toBe(index === 0 ? '1px' : '0px');
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

for (const theme of ['light', 'dark'] as const) {
  test(`keeps populated panels on the approved surface in ${theme} at 200% zoom`, async ({
    mount,
    page,
  }) => {
    const component = await mount(PanelWorkspaceColumnClipHarness, {
      props: {
        sidebarWidth: 280,
        canvasWidth: 760,
        zoomFactor: 2,
        panelTypes: ['note', 'note'],
      },
    });
    await component.evaluate((node, mode) => {
      document.documentElement.classList.toggle('dark', mode === 'dark');
      node.setAttribute('data-test-theme', mode);
    }, theme);

    for (const [index, panel] of (await component.locator('.panel').all()).entries()) {
      const styles = await shellStyles(panel, page, 'bg-background');
      expect(styles.background).toBe(styles.expectedBackground);
      expect(styles.emptyStateBackground).toBeNull();
      expect(styles.borders).toEqual(['0px', '0px', '0px', '0px']);
      expect(styles.focused).toBe(index === 0 ? 'true' : 'false');
      expect(styles.focusBorderVisible).toBe(index === 0 ? 'true' : 'false');
      if (index === 0) expect(styles.outlineColor).toBe(styles.expectedBorder);
      expect(styles.outlineOffset).toBe(index === 0 ? '-1px' : '0px');
      expect(styles.outlineStyle).toBe(index === 0 ? 'solid' : 'none');
      expect(styles.outlineWidth).toBe(index === 0 ? '1px' : '0px');
      expect(styles.ownsEmptySurface).toBeNull();
    }
  });
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
