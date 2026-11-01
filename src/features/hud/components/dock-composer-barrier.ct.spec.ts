import type { Locator } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ComposerBarrierHarness from './DockComposerBarrierHarness.svelte';
import { readDictationIndicators } from './dock-composer-ct-helpers';

const editorSelector = '[data-testid="message-input"] [contenteditable="true"]';

test('narrow production composer retains a readable dictation timer and waveform beside the model picker', async ({
  mount,
}, info) => {
  const component = await mount(ComposerBarrierHarness, { props: { width: 320, dictating: true } });
  const editor = component.locator(editorSelector);
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.fill('Keep this unsent.');
  await expect(component.locator('[data-dock-dictation-time]')).toBeVisible();
  await expect
    .poll(() => readDictationIndicators(component))
    .toEqual({
      timerUnclipped: true,
      separate: true,
      usefulHistory: true,
    });
  const host = component.locator('[data-barrier-composer-host]');
  const bounds = await host.boundingBox();
  if (!bounds) throw new Error('Missing composer bounds');
  const model = component.locator('[data-chat-input-primary-actions]').getByRole('button').first();
  const send = component.getByTestId('composer-submit-button');
  for (const control of [model, send]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    if (!box) throw new Error('Missing control bounds');
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    await control.focus();
    await expect(control).toBeFocused();
  }
  await info.attach('production-composer-dictating-narrow', {
    body: await host.screenshot(),
    contentType: 'image/png',
  });
  await expect(component).toHaveAttribute('data-submissions', '[]');
  await expectClosedTransport(component);
});

async function beginHeldSubmission(component: Locator) {
  const editor = component.locator(editorSelector);
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.fill('Draft');
  await editor.press('End');
  const normalUpdates = await component.getAttribute('data-normal-updates');
  await component.getByRole('button', { name: 'Queue references', exact: true }).click();
  await expect(component).toHaveAttribute('data-phase', 'first-ack-held');
  await expect(component).toHaveAttribute('data-queued', '["first","second"]');
  await expect(component).toHaveAttribute('data-committed', '[]');
  // The first event has reached TipTap but its acknowledgment is still held.
  // Submit must enter the asynchronous barrier even with two queued events.
  const send = component.getByTestId('composer-submit-button');
  await send.dblclick();
  await expect(component).toHaveAttribute('data-barrier-calls', '1');
  await expect(send).toBeDisabled();
  await expect(component).toHaveAttribute('data-submissions', '[]');
  await expect(component).toHaveAttribute('data-normal-updates', normalUpdates!);
  return { editor, send, normalUpdates };
}

async function acknowledgeReferences(component: Locator) {
  await component
    .getByRole('button', { name: 'Release first acknowledgment', exact: true })
    .click();
  await expect(component).toHaveAttribute('data-phase', 'awaiting-speech');
  await expect(component).toHaveAttribute('data-committed', '["first","second"]');
  await expect(component).toHaveAttribute('data-queued', '[]');
  await expect(component).toHaveAttribute('data-submissions', '[]');
}

async function finalizeSpeech(component: Locator) {
  await component.getByRole('button', { name: 'Finalize speech', exact: true }).click();
  await expect(component).toHaveAttribute('data-phase', 'returned');
}

async function expectClosedTransport(component: Locator) {
  const calls = JSON.parse((await component.getAttribute('data-calls')) ?? '[]') as {
    method: string;
  }[];
  expect(
    calls.filter(({ method }) => ['agent.sendMessage', 'agent.queueMessage'].includes(method)),
  ).toEqual([]);
}

test('composer waits for two acknowledged reference heads and final speech before one current-text submission', async ({
  mount,
}) => {
  const component = await mount(ComposerBarrierHarness);
  const { send, normalUpdates } = await beginHeldSubmission(component);
  await acknowledgeReferences(component);
  await expect(send).toBeDisabled();
  await finalizeSpeech(component);
  await expect(send).toBeEnabled();
  await expect
    .poll(async () => JSON.parse((await component.getAttribute('data-submissions')) ?? '[]'))
    .toEqual([
      {
        text: 'Draft first [[mark:1]] second [[mark:2]] final speech',
        contextItems: [],
        submissionId: expect.any(String),
      },
    ]);
  await expect(component).toHaveAttribute('data-committed', '["first","second","speech-final"]');
  await expect(component).toHaveAttribute('data-normal-updates', normalUpdates!);
  await expect(component).toHaveAttribute('data-barrier-calls', '1');
  await expectClosedTransport(component);
});

test('typing during speech finalization cancels submission while authorized references remain editable', async ({
  mount,
}) => {
  const component = await mount(ComposerBarrierHarness);
  const { editor, send } = await beginHeldSubmission(component);
  await acknowledgeReferences(component);
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.focus();
  await editor.press('End');
  await editor.pressSequentially(' revised');
  await finalizeSpeech(component);
  await expect(send).toBeEnabled();
  await expect(component).toHaveAttribute('data-submissions', '[]');
  await expect(component).toHaveAttribute(
    'data-draft',
    'Draft first [[mark:1]] second [[mark:2]] revised final speech',
  );
  await expect(component).toHaveAttribute('data-committed', '["first","second","speech-final"]');
  await expectClosedTransport(component);
});

test('switching the composer target cancels an otherwise successful pending submission barrier', async ({
  mount,
}) => {
  const component = await mount(ComposerBarrierHarness);
  const { send } = await beginHeldSubmission(component);
  await acknowledgeReferences(component);
  await component.getByRole('button', { name: 'Switch target', exact: true }).click();
  await expect(component).toHaveAttribute('data-agent', 'wire-other');
  await finalizeSpeech(component);
  await expect(send).toBeEnabled();
  await expect(component).toHaveAttribute('data-submissions', '[]');
  await expect(component).toHaveAttribute('data-committed', '["first","second"]');
  await expectClosedTransport(component);
});

test('unmounting the composer prevents a late successful barrier from submitting its old draft', async ({
  mount,
}) => {
  const component = await mount(ComposerBarrierHarness);
  await beginHeldSubmission(component);
  await acknowledgeReferences(component);
  await component.getByRole('button', { name: 'Unmount composer', exact: true }).click();
  await expect(component.locator(editorSelector)).toHaveCount(0);
  await finalizeSpeech(component);
  // Let the resolved promise and the wrapper's tick continuation complete; no
  // elapsed-time assumption or native service is involved.
  await component.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await expect(component).toHaveAttribute('data-submissions', '[]');
  await expect(component).toHaveAttribute('data-committed', '["first","second"]');
  await expectClosedTransport(component);
});
