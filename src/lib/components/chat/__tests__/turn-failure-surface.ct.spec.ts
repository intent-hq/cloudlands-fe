import { expect, test } from '@playwright/experimental-ct-svelte';
import TurnFailureNotice from '../TurnFailureNotice.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`turn failure stays unboxed in ${theme} mode`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width: 510, height: 180 });
    await page.evaluate((theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }, theme);
    await mount(TurnFailureNotice, {
      props: { reason: 'The agent stopped before it could finish the response.' },
    });

    const notice = page.getByRole('alert');
    await expect(notice).toBeVisible();
    await testInfo.attach('failure-surface', {
      body: await notice.screenshot({ path: testInfo.outputPath('failure-surface.png') }),
      contentType: 'image/png',
    });
    await testInfo.attach('failure-geometry', {
      body: JSON.stringify(
        await notice.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            width: rect.width,
            height: rect.height,
            background: style.backgroundColor,
            border: style.borderWidth,
          };
        }),
      ),
      contentType: 'application/json',
    });
    await expect(notice).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      await expect(notice).toHaveCSS(`border-${side}-width`, '0px');
    }
    await expect(notice).toHaveAttribute('aria-live', 'polite');
  });
}
