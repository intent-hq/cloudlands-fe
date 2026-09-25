import { expect, test } from '../../../../../test/ct-test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import Harness from './AgentToastIconHarness.svelte';

for (const kind of ['failure', 'attention'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${kind} toast aligns glyph and workspace badge with its first line in ${theme}`, async ({
      mount,
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 600 });
      await page.evaluate(
        (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
        theme,
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mount(Harness, { props: { kind } });
      const toast = page.locator('[data-sonner-toast]');
      await expect(toast).toBeVisible();
      await expect(toast).toHaveAttribute('data-mounted', 'true');
      await page.evaluate(() => document.fonts.ready);
      await toast.evaluate((node) =>
        Promise.all(
          node.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
      const geometry = await toast.evaluate((node) => {
        const title = node.querySelector('.toast-title')!;
        const rect = title.getBoundingClientRect();
        const lineHeight = Number.parseFloat(getComputedStyle(title).lineHeight);
        return {
          center: rect.top + lineHeight / 2,
          lines: rect.height / lineHeight,
          icons: Array.from(node.querySelectorAll('.first-line-icon > *')).map((icon) => {
            const box = icon.getBoundingClientRect();
            return box.top + box.height / 2;
          }),
          overflow: node.scrollWidth - node.clientWidth,
        };
      });
      expect(geometry.icons).toHaveLength(2);
      for (const center of geometry.icons)
        expect(Math.abs(center - geometry.center)).toBeLessThanOrEqual(1);
      if (kind === 'failure') expect(geometry.lines).toBeGreaterThan(1);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      if (process.env.MODAL_AUDIT_CAPTURE_DIR) {
        await mkdir(process.env.MODAL_AUDIT_CAPTURE_DIR, { recursive: true });
        await toast.screenshot({
          path: join(process.env.MODAL_AUDIT_CAPTURE_DIR, `agent-${kind}-${theme}-320.png`),
        });
      }
    });
  }
}
