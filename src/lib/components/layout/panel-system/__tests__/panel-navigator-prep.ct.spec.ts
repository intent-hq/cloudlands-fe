import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import PanelNavigatorPrepHarness from './mocks/PanelNavigatorPrepHarness.svelte';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function expectGeometryWithinHalfDevicePixel(component: Locator, page: Page) {
  await expect
    .poll(async () => {
      const error = await component.evaluate((root) => {
        const panels = Array.from(root.querySelectorAll('[data-panel-id]'));
        const viewport = root.querySelector('[data-testid="panel-navigator-viewport"]');
        const track = root.querySelector('.panel-navigator-track');
        const thumb = root.querySelector('[data-panel-navigator-thumb]');
        if (!viewport || !track || !thumb || panels.length < 2) return Number.POSITIVE_INFINITY;
        const panelRects = panels.map((panel) => panel.getBoundingClientRect());
        const viewportRect = viewport.getBoundingClientRect();
        const trackRect = track.getBoundingClientRect();
        const contentLeft = Math.min(...panelRects.map(({ left }) => left));
        const contentRight = Math.max(...panelRects.map(({ right }) => right));
        const contentWidth = contentRight - contentLeft;
        const visibleLeft = Math.max(contentLeft, viewportRect.left);
        const visibleRight = Math.min(contentRight, viewportRect.right);
        const expectedThumbLeft =
          trackRect.left + ((visibleLeft - contentLeft) / contentWidth) * trackRect.width;
        const expectedThumbRight =
          expectedThumbLeft +
          (Math.max(0, visibleRight - visibleLeft) / contentWidth) * trackRect.width;
        const segmentErrors = panels.map((panel, index) => {
          const segment = root.querySelector(
            `[data-panel-navigator-segment="${panel.getAttribute('data-panel-id')}"]`,
          );
          if (!segment) return Number.POSITIVE_INFINITY;
          const segmentRect = segment.getBoundingClientRect();
          const expectedLeft =
            trackRect.left +
            ((panelRects[index].left - contentLeft) / contentWidth) * trackRect.width;
          const expectedRight =
            trackRect.left +
            ((panelRects[index].right - contentLeft) / contentWidth) * trackRect.width;
          return Math.max(
            Math.abs(segmentRect.left - expectedLeft),
            Math.abs(segmentRect.right - expectedRight),
          );
        });
        const thumbRect = thumb.getBoundingClientRect();
        return Math.max(
          ...segmentErrors,
          Math.abs(thumbRect.left - expectedThumbLeft),
          Math.abs(thumbRect.right - expectedThumbRight),
        );
      });
      return error * (await page.evaluate(() => devicePixelRatio));
    })
    .toBeLessThanOrEqual(0.5);
}

