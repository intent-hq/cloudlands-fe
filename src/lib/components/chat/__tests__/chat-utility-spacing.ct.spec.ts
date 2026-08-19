import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatUtilitySpacingHost from './ChatUtilitySpacingHost.svelte';

const states = [
  { expanded: false, streaming: false, actionsVisible: false },
  { expanded: true, streaming: false, actionsVisible: true },
  { expanded: false, streaming: true, actionsVisible: true },
];

test('does not reserve an absent queue gap and preserves one/many queue spacing', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatUtilitySpacingHost, { props: { queueCount: 0 } });
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [320, 720]) {
      await page.setViewportSize({ width, height: 900 });
      for (const zoom of [1, 2]) {
        await page.evaluate((value) => (document.body.style.zoom = String(value)), zoom);
        for (const state of states) {
          for (const queueCount of [0, 1, 3]) {
            await component.update({
              props: {
                queueCount,
                theme,
                compact: width === 320,
                ...state,
              },
            });
            await page.waitForTimeout(220);
            const geometry = await component.evaluate((root) => {
              const box = (selector: string) =>
                (root.querySelector(selector) as HTMLElement).getBoundingClientRect();
              const column = box('[data-testid="utility-column"]');
              const subscription = box('[data-testid="subscription-utility-area"]');
              const queue = root.querySelector('[data-testid="queued-message-utility-area"]');
              const queueBox = queue?.getBoundingClientRect() ?? null;
              return {
                columnBottom: column.bottom,
                columnPaddingBottom: getComputedStyle(
                  root.querySelector('[data-testid="utility-column"]')!,
                ).paddingBottom,
                subscriptionBottom: subscription.bottom,
                queueTop: queueBox?.top ?? null,
                queueBottom: queueBox?.bottom ?? null,
              };
            });
            if (queueCount === 0) {
              expect(geometry.queueTop).toBeNull();
              expect(geometry.columnPaddingBottom).toBe(width === 320 ? '12px' : '24px');
              expect(geometry.columnBottom - geometry.subscriptionBottom).toBeCloseTo(
                (width === 320 ? 13 : 25) * zoom,
                1,
              );
            } else {
              expect((geometry.queueTop ?? 0) - geometry.subscriptionBottom).toBeCloseTo(
                24 * zoom,
                0,
              );
              expect(geometry.columnBottom - (geometry.queueBottom ?? 0)).toBeCloseTo(
                (width === 320 ? 13 : 25) * zoom,
                1,
              );
            }
          }
        }
      }
    }
  }
});
