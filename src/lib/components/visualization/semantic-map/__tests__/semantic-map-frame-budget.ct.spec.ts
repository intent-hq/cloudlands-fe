import { expect, test } from '@playwright/experimental-ct-svelte';
import SemanticMapPreview from '../semantic-map.preview.svelte';

test('three-agent 32x replay meets the 1440px frame budget', async ({ mount, page }, testInfo) => {
  test.setTimeout(15_000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.evaluate(() => history.replaceState({}, '', '?w=1440&h=900'));
  const component = await mount(SemanticMapPreview, { props: { state: 'replay' } });
  const canvas = component.locator('[data-semantic-map-canvas]');
  await expect(canvas).toHaveAttribute('data-semantic-map-width', '1440');
  await expect(canvas).toHaveAttribute('data-semantic-map-height', '900');
  await expect(canvas).toHaveAttribute('data-semantic-map-agent-count', '3');

  await component.getByRole('button', { name: '32×' }).click();
  await component.getByRole('button', { name: 'Paused' }).click();
  const metrics = await canvas.evaluate(
    () =>
      new Promise<{ durationMs: number; deltas: number[] }>((resolve) => {
        const startedAt = performance.now();
        let previous = startedAt;
        const deltas: number[] = [];
        const sample = (now: number) => {
          deltas.push(now - previous);
          previous = now;
          if (now - startedAt >= 3_200) resolve({ durationMs: now - startedAt, deltas });
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  const ordered = [...metrics.deltas].sort((left, right) => left - right);
  const rawP95 = ordered[Math.ceil(ordered.length * 0.95) - 1];
  const frameBudgetMs = 16.7;
  // Headless Chromium exposes rAF timestamps at 0.1 ms precision, so subtracting two
  // timestamps can add up to 0.2 ms of quantization error. The 16.9 ms ceiling remains
  // well below the 25 ms midpoint that would indicate a missed 60 Hz vsync.
  const timestampQuantizationToleranceMs = 0.2;
  const rawP95CeilingMs = frameBudgetMs + timestampQuantizationToleranceMs;
  console.info(`semantic-map frame budget: ${ordered.length} samples, raw p95 ${rawP95}ms`);
  await testInfo.attach('frame-budget.json', {
    body: JSON.stringify(
      {
        durationMs: metrics.durationMs,
        samples: ordered.length,
        rawP95,
        frameBudgetMs,
        timestampQuantizationToleranceMs,
        rawP95CeilingMs,
        deltas: metrics.deltas,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(metrics.durationMs).toBeGreaterThanOrEqual(3_000);
  expect(rawP95).toBeLessThanOrEqual(rawP95CeilingMs);
});
