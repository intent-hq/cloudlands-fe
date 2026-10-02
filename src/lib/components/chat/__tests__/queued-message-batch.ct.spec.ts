import { expect, test } from '../../../../test/ct-test';
import QueuedMessagesPreview from '../queued-messages.preview.svelte';

for (const contentKind of ['plain', 'member'] as const) {
  test(`keeps unchanged ${contentKind} text at the same height when entering and leaving edit mode`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(QueuedMessagesPreview, {
      props: { messageCount: 3, contentKind },
    });
    await page.evaluate(() => document.fonts.ready);
    const row = component.getByTestId('queued-message-row').first();
    const next = component.getByTestId('queued-message-row').nth(1);
    const before = (await row.boundingBox())!;
    const nextTop = (await next.boundingBox())!.y;
    await row.hover();
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = row.getByRole('textbox');
    await expect(editor).toBeFocused();
    await expect.poll(async () => (await row.boundingBox())!.height).toBeCloseTo(before.height, 1);
    expect((await next.boundingBox())!.y).toBeCloseTo(nextTop, 1);
    if (contentKind === 'plain') {
      await editor.fill('First line\nSecond line\nThird line');
      await expect
        .poll(async () => (await row.boundingBox())!.height)
        .toBeGreaterThan(before.height);
    }
    await editor.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await row.boundingBox())!.height).toBeCloseTo(before.height, 1);
  });
}

test('keeps a visible edit compact and reveals a clipped row for keyboard editing', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(QueuedMessagesPreview, { props: { messageCount: 12 } });
  const viewport = component.getByTestId('queued-messages-viewport');
  const expand = component.getByRole('button', { name: 'Show all queued messages' });
  await expect(expand).toBeVisible();
  const compact = (await viewport.boundingBox())!.height;
  const first = component.getByTestId('queued-message-row').first();
  await first.hover();
  await first.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(first.getByRole('textbox')).toBeFocused();
  await expect(expand).toBeVisible();
  expect((await viewport.boundingBox())!.height).toBeCloseTo(compact, 1);
  await first.getByRole('textbox').fill(Array(8).fill('A longer draft').join('\n'));
  await expect(expand).toHaveCount(0);
  await first.getByRole('textbox').press('Escape');
  const disclosure = component.getByTestId('queued-messages-disclosure');
  await disclosure.click();
  await expect(viewport).toHaveCount(0);
  await disclosure.click();
  await expect(expand).toBeVisible();
  await component
    .getByTestId('queued-message-row')
    .nth(3)
    .getByTestId('queued-message-content')
    .focus();
  await expect(expand).toHaveCount(0);
  await disclosure.click();
  await expect(viewport).toHaveCount(0);
  await disclosure.click();
  await expect(expand).toBeVisible();
  const last = component.getByTestId('queued-message-row').last();
  await last.getByRole('button', { name: 'Edit', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(last.getByRole('textbox')).toBeFocused();
  await expect(expand).toHaveCount(0);
  const bounds = (await viewport.boundingBox())!;
  const input = (await last.getByRole('textbox').boundingBox())!;
  expect(input.y).toBeGreaterThanOrEqual(bounds.y - 1);
  expect(input.y + input.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`reopens a full queue without overshooting its compact height (${reducedMotion})`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(QueuedMessagesPreview, { props: { messageCount: 12 } });
    const content = component.getByTestId('queued-messages-content');
    const viewport = component.getByTestId('queued-messages-viewport');
    const expand = component.getByRole('button', { name: 'Show all queued messages' });
    const disclosure = component.getByTestId('queued-messages-disclosure');
    await expect(expand).toBeVisible();
    const compact = (await content.boundingBox())!.height;
    await expand.click();
    await expect.poll(async () => (await content.boundingBox())!.height).toBeGreaterThan(compact);
    await page.emulateMedia({ reducedMotion });
    await disclosure.click();
    await expect(viewport).toHaveCount(0);
    const frames = await disclosure.evaluate(async (button) => {
      const surface = button.closest('[data-testid="queued-messages-container"]')!;
      const samples: number[] = [];
      (button as HTMLButtonElement).click();
      for (let frame = 0; frame < 40; frame++) {
        await new Promise(requestAnimationFrame);
        samples.push(
          surface.querySelector('[data-testid="queued-messages-content"]')?.getBoundingClientRect()
            .height ?? 0,
        );
      }
      return samples;
    });
    await expect(expand).toBeVisible();
    expect(Math.max(...frames)).toBeLessThanOrEqual(compact + 1);
    expect(frames.at(-1)).toBeCloseTo(compact, 1);
    const reversal = await disclosure.evaluate(async (button) => {
      const surface = button.closest('[data-testid="queued-messages-container"]')!;
      const samples: number[] = [];
      (button as HTMLButtonElement).click();
      await new Promise(requestAnimationFrame);
      (button as HTMLButtonElement).click();
      for (let frame = 0; frame < 40; frame++) {
        await new Promise(requestAnimationFrame);
        samples.push(
          surface.querySelector('[data-testid="queued-messages-content"]')?.getBoundingClientRect()
            .height ?? 0,
        );
      }
      return samples;
    });
    expect(Math.max(...reversal)).toBeLessThanOrEqual(compact + 1);
    expect(reversal.at(-1)).toBeCloseTo(compact, 1);
    await testInfo.attach('reopen-heights.json', {
      body: JSON.stringify({ compact, frames, reversal }),
      contentType: 'application/json',
    });
  });
}

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
