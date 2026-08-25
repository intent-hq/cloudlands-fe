import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import WorkspaceColumnsRevealHarness from './mocks/WorkspaceColumnsRevealHarness.svelte';

async function requireReadyHarness(component: Locator, page: Page) {
  const host = component;
  const ready = host.and(page.locator('[data-reveal-host][data-reveal-ready="true"]'));
  const initializationError = component.locator(
    '[data-reveal-initialization-error], [data-reveal-boundary-error]',
  );
  await expect(host).toBeVisible();
  await expect(ready.or(initializationError)).toBeAttached({ timeout: 15_000 });
  if (await initializationError.count()) {
    throw new Error(
      `WorkspaceColumnsRevealHarness initialization failed: ${await initializationError.first().textContent()}`,
    );
  }
  return host;
}

async function expectFocusedPanelVisible(component: Locator) {
  const state = component.locator('[data-reveal-state]');
  const scroller = component.locator('[data-workspace-columns]');
  await expect(state).toHaveAttribute('data-pending-panel-reveal', '');
  await component.evaluate(async () => {
    for (let frame = 0; frame < 5; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  });
  const panelId = await state.getAttribute('data-focused-panel-id');
  const workspaceId = await state.getAttribute('data-workspace-id');
  const target = component.locator(
    `[data-workspace-column="${workspaceId}"] [data-panel-id="${panelId}"]`,
  );
  await expect(target).toBeVisible();
  // The reveal logic aligns panels to the inset content box declared through
  // data-workspace-reveal-inset / scroll-padding-inline, so measure against
  // that reveal viewport rather than the raw scroller edges.
  const inset = await scroller.evaluate((node) => {
    const explicit = Number.parseFloat((node as HTMLElement).dataset.workspaceRevealInset ?? '');
    if (!Number.isFinite(explicit)) return 0;
    const scale = node.getBoundingClientRect().width / (node as HTMLElement).offsetWidth || 1;
    return explicit * scale;
  });
  await expect
    .poll(async () => {
      const [scrollerBox, panel] = await Promise.all([
        scroller.boundingBox(),
        target.boundingBox(),
      ]);
      const viewport = {
        x: scrollerBox!.x + inset,
        width: scrollerBox!.width - inset * 2,
      };
      const viewportRight = viewport.x + viewport.width;
      const panelRight = panel!.x + panel!.width;
      if (panel!.width > viewport.width) {
        if (panel!.x < viewport.x && panelRight > viewportRight) return 0;
        if (panelRight > viewportRight) return panel!.x - viewport.x;
        if (panel!.x < viewport.x) return panelRight - viewportRight;
        return 0;
      }
      if (panel!.x < viewport.x) return panel!.x - viewport.x;
      if (panelRight > viewportRight) return panelRight - viewportRight;
      return 0;
    })
    .toBeCloseTo(0, 0);
}

async function expectNavigatorGeometryWithinHalfDevicePixel(component: Locator, page: Page) {
  await expect
    .poll(async () => {
      const geometryError = await component.evaluate((root) => {
        const panels = [...root.querySelectorAll<HTMLElement>('[data-panel-id]')];
        const viewport = root.querySelector<HTMLElement>('[data-workspace-columns]');
        const track = root.querySelector<HTMLElement>('.panel-navigator-track');
        const thumb = root.querySelector<HTMLElement>('[data-panel-navigator-thumb]');
        if (panels.length < 2 || !viewport || !track || !thumb) return Number.POSITIVE_INFINITY;
        const trackRect = track.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        const contentLeft = Math.min(...panels.map((panel) => panel.getBoundingClientRect().left));
        const contentRight = Math.max(
          ...panels.map((panel) => panel.getBoundingClientRect().right),
        );
        const contentWidth = contentRight - contentLeft;
        const expectedThumbLeft =
          trackRect.left +
          ((Math.max(contentLeft, viewportRect.left) - contentLeft) / contentWidth) *
            trackRect.width;
        const expectedThumbRight =
          expectedThumbLeft +
          (Math.max(
            0,
            Math.min(contentRight, viewportRect.right) - Math.max(contentLeft, viewportRect.left),
          ) /
            contentWidth) *
            trackRect.width;
        const thumbRect = thumb.getBoundingClientRect();
        const segmentErrors = panels.map((panel) => {
          const panelRect = panel.getBoundingClientRect();
          const segment = root.querySelector<HTMLElement>(
            `[data-panel-navigator-segment="${panel.dataset.panelId}"]`,
          );
          if (!segment) return Number.POSITIVE_INFINITY;
          const segmentRect = segment.getBoundingClientRect();
          const expectedLeft =
            trackRect.left + ((panelRect.left - contentLeft) / contentWidth) * trackRect.width;
          const expectedRight =
            trackRect.left + ((panelRect.right - contentLeft) / contentWidth) * trackRect.width;
          return Math.max(
            Math.abs(segmentRect.left - expectedLeft),
            Math.abs(segmentRect.right - expectedRight),
          );
        });
        return Math.max(
          ...segmentErrors,
          Math.abs(thumbRect.left - expectedThumbLeft),
          Math.abs(thumbRect.right - expectedThumbRight),
        );
      });
      return geometryError * (await page.evaluate(() => devicePixelRatio));
    })
    .toBeLessThanOrEqual(0.5);
}

test('fully reveals and consumes an equivalent panel request at 200% zoom', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceColumnsRevealHarness, {
    props: { viewportWidth: 400, zoom: 2, workspaceKey: 'equivalent' },
  });
  const host = await requireReadyHarness(component, page);
  const state = component.locator('[data-reveal-state]');
  const scroller = component.locator('[data-workspace-columns]');
  const targetPanelId = await state.getAttribute('data-target-panel-id');
  const target = component.locator(`[data-panel-id="${targetPanelId}"]`);

  await expect(target).toBeVisible();
  expect(await host.evaluate((node) => node.getBoundingClientRect().width)).toBe(800);
  const before = await Promise.all([scroller.boundingBox(), target.boundingBox()]);
  expect(before[1]!.x + before[1]!.width).toBeGreaterThan(before[0]!.x + before[0]!.width + 1);

  await component.locator('[data-reveal-trigger]').click();
  await expect(state).toHaveAttribute('data-saw-pending-reveal', 'true');
  await expect(state).toHaveAttribute('data-pending-panel-reveal', '');
  await expect
    .poll(async () => {
      const [viewport, panel] = await Promise.all([scroller.boundingBox(), target.boundingBox()]);
      return {
        leftVisible: panel!.x >= viewport!.x - 1,
        rightVisible: panel!.x + panel!.width <= viewport!.x + viewport!.width + 1,
      };
    })
    .toEqual({ leftVisible: true, rightVisible: true });
  expect(await scroller.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await expect(component.locator('[data-panel-id]')).toHaveCount(2);
});

