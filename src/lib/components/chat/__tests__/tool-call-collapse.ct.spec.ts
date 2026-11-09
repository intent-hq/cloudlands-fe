import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import ToolCallCollapseHost from './ToolCallCollapseHost.svelte';

const WRAPPER = '[data-response-group-motion="animated-height"]';

// Clicks and samples in one evaluate so no animation frames pass before sampling starts.
async function toggleAndSample(host: Locator) {
  return host.evaluate(
    (node, selector) =>
      new Promise<{ height: number; content: number }[]>((resolve) => {
        const wrapper = node.querySelector<HTMLElement>(selector)!;
        const samples: { height: number; content: number }[] = [];
        node.querySelector<HTMLElement>('[data-testid="tool-call-disclosure"]')!.click();
        const started = performance.now();
        const frame = () => {
          samples.push({
            height: wrapper.getBoundingClientRect().height,
            content: wrapper.firstElementChild?.getBoundingClientRect().height ?? 0,
          });
          if (performance.now() - started < 600) requestAnimationFrame(frame);
          else resolve(samples);
        };
        requestAnimationFrame(frame);
      }),
    WRAPPER,
  );
}

test('slides a tool call closed with its details still visible', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const host = await mount(ToolCallCollapseHost);
  const toggle = host.getByTestId('tool-call-disclosure');

  const opening = await toggleAndSample(host);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const openHeight = opening.at(-1)!.height;
  expect(openHeight).toBeGreaterThan(40);
  const growing = opening.filter((sample) => sample.height > 2 && sample.height < openHeight - 2);
  expect(growing.length, JSON.stringify(opening)).toBeGreaterThanOrEqual(3);

  const closing = await toggleAndSample(host);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const midway = closing.filter(
    (sample) => sample.height > 2 && sample.height < openHeight - 2 && sample.content > 0,
  );
  expect(midway.length, JSON.stringify(closing)).toBeGreaterThanOrEqual(3);
  expect(closing.at(-1)!.height).toBe(0);
  await expect(host.locator(WRAPPER).locator(':scope > *')).toHaveCount(0);
});
