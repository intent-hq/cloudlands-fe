import { expect, test } from '../../../../test/ct-test';
import ChatNoticeConsistencyHost from './ChatNoticeConsistencyHost.svelte';

for (const scenario of [
  { name: 'light-wide', theme: 'light' as const, width: 420, zoom: 1 },
  { name: 'dark-narrow-zoomed', theme: 'dark' as const, width: 240, zoom: 2 },
]) {
  test(`notice content stays contained without overlap: ${scenario.name}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1200, height: 1400 });
    const component = await mount(ChatNoticeConsistencyHost, { props: scenario });
    await page.evaluate(() => document.fonts.ready);
    const geometry = await component.locator('[data-notice-variant]').evaluateAll((cells) =>
      cells.map((cell) => {
        const notice = cell.lastElementChild as HTMLElement;
        return {
          variant: cell.getAttribute('data-notice-variant'),
          overflow: notice.scrollWidth - notice.clientWidth,
        };
      }),
    );
    for (const notice of geometry) {
      expect(notice.overflow, notice.variant ?? '').toBeLessThanOrEqual(1);
    }
    for (const cell of await component.locator('[data-notice-variant]').all()) {
      const label = await cell.locator('[data-chat-notice-label]').boundingBox();
      const reason = cell.locator('[data-chat-notice-reason]');
      if (await reason.count()) {
        const reasonBox = await reason.boundingBox();
        expect(reasonBox!.y).toBeGreaterThanOrEqual(label!.y + label!.height);
      }
    }
  });
}
