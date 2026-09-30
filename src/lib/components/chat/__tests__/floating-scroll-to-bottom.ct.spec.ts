import { expect, test } from '../../../../test/ct-test';
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
    await viewport.hover();
    await page.mouse.wheel(0, -1400);
    await expect(button).toBeVisible();
    const [buttonBox, viewportBox, composerBox] = await Promise.all([
      button.boundingBox(),
      viewport.boundingBox(),
      page.getByTestId('chat-composer-shell').boundingBox(),
    ]);
    if (!buttonBox || !viewportBox || !composerBox) throw new Error('Missing chat geometry');
    expect(
      Math.abs(buttonBox.x + buttonBox.width / 2 - viewportBox.x - viewportBox.width / 2),
    ).toBeLessThan(15);
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(composerBox.y);
    await testInfo.attach('scrolled-up', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // Record actual animation frames from the same click through completion.
    const samples = await button.evaluate(async (el) => {
      const viewport = document.querySelector<HTMLElement>(
        '[data-testid="chat-transcript-scroll-viewport"]',
      )!;
      const positions = [viewport.scrollTop];
      (el as HTMLButtonElement).click();
      for (let frame = 0; frame < 45; frame++) {
        await new Promise(requestAnimationFrame);
        positions.push(viewport.scrollTop);
      }
      return positions;
    });
    await expect.poll(gap).toBeLessThanOrEqual(2);
    await expect(button).toHaveCount(0);
    const start = samples[0];
    const end = samples.at(-1)!;
    expect(end - start).toBeGreaterThan(100);
    if (scenario.reducedMotion === 'no-preference') {
      expect(samples.some((position) => position > start + 5 && position < end - 5)).toBe(true);
    } else {
      expect(Math.abs(samples[1] - end)).toBeLessThanOrEqual(2);
    }
    await component
      .getByTestId('append-streaming-message')
      .evaluate((el: HTMLButtonElement) => el.click());
    await expect(page.getByText('New streamed tail content.', { exact: false })).toBeVisible();
    await expect.poll(gap).toBeLessThanOrEqual(2);
    await expect(button).toHaveCount(0);
    await testInfo.attach('at-latest', { body: await page.screenshot(), contentType: 'image/png' });
    await testInfo.attach('scroll-animation-frames', {
      body: JSON.stringify({ scenario, samples }),
      contentType: 'application/json',
    });
  });
}

test('empty chat keeps the floating latest button hidden', async ({ mount, page }) => {
  await mount(ChatMessageNavigatorIntegrationHost, { props: { messages: [] } });
  await expect(page.getByTestId('chat-composer-shell')).toBeVisible();
  await expect(page.getByTestId('chat-floating-scroll-to-bottom-button')).toHaveCount(0);
});
