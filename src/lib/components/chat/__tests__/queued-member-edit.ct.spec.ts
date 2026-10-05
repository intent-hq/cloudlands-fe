import { expect, test } from '../../../../test/ct-test';
import { failOnConsoleErrors } from '../../../../test/ct-console-errors';
import QueuedMemberEditHost from './QueuedMemberEditHost.svelte';

failOnConsoleErrors(test);

const people = [
  { label: 'alex', principalId: 'github-alex', provider: 'github', host: 'github.com' },
  { label: 'alex', principalId: 'gitlab-alex', provider: 'gitlab', host: 'code.example:8443' },
  {
    label: 'alice.dev_ops-team',
    principalId: 'gitlab-alice',
    provider: 'gitlab',
    host: 'gitlab.com',
  },
];
const payloads = people.map(({ label, principalId, provider, host }) => ({
  label,
  principalId,
  workspaceId: 'member-mentions-workspace',
  identity: { provider, host, externalUserId: '42' },
}));
const tokens = payloads.map(
  (value) => `@member[${Buffer.from(JSON.stringify(value)).toString('base64')}]`,
);
const initialContent = `Ask ${tokens.join(' and ')} please`;
const readable = 'Ask @alex and @alex and @alice.dev_ops-team please';

test('queued members remain readable with distinct identities through edit, save, cancel and send', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 620, height: 600 });
  const component = await mount(QueuedMemberEditHost, { props: { initialContent } });
  const row = component.locator('[data-message-id="member-queue"]');
  await expect(row.getByTestId('queued-message-text')).toHaveText(readable);
  await row.getByTestId('queued-message-content').dblclick();
  const editor = row.getByRole('textbox');
  await expect(editor).toHaveText(readable);
  await expect(editor).toBeFocused();
  const chips = editor.locator('[data-type="member"]');
  await expect(chips).toHaveCount(3);
  for (let index = 0; index < payloads.length; index++) {
    const { label, ...meta } = payloads[index];
    await expect(chips.nth(index)).toHaveText(`@${label}`);
    expect(JSON.parse((await chips.nth(index).getAttribute('data-meta'))!)).toEqual(meta);
  }
  await expect(editor.locator('[data-type="file"]')).toHaveCount(0);
  await editor.press('End');
  await editor.pressSequentially(' thanks');
  await page.screenshot({ path: testInfo.outputPath('queued-member-edit.png') });
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(component.getByTestId('queued-member-stored')).toHaveText(
    `${initialContent} thanks`,
  );
  await expect(row.getByTestId('queued-message-text')).toHaveText(`${readable} thanks`);

  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(chips).toHaveCount(3);
  await editor.press('End');
  await editor.pressSequentially(' discarded');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(component.getByTestId('queued-member-stored')).toHaveText(
    `${initialContent} thanks`,
  );
  expect(JSON.parse((await component.getByTestId('queued-member-edits').textContent())!)).toEqual([
    { id: 'member-queue', content: initialContent, editing: true },
    { id: 'member-queue', content: `${initialContent} thanks`, editing: false },
    { id: 'member-queue', content: `${initialContent} thanks`, editing: true },
    { id: 'member-queue', content: `${initialContent} thanks`, editing: false },
  ]);
  await row.getByTestId('queued-message-content').press('Control+Enter');
  await expect(component.getByTestId('queued-member-sent')).toHaveText('member-queue');
});

test('queued member editing retains focus on refresh and reorder, and saves on blur', async ({
  mount,
  page,
}) => {
  const component = await mount(QueuedMemberEditHost, { props: { initialContent } });
  const row = component.locator('[data-message-id="member-queue"]');
  await row.getByTestId('queued-message-content').press('F2');
  const editor = row.getByRole('textbox');
  await expect(editor).toHaveText(readable);
  await editor.press('End');
  await editor.pressSequentially(' before');
  await component.getByRole('button', { name: 'Refresh queue', exact: true }).click();
  await component.getByRole('button', { name: 'Reorder queue', exact: true }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.type(' after');
  await component.getByRole('button', { name: 'Outside editor', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(component.getByTestId('queued-member-stored')).toHaveText(
    `${initialContent} before after`,
  );
});
