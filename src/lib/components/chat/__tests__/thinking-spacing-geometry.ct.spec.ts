import { expect, test } from '@playwright/experimental-ct-svelte';
import ThinkingSpacingGeometryHost from './ThinkingSpacingGeometryHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 720]) {
    for (const zoom of [1, 2]) {
      test(`keeps Thinking boundaries exact in ${theme} at ${width}px and ${zoom * 100}%`, async ({
        mount,
        page,
      }) => {
        const component = await mount(ThinkingSpacingGeometryHost, {
          props: { theme, width, zoom, showStreamingThinking: true },
        });

        for (const [testId, previousSelector, expectedGap] of [
          ['attention-card-boundary', '[data-testid="attention-card"]', 12],
          ['notice-boundary', '.discussion-request-notice', 16],
          ['prose-boundary', '[data-message-content-block="text"]', 12],
          ['message-content-boundary', '[data-testid="message-content"]', 12],
          ['streaming-boundary', '[data-message-content-block="text"]', 12],
        ] as const) {
          const fixture = component.getByTestId(testId);
          const measurement = await fixture.evaluate((root, selector) => {
            const rect = (element: Element) => {
              const box = element.getBoundingClientRect();
              return { top: box.top, bottom: box.bottom, height: box.height };
            };
            const thinking = root.querySelector('[data-testid="reasoning-tool-call"]')!;
            const row = thinking.querySelector('[data-operational-disclosure-row]')!;
            const previous = root.querySelector(selector);
            if (!previous) throw new Error(`Missing predecessor: ${selector}`);
            return { previous: rect(previous), thinking: rect(thinking), row: rect(row) };
          }, previousSelector);
          expect(measurement.thinking.top - measurement.previous.bottom, testId).toBeCloseTo(
            expectedGap * zoom,
            1,
          );
          expect(measurement.row.height, testId).toBeCloseTo(36 * zoom, 1);
        }

        const first = component.getByTestId('first-child-boundary');
        const firstGeometry = await first.evaluate((root) => {
          const rootBox = root.firstElementChild!.getBoundingClientRect();
          const thinkingBox = root
            .querySelector('[data-testid="reasoning-tool-call"]')!
            .getBoundingClientRect();
          return { rootTop: rootBox.top, thinkingTop: thinkingBox.top };
        });
        expect(firstGeometry.thinkingTop - firstGeometry.rootTop).toBeCloseTo(0, 1);

        const attention = component.getByTestId('attention-card-boundary');
        const disclosure = attention.getByTestId('reasoning-disclosure');
        await expect(disclosure).toContainText('Considering task restoration');
        const titleGeometry = await attention
          .getByTestId('reasoning-summary')
          .evaluate((summary) => ({
            clientWidth: summary.clientWidth,
            scrollWidth: summary.scrollWidth,
            whiteSpace: getComputedStyle(summary).whiteSpace,
          }));
        expect(titleGeometry.clientWidth).toBeGreaterThan(0);
        expect(titleGeometry.scrollWidth).toBeGreaterThanOrEqual(titleGeometry.clientWidth);
        expect(titleGeometry.whiteSpace).toBe('nowrap');
        const gap = async () =>
          attention.evaluate((root) => {
            const card = root.querySelector('[data-testid="attention-card"]')!;
            const thinking = root.querySelector('[data-testid="reasoning-tool-call"]')!;
            return thinking.getBoundingClientRect().top - card.getBoundingClientRect().bottom;
          });
        expect(await gap()).toBeCloseTo(12 * zoom, 1);
        await disclosure.click();
        await page.waitForTimeout(180);
        expect(await gap()).toBeCloseTo(12 * zoom, 1);
        await disclosure.click();
        await page.waitForTimeout(180);
        expect(await gap()).toBeCloseTo(12 * zoom, 1);

        await component.update({
          props: { theme, width, zoom, showStreamingThinking: false },
        });
        await expect(
          component.getByTestId('streaming-boundary').getByTestId('reasoning-tool-call'),
        ).toHaveCount(0);
        await component.update({ props: { theme, width, zoom, showStreamingThinking: true } });
        const streamingGap = await component.getByTestId('streaming-boundary').evaluate((root) => {
          const thinking = root.querySelector('[data-testid="reasoning-tool-call"]')!;
          const wrapper = thinking.closest('.content-block--thinking')!;
          return (
            thinking.getBoundingClientRect().top -
            wrapper.previousElementSibling!.getBoundingClientRect().bottom
          );
        });
        expect(streamingGap).toBeCloseTo(12 * zoom, 1);
      });
    }
  }
}

test('leaves no stale Thinking boundary motion with reduced motion', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ThinkingSpacingGeometryHost);
  const disclosure = component
    .getByTestId('attention-card-boundary')
    .getByTestId('reasoning-disclosure');
  await disclosure.click();
  const details = component
    .getByTestId('attention-card-boundary')
    .locator('[data-operational-expanded-content]');
  await expect(details).toBeVisible();
  expect(await details.evaluate((element) => element.getAnimations().length)).toBe(0);
});
