import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatVideoBlockHost from './ChatVideoBlockHost.svelte';

const demoVideo = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANcbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAHgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAod0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAB4AAAEAAABAAAAAAH/bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAABgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABqm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAWpzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAL7iAAAAAAAAABhzdHRzAAAAAAAAAAEAAAADAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAKGN0dHMAAAAAAAAAAwAAAAEAAAQAAAAAAQAABgAAAAABAAACAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAwAAAAEAAAAgc3RzegAAAAAAAAAAAAAAAwAAAsUAAAAMAAAADAAAABRzdGNvAAAAAAAAAAEAAAOMAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2MS43LjEwMAAAAAhmcmVlAAAC5W1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEADP//vbsvgU2FMjBAAAACEGaImxCv/7AAAAACAGeQXkK/8SB',
  'base64',
);

for (const theme of ['dark'] as const) {
  test(`opens accessible modal playback without changing transcript follow in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('https://media.example/demo.mp4', (route) =>
      route.fulfill({ contentType: 'video/mp4', body: demoVideo }),
    );
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
