import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatVideoBlockHost from './ChatVideoBlockHost.svelte';

for (const theme of ['light', 'dark'] as const) {
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
    const before = await scroll.evaluate((node) => node.scrollTop);

    const snapshot = component.getByRole('button', { name: 'Play demo.mp4' });
    await expect(snapshot.locator('video')).not.toHaveAttribute('controls', '');
    await expect(snapshot).toHaveClass(/aspect-video/);
    await snapshot.focus();
    await snapshot.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Video preview: demo.mp4' });
    await expect(dialog).toBeVisible();
    const player = dialog.getByTestId('chat-video-player');
    await expect(player).toHaveAttribute('controls', '');
    await expect(player).not.toHaveAttribute('autoplay', '');
    await expect(dialog.getByRole('link', { name: 'Open or download video' })).toHaveAttribute(
      'href',
      'https://media.example/demo.mp4',
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(snapshot).toBeFocused();
    expect(await scroll.evaluate((node) => node.scrollTop)).toBe(before);
    expect((await snapshot.boundingBox())?.width).toBeLessThanOrEqual(320);
  });
}
