import { expect, test } from '@playwright/experimental-ct-svelte';
import BackgroundHooksRowGeometryHost from './BackgroundHooksRowGeometryHost.svelte';

test.setTimeout(120_000);

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2]) {
    for (const width of [320, 720]) {
      test(`lays out the hook card in ${theme} at ${zoom * 100}% and ${width}px`, async ({
        mount,
        page,
      }) => {
        const component = await mount(BackgroundHooksRowGeometryHost, {
          props: { theme, zoom, width },
        });
        const summary = component.getByTestId('background-hook-summary');
        await summary.click();
        await expect(summary).toHaveAttribute('aria-expanded', 'true');

        const host = page.getByTestId('background-hooks-geometry-host');
        const card = component.getByTestId('background-hook-card');
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
        const cardContainment = await card.evaluate((node) => ({
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          radius: getComputedStyle(node).borderRadius,
        }));
        expect(cardContainment.scrollWidth).toBeLessThanOrEqual(cardContainment.clientWidth);
        expect(Number.parseFloat(cardContainment.radius)).toBeGreaterThan(0);

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
          expect(boxes.map(({ left }) => left)).toEqual([...boxes.map(({ left }) => left)].sort());
        }
      });
    }
  }
}

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
