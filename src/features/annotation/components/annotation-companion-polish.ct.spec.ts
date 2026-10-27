import { expect, test } from '../../../test/ct-test';
import FeedbackPreview from './annotation-feedback.preview.svelte';

test('direct feedback pending send keeps actions stable without a review modal', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(FeedbackPreview, {
    props: { failFirst: false, deliveryDelayMs: 2000 },
  });
  const send = page.getByRole('button', { name: 'Send to agent', exact: true });
  await expect(send).toBeEnabled();
  const before = await send.boundingBox();
  const iconBefore = await send.locator('[data-slot="button-leading-icon"]').boundingBox();
  if (!before || !iconBefore) throw new Error('Send action and its icon must be rendered');
  await send.click();
  const sending = page.getByRole('button', { name: 'Sending…', exact: true });
  await expect(sending).toBeDisabled();
  await expect(sending).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const during = await sending.boundingBox();
  const iconDuring = await sending.locator('[data-slot="button-leading-icon"]').boundingBox();
  expect(during).toEqual(before);
  expect(iconDuring).toEqual(iconBefore);
  await page.screenshot({ path: testInfo.outputPath('direct-feedback-sending.png') });
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  await expect(send).toBeDisabled();
  const transcript = await component.getAttribute('data-delivery-transcript');
  if (!transcript) throw new Error('Completed delivery must record its synthetic attempt');
  expect(JSON.parse(transcript)).toHaveLength(1);
  await testInfo.attach('Direct-send pending geometry', {
    body: JSON.stringify({
      before,
      during,
      iconBefore,
      iconDuring,
      syntheticDeliveryDelayMs: 2000,
    }),
    contentType: 'application/json',
  });
});

test('direct feedback stacks capture limit and failed delivery notices', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(FeedbackPreview, { props: { failFirst: true } });
  await expect(page.getByRole('button', { name: 'Send to agent', exact: true })).toBeEnabled();
  for (const name of ['Rectangle', 'Draw', 'Rectangle', 'Draw', 'Rectangle', 'Draw']) {
    if (await page.locator('.capture-notices').getByRole('status').count()) break;
    await page.mouse.move(100, 180);
    await page.mouse.down();
    await page.mouse.move(190, 230, { steps: 4 });
    await page.mouse.up();
    // Match native frame boundaries: interaction, then a fresh drawing moment.
    await page.getByRole('button', { name: 'Mouse', exact: true }).click();
    const tool = page.getByRole('button', { name, exact: true });
    await tool.click();
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('main[data-tool]')).toHaveAttribute('data-tool', name.toLowerCase());
  }
  await expect(page.locator('.capture-notices').getByRole('status')).toHaveText(
    'Up to 6 captures per feedback message.',
  );
  await page.getByRole('button', { name: 'Send to agent', exact: true }).click();
  const notices = page.locator('.capture-notices');
  await expect(notices.getByRole('alert')).toHaveText('Could not send the annotation.');
  const limit = await notices.getByRole('status').boundingBox();
  const error = await notices.getByRole('alert').boundingBox();
  if (!limit || !error) throw new Error('Both notices must render');
  expect(error.y).toBeGreaterThanOrEqual(limit.y + limit.height);
  expect(error.y + error.height).toBeLessThanOrEqual(720);
  await page.screenshot({ path: testInfo.outputPath('stacked-capture-notices.png') });
  await testInfo.attach('Stacked notice bounds', {
    body: JSON.stringify({ limit, error, externalDelivery: 'fake failure' }),
    contentType: 'application/json',
  });
});
