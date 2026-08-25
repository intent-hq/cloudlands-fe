import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(120_000);

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2]) {
    if ((theme === 'light' && zoom !== 1) || (theme === 'dark' && zoom !== 2)) continue;
    test(`keeps cross-message tool seams at 0px in ${theme} at ${zoom * 100}%`, async ({
      mount,
    }) => {
      const component = await mount(ChatPanelOperationalGeometryHost, {
        props: { theme, zoom, width: 560, seamOnly: true },
      });
      const row = (messageId: string) =>
        component.locator(`[data-message-id="${messageId}"] [data-chat-operational-row]`).first();
      const pairs = [
        ['assistant-orphan-tool-a', 'assistant-orphan-tool-b', 'turn'],
        ['assistant-tool-message-static', 'assistant-tool-message-streaming', 'message'],
      ] as const;

      for (const [beforeId, afterId, owner] of pairs) {
        const before = row(beforeId);
        const after = row(afterId);
        await expect(before).toBeVisible();
        await expect(after).toBeVisible();
        const measureGeometry = () =>
          component.evaluate(
            (root, messageIds) => {
              return messageIds.map((messageId) => {
                const element = root.querySelector(
                  `[data-message-id="${messageId}"] [data-chat-operational-row]`,
                )!;
                const box = element
                  .querySelector('[data-operational-disclosure-row]')!
                  .getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                  top: box.top,
                  bottom: box.bottom,
                  height: box.height,
                  margins: [style.marginTop, style.marginBottom],
                };
              });
            },
            [beforeId, afterId],
          );
        await expect
          .poll(async () => {
            const boxes = await measureGeometry();
            return Math.round((boxes[1].top - boxes[0].bottom) * 10) / 10;
          })
          .toBe(0);
        const geometry = await measureGeometry();
        expect(geometry[0].height).toBeCloseTo(28 * zoom, 1);
        expect(geometry[1].height).toBeCloseTo(28 * zoom, 1);
        expect(Math.abs(geometry[1].top - geometry[0].bottom)).toBeLessThanOrEqual(0.5);
        expect(geometry.flatMap(({ margins }) => margins)).toEqual(['0px', '0px', '0px', '0px']);

        if (owner === 'turn') {
          const seam = component.locator('[data-tool-seam="true"]');
          expect(await seam.count()).toBeGreaterThanOrEqual(3);
          for (const gap of await seam.all()) {
            await expect(gap).toHaveCSS('height', '0px');
            await expect(gap).toHaveAttribute('aria-hidden', 'true');
          }
        } else {
          const message = component.locator(`[data-message-id="${afterId}"]`);
          await expect(message).toHaveAttribute('data-operational-message-seam', 'true');
          await expect(message).toHaveCSS('margin-top', '0px');
          await expect(component.locator(`[data-after-assistant-message="${beforeId}"]`)).toHaveCSS(
            'margin-bottom',
            '0px',
          );
        }
        await expect(after.getByTestId('tool-call-disclosure')).toHaveAttribute(
          'aria-label',
          /Read .*\.ts/,
        );
      }

      const productionRows = [
        'assistant-production-search',
        'assistant-production-reopen',
        'assistant-production-reasoning',
      ].map((messageId) => row(messageId));
      await expect(productionRows[0]).toBeVisible();
      await expect(productionRows[1]).toBeVisible();
      await expect(productionRows[2]).toBeVisible();
      const productionGeometry = await component.evaluate((root) =>
        [
          'assistant-production-search',
          'assistant-production-reopen',
          'assistant-production-reasoning',
        ].map((messageId) => {
          const message = root.querySelector(`[data-message-id="${messageId}"]`)!;
          const operational = message.querySelector('[data-chat-operational-row]')!;
          const rowBox = operational
            .querySelector('[data-operational-disclosure-row]')!
            .getBoundingClientRect();
          const messageStyle = getComputedStyle(message);
          return {
            top: rowBox.top,
            bottom: rowBox.bottom,
            height: rowBox.height,
            messageMargins: [messageStyle.marginTop, messageStyle.marginBottom],
          };
        }),
      );
      expect(productionGeometry.map(({ height }) => height)).toEqual([
        28 * zoom,
        28 * zoom,
        28 * zoom,
      ]);
      expect(
        Math.abs(productionGeometry[1].top - productionGeometry[0].bottom),
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(productionGeometry[2].top - productionGeometry[1].bottom),
      ).toBeLessThanOrEqual(0.5);
      expect(productionGeometry.flatMap(({ messageMargins }) => messageMargins)).toEqual([
        '0px',
        '0px',
        '0px',
        '0px',
        '0px',
        '0px',
      ]);
      await expect(
        component.locator('[data-message-id="assistant-production-reasoning"]'),
      ).not.toHaveCSS('padding-top', '8px');

      const eventSpacing = await component.evaluate((root) => {
        const beforeTool = root
          .querySelector(
            '[data-message-id="assistant-before-event-tool"] [data-operational-disclosure-row]',
          )!
          .getBoundingClientRect();
        const event = root
          .querySelector('[data-message-id="event-tool-spacing"]')!
          .getBoundingClientRect();
        const eventTool = root
          .querySelector(
            '[data-message-id="assistant-tool-spacing"] [data-operational-disclosure-row]',
          )!
          .getBoundingClientRect();
        return {
          beforeEvent: event.top - beforeTool.bottom,
          afterEvent: eventTool.top - event.bottom,
          eventToolHeight: eventTool.height,
        };
      });
      expect(eventSpacing.beforeEvent).toBeCloseTo(32 * zoom, 1);
      expect(eventSpacing.afterEvent).toBeCloseTo(32 * zoom, 1);
      expect(eventSpacing.eventToolHeight).toBeCloseTo(28 * zoom, 1);

      const userSpacing = await component.evaluate((root) => {
        const previousOperational = root
          .querySelector('[data-message-id="assistant-waiting"] [data-operational-disclosure-row]')!
          .getBoundingClientRect();
        const userMessage = root
          .querySelector('[data-message-id="user-static-tools"]')!
          .getBoundingClientRect();
        return userMessage.top - previousOperational.bottom;
      });
      expect(userSpacing).toBeCloseTo(40 * zoom, 1);

      const userBottomSpacing = await component.evaluate((root) => {
        const userMessage = root
          .querySelector('[data-message-id="user-static-tools"]')!
          .getBoundingClientRect();
        const assistantRow = root
          .querySelector(
            '[data-message-id="assistant-static-tools"] [data-operational-disclosure-row]',
          )!
          .getBoundingClientRect();
        return assistantRow.top - userMessage.bottom;
      });
      expect(userBottomSpacing).toBeCloseTo(28 * zoom, 1);
      await expect(
        component
          .getByTestId('chat-transcript-scroll-viewport')
          .getByTestId('chat-scroll-to-bottom-button'),
      ).toHaveCount(0);
    });
  }
}
