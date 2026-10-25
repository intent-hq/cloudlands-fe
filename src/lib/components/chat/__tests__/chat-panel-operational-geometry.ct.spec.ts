import { expect, test } from '../../../../test/ct-test';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(120_000);

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2]) {
    for (const width of [320, 720]) {
      if (
        (theme === 'light' && (width !== 720 || zoom !== 1)) ||
        (theme === 'dark' && (width !== 320 || zoom !== 2))
      )
        continue;
      test(`keeps ChatPanel operational disclosures accessible in ${theme} at ${zoom * 100}% and ${width}px`, async ({
        mount,
      }) => {
        const component = await mount(ChatPanelOperationalGeometryHost, {
          props: { theme, zoom, width },
        });
        // The fixture session streams, so followBottom re-pins the transcript
        // to the exact bottom on every mutation/resize settle frame. Playwright
        // scrolls targets into view without wheel events, so follow never
        // unlocks and the re-pin races (and under CI load starves) clicks on
        // rows above the fold. A real user scrolls up first, which drops
        // follow — emulate that before each interaction pass.
        const unlockFollow = () =>
          component
            .getByTestId('chat-transcript-scroll-viewport')
            .evaluate((node) => node.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 })));
        for (const messageId of ['assistant-finished', 'assistant-streaming']) {
          await unlockFollow();
          const message = component.locator(`[data-message-id="${messageId}"]`);
          await message.evaluate((node) => node.scrollIntoView({ block: 'center' }));
          await message.getByTestId('response-group-disclosure').click();
          await message.evaluate((node) => node.scrollIntoView({ block: 'center' }));
          const rows = message.locator('[data-chat-operational-row]');
          await expect(rows).toHaveCount(messageId === 'assistant-streaming' ? 21 : 20);
          const groupContent = message.locator('[data-operational-expanded-content]').first();
          await groupContent.evaluate(async (element) => {
            await Promise.all(
              element
                .getAnimations({ subtree: true })
                .map((animation) => animation.finished.catch(() => {})),
            );
          });
          if (width === 320) {
            const clipped = await rows
              .locator('[data-operational-summary]')
              .evaluateAll((summaries) =>
                summaries.some((summary) => summary.scrollWidth > summary.clientWidth),
              );
            expect(clipped).toBe(true);
          }

          if (messageId === 'assistant-streaming') {
            const streamingRow = message.getByTestId('reasoning-tool-call').last();
            await expect(streamingRow.locator('[data-operational-leading]')).toHaveAttribute(
              'data-streaming-pulse',
            );
            // The pulse is an inline opacity style, so no animation may persist
            // under the slot. Its IntentMarkLoader crossfades for settleMs (two
            // Web Animations) whenever its IntersectionObserver re-admits it
            // after the scrollIntoView above; poll past that transient instead
            // of sampling once. A persistent animation still never reaches 0.
            await expect
              .poll(
                () =>
                  streamingRow
                    .locator('[data-operational-leading]')
                    .evaluate((node) => node.getAnimations({ subtree: true }).length),
                { message: 'streaming pulse slot must settle with no running animations' },
              )
              .toBe(0);
            await expect(streamingRow.locator('[data-operational-expanded-content]')).toBeVisible();
          }

          await expect(message.locator('[data-operational-expanded-guide]')).toHaveCount(1);

          if (messageId === 'assistant-finished') {
            // Measure relative to the message container: expanding can toggle
            // the transcript scrollbar, which shifts absolute coordinates.
            const staticRow = message.getByTestId('reasoning-tool-call').first();
            const measureRow = () =>
              staticRow.evaluate((element) => {
                const row = element.querySelector('[data-operational-disclosure-row]')!;
                const box = row.getBoundingClientRect();
                const host = element.closest('[data-message-id]')!.getBoundingClientRect();
                return [box.left - host.left, box.right - host.left, box.height];
              });
            const beforeExpansion = await measureRow();
            await staticRow.getByTestId('reasoning-disclosure').click();
            await expect(staticRow.locator('[data-operational-expanded-content]')).toBeVisible();
            const afterExpansion = await measureRow();
            expect(afterExpansion).toEqual(beforeExpansion);
          }
        }

        const finished = component.locator('[data-message-id="assistant-finished"]');
        await expect(
          finished.locator('[data-conversation-layer="tool-activity"] [data-operational-chevron]'),
        ).toHaveCount(0);
        const empty = finished.locator('[data-tool-use-id="finished-empty"]');
        await expect(empty.locator('button')).toHaveCount(0);
        await expect(empty.locator('[data-operational-trailing]')).toHaveCount(0);

        for (const [id, inputCount, outputCount] of [
          ['finished-input-only', 1, 0],
          ['finished-output-only', 0, 1],
          ['finished-both', 1, 1],
          ['finished-error', 1, 1],
          ['finished-long', 1, 1],
        ] as const) {
          const tool = finished.locator(`[data-tool-use-id="${id}"]`);
          const disclosure = tool.getByTestId('tool-call-disclosure');
          await disclosure.focus();
          await expect(disclosure).toBeFocused();
          await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
          await disclosure.press('Enter');
          await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
          const inline = tool.locator('[data-tool-details-inline]');
          await expect(inline).toBeVisible();
          await expect(inline.locator('details, summary')).toHaveCount(0);
          await expect(inline.getByText('Technical details', { exact: true })).toHaveCount(0);
          await expect(inline.locator('[data-tool-detail-section="input"]')).toHaveCount(
            inputCount,
          );
          await expect(inline.locator('[data-tool-detail-section="output"]')).toHaveCount(
            outputCount,
          );
        }

        const longPayload = finished.locator('[data-tool-use-id="finished-long"] pre').last();
        const longStyle = await longPayload.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            whiteSpace: style.whiteSpace,
            overflowY: style.overflowY,
            maxHeight: style.maxHeight,
          };
        });
        expect(longStyle.whiteSpace).toBe('pre-wrap');
        expect(longStyle.overflowY).toBe('auto');
        expect(Number.parseFloat(longStyle.maxHeight)).toBeGreaterThan(0);
      });
    }
  }
}
