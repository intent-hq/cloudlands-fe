import { expect, test } from '../../../test/ct-test';
import WorkspaceTabDragRegionHarness from './WorkspaceTabDragRegionHarness.svelte';

// A Mac browser has no native traffic lights in the page, so the titlebar must
// not reserve their clearance when Intent runs on the web.
test.use({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});

test('web titlebar on macOS starts the home control at the left edge', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 900, height: 400 });
  const component = await mount(WorkspaceTabDragRegionHarness);
  const titlebar = component.locator('.window-title-bar');
  const controls = component.locator('[data-titlebar-fixed-controls]');
  await expect(controls).toBeVisible();

  const inset = await titlebar.evaluate((root) => {
    const controlsEl = root.querySelector<HTMLElement>('[data-titlebar-fixed-controls]')!;
    return controlsEl.getBoundingClientRect().left - root.getBoundingClientRect().left;
  });
  const screenshotPath = testInfo.outputPath('web-titlebar-mac.png');
  await titlebar.screenshot({ path: screenshotPath });
  await testInfo.attach('web-titlebar-mac', { path: screenshotPath, contentType: 'image/png' });
  expect(inset, 'No traffic-light clearance in a browser').toBeLessThan(40);
  await expect(titlebar).not.toHaveClass(/window-title-bar-mac/);
});