test('renders proportional segments and activates the canonical reveal path', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceColumnsRevealHarness, {
    props: { viewportWidth: 400, zoom: 2, workspaceKey: 'navigator' },
  });
  await requireReadyHarness(component, page);
  const navigator = component.locator('[data-panel-navigator]');
  const segments = navigator.locator('[data-panel-navigator-segment]');
  await expect(navigator).toBeVisible();
  await expect(segments).toHaveCount(2);

  await expectNavigatorGeometryWithinHalfDevicePixel(component, page);

  const restingNavigatorSize = await navigator.evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
  }));
  await segments.nth(1).hover();
  await expect(segments.nth(1)).toHaveAttribute('title', /.+/);
  expect(
    await navigator.evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
    })),
  ).toEqual(restingNavigatorSize);
  await segments.nth(1).focus();
  expect((await segments.nth(1).boundingBox())?.height).toBeCloseTo(restingNavigatorSize.height, 1);
  await segments.nth(1).press('Enter');
  await expect(segments.nth(1)).toHaveAttribute('aria-current', 'page');
  await expectFocusedPanelVisible(component);
  await segments.nth(0).focus();
  await segments.nth(0).press('Space');
  await expect(segments.nth(0)).toHaveAttribute('aria-current', 'page');
  await expectFocusedPanelVisible(component);
  await segments.nth(1).click();
  await expectFocusedPanelVisible(component);
});

