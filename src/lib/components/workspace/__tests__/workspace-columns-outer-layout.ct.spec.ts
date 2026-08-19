import { expect, test } from '@playwright/experimental-ct-svelte';
import WorkspaceColumnsOuterLayoutHarness from './mocks/WorkspaceColumnsOuterLayoutHarness.svelte';

test('shows token elevation only after real horizontal overlap in light, dark, and zoomed geometry', async ({
  mount,
}) => {
  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      const component = await mount(WorkspaceColumnsOuterLayoutHarness, {
        props: { theme, zoom, count: 3, viewportWidth: 760 },
      });
      const frame = component.locator('[data-sidebar-panel-frame]');
      const scroller = component.locator('[data-workspace-columns]');
      const before = await frame.boundingBox();
      const origin = await frame.evaluate((node) => {
        const style = getComputedStyle(node, '::after');
        return { opacity: style.opacity, boxShadow: style.boxShadow };
      });
      expect(origin.opacity).toBe('0');
      expect(origin.boxShadow).not.toBe('none');

      await scroller.evaluate((node) => {
        node.scrollLeft = 120;
        node.dispatchEvent(new Event('scroll'));
      });
      await expect(frame).toHaveClass(/workspace-columns-overlap/);
      await expect
        .poll(() => frame.evaluate((node) => getComputedStyle(node, '::after').opacity))
        .toBe('1');
      expect(await frame.boundingBox()).toEqual(before);
      expect(
        await frame.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return node.contains(
            document.elementFromPoint(box.right - 0.5, box.top + box.height / 2),
          );
        }),
      ).toBe(true);
      expect(await frame.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
        'rgba(0, 0, 0, 0)',
      );

      await scroller.evaluate((node) => {
        node.scrollLeft = 0;
        node.dispatchEvent(new Event('scroll'));
      });
      await expect(frame).not.toHaveClass(/workspace-columns-overlap/);
      await component.unmount();
    }
  }
});

