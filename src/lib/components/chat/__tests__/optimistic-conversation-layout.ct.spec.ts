import type { Locator } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);

const props = { width: 620, height: 700, transcript: true, submissionSupport: true };
const gap = async (before: Locator, after: Locator) => {
  const a = (await before.boundingBox())!;
  const b = (await after.boundingBox())!;
  return b.y - a.y - a.height;
};

test('keeps the confirmed turn gap while a new contribution waits for preparation and history', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  await page.evaluate(() => document.fonts.ready);
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await editor.fill('Next contribution');
  await editor.press('Enter');
  const previous = component.locator('[data-message-id="attention-assistant-11"]');
  const row = component
    .locator('[data-message-role="user"]')
    .filter({ hasText: 'Next contribution' });
  await expect(row).toBeVisible();
  const pendingGap = await gap(previous, row);
  await page.screenshot({ path: info.outputPath('before-history.png') });
  await editor.fill('Keep my newer draft');
  await component.update({ props: { ...props, settleSubmission: 'history' } });
  await expect(
    component.locator('[data-send-app-message-id]:not([data-message-index])'),
  ).toHaveCount(0);
  await expect(row).toHaveCount(1);
  const confirmedGap = await gap(previous, row);
  await page.screenshot({ path: info.outputPath('after-history.png') });
  await info.attach('turn-gap', {
    body: JSON.stringify({ pendingGap, confirmedGap }),
    contentType: 'application/json',
  });
  expect(pendingGap).toBeCloseTo(confirmedGap, 1);
  await expect(editor).toHaveText('Keep my newer draft');
  await expect(editor).toBeFocused();
});

for (const order of ['ack-first', 'history-first'] as const) {
  test(`keeps early working status below its user through ${order} reconciliation`, async ({
    mount,
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ChatPanelComposerGeometryHost, { props });
    await page.evaluate(() => document.fonts.ready);
    const editor = component.getByTestId('message-input').locator('.tiptap-editor');
    await editor.fill('Start this new turn');
    await editor.press('Enter');
    const row = component
      .locator('[data-message-role="user"]')
      .filter({ hasText: 'Start this new turn' });
    const status = component.locator('[data-streaming-typing-row]');
    await expect(row).toBeVisible();
    await component.update({ props: { ...props, submissionStage: 'started', streaming: true } });
    await expect(status).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('early-stream-before-ack.png') });
    expect
      .soft(await gap(row, status), 'early stream status follows its optimistic user')
      .toBeGreaterThanOrEqual(0);
    if (order === 'ack-first') {
      await component.update({ props: { ...props, submissionStage: 'ack', streaming: true } });
      await expect(row).toHaveCount(1);
      expect
        .soft(await gap(row, status), 'ACK without history does not move status above user')
        .toBeGreaterThanOrEqual(0);
    }
    await component.update({ props: { ...props, streaming: true, settleSubmission: 'history' } });
    await expect(
      component.locator('[data-send-app-message-id]:not([data-message-index])'),
    ).toHaveCount(0);
    await expect(row).toHaveCount(1);
    await expect(status).toHaveCount(1);
    expect(await gap(row, status)).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: info.outputPath('confirmed-working-order.png') });
  });
}

test('keeps prior-turn working status above a queued contribution', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { ...props, streaming: true },
  });
  await page.evaluate(() => document.fonts.ready);
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await editor.fill('Wait for the previous turn');
  await editor.press('Enter');
  const queued = component.getByTestId('queued-message-text');
  await expect(queued).toHaveText('Wait for the previous turn');
  const status = component.locator('[data-streaming-typing-row]');
  await expect(status).toHaveCount(1);
  expect(await gap(status, queued)).toBeGreaterThanOrEqual(0);
  await expect(editor).toBeFocused();
});
