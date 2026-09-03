import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(120_000);

/**
 * Explicit settle gate before a geometry read: web fonts applied, every finite
 * animation in the subtree finished (Svelte transitions are WAAPI animations
 * that Svelte cancels on completion, hence the catch; looping status
 * indicators never finish and are skipped), then a layout flush so the read
 * sees the settled frame instead of an arbitrary wall-clock delay. The
 * animation wait loops because a finished animation can start another one
 * (an intro chained after an outro), which a single pass would miss.
 */
async function settleLayout(scope: Locator) {
  await scope.evaluate(async (element) => {
    await document.fonts.ready;
    for (;;) {
      const running = element
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity),
        );
      if (running.length === 0) break;
      await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

const eventPairs = [
  ['event-wake', 'assistant-wake'],
  ['event-subscription', 'assistant-subscription'],
  ['event-finished-event', 'assistant-finished-event'],
  ['event-sent', 'assistant-sent'],
  ['event-waiting', 'assistant-waiting'],
  ['event-streaming-seam', 'assistant-streaming-seam'],
] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2]) {
    test(`keeps 16px above the detached live Thinking row in ${theme} at ${zoom * 100}%`, async ({
      mount,
    }) => {
      const component = await mount(ChatPanelOperationalGeometryHost, {
        props: { theme, width: 720, zoom, seamOnly: true, detachedStatus: true },
      });
      const wrapper = component.getByTestId('end-of-list-streaming-status');
      await expect(wrapper.locator('[data-streaming-typing-row]')).toBeVisible();
      await settleLayout(component);

      const geometry = await wrapper.evaluate((element) => {
        const previous = document.querySelector(
          '[data-message-id="assistant-tool-message-streaming"]',
        )!;
        const row = element.querySelector('[data-streaming-typing-row]')!;
        const wrapperStyle = getComputedStyle(element);
        return {
          topGap: row.getBoundingClientRect().top - previous.getBoundingClientRect().bottom,
          rowMarginTop: getComputedStyle(row).marginTop,
          wrapperPaddingTop: wrapperStyle.paddingTop,
          wrapperPaddingBottom: wrapperStyle.paddingBottom,
          wrapperMarginBottom: wrapperStyle.marginBottom,
        };
      });

      expect(geometry.topGap).toBeCloseTo(16 * zoom, 1);
      expect(geometry.rowMarginTop).toBe('8px');
      expect(geometry.wrapperPaddingTop).toBe('4px');
      expect(geometry.wrapperPaddingBottom).toBe('0px');
      expect(geometry.wrapperMarginBottom).toBe('64px');
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 720]) {
    for (const zoom of [1, 2]) {
      if (
        (theme === 'light' && (width !== 720 || zoom !== 1)) ||
        (theme === 'dark' && (width !== 320 || zoom !== 2))
      )
        continue;
      test(`owns directional Thinking seams in ${theme} at ${width}px and ${zoom * 100}%`, async ({
        mount,
      }) => {
        const component = await mount(ChatPanelOperationalGeometryHost, {
          props: { theme, width, zoom, seamOnly: true },
        });

        for (const [eventId, assistantId] of eventPairs) {
          const event = component.locator(`[data-message-id="${eventId}"]`);
          const assistant = component.locator(`[data-message-id="${assistantId}"]`);
          const thinking = assistant.locator('[data-message-content-block="thinking"]').first();
          await expect(thinking).toBeVisible();
          await settleLayout(component);
          const gap = await event.evaluate((element, nextId) => {
            const next = document.querySelector(`[data-message-id="${nextId}"]`)!;
            const thinkingWrapper = next.querySelector('[data-message-content-block="thinking"]')!;
            return (
              thinkingWrapper.getBoundingClientRect().top - element.getBoundingClientRect().bottom
            );
          }, assistantId);
          expect(gap, `${eventId}>Thinking`).toBeCloseTo(32 * zoom, 1);
        }

        const eventBoundary = await component
          .locator('[data-message-id="event-wake"]')
          .evaluate((event) => {
            const previous = document.querySelector('[data-message-id="assistant-tool-spacing"]')!;
            const next = document.querySelector('[data-message-id="assistant-wake"]')!;
            const thinking = next.querySelector('[data-message-content-block="thinking"]')!;
            return {
              top: event.getBoundingClientRect().top - previous.getBoundingClientRect().bottom,
              bottom: thinking.getBoundingClientRect().top - event.getBoundingClientRect().bottom,
            };
          });
        expect(eventBoundary.top).toBeCloseTo(32 * zoom, 1);
        expect(eventBoundary.bottom).toBeCloseTo(32 * zoom, 1);
        expect(eventBoundary.top).toBeCloseTo(eventBoundary.bottom, 1);

        for (const [messageId, topLevelTypes, topLevelGaps] of [
          ['assistant-static-tools', ['tool_use', 'thinking', 'tool_use', 'tool_use'], [0, 0, 0]],
          [
            'assistant-streaming-seam',
            ['thinking', 'tool_use', 'thinking', 'tool_use', 'tool_use'],
            [0, 0, 0, 0],
          ],
        ] as const) {
          const message = component.locator(`[data-message-id="${messageId}"]`);
          for (const disclosure of await message.getByTestId('response-group-disclosure').all()) {
            if ((await disclosure.getAttribute('aria-expanded')) === 'false') {
              await disclosure.evaluate((element) => (element as HTMLElement).click());
            }
            await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
          }
          await settleLayout(message);
          const rowSets = [
            {
              label: `${messageId}:ungrouped`,
              rows: message
                .locator('[data-operational-stack]')
                .first()
                .locator(
                  ':scope > [data-message-content-block="tool_use"], :scope > [data-message-content-block="thinking"]',
                ),
              types: topLevelTypes,
              gaps: topLevelGaps,
            },
            {
              label: `${messageId}:grouped`,
              rows: message
                .locator('[data-response-group-content]')
                .locator(
                  ':scope > [data-message-content-block="tool_use"], :scope > [data-message-content-block="thinking"]',
                ),
              types: ['tool_use', 'thinking', 'tool_use', 'tool_use'],
              gaps: [0, 0, 0],
            },
          ] as const;

          for (const rowSet of rowSets) {
            await expect(rowSet.rows.first(), `${rowSet.label}:first row`).toBeVisible();
            const geometry = await rowSet.rows.evaluateAll((wrappers) =>
              wrappers.map((wrapper) => {
                const row = wrapper.querySelector<HTMLElement>('[data-chat-operational-row]')!;
                const rowBox = row.getBoundingClientRect();
                const rowStyle = getComputedStyle(row);
                const wrapperStyle = getComputedStyle(wrapper);
                return {
                  type: wrapper.getAttribute('data-message-content-block'),
                  top: rowBox.top,
                  bottom: rowBox.bottom,
                  childMargins: [rowStyle.marginTop, rowStyle.marginBottom],
                  wrapperMargins: [wrapperStyle.marginTop, wrapperStyle.marginBottom],
                  wrapperPaddingTop: wrapperStyle.paddingTop,
                  parentRowGap: getComputedStyle(wrapper.parentElement!).rowGap,
                };
              }),
            );
            expect(
              geometry.map((row) => row.type),
              rowSet.label,
            ).toEqual(rowSet.types);
            expect(
              geometry.map((row) => row.childMargins),
              rowSet.label,
            ).toEqual(rowSet.types.map(() => ['0px', '0px']));
            expect(
              geometry.map((row) => row.wrapperMargins),
              rowSet.label,
            ).toEqual(rowSet.types.map(() => ['0px', '0px']));
            expect(
              geometry.map((row) => row.wrapperPaddingTop),
              `${rowSet.label}:wrapper padding`,
            ).toEqual(['0px', ...rowSet.gaps.map((gap) => `${gap}px`)]);
            expect(
              geometry.map((row) => row.parentRowGap),
              `${rowSet.label}:parent gap`,
            ).toEqual(rowSet.types.map(() => '0px'));
            for (let index = 1; index < geometry.length; index += 1) {
              expect(
                geometry[index].top - geometry[index - 1].bottom,
                `${rowSet.label}:${rowSet.types[index - 1]}>${rowSet.types[index]}`,
              ).toBeCloseTo(rowSet.gaps[index - 1] * zoom, 1);
            }
          }
        }
      });
    }
  }
}
