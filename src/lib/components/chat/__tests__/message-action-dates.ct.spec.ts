import { expect, test } from '../../../../test/ct-test';
import ChatMessage from '../ChatMessage.svelte';
import type { AgentMessage } from '$shared/types';

test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });

for (const role of ['user', 'assistant'] as const) {
  for (const zoom of [1, 2]) {
    test(`${role} dates and actions fit the minimum panel at ${zoom * 100}% zoom`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 240 * zoom, height: 500 * zoom });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.setFixedTime(new Date('2026-09-22T12:00:00Z'));
      await page.evaluate((scale) => {
        document.documentElement.style.zoom = String(scale);
      }, zoom);
      const message: AgentMessage = {
        id: `synthetic-${role}-date`,
        role,
        timestamp: '2025-11-22T19:55:00Z',
        contentBlocks: [{ type: 'text', text: 'Short message.' }],
      };
      let actionCount = 0;
      const component = await mount(ChatMessage, {
        props: {
          message,
          onRegenerate: () => {},
          onFork: () => actionCount++,
          onVote: () => {},
          onScrollToPrevious: () => actionCount++,
        },
      });
      await page.evaluate(() => document.fonts.ready);
      const toolbar = component.getByTestId('message-actions');
      const surface = role === 'user' ? component.getByTestId('user-message-surface') : component;
      const before = (await surface.boundingBox())!;
      await surface.hover();
      await expect(toolbar).toHaveCSS('opacity', '1');
      expect((await surface.boundingBox())!.height).toBeCloseTo(before.height, 1);

      const geometry = await toolbar.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const time = node.querySelector('time')!;
        const range = document.createRange();
        range.selectNodeContents(time);
        return {
          box: box.toJSON(),
          text: time.textContent,
          expected: new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(time.dateTime)),
          contents: [
            ...Array.from(range.getClientRects(), (rect) => rect.toJSON()),
            ...Array.from(node.querySelectorAll('button'), (button) =>
              button.getBoundingClientRect().toJSON(),
            ),
          ],
        };
      });
      expect(geometry.text).toBe(geometry.expected);
      await testInfo.attach('geometry', {
        body: JSON.stringify({ surface: before, ...geometry }, null, 2),
        contentType: 'application/json',
      });
      expect(geometry.box.left).toBeGreaterThanOrEqual(before.x);
      expect(geometry.box.right).toBeLessThanOrEqual(before.x + before.width);
      expect(geometry.box.top).toBeGreaterThanOrEqual(before.y);
      expect(geometry.box.bottom).toBeLessThanOrEqual(before.y + before.height);
      for (const rect of geometry.contents) {
        expect(rect.left).toBeGreaterThanOrEqual(geometry.box.left - 1);
        expect(rect.right).toBeLessThanOrEqual(geometry.box.right + 1);
        expect(rect.top).toBeGreaterThanOrEqual(geometry.box.top - 1);
        expect(rect.bottom).toBeLessThanOrEqual(geometry.box.bottom + 1);
      }
      for (const button of await toolbar.getByRole('button').all()) {
        await button.click({ trial: true });
      }
      await page.mouse.move(239 * zoom, 450 * zoom);
      await expect(toolbar).toHaveCSS('opacity', '0');
      const action = toolbar.locator(
        role === 'user' ? '[data-action-id="scroll-previous"]' : 'button[aria-haspopup="menu"]',
      );
      await action.focus();
      await expect(toolbar).toHaveCSS('opacity', '1');
      await action.click({ trial: true });
      await testInfo.attach('message-actions', {
        body: await component.screenshot(),
        contentType: 'image/png',
      });
      await page.keyboard.press('Enter');
      if (role === 'assistant') {
        await page.getByRole('menuitem', { name: /Fork conversation/ }).click();
      }
      await expect.poll(() => actionCount).toBe(1);
      expect((await surface.boundingBox())!.height).toBeCloseTo(before.height, 1);
      if (role === 'assistant') {
        await page.setViewportSize({ width: 640 * zoom, height: 500 * zoom });
        await expect(toolbar.locator('[data-action-id="fork"]')).toBeVisible();
        await expect(toolbar.locator('button[aria-haspopup="menu"]')).toHaveCount(0);
      }
    });
  }
}
