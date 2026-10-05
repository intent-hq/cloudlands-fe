import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import AccordionHarness from './AccordionHarness.svelte';

/**
 * Regression for intent-hq/intent#5306: Bits UI rewrites the content element's
 * `style` attribute for its measurement variables, which clobbered the
 * `animatedHeight` inline styles when both lived on the same element and left
 * a closed panel at its full height.
 */

interface PanelSample {
  /** Computed height of the `[data-accordion-content]` element. */
  height: number;
  /** Natural height of the padded body the panel wraps. */
  bodyHeight: number;
  /**
   * Whether the consumer content is hit-testable. A closed panel is `inert`, so this is
   * false regardless of clipping; the height assertion is what proves the panel collapsed.
   */
  contentHit: boolean;
  measuredWidth: string;
}

async function samplePanel(panel: Locator): Promise<PanelSample> {
  return panel.evaluate((node) => {
    const content = node.querySelector<HTMLElement>('[data-accordion-panel-content]')!;
    const rect = content.getBoundingClientRect();
    const hits = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + 2);
    return {
      height: Number.parseFloat(getComputedStyle(node).height),
      bodyHeight: content.parentElement!.getBoundingClientRect().height,
      contentHit: hits.includes(content),
      measuredWidth: node.style.getPropertyValue('--bits-accordion-content-width'),
    };
  });
}

async function expectMeasured(panel: Locator) {
  await expect.poll(async () => (await samplePanel(panel)).measuredWidth).not.toMatch(/^(0px)?$/);
}

async function expectClosed(panel: Locator) {
  await expect(panel).toHaveAttribute('data-state', 'closed');
  await expect.poll(async () => (await samplePanel(panel)).height).toBe(0);
  const sample = await samplePanel(panel);
  expect(sample.bodyHeight).toBeGreaterThan(0);
  expect(sample.contentHit).toBe(false);
}

async function expectOpen(panel: Locator) {
  await expect(panel).toHaveAttribute('data-state', 'open');
  await expect
    .poll(async () => {
      const sample = await samplePanel(panel);
      return Math.abs(sample.height - sample.bodyHeight) < 0.5 && sample.contentHit;
    })
    .toBe(true);
}

test('keeps a closed accordion panel at zero height across measurement, open, and re-close', async ({
  mount,
}) => {
  const component = await mount(AccordionHarness);
  const first = component.locator('[data-accordion-content]').nth(0);
  const second = component.locator('[data-accordion-content]').nth(1);

  await expectMeasured(first);
  await expectMeasured(second);
  await expectOpen(first);
  await expectClosed(second);

  await component.getByRole('button', { name: 'Second section' }).click();
  await expectOpen(second);
  await expectClosed(first);

  await component.getByRole('button', { name: 'First section' }).click();
  await expectOpen(first);
  await expectClosed(second);
});
