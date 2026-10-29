import { expect, test } from '../../../test/ct-test';
import TypingPreview from './presence-typing.preview.svelte';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

for (const scenario of [
  { name: 'wide', width: 720, chief: false },
  { name: 'narrow', width: 320, chief: false },
  { name: 'chief', width: 320, chief: true },
]) {
  test(`typing fits above the prompt without moving chat content (${scenario.name})`, async ({
    mount,
    page,
  }, testInfo) => {
    const props = {
      width: scenario.width,
      chief: scenario.chief,
      monitors: true,
      initializeStore: true,
      typing: false,
    };
    const component = await mount(TypingPreview, { props });
    const monitor = component.getByTestId('event-subscriptions-card');
    const prompt = component.getByTestId('question-composer-input');
    const transcript = component.getByTestId('chat-transcript-scroll-viewport');
    const indicator = component.locator('[data-presence-typing-indicator]');
    await expect(monitor).toBeVisible();
    await expect(prompt).toBeVisible();
    await expect(indicator).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    const before = {
      monitor: await monitor.boundingBox(),
      prompt: await prompt.boundingBox(),
      transcript: await transcript.boundingBox(),
    };

    for (const multiple of [false, true]) {
      await component.update({ props: { ...props, typing: true, multiple } });
      await expect(indicator).toBeVisible();
      await expect(indicator).toContainText('Amelia');
      await expect
        .poll(async () => ({
          monitor: await monitor.boundingBox(),
          prompt: await prompt.boundingBox(),
          transcript: await transcript.boundingBox(),
        }))
        .toEqual(before);
      const typingBox = (await indicator.boundingBox())!;
      expect(typingBox.y).toBeGreaterThanOrEqual(before.transcript!.y + before.transcript!.height);
      expect(typingBox.y).toBeGreaterThanOrEqual(before.monitor!.y + before.monitor!.height);
      expect(typingBox.y + typingBox.height).toBeLessThanOrEqual(before.prompt!.y);
    }
    const screenshot = testInfo.outputPath(`typing-gap-${scenario.name}.png`);
    await component.screenshot({ path: screenshot });
    await testInfo.attach('Typing in the existing composer gap', {
      path: screenshot,
      contentType: 'image/png',
    });
    await component.update({ props });
    await expect(indicator).toHaveCount(0);
    await expect
      .poll(async () => ({
        monitor: await monitor.boundingBox(),
        prompt: await prompt.boundingBox(),
        transcript: await transcript.boundingBox(),
      }))
      .toEqual(before);
  });
}
