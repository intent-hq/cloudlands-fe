import type { Page } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import ChatPendingProposalSeekHost from './ChatPendingProposalSeekHost.svelte';

test.setTimeout(120_000);

type HighlightProbeWindow = Window & { __highlightedProposalKeys?: (string | null)[] };

// Record which proposal cards receive the transient highlight, so the test
// observes the flash that is applied and removed within the click flow.
async function recordHighlights(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window as HighlightProbeWindow;
    probe.__highlightedProposalKeys = [];
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        if (
          record.attributeName === 'class' &&
          target.classList.contains('highlight-flash') &&
          !record.oldValue?.split(/\s+/).includes('highlight-flash')
        ) {
          probe.__highlightedProposalKeys!.push(target.getAttribute('data-pending-proposal-key'));
        }
      }
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
  });
}

test('the pill seeks history to an unloaded message and highlights the id-less pending card', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 1000 });
  const host = await mount(ChatPendingProposalSeekHost, { props: { scenario: 'seekable' } });
  const chip = host.getByTestId('pending-proposal-chip');
  await expect(chip).toBeVisible();
  await expect(host.locator('[data-message-id="m-41"]')).toHaveCount(0);
  await recordHighlights(page);

  await chip.click();

  const target = host.locator('[data-pending-proposal-key="Title keyed follow-up"]');
  await expect(target).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(() => (window as HighlightProbeWindow).__highlightedProposalKeys ?? []),
    )
    .toEqual(['Title keyed follow-up']);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});

test('the pill reports an unreachable pending card with a toast instead of failing silently', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 1000 });
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  const host = await mount(ChatPendingProposalSeekHost, { props: { scenario: 'vanished' } });
  const chip = host.getByTestId('pending-proposal-chip');
  await expect(chip).toBeVisible();

  await chip.click();

  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
  await expect(host.locator('[data-message-id="m-41"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
