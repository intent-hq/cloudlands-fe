import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../../test/ct-test';
import ConversationWireHarness from './DockConversationWireHarness.svelte';

const questionId = '55d59402-06d1-4c51-bec4-f37c0a1b4b23';
const draft = 'Keep my ordinary chat draft.';
// Reviewable captures land in the workspace artifact folder (monorepo root).
const artifact = (name: string) => path.resolve(process.cwd(), '../../.intent/artifacts', name);

test('notch answers canonical questions once and restores the ordinary chat draft', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ConversationWireHarness, { props: { width: 320, height: 520 } });
  const editor = component.getByTestId('message-input').locator('[contenteditable]');
  await expect(editor).toBeEditable();
  await editor.fill(draft);
  await component.getByRole('button', { name: 'Publish synthetic questions', exact: true }).click();
  await expect(component.getByTestId('question-wizard-card')).toBeVisible();
  await expect(component.locator('[data-dock-questions]')).toContainText(
    'Which appearance should we use?',
  );
  // The composer stays mounted, inert, behind the question card in the footer.
  const composerLayer = component.getByTestId('question-composer-input');
  await expect(composerLayer).toHaveAttribute('inert', '');
  await expect(component.locator('.attention')).toHaveCount(0);
  const card = component.locator('[data-dock-questions]');
  const [cardBox, laneBox] = await Promise.all([
    card.boundingBox(),
    component.locator('.conversation-footer .composer-prompt-lane').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: rect.left + Number.parseFloat(style.paddingLeft),
        right: rect.right - Number.parseFloat(style.paddingRight),
        bottom: rect.bottom - Number.parseFloat(style.paddingBottom),
      };
    }),
  ]);
  if (!cardBox) throw new Error('Missing question card bounds');
  // The question controls remain contained in the live composer lane.
  expect(cardBox.x).toBeGreaterThanOrEqual(laneBox.left - 1);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(laneBox.right + 1);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(laneBox.bottom + 1);
  await card.screenshot({ path: info.outputPath('notch-question.png') });
  await component.screenshot({ path: artifact('dock-question-after.png') });
  // Hide collapses the card above the composer and gives the composer back.
  await component.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(composerLayer).not.toHaveAttribute('inert', '');
  await expect(editor).toBeEditable();
  await expect(editor).toContainText(draft);
  await component.getByRole('button', { name: /Click to expand/ }).click();
  await expect(composerLayer).toHaveAttribute('inert', '');
  await component.getByRole('radio', { name: /Follow the system/ }).click();
  const wire = component;
  const sends = async () =>
    JSON.parse((await wire.getAttribute('data-calls')) ?? '[]').filter(
      (call: { method: string }) => call.method === 'agent.sendMessage',
    );
  await expect.poll(async () => (await sends()).length).toBe(1);
  expect((await sends())[0].params).toMatchObject({
    agentId: 'wire-main',
    messageMetadata: { type: 'question_answers', answeredQuestionsMessageId: questionId },
  });
  expect(JSON.stringify((await sends())[0].params)).toContain('Q: Which appearance should we use?');
  expect(JSON.stringify((await sends())[0].params)).toContain('A: Follow the system');
  await expect(component.getByTestId('question-wizard-card')).toHaveCount(0);
  await expect(editor).toContainText(draft);
  const selector = component.getByRole('combobox', { name: 'Conversation with', exact: true });
  await selector.click();
  await page.getByRole('option', { name: 'Wire specialist', exact: true }).click();
  await expect(editor).toBeEditable();
  await editor.fill('Keep the specialist draft too.');
  await component.getByRole('button', { name: 'Accept synthetic delivery', exact: true }).click();
  await expect(editor).toContainText('Keep the specialist draft too.');
  await selector.click();
  await page.getByRole('option', { name: /Wire coordinator/ }).click();
  await expect(editor).toContainText(draft);
  await expect(editor).toBeEditable();
  await expect(component.locator('.attention')).toHaveCount(0);
  expect(await sends()).toHaveLength(1);
  await writeFile(
    info.outputPath('question-answer-wire.json'),
    JSON.stringify(await sends(), null, 2),
  );
  await component.screenshot({ path: info.outputPath('notch-chat-restored.png') });
});

