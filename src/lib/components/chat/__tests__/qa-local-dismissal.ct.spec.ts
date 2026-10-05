import { expect, test } from '../../../../test/ct-test';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);
const props = { width: 620, height: 700, questions: true, submissionSupport: true };

test('dismisses the answered wizard before preparation or ACK and restores the composer', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const choice = component.getByRole('checkbox', { name: /Start with the smallest change/ });
  await choice.click();
  await page.screenshot({ path: info.outputPath('before-answer.png') });
  await component.getByRole('button', { name: 'Continue', exact: true }).click();
  const answer = component
    .locator('[data-message-role="user"]')
    .filter({ hasText: 'A: Start with the smallest change' });
  await expect(answer).toBeVisible();
  await page.screenshot({ path: info.outputPath('answer-before-ack.png') });
  await expect(choice).toHaveCount(0);
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Keep my newer draft');
  await component.update({ props: { ...props, settleSubmission: 'history' } });
  await expect(choice).toHaveCount(0);
  await expect(answer).toHaveCount(1);
  await expect(editor).toHaveText('Keep my newer draft');
  await component.update({ props: { ...props, staleAnswerTranscript: true } });
  await expect(choice).toHaveCount(0);
  await expect(editor).toHaveText('Keep my newer draft');
});

test('does not resurface between stream evidence and transcript or a late ACK', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  await component.getByRole('checkbox', { name: /Start with the smallest change/ }).click();
  await component.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(component.getByRole('checkbox')).toHaveCount(0);
  await component.update({ props: { ...props, submissionStage: 'started', streaming: true } });
  await component.update({ props: { ...props, streaming: true, settleSubmission: 'evidence' } });
  await expect(component.getByRole('checkbox')).toHaveCount(0);
  await component.update({
    props: { ...props, streaming: true, submissionStage: 'ack', staleAnswerTranscript: true },
  });
  await expect(component.getByRole('checkbox')).toHaveCount(0);
  await expect(component.getByTestId('message-input')).toBeVisible();
  await page.screenshot({ path: info.outputPath('evidence-before-transcript.png') });
});

test('shows a newer set during queue fallback and admits each answered set once', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  await component.getByRole('checkbox', { name: /Start with the smallest change/ }).click();
  await component
    .getByRole('button', { name: 'Continue', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(component.getByRole('checkbox')).toHaveCount(0);
  await expect(component.locator('[data-message-role="user"]')).toHaveCount(1);
  await component.update({ props: { ...props, streaming: true, settleSubmission: 'queue' } });
  await expect(component.getByTestId('queued-message-text')).toHaveCount(1);
  await expect(component.getByRole('checkbox')).toHaveCount(0);
  await component.update({ props: { ...props, streaming: true, newerQuestion: true } });
  await expect(component.getByRole('checkbox', { name: /Compare two approaches/ })).toBeVisible();
  await component.getByRole('checkbox', { name: /Compare two approaches/ }).click();
  await component.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(component.getByRole('checkbox')).toHaveCount(0);
  const queue = component.getByTestId('queued-message-text');
  await expect(queue).toHaveCount(2);
  await expect(queue.nth(0)).toContainText('A: Start with the smallest change');
  await expect(queue.nth(1)).toContainText('A: Compare two approaches');
  await page.screenshot({ path: info.outputPath('two-question-answers-queued.png') });
});

for (const outcome of ['rejected', 'uncertain'] as const) {
  test(`keeps recovery available after an answer is ${outcome} without losing the newer draft`, async ({
    mount,
    page,
  }, info) => {
    const component = await mount(ChatPanelComposerGeometryHost, { props });
    await component.getByRole('checkbox', { name: /Start with the smallest change/ }).click();
    await component.getByRole('button', { name: 'Continue', exact: true }).click();
    const editor = component.getByTestId('message-input').locator('.tiptap-editor');
    await expect(editor).toBeVisible();
    await editor.fill('Keep this newer draft');
    await component.update({ props: { ...props, settleSubmission: outcome } });
    await expect(component.getByRole('button', { name: /try again/i })).toBeVisible();
    if (outcome === 'rejected') {
      await expect(
        component.getByRole('checkbox', { name: /Start with the smallest change/ }),
      ).toBeVisible();
      await component.getByRole('button', { name: 'Hide', exact: true }).click();
      await expect(component.getByRole('checkbox')).toHaveCount(0);
    } else await expect(component.getByRole('checkbox')).toHaveCount(0);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveText('Keep this newer draft');
    await page.screenshot({ path: info.outputPath(`${outcome}-recovery.png`) });
  });
}
