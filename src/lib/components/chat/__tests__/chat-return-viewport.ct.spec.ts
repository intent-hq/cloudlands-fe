import type { Locator, Page } from '@playwright/experimental-ct-svelte';
import { expect, test, wheelUntilScrolled } from '../../../../test/ct-test';
import ChatReturnHost, { type ReturnPath } from './ChatReturnHost.svelte';

// Returning to a chat (workspace switch or agent-tab switch) must never leave
// the transcript viewport parked in blank space — the switch-back skeleton
// collapses the scroll extent and a non-following viewport used to stay at
// ~0 inside the unloaded-history spacer once the rows came back.

test.setTimeout(60_000);
test.use({ viewport: { width: 900, height: 1000 } });

type Harness = {
  leave(path: ReturnPath, unread?: number): void;
  reactivate(): void;
  deliverSnapshot(): void;
  awaitingSkeleton(): boolean;
};

const distanceFromBottom = (viewport: Locator) =>
  viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);

/** Ids of rendered (hydrated) message rows intersecting the viewport. */
const visibleRows = (viewport: Locator) =>
  viewport.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return [...node.querySelectorAll<HTMLElement>('[data-message-id]')]
      .filter((row) => {
        if (row.closest('[data-lazy-visible="false"]')) return false;
        if (!row.textContent?.trim()) return false;
        const rect = row.getBoundingClientRect();
        return rect.height > 0 && rect.bottom > box.top + 1 && rect.top < box.bottom - 1;
      })
      .map((row) => row.dataset.messageId!);
  });

async function openChat(page: Page, mount: (c: typeof ChatReturnHost) => Promise<Locator>) {
  const component = await mount(ChatReturnHost);
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');
  await expect(component.locator('[data-message-id="m-999"]').first()).toBeVisible();
  await expect.poll(() => distanceFromBottom(viewport)).toBeLessThan(3);
  return { component, viewport };
}

/** Let the unloaded-history spacer reconcile (quiet window). */
async function waitForSpacer(viewport: Locator) {
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight)).toBeGreaterThan(4000);
}

async function scrollUp(viewport: Locator) {
  await waitForSpacer(viewport);
  await wheelUntilScrolled(viewport, { deltaY: -600 });
  await expect.poll(() => distanceFromBottom(viewport)).toBeGreaterThan(300);
}

async function returnTo(page: Page, viewport: Locator, path: ReturnPath, unread = 0) {
  await page.evaluate(
    ([p, u]) =>
      (window as unknown as { chatReturn: Harness }).chatReturn.leave(p as ReturnPath, u as number),
    [path, unread] as const,
  );
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- the time away from the chat.
  await page.waitForTimeout(150);
  await page.evaluate(() => (window as unknown as { chatReturn: Harness }).chatReturn.reactivate());
  // The switch-back skeleton is up (armed by the panel's own activation).
  await expect(page.getByTestId('chat-transcript-skeleton')).toBeVisible();
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- the skeleton window before the snapshot lands.
  await page.waitForTimeout(250);
  await page.evaluate(() =>
    (window as unknown as { chatReturn: Harness }).chatReturn.deliverSnapshot(),
  );
  await expect(page.getByTestId('chat-transcript-skeleton')).toHaveCount(0);
  void viewport;
}

const PATHS: ReturnPath[] = [
  'workspace-quick',
  'workspace-rebuilt',
  'workspace-dropped',
  'tab-quick',
  'tab-rebuilt',
];

for (const path of PATHS) {
  for (const start of ['bottom', 'scrolled'] as const) {
    test(`${path} return from ${start} shows hydrated rows`, async ({ mount, page }) => {
      const { component, viewport } = await openChat(page, mount);
      let readingRow: string | undefined;
      if (start === 'scrolled') {
        await scrollUp(viewport);
        readingRow = (await visibleRows(viewport))[0];
      }
      await returnTo(page, viewport, path);
      const reading = component.locator(`[data-message-id="${readingRow}"]`).first();
      await expect.poll(() => visibleRows(viewport), { timeout: 1500 }).not.toEqual([]);
      if (path.startsWith('workspace-') || start === 'bottom') {
        // Workspace returns (and any return from the bottom) land on the newest row.
        await expect.poll(() => distanceFromBottom(viewport), { timeout: 1500 }).toBeLessThan(3);
        await expect(component.locator('[data-message-id="m-999"]').first()).toBeInViewport();
        await expect(component.getByTestId('chat-scroll-to-bottom-button')).toHaveCount(0);
      } else {
        // Agent-tab return: the cached reading position, else the bottom.
        await expect
          .poll(
            async () =>
              (await reading.isVisible().catch(() => false)) ||
              (await distanceFromBottom(viewport)) < 3,
            { timeout: 1500 },
          )
          .toBe(true);
      }
      // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- observes the landing staying put.
      await page.waitForTimeout(500);
      expect(await visibleRows(viewport)).not.toEqual([]);
    });
  }
}

for (const path of ['workspace-quick', 'workspace-rebuilt', 'workspace-dropped'] as const) {
  for (const start of ['bottom', 'scrolled'] as const) {
    test(`${path} return from ${start} with unread lands at the divider`, async ({
      mount,
      page,
    }) => {
      const { component, viewport } = await openChat(page, mount);
      if (start === 'scrolled') await scrollUp(viewport);
      await returnTo(page, viewport, path, 4);
      const divider = component.locator('[data-new-messages-divider]');
      await expect(divider).toHaveCount(1, { timeout: 1500 });
      await expect(divider).toBeInViewport({ timeout: 1500 });
      // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- observes the landing staying put.
      await page.waitForTimeout(500);
      await expect(divider).toBeInViewport();
      expect(await visibleRows(viewport)).not.toEqual([]);
    });
  }
}

async function parkInSpacer(viewport: Locator) {
  // A stray clamp with no user input: the top of the transcript is the
  // unloaded-history spacer.
  await viewport.evaluate((node) => {
    node.scrollTop = 0;
  });
  expect(await visibleRows(viewport)).toEqual([]);
}

test('safety net moves a blank revealed viewport within 1 s and records a breadcrumb', async ({
  mount,
  page,
}) => {
  const breadcrumbs: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('chat-return-landing-correction')) breadcrumbs.push(message.text());
  });
  const { component, viewport } = await openChat(page, mount);
  await waitForSpacer(viewport);
  await returnTo(page, viewport, 'workspace-quick');
  await parkInSpacer(viewport);
  await expect.poll(() => visibleRows(viewport), { timeout: 1000 }).not.toEqual([]);
  await expect(component.locator('[data-message-id="m-999"]').first()).toBeInViewport();
  await expect.poll(() => breadcrumbs.length).toBeGreaterThan(0);
});

test('safety net never moves the viewport after user scroll input', async ({ mount, page }) => {
  const { viewport } = await openChat(page, mount);
  await waitForSpacer(viewport);
  await returnTo(page, viewport, 'workspace-quick');
  await wheelUntilScrolled(viewport, { deltaY: -200 });
  await parkInSpacer(viewport);
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- observes the whole safety-net window staying quiet.
  await page.waitForTimeout(1600);
  expect(await viewport.evaluate((node) => node.scrollTop)).toBeLessThan(3);
});
