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

async function openChat(page: Page, mounted: Promise<Locator>) {
  const component = await mounted;
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
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: the time away from the chat.
  await page.waitForTimeout(150);
  await page.evaluate(() => (window as unknown as { chatReturn: Harness }).chatReturn.reactivate());
  // The switch-back skeleton is up (armed by the panel's own activation).
  await expect(page.getByTestId('chat-transcript-skeleton')).toBeVisible();
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: the skeleton window before the snapshot lands.
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
      const { component, viewport } = await openChat(page, mount(ChatReturnHost));
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
      // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: the landing must stay put.
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
      const { component, viewport } = await openChat(page, mount(ChatReturnHost));
      if (start === 'scrolled') await scrollUp(viewport);
      await returnTo(page, viewport, path, 4);
      const divider = component.locator('[data-new-messages-divider]');
      await expect(divider).toHaveCount(1, { timeout: 1500 });
      await expect(divider).toBeInViewport({ timeout: 1500 });
      // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: the landing must stay put.
      await page.waitForTimeout(500);
      await expect(divider).toBeInViewport();
      expect(await visibleRows(viewport)).not.toEqual([]);
    });
  }
}

async function parkInSpacer(viewport: Locator): Promise<number> {
  // The bug's state: the viewport sits in the unloaded-history spacer and
  // nothing reacts to it. Swallow the resulting scroll event so the
  // scroll-driven paging does not fill the spacer and mask the safety net.
  const parked = await viewport.evaluate(async (node) => {
    const swallow = (event: Event) => {
      if (event.target === node) event.stopImmediatePropagation();
    };
    window.addEventListener('scroll', swallow, true);
    // Mid-spacer: away from the loaded rows and the top paging edge.
    const firstRow = node.querySelector<HTMLElement>('[data-message-id]');
    const firstRowTop = firstRow
      ? node.scrollTop + firstRow.getBoundingClientRect().top - node.getBoundingClientRect().top
      : 0;
    node.scrollTop = Math.max(0, Math.round(firstRowTop / 2 - node.clientHeight / 2));
    // Measured synchronously: the safety net may correct on its next check.
    const box = node.getBoundingClientRect();
    const blank = ![...node.querySelectorAll<HTMLElement>('[data-message-id]')].some((row) => {
      const rect = row.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > box.top + 1 && rect.top < box.bottom - 1;
    });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    window.removeEventListener('scroll', swallow, true);
    return { blank, top: node.scrollTop };
  });
  expect(parked.blank).toBe(true);
  return parked.top;
}

test('safety net moves a blank revealed viewport within 1 s and records a breadcrumb', async ({
  mount,
  page,
}) => {
  const breadcrumbs: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('chat-return-landing-correction')) breadcrumbs.push(message.text());
  });
  const { component, viewport } = await openChat(page, mount(ChatReturnHost));
  await waitForSpacer(viewport);
  // A divider landing turns follow off, so only the safety net can recover.
  await returnTo(page, viewport, 'workspace-quick', 4);
  const divider = component.locator('[data-new-messages-divider]');
  await expect(divider).toBeInViewport({ timeout: 1000 });
  const parkedAt = await page.evaluate(() => performance.now());
  await parkInSpacer(viewport);
  // A parked viewport may legitimately start a seek or history fetch, which
  // gates the safety net. Never vacuous: rows must be visible within 1 s of
  // the park, or of the end of the last busy period that followed it.
  const lateBy: number[] = [];
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => {
          const harness = (
            window as unknown as {
              chatReturn: { busyNow(): boolean; busyLog(): { t: number; event: string }[] };
            }
          ).chatReturn;
          const ends = harness
            .busyLog()
            .filter((entry) => entry.event.endsWith(':end'))
            .map((entry) => entry.t);
          return { busy: harness.busyNow(), lastEnd: Math.max(0, ...ends), now: performance.now() };
        });
        if ((await visibleRows(viewport)).length > 0) return 'visible';
        if (state.busy) return 'busy';
        const since = state.now - Math.max(parkedAt, state.lastEnd);
        if (since > 1000) lateBy.push(Math.round(since));
        return 'waiting';
      },
      { timeout: 6000, intervals: [50] },
    )
    .toBe('visible');
  expect(lateBy).toEqual([]);
  const busyAfterPark = await page.evaluate(
    (parked) =>
      (
        window as unknown as { chatReturn: { busyLog(): { t: number; event: string }[] } }
      ).chatReturn
        .busyLog()
        .some((entry) => entry.t >= parked && entry.event.endsWith(':start')),
    parkedAt,
  );
  if (!busyAfterPark) {
    // Nothing else could have recovered the viewport: the safety net did,
    // landing on the divider and recording the breadcrumb.
    await expect(divider).toBeInViewport();
    await expect.poll(() => breadcrumbs.length).toBeGreaterThan(0);
  }
});

test('safety net never moves the viewport after user scroll input', async ({ mount, page }) => {
  const { viewport } = await openChat(page, mount(ChatReturnHost));
  await waitForSpacer(viewport);
  await returnTo(page, viewport, 'workspace-quick');
  await wheelUntilScrolled(viewport, { deltaY: -200 });
  const parkedTop = await parkInSpacer(viewport);
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: the safety net must not move.
  await page.waitForTimeout(1600);
  expect(Math.abs((await viewport.evaluate((node) => node.scrollTop)) - parkedTop)).toBeLessThan(3);
});

test('agent-tab quick return following the bottom with the divider above stays at the bottom', async ({
  mount,
  page,
}) => {
  // Entry with a short unseen tail latches a divider and follows the bottom;
  // the divider session survives agent-tab switches.
  const { component, viewport } = await openChat(
    page,
    mount(ChatReturnHost, { props: { lastSeen: 'm-995' } }),
  );
  const divider = component.locator('[data-new-messages-divider]');
  await expect(divider).toHaveCount(1);
  // Tall rows arriving while away push the divider above the viewport.
  await returnTo(page, viewport, 'tab-quick', 4);
  await expect.poll(() => distanceFromBottom(viewport), { timeout: 1500 }).toBeLessThan(3);
  await expect(divider).not.toBeInViewport();
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: the whole safety-net window must not move.
  await page.waitForTimeout(1600);
  expect(await distanceFromBottom(viewport)).toBeLessThan(3);
  await expect(divider).not.toBeInViewport();
});

test('scroll-to-end after a divider landing is not pulled back to the divider', async ({
  mount,
  page,
}) => {
  const { component, viewport } = await openChat(page, mount(ChatReturnHost));
  await returnTo(page, viewport, 'workspace-quick', 4);
  await expect(component.locator('[data-new-messages-divider]')).toBeInViewport({
    timeout: 1500,
  });
  await component.getByTestId('chat-floating-scroll-to-bottom-button').click();
  await expect.poll(() => distanceFromBottom(viewport), { timeout: 1500 }).toBeLessThan(3);
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: the whole safety-net window must not move.
  await page.waitForTimeout(1600);
  expect(await distanceFromBottom(viewport)).toBeLessThan(3);
});