test('keeps the global sidebar transparent while the tab workspace paints its surface', async ({
  mount,
}) => {
  for (const theme of ['light', 'dark'] as const) {
    const component = await mount(WorkspaceColumnsOuterLayoutHarness, {
      props: { mode: 'tab', theme },
    });
    await expect
      .poll(() =>
        component
          .locator('[data-global-sidebar]')
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .toBe('rgba(0, 0, 0, 0)');
    const tabSurface = component.locator('[data-tab-workspace-surface]');
    expect(await tabSurface.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
    await component.unmount();
  }
});

test('preserves card elevation, shared gaps, end padding, and stack edges at scroll extremes', async ({
  mount,
}) => {
  for (const props of [
    { count: 1, stacked: false, viewportWidth: 1100 },
    { count: 3, stacked: false, viewportWidth: 760 },
    { count: 3, stacked: true, viewportWidth: 620 },
  ]) {
    const component = await mount(WorkspaceColumnsOuterLayoutHarness, { props });
    const scroller = component.locator('[data-workspace-columns]');
    const track = component.locator('[data-columns-track]');
    const cards = component.locator('[data-workspace-column]');
    const first = await cards.first().boundingBox();
    const scrollerBox = await scroller.boundingBox();
    const inlineGeometry = await track.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        startPadding: style.paddingInlineStart,
        endPadding: style.paddingInlineEnd,
      };
    });
    expect(inlineGeometry).toEqual({ startPadding: '8px', endPadding: '8px' });
    expect(first!.x - scrollerBox!.x).toBeCloseTo(8, 1);
    expect(first!.y).toBeGreaterThanOrEqual(scrollerBox!.y + 8);
    expect(await cards.first().evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(
      'none',
    );
    const cardColor = await cards
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(
      await component
        .locator('[data-workspace-panel-canvas]')
        .first()
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe(cardColor);
    expect(await track.evaluate((node) => getComputedStyle(node).columnGap)).toBe('12px');

    await scroller.evaluate((node) => (node.scrollLeft = node.scrollWidth));
    const last = await component.locator('[data-workspace-directory-column]').boundingBox();
    const endScrollerBox = await scroller.boundingBox();
    const lastRight = last!.x + last!.width;
    const scrollerRight = endScrollerBox!.x + endScrollerBox!.width;
    expect(lastRight).toBeLessThanOrEqual(scrollerRight - 8 + 1);
    expect(lastRight).toBeGreaterThanOrEqual(scrollerRight - 8 - 1);
    expect(await cards.first().getAttribute('draggable')).toBe('true');
    await component.unmount();
  }
});

test('keeps persisted visible sidebar widths stable through remount and reactive resize', async ({
  mount,
}) => {
  for (const environment of [
    { count: 1, stacked: false, viewportWidth: 1100, theme: 'dark' as const, zoom: 1 },
    { count: 3, stacked: true, viewportWidth: 620, theme: 'light' as const, zoom: 2 },
  ]) {
    for (const state of [
      { persistedWidth: 280, collapsed: true },
      { persistedWidth: 360, collapsed: false },
      { persistedWidth: 340, collapsed: false },
      { persistedWidth: 280, collapsed: false },
      { persistedWidth: 400, collapsed: false },
    ]) {
      const props = { ...state, ...environment };
      const component = await mount(WorkspaceColumnsOuterLayoutHarness, { props });
      const width = await component
        .locator('[data-workspace-sidebar]')
        .first()
        .evaluate((node) => node.getBoundingClientRect().width);
      expect(width).toBe(state.collapsed ? 0 : state.persistedWidth);
      await component.unmount();

      const restored = await mount(WorkspaceColumnsOuterLayoutHarness, { props });
      await expect
        .poll(() =>
          restored
            .locator('[data-workspace-sidebar]')
            .first()
            .evaluate((node) => node.getBoundingClientRect().width),
        )
        .toBe(width);
      await restored.update({
        props: { ...props, persistedWidth: state.collapsed ? 280 : 400 },
      });
      await expect
        .poll(() =>
          restored
            .locator('[data-workspace-sidebar]')
            .first()
            .evaluate((node) => node.getBoundingClientRect().width),
        )
        .toBe(state.collapsed ? 0 : 400);
      await restored.unmount();
    }
  }
});

test('reveals first and last workspaces across the visual-state matrix', async ({
  mount,
  page,
}) => {
  test.setTimeout(120_000);
  const cases = [
    { theme: 'light' as const, zoom: 1, viewportWidth: 1100, stacked: false, reduced: false },
    { theme: 'dark' as const, zoom: 1, viewportWidth: 620, stacked: true, reduced: true },
    { theme: 'light' as const, zoom: 2, viewportWidth: 620, stacked: false, reduced: true },
    { theme: 'dark' as const, zoom: 2, viewportWidth: 1100, stacked: true, reduced: false },
  ];

  for (const state of cases) {
    await page.emulateMedia({ reducedMotion: state.reduced ? 'reduce' : 'no-preference' });
    await page.evaluate((zoom) => (document.documentElement.style.zoom = String(zoom)), state.zoom);
    const component = await mount(WorkspaceColumnsOuterLayoutHarness, {
      props: { ...state, count: 4 },
    });
    const scroller = component.locator('[data-workspace-columns]');
    const first = component.locator('[data-workspace-column="0"]');
    const last = component.locator('[data-workspace-column="3"]');
    const revealInset = 8 * state.zoom;

    const startBox = await scroller.boundingBox();
    const firstBox = await first.boundingBox();
    expect(firstBox!.x - startBox!.x).toBeCloseTo(revealInset, 1);

    await component.locator('[data-reveal-last]').evaluate((node) => (node as HTMLElement).click());
    await expect
      .poll(async () => {
        const [scrollerBox, lastBox] = await Promise.all([
          scroller.boundingBox(),
          last.boundingBox(),
        ]);
        return lastBox!.x - scrollerBox!.x;
      })
      .toBeCloseTo(revealInset, 1);
    const lastExtent = await scroller.evaluate((node) => ({
      scrollLeft: node.scrollLeft,
      maxScrollLeft: node.scrollWidth - node.clientWidth,
    }));
    expect(lastExtent.scrollLeft).toBeLessThanOrEqual(lastExtent.maxScrollLeft);

    await component
      .locator('[data-reveal-first]')
      .evaluate((node) => (node as HTMLElement).click());
    await expect.poll(() => scroller.evaluate((node) => node.scrollLeft)).toBeCloseTo(0, 1);

    if (state.stacked) {
      const stackedXs = await Promise.all(
        ['0', '1'].map((id) =>
          component
            .locator(`[data-workspace-column="${id}"]`)
            .evaluate((node) => node.getBoundingClientRect().x),
        ),
      );
      expect(stackedXs[0]).toBeCloseTo(stackedXs[1], 1);
    }
    await component.unmount();
  }
  await page.evaluate(() => (document.documentElement.style.zoom = ''));
});