test('updates geometry for fit, overflow, scroll, resize, open, close, and reorder', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.classList.add('light'));
  const component = await mount(WorkspaceColumnsRevealHarness, {
    props: { viewportWidth: 1200, zoom: 1, workspaceKey: 'navigator-updates' },
  });
  await requireReadyHarness(component, page);
  const navigator = component.locator('[data-panel-navigator]');
  const thumb = navigator.locator('[data-panel-navigator-thumb]');
  const segments = navigator.locator('[data-panel-navigator-segment]');

  await expect(segments).toHaveCount(2);
  await expect
    .poll(() => thumb.evaluate((node) => node.getBoundingClientRect().width))
    .toBeGreaterThan(0);
  const fitRatio = await Promise.all([
    thumb.evaluate((node) => node.getBoundingClientRect().width),
    navigator
      .locator('.panel-navigator-track')
      .evaluate((node) => node.getBoundingClientRect().width),
  ]);
  expect(fitRatio[0]).toBeCloseTo(fitRatio[1], 0);
  await expectNavigatorGeometryWithinHalfDevicePixel(component, page);

  await component.update({
    props: { viewportWidth: 400, zoom: 1, workspaceKey: 'navigator-updates' },
  });
  await expect
    .poll(() => thumb.evaluate((node) => node.getBoundingClientRect().width))
    .toBeLessThan(fitRatio[0]);
  const thumbLeftBeforeScroll = await thumb.evaluate((node) => node.getBoundingClientRect().left);
  await component.locator('[data-workspace-columns]').evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect
    .poll(() => thumb.evaluate((node) => node.getBoundingClientRect().left))
    .toBeGreaterThan(thumbLeftBeforeScroll);
  await expectNavigatorGeometryWithinHalfDevicePixel(component, page);

  await component.locator('[data-mix-panel-widths]').click();
  await expect
    .poll(async () => {
      const widths = await segments.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().width),
      );
      return Math.abs(widths[0] - widths[1]);
    })
    .toBeGreaterThan(20);
  const mixedWidths = await segments.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().width),
  );
  expect(Math.abs(mixedWidths[0] - mixedWidths[1])).toBeGreaterThan(20);
  await expectNavigatorGeometryWithinHalfDevicePixel(component, page);

  await component.locator('[data-open-agent]').click();
  await expect(segments).toHaveCount(3);
  await expectNavigatorGeometryWithinHalfDevicePixel(component, page);
  await component.locator('[data-close-extra-panel]').click();
  await expect(segments).toHaveCount(2);
  await expectNavigatorGeometryWithinHalfDevicePixel(component, page);

  await component.locator('[data-reorder-panels]').click();
  const targetPanelId = await component
    .locator('[data-reveal-state]')
    .getAttribute('data-target-panel-id');
  await expect(segments.first()).toHaveAttribute('data-panel-navigator-segment', targetPanelId!);
  await expectNavigatorGeometryWithinHalfDevicePixel(component, page);

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => {
      document.documentElement.classList.toggle('dark', value === 'dark');
      document.documentElement.classList.toggle('light', value === 'light');
    }, theme);
    await expect
      .poll(() =>
        segments
          .first()
          .locator('.panel-navigator-tile')
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .not.toBe('rgba(0, 0, 0, 0)');
  }
  expect(
    await segments
      .first()
      .locator('.panel-navigator-tile')
      .evaluate((node) => {
        const durations = getComputedStyle(node).transitionDuration.split(',');
        return Math.max(
          ...durations.map((duration) =>
            duration.endsWith('ms')
              ? Number.parseFloat(duration) / 1000
              : Number.parseFloat(duration),
          ),
        );
      }),
  ).toBeLessThanOrEqual(0.00001);

  await component.update({
    props: { viewportWidth: 400, zoom: 2, workspaceKey: 'navigator-updates' },
  });
  await expectNavigatorGeometryWithinHalfDevicePixel(component, page);
});

for (const route of [
  { name: 'file', trigger: '[data-open-file]', expectedPanelCount: '3' },
  { name: 'note', trigger: '[data-open-note]', expectedPanelCount: '3' },
  { name: 'agent', trigger: '[data-open-agent]', expectedPanelCount: '3' },
  { name: 'changes', trigger: '[data-open-changes]', expectedPanelCount: '2' },
]) {
  test(`production ${route.name} open reveals its final panel at 400px and 200% zoom`, async ({
    mount,
    page,
  }) => {
    const component = await mount(WorkspaceColumnsRevealHarness, {
      props: { viewportWidth: 400, zoom: 2, workspaceKey: route.name },
    });
    await requireReadyHarness(component, page);
    const state = component.locator('[data-reveal-state]');
    await component.locator(route.trigger).click();
    await expect(state).toHaveAttribute('data-saw-pending-reveal', 'true');
    await expect(state).toHaveAttribute('data-panel-count', route.expectedPanelCount);
    await expectFocusedPanelVisible(component);
  });
}

test('explicit existing-panel focus reveals with minimum horizontal movement', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceColumnsRevealHarness, {
    props: { viewportWidth: 400, zoom: 2, workspaceKey: 'existing-focus' },
  });
  await requireReadyHarness(component, page);
  const scroller = component.locator('[data-workspace-columns]');
  const verticalBefore = await scroller.evaluate((node) => node.scrollTop);
  await component.locator('[data-focus-panel]').click();
  await expectFocusedPanelVisible(component);
  expect(await scroller.evaluate((node) => node.scrollTop)).toBe(verticalBefore);
  const workspaceId = await component
    .locator('[data-reveal-state]')
    .getAttribute('data-workspace-id');
  await expect(
    component.locator(`[data-workspace-column="${workspaceId}"] [data-panel-id]`),
  ).toHaveCount(2);
});

