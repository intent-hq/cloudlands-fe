import { expect, test } from '../../../../test/ct-test';
import Preview from '../chat-image-height.preview.svelte';

for (const scenario of [
  { name: 'sized portrait images', props: {} },
  { name: 'images without dimensions', props: { unsized: true } },
  { name: 'streaming images', props: { isStreaming: true } },
]) {
  test(`${scenario.name} leave room for the conversation and resize with the window`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 700 });
    const component = await mount(Preview, { props: scenario.props });
    const images = component.locator('img');
    await expect(images).toHaveCount(3);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    for (const image of await images.all()) {
      await image.evaluate((node: HTMLImageElement) => node.decode());
      expect((await image.boundingBox())!.height).toBeLessThanOrEqual(viewportHeight / 2);
    }

    await page.setViewportSize({ width: 480, height: 300 });
    const resizedViewportHeight = await page.evaluate(() => window.innerHeight);
    for (const image of await images.all()) {
      await expect(async () => {
        expect((await image.boundingBox())!.height).toBeLessThanOrEqual(resizedViewportHeight / 2);
      }).toPass();
    }

    const markdownImage = images.first();
    await markdownImage.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(markdownImage).toBeFocused();

    const block = component.getByRole('button', { name: /view Harbor study full size/i });
    await block.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(block).toBeFocused();
  });
}
