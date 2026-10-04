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
    await page.evaluate(() => {
      const samples: { count: number; gap: number }[] = [];
      const state = { samples, running: true };
      (window as typeof window & { layoutFrames?: typeof state }).layoutFrames = state;
      const sample = () => {
        if (!state.running) return;
        const row = Array.from(document.querySelectorAll('[data-message-role="user"]')).find(
          (node) => node.textContent?.includes('Start this new turn'),
        );
        const statuses = document.querySelectorAll(
          '[data-streaming-typing-row]:not([aria-hidden="true"])',
        );
        if (row && statuses.length)
          samples.push({
            count: statuses.length,
            gap: statuses[0].getBoundingClientRect().top - row.getBoundingClientRect().bottom,
          });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
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
    if (order === 'history-first')
      await component.update({
        props: { ...props, streaming: true, submissionStage: 'ack', settleSubmission: undefined },
      });
    const frames = await page.evaluate(() => {
      const state = (
        window as typeof window & {
          layoutFrames: { running: boolean; samples: { count: number; gap: number }[] };
        }
      ).layoutFrames;
      state.running = false;
      return state.samples;
    });
    await info.attach('working-order-frames', {
      body: JSON.stringify(frames),
      contentType: 'application/json',
    });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(({ count, gap }) => count === 1 && gap >= 0)).toBe(true);
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

test('keeps the active first send ahead of a rapid second submission through history and queue fallback', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  await page.evaluate(() => document.fonts.ready);
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await editor.fill('First rapid send');
  await editor.press('Enter');
  await editor.fill('Second rapid send');
  await editor.press('Enter');
  const first = component
    .locator('[data-message-role="user"]')
    .filter({ hasText: 'First rapid send' });
  const second = component
    .locator('[data-message-role="user"]')
    .filter({ hasText: 'Second rapid send' });
  const status = component.locator('[data-streaming-typing-row]');
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(1);
  await component.update({ props: { ...props, streaming: true, submissionStage: 'started' } });
  await expect(status).toHaveCount(1);
  expect(await gap(first, status)).toBeGreaterThanOrEqual(0);
  expect(await gap(status, second)).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: info.outputPath('rapid-first-active.png') });
  await component.update({
    props: { ...props, streaming: true, submissionStage: undefined, settleSubmission: 'history' },
  });
  await expect(
    component.locator('[data-send-app-message-id]:not([data-message-index])'),
  ).toHaveCount(1);
  await expect(status).toHaveCount(1);
  expect(await gap(first, status)).toBeGreaterThanOrEqual(0);
  expect(await gap(status, second)).toBeGreaterThanOrEqual(0);
  await editor.fill('Newer unsent draft');
  await component.update({ props: { ...props, streaming: true, settleSubmission: 'queue' } });
  await expect(second).toHaveCount(0);
  await expect(component.getByTestId('queued-message-text')).toHaveText('Second rapid send');
  await expect(component.getByText('First rapid send', { exact: true })).toHaveCount(1);
  await expect(component.getByText('Second rapid send', { exact: true })).toHaveCount(1);
  await expect(editor).toHaveText('Newer unsent draft');
  await expect(editor).toBeFocused();
});

test('does not move prior activity below a still-preparing direct send that falls back to queue', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await editor.fill('Preparation is still held');
  await editor.press('Enter');
  await page.evaluate(() => document.fonts.ready);
  // An independent turn becomes active while this send is still in preparation.
  await component.update({ props: { ...props, streaming: true } });
  const pending = component
    .locator('[data-message-role="user"]')
    .filter({ hasText: 'Preparation is still held' });
  const status = component.locator('[data-streaming-typing-row]');
  await expect(status).toHaveCount(1);
  expect(await gap(status, pending)).toBeGreaterThanOrEqual(0);
  await component.update({ props: { ...props, streaming: true, settleSubmission: 'queue' } });
  await expect(pending).toHaveCount(0);
  await expect(component.getByTestId('queued-message-text')).toHaveText(
    'Preparation is still held',
  );
  await expect(status).toHaveCount(1);
});

test('places an early first-turn indicator below the optimistic first message', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const empty = { ...props, transcript: false };
  const component = await mount(ChatPanelComposerGeometryHost, { props: empty });
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await editor.fill('First ever send');
  await editor.press('Enter');
  await component.update({ props: { ...empty, streaming: true, submissionStage: 'started' } });
  await page.evaluate(() => document.fonts.ready);
  const row = component
    .locator('[data-message-role="user"]')
    .filter({ hasText: 'First ever send' });
  const status = component.locator('[data-streaming-typing-row]');
  await expect(status).toHaveCount(1);
  expect(await gap(row, status)).toBeGreaterThanOrEqual(0);
});