test('keeps a long production Markdown file open vertically contained', async ({ mount, page }) => {
  const component = await mount(WorkspaceColumnsRevealHarness, {
    props: { viewportWidth: 400, zoom: 1, workspaceKey: 'long-markdown', standalone: true },
  });
  await requireReadyHarness(component, page);
  const state = component.locator('[data-reveal-state]');

  const measure = () =>
    component.evaluate((root) => {
      const panels = [...root.querySelectorAll<HTMLElement>('[data-panel-id]')];
      const panel = panels.at(-1) ?? null;
      const inset = panel?.closest('[data-testid="panel-workspace-inset"]') as HTMLElement | null;
      const markdown = panel?.querySelector<HTMLElement>('.markdown-file-editor') ?? null;
      const outerScrollHost = root.querySelector<HTMLElement>(
        '[data-testid="production-workspace-scroll-host"]',
      );
      const panelRect = panel?.getBoundingClientRect();
      return {
        windowScrollY: window.scrollY,
        documentScrollHeight: document.documentElement.scrollHeight,
        documentClientHeight: document.documentElement.clientHeight,
        outerScrollTop: outerScrollHost?.scrollTop ?? null,
        outerScrollHeight: outerScrollHost?.scrollHeight ?? null,
        outerClientHeight: outerScrollHost?.clientHeight ?? null,
        outerOverflowY: outerScrollHost ? getComputedStyle(outerScrollHost).overflowY : null,
        columnsScrollTop: (root.querySelector('[data-workspace-columns]') as HTMLElement | null)
          ?.scrollTop,
        insetScrollTop: inset?.scrollTop ?? null,
        panelTop: panelRect?.top ?? null,
        panelBottom: panelRect?.bottom ?? null,
        panelHeight: panelRect?.height ?? null,
        markdownScrollHeight: markdown?.scrollHeight ?? null,
        markdownClientHeight: markdown?.clientHeight ?? null,
      };
    });

  const before = await measure();
  await component.locator('[data-open-readme]').click();
  await expect(state).toHaveAttribute('data-panel-count', '3');
  await expect(state).toHaveAttribute('data-pending-panel-reveal', '');
  await expect(component.locator('[data-panel-id]').last()).toBeVisible();
  const afterOpen = await measure();
  await component.locator('[data-resolve-readme]').click();
  await expect(component.locator('.markdown-file-editor')).toBeVisible();
  await expect
    .poll(() => component.locator('.markdown-file-editor').evaluate((node) => node.scrollHeight))
    .toBeGreaterThan(2_000);
  const afterLoad = await measure();

  console.log(JSON.stringify({ before, afterOpen, afterLoad }, null, 2));
  expect(afterOpen.windowScrollY).toBe(before.windowScrollY);
  expect(afterLoad.windowScrollY).toBe(before.windowScrollY);
  expect(afterOpen.outerScrollTop).toBe(before.outerScrollTop);
  expect(afterLoad.outerScrollTop).toBe(before.outerScrollTop);
  expect(afterLoad.outerOverflowY).toBe('hidden');
  expect(afterOpen.outerScrollHeight).toBe(before.outerScrollHeight);
  expect(afterLoad.outerScrollHeight).toBe(before.outerScrollHeight);
  expect(afterLoad.outerClientHeight).toBe(before.outerClientHeight);
  expect(afterOpen.columnsScrollTop).toBe(before.columnsScrollTop);
  expect(afterLoad.columnsScrollTop).toBe(before.columnsScrollTop);
  expect(afterOpen.documentScrollHeight).toBe(before.documentScrollHeight);
  expect(afterLoad.documentScrollHeight).toBe(before.documentScrollHeight);
  expect(afterLoad.markdownScrollHeight).toBeGreaterThan(afterLoad.markdownClientHeight!);
});

test('panel removal cancels a scheduled reveal without recreating the panel', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceColumnsRevealHarness, {
    props: { viewportWidth: 400, zoom: 2, workspaceKey: 'removal' },
  });
  await requireReadyHarness(component, page);
  const state = component.locator('[data-reveal-state]');
  await component.locator('[data-remove-panel]').click();
  await expect(state).toHaveAttribute('data-pending-panel-reveal', '');
  await expect(state).toHaveAttribute('data-panel-count', '1');
  const targetPanelId = await state.getAttribute('data-target-panel-id');
  await expect(component.locator(`[data-panel-id="${targetPanelId}"]`)).toHaveCount(0);
});
