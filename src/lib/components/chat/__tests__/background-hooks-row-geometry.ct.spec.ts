import { expect, test } from '@playwright/experimental-ct-svelte';
import BackgroundHooksRowGeometryHost from './BackgroundHooksRowGeometryHost.svelte';

test.setTimeout(120_000);

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2]) {
    for (const width of [320, 720]) {
      for (const embedded of [false, true]) {
        test(`lays out the ${embedded ? 'embedded row' : 'standalone card'} in ${theme} at ${zoom * 100}% and ${width}px`, async ({
          mount,
          page,
        }) => {
          const component = await mount(BackgroundHooksRowGeometryHost, {
            props: { theme, zoom, width, embedded },
          });
          const summary = component.getByTestId('background-hook-summary');
          await summary.click();
          await expect(summary).toHaveAttribute('aria-expanded', 'true');

          const host = page.getByTestId('background-hooks-geometry-host');
          const card = component.getByTestId('background-hook-card');
          const title = component.locator('[id^="background-hook-title-"]');
          const metrics = component.locator('.background-hook-metric');
          await expect(metrics).toHaveCount(4);
          await expect(component.getByText('Next run', { exact: true })).toBeVisible();
          await expect(component.getByText('Interval', { exact: true })).toBeVisible();
          await expect(component.getByText('Expires', { exact: true })).toBeVisible();
          await expect(component.getByText('Runs', { exact: true })).toBeVisible();

          const containment = await host.evaluate((node) => ({
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
          }));
          expect(containment.scrollWidth).toBeLessThanOrEqual(containment.clientWidth);
          const cardContainment = await card.evaluate((node) => {
            const style = getComputedStyle(node);
            const bounds = node.getBoundingClientRect();
            const parentBounds = node.parentElement!.getBoundingClientRect();
            return {
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
              width: bounds.width,
              parentWidth: parentBounds.width,
              margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
              radius: style.borderRadius,
              border: [
                style.borderTopWidth,
                style.borderRightWidth,
                style.borderBottomWidth,
                style.borderLeftWidth,
              ],
              shadow: style.boxShadow,
              background: style.backgroundColor,
            };
          });
          expect(cardContainment.scrollWidth).toBeLessThanOrEqual(cardContainment.clientWidth);
          if (embedded) {
            expect(cardContainment.margin.map(Number.parseFloat)).toEqual([0, 0, 0, 0]);
            expect(Number.parseFloat(cardContainment.radius)).toBe(0);
            expect(cardContainment.border.map(Number.parseFloat)).toEqual([0, 0, 0, 0]);
            expect(cardContainment.shadow).toBe('none');
            expect(cardContainment.background).toBe('rgba(0, 0, 0, 0)');
            expect(cardContainment.width).toBeCloseTo(cardContainment.parentWidth, 1);
            await expect(title).toHaveCSS('font-weight', '400');
          } else {
            expect(cardContainment.margin.map(Number.parseFloat).every((value) => value > 0)).toBe(
              true,
            );
            expect(Number.parseFloat(cardContainment.radius)).toBeGreaterThan(0);
            expect(cardContainment.border.map(Number.parseFloat).every((value) => value > 0)).toBe(
              true,
            );
            expect(cardContainment.shadow).not.toBe('none');
            expect(cardContainment.background).not.toBe('rgba(0, 0, 0, 0)');
            await expect(title).toHaveCSS('font-weight', '500');
          }

          const iconBox = await component
            .getByTestId('background-hook-icon')
            .locator('svg')
            .boundingBox();
          expect(iconBox?.width).toBeCloseTo(16 * zoom, 1);
          expect(iconBox?.height).toBeCloseTo(16 * zoom, 1);

          const boxes = await metrics.evaluateAll((nodes) =>
            nodes.map((node) => {
              const box = node.getBoundingClientRect();
              const label = node.querySelector('dt')!.getBoundingClientRect();
              const value = node.querySelector('dd')!.getBoundingClientRect();
              return {
                top: box.top,
                left: box.left,
                label: [label.left, label.top],
                value: [value.left, value.top],
              };
            }),
          );
          const shouldStack = width / zoom <= 512;
          if (shouldStack) {
            expect(new Set(boxes.map(({ top }) => Math.round(top))).size).toBe(4);
            for (const box of boxes) {
              expect(box.value[0]).toBeGreaterThan(box.label[0]);
              expect(box.value[1]).toBeCloseTo(box.label[1], 1);
            }
          } else {
            expect(new Set(boxes.map(({ top }) => Math.round(top))).size).toBe(1);
            expect(boxes.map(({ left }) => left)).toEqual(
              [...boxes.map(({ left }) => left)].sort((a, b) => a - b),
            );
          }
        });
      }
    }
  }
}

test('uses one internal separator between embedded hooks without gaps or doubled strokes', async ({
  mount,
}) => {
  const component = await mount(BackgroundHooksRowGeometryHost, {
    props: { embedded: true, hookCount: 3 },
  });
  const cards = component.getByTestId('background-hook-card');
  await expect(cards).toHaveCount(3);

  const geometry = await cards.evaluateAll((nodes) =>
    nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        top: bounds.top,
        bottom: bounds.bottom,
        borderTop: style.borderTopWidth,
        borderBottom: style.borderBottomWidth,
      };
    }),
  );
  expect(geometry.map(({ borderTop }) => Number.parseFloat(borderTop))).toEqual([0, 1, 1]);
  expect(geometry.map(({ borderBottom }) => Number.parseFloat(borderBottom))).toEqual([0, 0, 0]);
  expect(geometry[1].top).toBeCloseTo(geometry[0].bottom, 1);
  expect(geometry[2].top).toBeCloseTo(geometry[1].bottom, 1);
});

test('supports keyboard disclosure and reduced motion', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(BackgroundHooksRowGeometryHost, {
    props: { width: 320, zoom: 2, running: true },
  });
  const summary = component.getByTestId('background-hook-summary');
  await summary.focus();
  await summary.press('Enter');
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await summary.press('Space');
  await expect(summary).toHaveAttribute('aria-expanded', 'false');

  const motion = await component
    .getByTestId('background-hook-icon')
    .locator('svg')
    .evaluate((node) => ({
      animation: getComputedStyle(node).animationName,
      transition: getComputedStyle(node).transitionDuration,
    }));
  expect(motion.animation).toBe('none');
  expect(Number.parseFloat(motion.transition)).toBeLessThan(0.001);
});
