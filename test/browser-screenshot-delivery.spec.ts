import { expect, test } from '@playwright/test';
import { resolveBrowserScreenshotSource } from '../src/lib/components/chat/browser-screenshot-source';

const SCREENSHOTS = [
  {
    mimeType: 'image/png',
    base64:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl2kAAAAASUVORK5CYII=',
  },
  {
    mimeType: 'image/jpeg',
    base64:
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=',
  },
] as const;

for (const screenshot of SCREENSHOTS) {
  test(`current-source ${screenshot.mimeType} fallback decodes in Chromium`, async ({ page }) => {
    const source = resolveBrowserScreenshotSource({ screenshotBase64: screenshot.base64 });
    expect(source).toBe(`data:${screenshot.mimeType};base64,${screenshot.base64}`);

    await page.setContent(`<img alt="Browser screenshot" src="${source}">`);
    const image = page.getByRole('img', { name: 'Browser screenshot' });
    await image.evaluate((element) => (element as HTMLImageElement).decode());

    await expect(image).toHaveJSProperty('naturalWidth', 1);
    await expect(image).toHaveJSProperty('naturalHeight', 1);
    await expect
      .poll(() =>
        page.evaluate(() =>
          fetch(document.images[0].src).then((r) => r.blob().then((b) => b.type)),
        ),
      )
      .toBe(screenshot.mimeType);
  });
}

test('current-source asset fallback keeps only safe URLs', () => {
  expect(
    resolveBrowserScreenshotSource({
      screenshotUrl: 'workspace-asset://workspace-1/current-source-shot.jpg',
    }),
  ).toBe('workspace-asset://workspace-1/current-source-shot.jpg');
  expect(resolveBrowserScreenshotSource({ screenshotUrl: 'javascript:alert(1)' })).toBeNull();
});
