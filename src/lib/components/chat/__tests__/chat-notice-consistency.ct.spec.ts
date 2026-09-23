import { expect, test } from '../../../../test/ct-test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ChatNoticeConsistencyHost from './ChatNoticeConsistencyHost.svelte';

for (const scenario of [
  { name: 'light-wide', theme: 'light' as const, width: 420, zoom: 1 },
  { name: 'dark-narrow-zoomed', theme: 'dark' as const, width: 240, zoom: 2 },
]) {
  test(`consistent notice geometry: ${scenario.name}`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1200, height: 1400 });
    const component = await mount(ChatNoticeConsistencyHost, { props: scenario });
    await page.evaluate(() => document.fonts.ready);
    const backgroundBrightness = await component
      .locator('[data-notice-surface]')
      .evaluate((node) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        context.fillStyle = getComputedStyle(node).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
        return (red + green + blue) / 3;
      });
    if (scenario.theme === 'dark') expect(backgroundBrightness).toBeLessThan(128);
    else expect(backgroundBrightness).toBeGreaterThan(128);
    const geometry = await component.locator('[data-notice-variant]').evaluateAll((cells) =>
      cells.map((cell) => {
        const notice = cell.lastElementChild as HTMLElement;
        const preceding = cell.querySelector('[data-preceding-content]')!;
        const style = getComputedStyle(notice);
        const typography = (selector: string) => {
          const node = cell.querySelector(selector);
          if (!node) return null;
          const textStyle = getComputedStyle(node);
          return { fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight };
        };
        return {
          variant: cell.getAttribute('data-notice-variant'),
          seam: notice.getBoundingClientRect().top - preceding.getBoundingClientRect().bottom,
          border: parseFloat(style.borderTopWidth),
          background: style.backgroundColor,
          overflow: notice.scrollWidth - notice.clientWidth,
          proseTypography: typography('[data-assistant-prose] p'),
          labelTypography: typography('[data-chat-notice-label]'),
          reasonTypography: typography('[data-chat-notice-reason]'),
        };
      }),
    );
    const captureDir = process.env.CHAT_NOTICE_CAPTURE_DIR;
    if (captureDir) {
      await mkdir(captureDir, { recursive: true });
      await component.screenshot({ path: join(captureDir, `${scenario.name}.png`) });
      await writeFile(join(captureDir, `${scenario.name}.json`), JSON.stringify(geometry, null, 2));
    }
    for (const notice of geometry) {
      expect(notice.seam, notice.variant ?? '').toBeCloseTo(40 * scenario.zoom, 1);
      expect(notice.border, notice.variant ?? '').toBe(0);
      expect(notice.background, notice.variant ?? '').toBe('rgba(0, 0, 0, 0)');
      expect(notice.overflow, notice.variant ?? '').toBeLessThanOrEqual(1);
      expect(notice.proseTypography, notice.variant ?? '').not.toBeNull();
      expect(notice.labelTypography, notice.variant ?? '').toEqual(notice.proseTypography);
      if (notice.reasonTypography) {
        expect(notice.reasonTypography, notice.variant ?? '').toEqual(notice.proseTypography);
      }
    }
    for (const cell of await component.locator('[data-notice-variant]').all()) {
      const prose = await cell.locator('[data-assistant-prose]').boundingBox();
      const label = await cell.locator('[data-chat-notice-label]').boundingBox();
      // Notice text shares the real assistant prose origin, including its theme/zoom context.
      expect(label!.x).toBeCloseTo(prose!.x, 1);
      const reason = cell.locator('[data-chat-notice-reason]');
      if (await reason.count()) {
        const reasonBox = await reason.boundingBox();
        expect(label!.x).toBeCloseTo(reasonBox!.x, 1);
        expect(reasonBox!.y).toBeGreaterThanOrEqual(label!.y + label!.height);
      }
    }
  });
}
