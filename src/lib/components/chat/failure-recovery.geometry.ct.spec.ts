import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import { expect, test } from '../../../test/ct-test';
import Preview from './failure-recovery.preview.svelte';

// Capture the queued-message height at rest, not during its entrance tween.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  );
  // The real panel measures its responsive inset and queue height after mount.
  // Extend this scene's capture readiness without changing snapshot tolerances.
  await page.evaluate(() => {
    const capture = (
      window as typeof window & {
        __INTENT_GEOMETRY_CT__: {
          waitForCaptureStability: typeof import('$lib/component-catalog/capture-stability').waitForCaptureStability;
        };
      }
    ).__INTENT_GEOMETRY_CT__;
    const waitForAssets = capture.waitForCaptureStability;
    capture.waitForCaptureStability = async (root, options) => {
      const result = await waitForAssets(root, options);
      const deadline = performance.now() + 5_000;
      let previous = '';
      let unchangedSince = performance.now();
      while (performance.now() < deadline) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const elements = root.querySelectorAll(
          '[data-testid="failure-recovery-card"], .turn-failure-notice, [data-testid="queued-messages-container"], [data-testid="queued-messages-viewport"]',
        );
        const geometry = JSON.stringify(
          [...elements].map((element) => element.getBoundingClientRect().toJSON()),
        );
        if (elements.length === 0 || geometry !== previous) {
          previous = geometry;
          unchangedSince = performance.now();
        } else if (performance.now() - unchangedSince >= 250) {
          return result;
        }
      }
      throw new Error('Recovery panel layout did not settle before geometry capture');
    };
  });
});

defineGeometrySnapshotSuite({
  scene: 'failure-recovery',
  component: Preview,
  states: ['repeated-failures', 'partial-output', 'long-error'],
  widths: [420],
  selector:
    '[data-testid="failure-recovery-preview"], [data-testid="failure-recovery-card"], [data-testid="failure-raw-details"], .turn-failure-notice, [data-testid="queued-message-retry-status"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/failure-recovery.geometry.json', import.meta.url),
  ),
});
