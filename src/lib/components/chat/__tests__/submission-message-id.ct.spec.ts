import { expect, test } from '../../../../test/ct-test';
import SubmissionMessageIdHost from './SubmissionMessageIdHost.svelte';

test.setTimeout(120_000);
const ids = ['user-msg-868b24f0-0c82-448c-9fd0-1882343cd19c', 'caller:retry/42'];
const content = 'Continue after the provider failure';

for (const id of ids) {
  test(`keeps chat usable after failed submission ${id}`, async ({ mount, page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const component = await mount(SubmissionMessageIdHost, { props: { id } });
    await expect(component.locator(`[data-message-id="${id}"]`)).toBeVisible();
    await expect(component.getByText(content, { exact: true })).toHaveCount(1);
    await component.update({ props: { id, settleSubmission: 'rejected' } });
    await expect(component.getByText(content, { exact: true })).toHaveCount(0);
    const editor = component.getByTestId('message-input').locator('.tiptap-editor');
    await editor.click();
    await editor.pressSequentially('Send a new message after failure');
    await component.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(component.getByText(content, { exact: true })).toHaveCount(1);
    await expect(editor).toContainText('Send a new message after failure');
    await editor.press('Enter');
    await expect(editor).toBeEmpty();
    await expect(
      component.getByText('Send a new message after failure', { exact: true }),
    ).toHaveCount(1);
    expect(errors).toEqual([]);
    await testInfo.attach('retry-and-send', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });

  test(`renders processing identity once when confirmed in history ${id}`, async ({
    mount,
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const component = await mount(SubmissionMessageIdHost, { props: { id, stage: 'processing' } });
    const message = component.locator(`[data-message-id="${id}"]`);
    await expect(message).toBeVisible();
    await expect(component.getByText(content, { exact: true })).toHaveCount(1);
    await component.update({ props: { id, stage: 'history' } });
    await expect(message).toHaveCount(1);
    await expect(component.getByText(content, { exact: true })).toHaveCount(1);
    expect(errors).toEqual([]);
    await testInfo.attach('confirmed-history', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });
}
