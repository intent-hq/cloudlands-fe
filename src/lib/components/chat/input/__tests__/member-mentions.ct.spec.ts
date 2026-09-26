import { expect, test } from '../../../../../test/ct-test';
import { failOnConsoleErrors } from '../../../../../test/ct-console-errors';
import MemberMentionsHost from './MemberMentionsHost.svelte';

failOnConsoleErrors(test);

test.beforeEach(async ({ mount, page }) => {
  await page.setViewportSize({ width: 620, height: 900 });
  await mount(MemberMentionsHost);
  await expect(page.getByTestId('member-flow')).toHaveAttribute('data-ready', 'true');
});

test('equal handles stay distinct when keyboard and mouse choose different forges', async ({
  page,
}, testInfo) => {
  const editor = page.getByTestId('composer').getByRole('textbox');
  await editor.fill('@ALEx');
  const github = page.getByRole('option', { name: '@alex · GitHub · github.com', exact: true });
  const gitlab = page.getByRole('option', {
    name: '@alex · GitLab · code.example:8443',
    exact: true,
  });
  await expect(github).toBeVisible();
  await expect(gitlab).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('member-picker.png') });
  await editor.press('ArrowDown');
  await expect(gitlab).toHaveAttribute('aria-selected', 'true');
  await editor.press('Enter');
  const chip = editor.locator('[data-type="member"]');
  await expect(chip).toHaveAttribute('data-id', 'member-gitlab-alex');
  await expect(chip).toHaveText('@alex');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(editor).toBeFocused();
  await chip.hover();
  await expect(page.getByRole('tooltip')).toContainText('GitLab · code.example:8443');
  await chip.click();
  await expect(chip).toHaveAttribute('data-type', 'member');
  await editor.fill('@alex');
  await github.click();
  await expect(chip).toHaveAttribute('data-id', 'member-github-alex');
  await expect(editor).toBeFocused();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('github-selected.png') });
});

test('dotted GitLab mention survives draft, submit, chat edit and comment edit without file context', async ({
  page,
}, testInfo) => {
  const editor = page.getByTestId('composer').getByRole('textbox');
  await editor.fill('@alice.dev');
  await page.getByRole('option', { name: /@alice\.dev_ops-team/ }).click();
  await expect(editor.locator('[data-type="member"]')).toHaveText('@alice.dev_ops-team');
  await page.getByRole('button', { name: 'Save draft and close' }).click();
  await expect(editor.locator('[data-type="member"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore draft' }).click();
  const restored = editor.locator('[data-type="member"]');
  await expect(restored).toHaveAttribute('data-id', 'member-gitlab-alice');
  expect(JSON.parse((await restored.getAttribute('data-meta')) ?? '{}')).toEqual({
    principalId: 'gitlab-alice',
    workspaceId: 'member-mentions-workspace',
    identity: { provider: 'gitlab', host: 'gitlab.com', externalUserId: '73' },
  });
  await expect(editor.locator('[data-type="file"]')).toHaveCount(0);
  await editor.press('Enter');
  await expect(page.getByTestId('file-context')).toHaveText('[]');
  const stored = await page.getByTestId('stored-text').textContent();
  const payload = stored?.match(/^@member\[([A-Za-z0-9+/=]+)\]$/)?.[1];
  expect(payload).toBeTruthy();
  expect(JSON.parse(Buffer.from(payload!, 'base64').toString('utf8'))).toEqual({
    label: 'alice.dev_ops-team',
    principalId: 'gitlab-alice',
    workspaceId: 'member-mentions-workspace',
    identity: { provider: 'gitlab', host: 'gitlab.com', externalUserId: '73' },
  });
  const chat = page.getByTestId('submitted-chat');
  const comment = page.getByTestId('submitted-comment');
  await expect(chat).toContainText('@alice.dev_ops-team');
  await expect(comment.locator('[data-type="member"]')).toHaveText('@alice.dev_ops-team');
  for (const rendered of [chat, comment]) {
    await expect(rendered).not.toContainText('@member[');
    await expect(rendered).not.toContainText('devspace://');
  }
  await page.screenshot({ path: testInfo.outputPath('gitlab-submitted.png') });

  await chat.getByTestId('user-message-surface').click();
  const edit = chat.getByRole('textbox');
  await expect(edit.locator('[data-type="member"]')).toHaveAttribute(
    'data-id',
    'member-gitlab-alice',
  );
  await edit.press('End');
  await edit.pressSequentially(' thanks');
  await edit.press('Enter');
  await page.getByRole('button', { name: 'Edit & regenerate', exact: true }).click();
  await expect(page.getByTestId('stored-text')).toHaveText(`${stored} thanks`);

  await comment.getByRole('button', { name: 'Edit', exact: true }).click();
  const commentEdit = comment.getByRole('textbox');
  await expect(commentEdit.locator('[data-type="member"]')).toHaveAttribute(
    'data-id',
    'member-gitlab-alice',
  );
  await commentEdit.press('End');
  await commentEdit.pressSequentially(' please');
  await comment.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('stored-comment')).toHaveText(`${stored} please`);
  await expect(comment.locator('[data-type="member"]')).toHaveText('@alice.dev_ops-team');
  const requests = JSON.parse((await page.getByTestId('wire-requests').textContent()) ?? '[]');
  expect(requests.filter((r: { method: string }) => r.method === 'workspace.members.list')).toEqual(
    [{ method: 'workspace.members.list', params: { workspaceId: 'member-mentions-workspace' } }],
  );
});

test('a member with no forge metadata stays neutral through selection and submission', async ({
  page,
}) => {
  const editor = page.getByTestId('composer').getByRole('textbox');
  await editor.fill('@legacy');
  const row = page.getByRole('option', { name: '@legacy.dev', exact: true });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('GitHub');
  await editor.press('Enter');
  const chip = editor.locator('[data-type="member"]');
  await chip.hover();
  await expect(page.getByRole('tooltip')).toContainText('@legacy.dev');
  await expect(page.getByRole('tooltip')).not.toContainText('GitHub');
  await editor.press('Enter');
  await expect(page.getByTestId('submitted-chat')).toContainText('@legacy.dev');
  await expect(page.getByTestId('submitted-comment').locator('[data-type="member"]')).toHaveText(
    '@legacy.dev',
  );
  await expect(page.getByTestId('file-context')).toHaveText('[]');
});