test('renders distinct panel glyphs, one active tile, and the native button keyboard model', async ({
  mount,
}) => {
  const component = await mount(PanelNavigatorPrepHarness, { props: { viewportWidth: 320 } });
  const navigator = component.getByRole('navigation', { name: 'Panel navigator' });
  const segments = navigator.getByRole('button');
  await expect(segments).toHaveCount(3);
  await expect(segments.nth(0)).toHaveAccessibleName('Chat');
  await expect(segments.nth(1)).toHaveAccessibleName(
    'A deliberately long note title for truncation',
  );
  await expect(segments.nth(1)).toHaveAttribute(
    'title',
    'A deliberately long note title for truncation',
  );
  await expect(segments.nth(0)).toHaveAttribute('data-panel-navigator-icon', 'agent');
  await expect(segments.nth(1)).toHaveAttribute('data-panel-navigator-icon', 'note');
  await expect(segments.nth(2)).toHaveAttribute('data-panel-navigator-icon', 'browser');
  expect(
    new Set(
      await segments.evaluateAll((nodes) =>
        nodes.map((node) => node.querySelector('svg path')?.getAttribute('d')),
      ),
    ).size,
  ).toBe(3);
  await expect(segments.nth(0)).toHaveAttribute('aria-current', 'page');
  await expect(segments.nth(1)).not.toHaveAttribute('aria-current', 'page');
  await expect(navigator.locator('[data-panel-navigator-thumb]')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await expect(navigator.locator('[role="scrollbar"], [role="tablist"]')).toHaveCount(0);

  await component.getByTestId('before-navigator').focus();
  await component.getByTestId('before-navigator').press('Tab');
  await expect(segments.nth(0)).toBeFocused();
  await expect(segments.nth(0)).toHaveCSS('height', '36px');
  await segments.nth(0).press('Tab');
  await expect(segments.nth(1)).toBeFocused();
  await segments.nth(1).press('Shift+Tab');
  await expect(segments.nth(0)).toBeFocused();

  await segments.nth(0).press('ArrowRight');
  await expect(segments.nth(0)).toBeFocused();
  await expect(component.getByTestId('activation-state')).toHaveText(':0');
  await segments.nth(0).press('Enter');
  await expect(segments.nth(0)).toBeFocused();
  await expect(component.getByTestId('activation-state')).toHaveText('chat:1');
  await segments.nth(1).focus();
  await segments.nth(1).press('Space');
  await expect(segments.nth(1)).toBeFocused();
  await expect(component.getByTestId('activation-state')).toHaveText('note:2');
  await expect(segments.nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(segments.nth(0)).not.toHaveAttribute('aria-current', 'page');

  // The tile background transitions over 120ms; poll until the active tile
  // has settled on a background distinct from the inactive one.
  await expect
    .poll(async () => {
      const [activeBackground, inactiveBackground] = await Promise.all([
        segments
          .nth(1)
          .locator('.panel-navigator-tile')
          .evaluate((node) => getComputedStyle(node).backgroundColor),
        segments
          .nth(2)
          .locator('.panel-navigator-tile')
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      ]);
      return activeBackground !== inactiveBackground;
    })
    .toBe(true);
});

test('covers fit, one-pixel overflow, mixed widths, narrow layout, and 200% zoom', async ({
  mount,
  page,
}) => {
  const cases = [
    { viewportWidth: 408, zoom: 1, widths: [200, 200] },
    { viewportWidth: 407, zoom: 1, widths: [200, 200] },
    { viewportWidth: 320, zoom: 1, widths: [120, 280, 500] },
    { viewportWidth: 400, zoom: 2, widths: [240, 360, 480] },
  ];
  for (const [caseIndex, entry] of cases.entries()) {
    const initialPanels = entry.widths.map((width, index) => ({
      id: `case-${caseIndex}-${index}`,
      title: `Panel ${index + 1}`,
      width,
    }));
    const component = await mount(PanelNavigatorPrepHarness, {
      props: { viewportWidth: entry.viewportWidth, zoom: entry.zoom, initialPanels },
    });
    const navigator = component.getByRole('navigation', { name: 'Panel navigator' });
    await expect(navigator.getByRole('button')).toHaveCount(initialPanels.length);
    await expect(navigator.locator('.panel-navigator-track')).toHaveCSS('height', '36px');
    await expectGeometryWithinHalfDevicePixel(component, page);
    const [thumbWidth, trackWidth] = await Promise.all([
      navigator
        .locator('[data-panel-navigator-thumb]')
        .evaluate((node) => node.getBoundingClientRect().width),
      navigator
        .locator('.panel-navigator-track')
        .evaluate((node) => node.getBoundingClientRect().width),
    ]);
    if (caseIndex === 0) expect(thumbWidth).toBeCloseTo(trackWidth, 5);
    if (caseIndex === 1) expect(thumbWidth).toBeLessThan(trackWidth);
    await component.unmount();
  }
});

test('updates scroll, open, close, and order without animation in reduced motion', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelNavigatorPrepHarness, {
    props: { viewportWidth: 320, theme: 'dark' },
  });
  const navigator = component.getByRole('navigation', { name: 'Panel navigator' });
  const segments = navigator.getByRole('button');
  await expect(segments).toHaveCount(3);
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
  await expect
    .poll(() =>
      component.evaluate(
        (node) =>
          node.getAnimations({ subtree: true }).filter((animation) => {
            const duration = animation.effect?.getComputedTiming().duration;
            return (
              animation.playState !== 'finished' && typeof duration === 'number' && duration > 0
            );
          }).length,
      ),
    )
    .toBe(0);
  await expectGeometryWithinHalfDevicePixel(component, page);

  const thumb = navigator.locator('[data-panel-navigator-thumb]');
  const beforeScroll = await thumb.evaluate((node) => node.getBoundingClientRect().left);
  await component.getByTestId('scroll-panels').click();
  await expect
    .poll(() => thumb.evaluate((node) => node.getBoundingClientRect().left))
    .toBeGreaterThan(beforeScroll);
  await expectGeometryWithinHalfDevicePixel(component, page);

  await component.getByTestId('add-panel').click();
  await expect(segments).toHaveCount(4);
  await component.getByTestId('reverse-panels').click();
  await expect(segments.first()).toHaveAttribute('data-panel-navigator-segment', 'extra');
  await expectGeometryWithinHalfDevicePixel(component, page);
  await component.getByTestId('close-panel').click();
  await expect(segments).toHaveCount(3);
  await expectGeometryWithinHalfDevicePixel(component, page);
});
