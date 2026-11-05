import { activateHoverAction, expect, test } from '../../../../test/ct-test';
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
    // Editing keeps the row's size, so only wait for it to be still around the press.
    await activateHoverAction(row.getByRole('button', { name: 'Edit', exact: true }), row, {
      requireChange: false,
    });
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
  await activateHoverAction(first.getByRole('button', { name: 'Edit', exact: true }), first, {
    requireChange: false,
  });
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

for (const width of [420, 240]) {
  test(`expands and restores a compact queue with reachable actions at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 700 });
    const component = await mount(QueuedMessagesPreview, { props: { messageCount: 12 } });
    const viewport = component.getByTestId('queued-messages-viewport');
    const expand = component.getByRole('button', { name: 'Show all queued messages' });
    await expect(expand).toBeVisible();
    const compact = (await viewport.boundingBox())!.height;
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
    const showLess = component.getByRole('button', { name: 'Show less', exact: true });
    await expect(showLess).toBeInViewport();
    await showLess.focus();
    await page.keyboard.press('Enter');
    await expect(expand).toBeFocused();
    await expect.poll(async () => (await viewport.boundingBox())!.height).toBeCloseTo(compact, 1);
    expect(await viewport.evaluate((node) => node.scrollTop)).toBe(0);
    await expect(component.getByTestId('queued-message-row')).toHaveCount(12);
    await page.keyboard.press('Enter');
    await expect(showLess).toBeVisible();
    await expect.poll(async () => (await viewport.boundingBox())!.height).toBeGreaterThan(compact);
    await showLess.click();
    await expect(expand).toBeFocused();
    await expect(showLess).toHaveCount(0);
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
    component
      .getByTestId('queued-messages-header')
      .getByRole('button', { name: 'Send immediately' }),
  ).toBeDisabled();
  await testInfo.attach('held-message-preserved', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
  await component
    .getByTestId('queued-messages-header')
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
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
