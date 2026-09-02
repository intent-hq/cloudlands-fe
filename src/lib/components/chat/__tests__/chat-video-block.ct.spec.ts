import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatVideoBlockHost from './ChatVideoBlockHost.svelte';

for (const theme of ['dark'] as const) {
  test(`opens accessible modal playback without changing transcript follow in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 360, height: 720 });
    const component = await mount(ChatVideoBlockHost, {
      props: { theme, width: 160, zoom: 2 },
    });
    const scroll = component.getByTestId('transcript-scroll');
    await scroll.evaluate((node) => (node.scrollTop = node.scrollHeight));

    const snapshot = component.getByRole('button', { name: 'Play demo.mp4' });
    await expect(snapshot.locator('video')).not.toHaveAttribute('controls', '');
    await snapshot.focus();
    const keyboardBefore = await scroll.evaluate((node) => node.scrollTop);
    await snapshot.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Video preview: demo.mp4' });
    await expect(dialog).toBeVisible();
    const player = dialog.getByTestId('chat-video-player');
    await expect(player).toHaveAttribute('controls', '');
    await expect(player).not.toHaveAttribute('autoplay', '');
    await expect(dialog.getByRole('button', { name: 'Video options' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(snapshot).toBeFocused();
    expect(await scroll.evaluate((node) => node.scrollTop)).toBe(keyboardBefore);

    const mouseBefore = await scroll.evaluate((node) => node.scrollTop);
    const [snapshotBox, scrollBox] = await Promise.all([
      snapshot.boundingBox(),
      scroll.boundingBox(),
    ]);
    expect(snapshotBox).not.toBeNull();
    expect(scrollBox).not.toBeNull();
    const visibleTop = Math.max(snapshotBox!.y, scrollBox!.y);
    const visibleBottom = Math.min(
      snapshotBox!.y + snapshotBox!.height,
      scrollBox!.y + scrollBox!.height,
    );
    expect(visibleBottom).toBeGreaterThan(visibleTop);
    const clickPoint = {
      x: snapshotBox!.x + snapshotBox!.width / 2,
      y: (visibleTop + visibleBottom) / 2,
    };
    await expect
      .poll(() =>
        snapshot.evaluate(
          (node, point) => node.contains(document.elementFromPoint(point.x, point.y)),
          clickPoint,
        ),
      )
      .toBe(true);
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await expect(dialog).toBeVisible();
    expect(await scroll.evaluate((node) => node.scrollTop)).toBe(mouseBefore);
    await dialog.getByRole('button', { name: 'Close video preview' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(snapshot).toBeFocused();
    expect(await scroll.evaluate((node) => node.scrollTop)).toBe(mouseBefore);
    expect((await snapshot.boundingBox())?.width).toBeLessThanOrEqual(320);
  });
}
