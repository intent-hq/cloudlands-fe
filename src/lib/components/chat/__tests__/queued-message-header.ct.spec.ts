import { expect, test } from '../../../../test/ct-test';
import QueuedMessagesPreview from '../queued-messages.preview.svelte';

test('edits a collapsed single message from the header and saves or cancels inline', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 240, height: 400 });
  const component = await mount(QueuedMessagesPreview, { props: { messageCount: 1 } });
  const header = component.getByTestId('queued-messages-header');
  const row = component.getByTestId('queued-message-row');
  const disclosure = component.getByTestId('queued-messages-disclosure');
  await disclosure.click();
  await header.getByRole('button', { name: 'Edit', exact: true }).focus();
  await page.keyboard.press('Enter');
  const editor = row.getByRole('textbox');
  await expect(editor).toBeFocused();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await editor.fill('Discard this draft');
  await info.attach('single-message-inline-editor.png', {
    body: await component.getByTestId('queued-messages-container').screenshot(),
    contentType: 'image/png',
  });
  await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(row.getByTestId('queued-message-text')).toHaveText('Check the empty state too.');
  await header.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editor).toBeFocused();
  await editor.fill('Saved inline');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(row.getByTestId('queued-message-text')).toHaveText('Saved inline');
  const surface = component.getByTestId('queued-messages-container');
  expect(await surface.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await info.attach('single-message-saved.png', {
    body: await surface.screenshot(),
    contentType: 'image/png',
  });
  await disclosure.click();
  await header.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(surface).toHaveCount(0);
});

test('keeps the active draft when a multiple-message queue becomes a single message', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(QueuedMessagesPreview, { props: { messageCount: 3 } });
  const first = component.getByTestId('queued-message-row').first();
  await first.hover();
  await first.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = first.getByRole('textbox');
  await expect(editor).toBeFocused();
  await editor.fill('Keep my active draft');
  await component.update({ props: { messageCount: 1 } });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('Keep my active draft');
  await first.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(first.getByTestId('queued-message-text')).toHaveText('Keep my active draft');
  await info.attach('single-message-after-queue-drain.png', {
    body: await component.getByTestId('queued-messages-container').screenshot(),
    contentType: 'image/png',
  });
});

test('sends from a collapsed single-message header and blocks repeat mutations while pending', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(QueuedMessagesPreview, {
    props: { messageCount: 1, sendOutcome: 'pending' },
  });
  const header = component.getByTestId('queued-messages-header');
  await component.getByTestId('queued-messages-disclosure').click();
  const send = header.getByRole('button', { name: 'Send immediately' });
  await send.focus();
  await page.keyboard.press('Enter');
  await expect(
    header
      .getByTestId('queued-message-actions')
      .getByRole('button', { name: 'Sending…', exact: true }),
  ).toBeDisabled();
  await expect(header.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
  await expect(header.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
  await info.attach('single-message-sending.png', {
    body: await component.getByTestId('queued-messages-container').screenshot(),
    contentType: 'image/png',
  });
});

test('keeps a failed single message available for retry from its header', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(QueuedMessagesPreview, {
    props: { messageCount: 1, sendOutcome: 'failed' },
  });
  const header = component.getByTestId('queued-messages-header');
  const send = header.getByRole('button', { name: 'Send immediately' });
  await send.click();
  await expect(component.getByRole('alert')).toContainText('Connection unavailable');
  await expect(send).toBeEnabled();
  await info.attach('single-message-send-failed.png', {
    body: await component.getByTestId('queued-messages-container').screenshot(),
    contentType: 'image/png',
  });
  await component.update({ props: { messageCount: 1, sendOutcome: undefined } });
  await send.click();
  await expect(component.getByTestId('queued-messages-container')).toHaveCount(0);
});
