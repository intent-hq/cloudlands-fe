import { expect, test } from '../../../../test/ct-test';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);
const props = { width: 620, height: 700, questions: true, submissionSupport: true };

test('dismisses the answered wizard before preparation or ACK and restores the composer', async ({ mount, page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const choice = component.getByRole('checkbox', { name: /Start with the smallest change/ });
  await choice.click();
  await page.screenshot({ path: info.outputPath('before-answer.png') });
  await component.getByRole('button', { name: 'Continue', exact: true }).click();
  const answer = component.locator('[data-message-role="user"]').filter({ hasText: 'A: Start with the smallest change' });
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
});
