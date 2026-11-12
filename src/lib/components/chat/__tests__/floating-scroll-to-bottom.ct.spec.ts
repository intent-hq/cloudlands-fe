import { expect, test, wheelUntilScrolled } from '../../../../test/ct-test';
import ChatMessageNavigatorIntegrationHost from './ChatMessageNavigatorIntegrationHost.svelte';

for (const scenario of [
  { theme: 'light', width: 900, reducedMotion: 'no-preference' },
  { theme: 'dark', width: 360, reducedMotion: 'no-preference' },
  { theme: 'light', width: 900, reducedMotion: 'reduce' },
] as const) {
  test(`floating latest button: ${scenario.theme} ${scenario.width} ${scenario.reducedMotion}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 760 });
    await page.emulateMedia({ reducedMotion: scenario.reducedMotion });
    const component = await mount(ChatMessageNavigatorIntegrationHost, {
      props: { theme: scenario.theme },
    });
    const viewport = page.getByTestId('chat-transcript-scroll-viewport');
    const button = page.getByTestId('chat-floating-scroll-to-bottom-button');
    const gap = () => viewport.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
    await expect.poll(gap).toBeLessThanOrEqual(2);
    await expect(button).toHaveCount(0);
    await wheelUntilScrolled(viewport, { deltaY: -1400 });
    await expect(button).toBeVisible();
    const [buttonBox, viewportBox, composerBox] = await Promise.all([
      button.boundingBox(),
      viewport.boundingBox(),
      page.getByTestId('chat-composer-shell').boundingBox(),
    ]);
    if (!buttonBox || !viewportBox || !composerBox) throw new Error('Missing chat geometry');
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(composerBox.y);
    await testInfo.attach('scrolled-up', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await button.click();
    await expect.poll(gap).toBeLessThanOrEqual(2);
    await expect(button).toHaveCount(0);
    await component
      .getByTestId('append-streaming-message')
      .evaluate((el: HTMLButtonElement) => el.click());
    await expect(page.getByText('New streamed tail content.', { exact: false })).toBeVisible();
    await expect.poll(gap).toBeLessThanOrEqual(2);
    await expect(button).toHaveCount(0);
    await testInfo.attach('at-latest', { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('empty chat keeps the floating latest button hidden', async ({ mount, page }) => {
  await mount(ChatMessageNavigatorIntegrationHost, { props: { messages: [] } });
  await expect(page.getByTestId('chat-composer-shell')).toBeVisible();
  await expect(page.getByTestId('chat-floating-scroll-to-bottom-button')).toHaveCount(0);
});
