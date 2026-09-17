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
      focused: element.getAttribute('data-focused'),
      focusBorderVisible: element.getAttribute('data-focus-border-visible'),
      shadow: style.boxShadow,
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
          expect(styles.borders).toEqual(['1px', '1px', '1px', '1px']);
          expect(styles.focused).toBe(index === 0 ? 'true' : 'false');
          expect(styles.focusBorderVisible).toBe(index === 0 ? 'true' : 'false');
          expect(new Set(styles.borderColors)).toEqual(
            new Set([index === 0 ? styles.expectedBorder : 'rgba(0, 0, 0, 0)']),
          );
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
          await handle
            .locator('xpath=ancestor::*[contains(@class, "panel-split-handle-wrapper")][1]')
            .evaluate((node) => getComputedStyle(node).width),
        ).toBe('8px');
      });
    }
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const pristine of [true, false]) {
    test(`preserves empty header and content geometry through keyboard and pointer focus in ${theme}, pristine=${pristine}`, async ({
      mount,
      page,
    }) => {
      await page.setViewportSize({ width: 1100, height: 600 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark',
      );
      const component = await mount(PanelWorkspaceColumnClipHarness, {
        props: { sidebarWidth: 120, canvasWidth: 800, pristine },
      });
      const panels = component.locator('.panel');
      const children = component.locator(
        '[data-panel-header], .panel-content, [data-panel-empty-state]',
      );
      await expect(panels).toHaveCount(2);
      await expect(children).toHaveCount(6);
      await page.evaluate(() => document.fonts.ready);
      const bounds = () =>
        children.evaluateAll(async (nodes) => {
          // Container-query layout settles on the next render after focus styles change.
          await new Promise<number>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return nodes.map((node) => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height };
          });
        });
      await panels.first().click({ position: { x: 20, y: 90 } });
      await expect(panels.first()).toHaveAttribute('data-focused', 'true');
      await component.locator('.panel-split-handle').focus();
      const before = await bounds();
      await page.keyboard.press('Tab');
      await expect(panels.nth(1).locator('[data-add-panel-column]')).toBeFocused();
      await expect(panels.nth(1)).toHaveAttribute('data-focused', 'true');
      expect(await bounds()).toEqual(before);
      for (const [index, panel] of (await panels.all()).entries()) {
        const style = await shellStyles(panel, page);
        expect(style.borders).toEqual(['1px', '1px', '1px', '1px']);
        expect(new Set(style.borderColors)).toEqual(
          new Set([index === 1 ? style.expectedBorder : 'rgba(0, 0, 0, 0)']),
        );
        expect(style.background).toBe(style.expectedBackground);
        expect(style.emptyStateBackground).toBe(style.expectedBackground);
        expect(style.shadow).toBe('none');
      }
      await panels.first().click({ position: { x: 20, y: 90 } });
      await expect(panels.first()).toHaveAttribute('data-focused', 'true');
      expect(await bounds()).toEqual(before);
    });
  }

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
      expect(styles.borders).toEqual(['1px', '1px', '1px', '1px']);
      expect(styles.focused).toBe(index === 0 ? 'true' : 'false');
      expect(styles.focusBorderVisible).toBe(index === 0 ? 'true' : 'false');
      expect(new Set(styles.borderColors)).toEqual(
        new Set([index === 0 ? styles.expectedBorder : 'rgba(0, 0, 0, 0)']),
      );
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
