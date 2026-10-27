import { expect, test } from '../../../test/ct-test';
import FeedbackPreview from './annotation-feedback.preview.svelte';
import { ANNOTATION_PALETTE } from '../utils/annotation-actions';

// Exercises the production toolbar/overlay and Redux draft against local delivery.
// Every run retains a screenshot and the exact delivery transcript.
test('direct feedback preserves annotated captures, narration and destination through retry', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(FeedbackPreview, { props: { failFirst: true } });
  const send = page.getByRole('button', { name: 'Send to agent', exact: true });
  await expect(send).toBeEnabled();

  const destination = page.getByRole('button', { name: 'Workspace', exact: true });
  await destination.click();
  const agent = page.getByRole('combobox', { name: 'Agent', exact: true });
  await expect(agent).toHaveValue('Coordinator · Main agent');
  await agent.click();
  await page.getByRole('option', { name: 'Dock implementor', exact: true }).click();
  await expect(agent).toHaveValue('Dock implementor');
  await expect(agent).toHaveAttribute('aria-expanded', 'false');
  await agent.press('Escape');
  await expect(page.locator('.annotation-destination-popover')).toBeHidden();

  // Edit evidence through the canvas rather than the removed review modal.
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  const surface = page.locator('main[data-tool]');
  await expect(surface).toHaveAttribute('data-tool', 'pin');
  await page.mouse.click(600, 300);
  await expect(surface.locator('.pin')).toHaveCount(1);
  await send.click();
  await expect(page.locator('.capture-notices').getByRole('alert')).toHaveText(
    'Could not send the annotation.',
  );
  const retry = page.getByRole('button', { name: 'Retry send', exact: true });
  await expect(retry).toBeEnabled();
  await expect(surface.locator('.pin')).toHaveCount(1);
  await expect(destination).toContainText('Dock implementor');

  const firstTranscript = await component.getAttribute('data-delivery-transcript');
  if (!firstTranscript) throw new Error('Failed delivery must retain its transcript');
  const firstAttempts = JSON.parse(firstTranscript);
  expect(firstAttempts).toHaveLength(1);
  const first = firstAttempts[0];
  expect(first.recipient.agentId).toBe('fake-agent');
  expect(first.recipient.workspaceId).toBe('feedback-preview-workspace');
  expect(first.frames).toHaveLength(3);
  expect(new Set(first.frames.map((frame: { id: string }) => frame.id)).size).toBe(3);
  expect(first.frames.every((frame: { imageBytes: number }) => frame.imageBytes > 0)).toBe(true);
  expect(first.frames[2].pins).toEqual([{ number: 1, elapsedMs: expect.any(Number) }]);
  expect(first.message).toContain('Please keep the workspace preview inside the window.');
  expect(first.message).toContain(
    '[0:18] The preview is clipped when I move to the next workspace.',
  );

  const artifact = testInfo.outputPath('feedback-retry.png');
  await page.screenshot({ path: artifact, animations: 'disabled' });
  await testInfo.attach('Direct feedback retry draft', {
    path: artifact,
    contentType: 'image/png',
  });
  await retry.click();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  await expect(send).toBeDisabled();
  const transcript = await component.getAttribute('data-delivery-transcript');
  if (!transcript) throw new Error('Successful retry must retain both delivery attempts');
  const attempts = JSON.parse(transcript);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(first);
  expect(attempts[1]).toEqual(first);
  await testInfo.attach('Feedback delivery transcript', {
    body: transcript,
    contentType: 'application/json',
  });
});

test('live UI remains visible and interactive beneath ink while evidence exports separately', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(FeedbackPreview, { props: { failFirst: false } });
  const surface = page.locator('main[data-tool]');
  await expect(surface).toHaveAttribute('data-tool', 'draw');
  await expect(surface.locator('img')).toHaveCount(0);
  await expect(component.getByTestId('annotation-live-ui')).toBeVisible();
  await page.mouse.move(360, 230);
  await page.mouse.down();
  await page.mouse.move(490, 290, { steps: 12 });
  await page.mouse.up();
  const ink = surface.locator('.marks > path').first();
  await expect(ink).toBeVisible();
  const drawn = await ink.getAttribute('d');
  // Simulate content updating in the underlying application, with no frame swap.
  await page.evaluate(() => {
    const update = document.createElement('p');
    update.dataset.testid = 'live-app-update';
    update.textContent = 'Content changed while drawing';
    document.querySelector('[data-testid="annotation-live-ui"]')!.append(update);
  });
  await expect(page.getByTestId('live-app-update')).toBeVisible();
  await expect(ink).toHaveAttribute('d', drawn!);
  await page.screenshot({ path: testInfo.outputPath('live-ui-with-ink.png') });
  await page.getByRole('button', { name: 'Mouse', exact: true }).click();
  await expect(surface).toHaveAttribute('data-tool', 'mouse');
  await expect(ink).toHaveCount(0);
  await component.getByRole('button', { name: 'Update live content', exact: true }).click();
  await expect(page.getByTestId('live-update-count')).toHaveText('Live updates: 1');
  await expect(ink).toHaveCount(0);
  await expect(surface.locator('img')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('live-ui-interactive.png') });
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  await expect
    .poll(
      async () => JSON.parse((await component.getAttribute('data-delivery-images')) ?? '[]').length,
    )
    .toBeGreaterThan(0);
  const inkPixels = await component.evaluate(
    async (element, ink) => {
      const images: string[] = JSON.parse(element.getAttribute('data-delivery-images')!);
      const image = new Image();
      // The annotated moment is retained independently of the fresh live Mouse capture.
      image.src = images.at(-2)!;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          Math.abs(pixels[i] - ink[0]) < 8 &&
          Math.abs(pixels[i + 1] - ink[1]) < 8 &&
          Math.abs(pixels[i + 2] - ink[2]) < 8
        )
          count++;
      }
      return count;
    },
    [1, 3, 5].map((offset) => parseInt(ANNOTATION_PALETTE.ink.slice(offset, offset + 2), 16)),
  );
  expect(inkPixels).toBeGreaterThan(100);
});