test('notch question drafts survive agent navigation and a failed dismissal', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ConversationWireHarness);
  const editor = component.getByTestId('message-input').locator('[contenteditable]');
  await expect(editor).toBeEditable();
  await editor.fill(draft);
  await component.getByRole('button', { name: 'Publish synthetic questions', exact: true }).click();
  const answer = component.getByRole('textbox', { name: 'Type your own answer', exact: true });
  await answer.fill('Use the system until I choose otherwise.');
  const selector = component.getByRole('combobox', { name: 'Conversation with', exact: true });
  await selector.click();
  await page.getByRole('option', { name: 'Wire specialist', exact: true }).click();
  await expect(component.getByTestId('question-wizard-card')).toHaveCount(0);
  await expect(editor).toBeEditable();
  await selector.click();
  await page.getByRole('option', { name: /Wire coordinator/ }).click();
  await expect(answer).toHaveValue('Use the system until I choose otherwise.');
  await component
    .getByRole('button', { name: 'Reject next synthetic dismissal', exact: true })
    .click();
  await component.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss questions', exact: true }).click();
  await expect(answer).toHaveValue('Use the system until I choose otherwise.');
  await expect(component.getByTestId('question-wizard-card')).toBeVisible();
  await component.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss questions', exact: true }).click();
  await expect(component.getByTestId('question-wizard-card')).toHaveCount(0);
  await expect(editor).toContainText(draft);
  const calls = JSON.parse((await component.getAttribute('data-calls')) ?? '[]');
  expect(
    calls.filter((call: { method: string }) => call.method === 'agent.sendMessage'),
  ).toHaveLength(0);
  const dismissals = calls.filter(
    (call: { method: string }) => call.method === 'agent.dismissQuestions',
  );
  expect(dismissals).toHaveLength(2);
  for (const call of dismissals)
    expect(call.params).toMatchObject({
      agentId: 'wire-main',
      workspaceId: 'conversation-wire',
      messageId: questionId,
    });
  await writeFile(
    info.outputPath('question-dismiss-wire.json'),
    JSON.stringify(dismissals, null, 2),
  );
});

test('notch recovers a marked question outside the loaded transcript', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ConversationWireHarness);
  await expect(component.getByTestId('message-input').locator('[contenteditable]')).toBeEditable();
  await component
    .getByRole('button', { name: 'Publish older synthetic questions', exact: true })
    .click();
  await expect(component.getByTestId('question-wizard-card')).toContainText(
    'Which appearance should we use?',
  );
  const calls = JSON.parse((await component.getAttribute('data-calls')) ?? '[]');
  const recovery = calls.filter(
    (call: { method: string; params: Record<string, unknown> }) =>
      call.method === 'agent.getConversation' && call.params.aroundMessageId === questionId,
  );
  expect(recovery).toHaveLength(1);
  await writeFile(
    info.outputPath('question-recovery-wire.json'),
    JSON.stringify(recovery, null, 2),
  );
  await component
    .locator('[data-dock-questions]')
    .screenshot({ path: info.outputPath('notch-recovered-question.png') });
});

for (const outcome of ['rejected', 'uncertain', 'queued'] as const) {
  test(`notch question answers retain canonical ${outcome} semantics`, async ({
    mount,
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ConversationWireHarness);
    const editor = component.getByTestId('message-input').locator('[contenteditable]');
    await expect(editor).toBeEditable();
    await editor.fill(draft);
    await component
      .getByRole('button', { name: 'Publish synthetic questions', exact: true })
      .click();
    if (outcome === 'queued')
      await component.getByRole('button', { name: 'Start synthetic stream', exact: true }).click();
    await component.getByRole('radio', { name: /Always dark/ }).click();
    const wire = component;
    const requests = async () =>
      JSON.parse((await wire.getAttribute('data-calls')) ?? '[]').filter(
        (call: { method: string }) =>
          ['agent.sendMessage', 'agent.queueMessage'].includes(call.method),
      );
    await expect.poll(async () => (await requests()).length).toBe(1);
    expect((await requests())[0].params.messageMetadata).toEqual({
      type: 'question_answers',
      answeredQuestionsMessageId: questionId,
    });
    await component
      .getByRole('button', {
        name:
          outcome === 'uncertain'
            ? 'Lose synthetic send response'
            : outcome === 'rejected'
              ? 'Reject synthetic delivery'
              : 'Accept synthetic delivery',
        exact: true,
      })
      .click();
    if (outcome === 'rejected') {
      await expect(component.getByTestId('question-wizard-card')).toBeVisible();
      await component.getByRole('radio', { name: /Follow the system/ }).click();
      await expect.poll(async () => (await requests()).length).toBe(2);
      await component
        .getByRole('button', { name: 'Accept synthetic delivery', exact: true })
        .click();
      await expect(editor).toContainText(draft);
    } else {
      await expect(component.getByTestId('question-wizard-card')).toHaveCount(0);
      await expect(editor).toContainText(draft);
      if (outcome === 'uncertain') {
        await expect(editor).toHaveAttribute('contenteditable', 'false');
        await editor.click();
        await page.keyboard.type('This must not change the draft.');
        await page.keyboard.press('Enter');
        await expect(editor).toHaveText(draft);
        expect(await requests()).toHaveLength(1);
      } else {
        expect((await requests())[0].method).toBe('agent.queueMessage');
        await expect(component.locator('[data-testid="queued-messages-container"]')).toBeVisible();
      }
      expect(await requests()).toHaveLength(1);
    }
    await writeFile(
      info.outputPath(`question-${outcome}-wire.json`),
      JSON.stringify(await requests(), null, 2),
    );
    await component.screenshot({ path: info.outputPath(`notch-question-${outcome}.png`) });
  });
}
