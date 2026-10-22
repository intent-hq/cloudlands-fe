import { expect, test } from '../../../../test/ct-test';
import TooltipSurfaceHarness from './TooltipSurfaceHarness.svelte';

test.use({ viewport: { width: 720, height: 480 }, reducedMotion: 'reduce' });

// Both themes matter: the semantic surfaces use different color tokens.
for (const theme of ['light', 'dark'] as const) {
  for (const variant of ['browser', 'default', 'info', 'success', 'warning', 'error'] as const) {
    test(`${theme} ${variant} tooltip hides underlying status text and remains keyboard accessible`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle('dark', value),
        theme === 'dark',
      );
      await mount(TooltipSurfaceHarness, { props: { variant } });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const trigger = page.getByRole('button');
      const tooltip = page.getByRole('tooltip');
      await trigger.hover();
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveCSS('opacity', '1');
      await expect
        .poll(() =>
          tooltip.evaluate((node) =>
            node.getAnimations().every((animation) => animation.playState === 'finished'),
          ),
        )
        .toBe(true);
      const box = (await tooltip.boundingBox())!;
      const status = page.getByTestId('underlying-status');
      const statusBox = (await status.boundingBox())!;
      const overlap = {
        left: Math.max(box.x, statusBox.x),
        top: Math.max(box.y, statusBox.y),
        right: Math.min(box.x + box.width, statusBox.x + statusBox.width),
        bottom: Math.min(box.y + box.height, statusBox.y + statusBox.height),
      };
      expect(overlap.right).toBeGreaterThan(overlap.left);
      expect(overlap.bottom).toBeGreaterThan(overlap.top);
      // Hit testing independently verifies stacking, not just a z-index value.
      expect(
        await tooltip.evaluate(
          (node, area) =>
            node.contains(
              document.elementFromPoint((area.left + area.right) / 2, (area.top + area.bottom) / 2),
            ),
          overlap,
        ),
      ).toBe(true);
      // Compare the actual painted interior with/without underlying text. No
      // golden colors: an opaque overlay must be unaffected by content below it.
      const clip = { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 };
      const withStatus = await page.screenshot({ clip });
      await testInfo.attach('tooltip-over-status', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await status.evaluate((node) => {
        node.style.visibility = 'hidden';
      });
      await expect(status).toBeHidden();
      const withoutStatus = await page.screenshot({ clip });
      await status.evaluate((node) => {
        node.style.visibility = '';
      });
      expect(
        withStatus.equals(withoutStatus),
        'Underlying status must not change the painted tooltip',
      ).toBe(true);
      // Long host labels must wrap inside the surface rather than escape it.
      const contained = await tooltip.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return Array.from(node.querySelectorAll('h4, p')).every((text) => {
          const range = document.createRange();
          range.selectNodeContents(text);
          return Array.from(range.getClientRects()).every(
            (rect) =>
              rect.left >= bounds.left &&
              rect.right <= bounds.right &&
              rect.top >= bounds.top &&
              rect.bottom <= bounds.bottom,
          );
        });
      });
      expect(contained).toBe(true);
      await page.mouse.move(700, 450);
      await expect(tooltip).toHaveCount(0);
      await page.keyboard.press('Tab');
      await expect(trigger).toBeFocused();
      await expect(tooltip).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(tooltip).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
}
