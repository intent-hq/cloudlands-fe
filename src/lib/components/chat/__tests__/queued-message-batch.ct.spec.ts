import { expect, test } from '../../../../test/ct-test';
import QueuedMessagesPreview from '../queued-messages.preview.svelte';

for (const width of [420, 240]) {
  test(`expands a faded queue and keeps its actions reachable at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 700 });
    const component = await mount(QueuedMessagesPreview, { props: { messageCount: 12 } });
    const viewport = component.getByTestId('queued-messages-viewport');
    const expand = component.getByRole('button', { name: 'Show all queued messages' });
    await expect(expand).toBeVisible();
    const compact = (await viewport.boundingBox())!.height;
    expect(compact).toBeLessThanOrEqual(160);
    await testInfo.attach('compact-preview', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
    await expand.click();
    await expect(expand).toHaveCount(0);
    await expect.poll(async () => (await viewport.boundingBox())!.height).toBeGreaterThan(compact);
    const last = component.getByTestId('queued-message-row').last();
    await last.getByRole('button', { name: 'Edit', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(last.getByRole('textbox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(
      component.getByRole('button', { name: 'Clear all queued messages' }),
    ).toBeInViewport();
    await expect(
      component.getByRole('button', { name: 'Send all ready messages now' }),
    ).toBeInViewport();
    await testInfo.attach('expanded-preview', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('sends ready entries together and leaves held entries available to clear', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(QueuedMessagesPreview, {
    props: { messageCount: 3, heldCount: 1, heldStart: 1 },
  });
  await component.getByRole('button', { name: 'Send all ready messages now' }).click();
  await expect(component.getByTestId('queued-message-row')).toHaveCount(1);
  await expect(component.getByTestId('queued-message-text')).toHaveText(
    'Keep the spacing consistent.',
  );
  await expect(
    component.getByRole('button', { name: 'Send all ready messages now' }),
  ).toBeDisabled();
  await testInfo.attach('held-message-preserved', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
  await component.getByRole('button', { name: 'Clear all queued messages' }).click();
  await expect(component.getByTestId('queued-messages-container')).toHaveCount(0);
});

test('keeps failed batches in the queue and blocks duplicate pending actions', async ({
  mount,
}) => {
  const component = await mount(QueuedMessagesPreview, {
    props: { messageCount: 3, sendOutcome: 'failed' },
  });
  const send = component.getByRole('button', { name: 'Send all ready messages now' });
  await send.click();
  await expect(component.getByRole('alert')).toContainText('Connection unavailable');
  await expect(component.getByTestId('queued-message-row')).toHaveCount(3);
  await expect(send).toBeEnabled();
  await component.update({ props: { messageCount: 3, sendOutcome: 'pending' } });
  await send.click();
  await expect(send).toBeDisabled();
  await expect(component.getByRole('button', { name: 'Clear all queued messages' })).toBeDisabled();
  await expect(component.getByTestId('queued-message-row')).toHaveCount(3);
});

test('keeps a failed clear visible and leaves the queue retryable', async ({ mount }) => {
  const component = await mount(QueuedMessagesPreview, {
    props: { messageCount: 3, clearFails: true },
  });
  await component.getByRole('button', { name: 'Clear all queued messages' }).click();
  await expect(component.getByRole('alert')).toContainText('Connection unavailable');
  await expect(component.getByTestId('queued-message-row')).toHaveCount(3);
  await expect(component.getByRole('button', { name: 'Clear all queued messages' })).toBeEnabled();
});

for (const action of ['Remove', 'Send immediately']) {
  test(`animates ${action.toLowerCase()} and the final queue dismissal`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const component = await mount(QueuedMessagesPreview, { props: { messageCount: 3 } });
    const row = component.getByTestId('queued-message-row').first();
    await row.hover();
    const samples = await row
      .getByRole('button', { name: action, exact: true })
      .evaluate(async (button) => {
        const row = button.closest('[data-testid="queued-message-row"]')!;
        const card = button.closest('[data-testid="queued-messages-container"]')!;
        const frames = [
          { row: row.getBoundingClientRect().height, card: card.getBoundingClientRect().height },
        ];
        (button as HTMLButtonElement).click();
        for (let frame = 0; frame < 30; frame++) {
          await new Promise(requestAnimationFrame);
          frames.push({
            row: row.isConnected ? row.getBoundingClientRect().height : 0,
            card: card.getBoundingClientRect().height,
          });
        }
        return frames;
      });
    expect(samples.some((sample) => sample.row > 0 && sample.row < samples[0].row)).toBe(true);
    await expect(component.getByTestId('queued-message-row')).toHaveCount(2);
    const clear = component.getByRole('button', { name: 'Clear all queued messages' });
    const dismissal = await clear.evaluate(async (button) => {
      const card = button.closest('[data-testid="queued-messages-container"]')!;
      const heights = [card.getBoundingClientRect().height];
      (button as HTMLButtonElement).click();
      for (let frame = 0; frame < 30; frame++) {
        await new Promise(requestAnimationFrame);
        heights.push(card.isConnected ? card.getBoundingClientRect().height : 0);
      }
      return heights;
    });
    expect(dismissal.some((height) => height > 0 && height < dismissal[0])).toBe(true);
    await expect(component.getByTestId('queued-messages-container')).toHaveCount(0);
    await testInfo.attach('motion-frames.json', {
      body: JSON.stringify({ samples, dismissal }, null, 2),
      contentType: 'application/json',
    });
  });
}
