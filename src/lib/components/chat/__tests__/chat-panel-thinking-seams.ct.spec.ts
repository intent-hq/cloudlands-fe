import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(120_000);

const eventPairs = [
  ['event-wake', 'assistant-wake'],
  ['event-subscription', 'assistant-subscription'],
  ['event-finished-event', 'assistant-finished-event'],
  ['event-sent', 'assistant-sent'],
  ['event-waiting', 'assistant-waiting'],
  ['event-streaming-seam', 'assistant-streaming-seam'],
] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 720]) {
    for (const zoom of [1, 2]) {
      test(`owns directional Thinking seams in ${theme} at ${width}px and ${zoom * 100}%`, async ({
        mount,
        page,
      }) => {
        const component = await mount(ChatPanelOperationalGeometryHost, {
          props: { theme, width, zoom, seamOnly: true },
        });

        for (const [eventId, assistantId] of eventPairs) {
          const event = component.locator(`[data-message-id="${eventId}"]`);
          const assistant = component.locator(`[data-message-id="${assistantId}"]`);
          const thinking = assistant.locator('[data-message-content-block="thinking"]').first();
          await expect(thinking).toBeVisible();
          await page.waitForTimeout(300);
          const gap = await event.evaluate((element, nextId) => {
            const next = document.querySelector(`[data-message-id="${nextId}"]`)!;
            const thinkingWrapper = next.querySelector('[data-message-content-block="thinking"]')!;
            return (
              thinkingWrapper.getBoundingClientRect().top - element.getBoundingClientRect().bottom
            );
          }, assistantId);
          expect(gap, `${eventId}>Thinking`).toBeCloseTo(12 * zoom, 1);
        }

        for (const [messageId, topLevelTypes, topLevelGaps] of [
          ['assistant-static-tools', ['tool_use', 'thinking', 'tool_use', 'tool_use'], [12, 4, 4]],
          [
            'assistant-streaming-seam',
            ['thinking', 'tool_use', 'thinking', 'tool_use', 'tool_use'],
            [4, 12, 4, 4],
          ],
        ] as const) {
          const message = component.locator(`[data-message-id="${messageId}"]`);
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
              gaps: [12, 4, 4],
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
