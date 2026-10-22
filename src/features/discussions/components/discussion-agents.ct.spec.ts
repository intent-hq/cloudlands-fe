import { expect, test } from '../../../test/ct-test';
import DiscussionHost from './__tests__/DiscussionHost.svelte';

async function sends(component: import('@playwright/test').Locator) {
  const requests = JSON.parse(
    (await component.locator('[data-discussion-requests]').textContent()) || '[]',
  ) as Array<{ method: string; params: Record<string, unknown> }>;
  return requests
    .filter((request) => request.method === 'discussion.send')
    .map((request) => request.params);
}

test('agent authors open with pointer, Enter and Space while preserving the draft', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('Keep this draft');
  await component.getByRole('button', { name: 'Receive agent reply' }).click();
  const authors = component.getByRole('button', { name: 'Open agent Reviewer', exact: true });
  await expect(authors).toHaveCount(2);
  const navigation = component.locator('[data-discussion-agent-navigation]');
  const destination = ['discussion-test', { agentId: 'agent-reviewer', openInAdjacentPanel: true }];
  await authors.first().click();
  await expect(navigation).toHaveText(JSON.stringify([destination]));
  await authors.first().focus();
  await page.keyboard.press('Tab');
  await expect(authors.last()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(navigation).toHaveText(JSON.stringify([destination, destination]));
  await page.keyboard.press('Shift+Tab');
  await expect(authors.first()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(navigation).toHaveText(JSON.stringify([destination, destination, destination]));
  await expect(composer).toHaveValue('Keep this draft');
});

test('typing immediately after selecting an agent keeps the selected mention and caret', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Please ');
  await composer.press('@');
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await composer.pressSequentially('check this');
  await expect(composer).toHaveValue('Please @Reviewer check this');
  await expect(component.locator('[data-discussion-inline-mention]')).toHaveText('@Reviewer');
  await expect(composer).toBeFocused();
});

test('Stop and Retry control the selected agent attempt without consuming the current draft', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await component.getByRole('button', { name: 'Mention someone', exact: true }).click();
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await composer.pressSequentially('review this');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  const activity = component.locator('[data-discussion-agent-activity="agent-reviewer"]');
  await expect(activity).toHaveAttribute('data-discussion-activity-state', 'queued');
  await composer.fill('A separate draft');
  await activity.getByRole('button', { name: 'Stop Reviewer’s reply' }).click();
  await expect(activity).toHaveAttribute('data-discussion-activity-state', 'stopped');
  await activity.getByRole('button', { name: 'Retry Reviewer’s reply' }).click();
  await expect(activity).toHaveAttribute('data-discussion-activity-state', 'queued');
  await expect(composer).toHaveValue('A separate draft');
  const sent = await sends(component);
  expect(sent).toHaveLength(1);
  const requests = JSON.parse(
    (await component.locator('[data-discussion-requests]').textContent()) || '[]',
  );
  const messageId = await activity.getAttribute('data-discussion-activity-message');
  expect(
    requests.filter((request: { method: string }) =>
      /discussion\.(stop|retry)Agent/.test(request.method),
    ),
  ).toEqual([
    {
      method: 'discussion.stopAgent',
      params: { workspaceId: 'discussion-test', messageId, agentId: 'agent-reviewer', attempt: 1 },
    },
    {
      method: 'discussion.retryAgent',
      params: { workspaceId: 'discussion-test', messageId, agentId: 'agent-reviewer', attempt: 1 },
    },
  ]);
});

test('explicit mentions send only selected agents and show their replies in light and dark narrow panes', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('Can you review this? ');
  await composer.press('@');
  await expect(page.getByRole('listbox', { name: 'Mention someone' })).toBeVisible();
  await expect(composer).toBeFocused();
  await composer.pressSequentially('Reviewer');
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await expect(composer).toHaveValue('Can you review this? @Reviewer ');
  await expect(component.locator('[data-discussion-inline-mention]')).toContainText('@Reviewer');
  await expect(composer).toBeFocused();
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  expect(await sends(component)).toEqual([
    {
      workspaceId: 'discussion-test',
      messageId: expect.any(String),
      body: 'Can you review this? @Reviewer ',
      recipientAgentIds: ['agent-reviewer'],
      agentMentions: [{ agentId: 'agent-reviewer', name: 'Reviewer', start: 21, end: 30 }],
    },
  ]);
  await expect(
    component.locator('[data-discussion-message] [data-discussion-agent-mention]'),
  ).toContainText('@Reviewer');
  await component.getByRole('button', { name: 'Receive agent reply' }).click();
  await expect(component.locator('[data-discussion-agent-author]')).toHaveText('Agent');
  await expect(component.getByRole('log')).toContainText('I checked the changes.');
  await page.setViewportSize({ width: 390, height: 800 });
  await component.getByRole('button', { name: 'Mention someone', exact: true }).click();
  await expect(page.getByRole('option', { name: /Retired helper/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /Deleted helper/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /Elsewhere helper/ })).toHaveCount(0);
  await page.getByRole('option', { name: /Builder/ }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    await component
      .locator('[data-discussion-test-pane]')
      .screenshot({ path: testInfo.outputPath(`discussion-agents-${theme}.png`) });
  }
});

test('addressed agents can be added and removed while reading history', async ({ mount, page }) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const scroller = component.locator('[data-discussion-scroll]');
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
  await scroller.evaluate((el) => {
    el.scrollTop = 150;
    el.dispatchEvent(new Event('scroll'));
  });
  await component.getByRole('button', { name: 'Mention someone', exact: true }).click();
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await expect(component.locator('[data-discussion-inline-mention]')).toBeVisible();
  const input = component.getByRole('textbox', { name: 'Message', exact: true });
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await expect(component.locator('[data-discussion-inline-mention]')).toHaveCount(0);
});

test('deleting or removing a selected mention leaves ordinary text and links without delivery targets', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await component.getByRole('button', { name: 'Mention someone', exact: true }).click();
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await composer.fill(
    'Ordinary @Reviewer [Reviewer](intent://local/discussion-test/agent/agent-reviewer)',
  );
  await expect(component.locator('[data-discussion-inline-mention]')).toHaveCount(0);
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  expect((await sends(component))[0]).not.toHaveProperty('recipientAgentIds');
  await component.getByRole('button', { name: 'Mention someone', exact: true }).click();
  await page.getByRole('option', { name: /Reviewer/ }).click();
  const input = component.getByRole('textbox', { name: 'Message', exact: true });
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await expect(composer).toHaveValue('');
  await composer.fill('@Reviewer is an ordinary reference');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  expect((await sends(component))[1]).not.toHaveProperty('recipientAgentIds');
});

test('retry keeps original agent recipients while the new draft targets someone else', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost, {
    props: { agentMessaging: true, failSend: true },
  });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await component.getByRole('button', { name: 'Mention someone', exact: true }).click();
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await composer.press('Enter');
  await expect(component.locator('[data-discussion-failed]')).toBeVisible();
  await composer.fill('A new request ');
  await component.getByRole('button', { name: 'Mention someone', exact: true }).click();
  await page.getByRole('option', { name: /Builder/ }).click();
  await component
    .locator('[data-discussion-failed]')
    .getByRole('button', { name: 'Retry', exact: true })
    .click();
  await expect(component.locator('[data-discussion-failed]')).toHaveCount(0);
  const requests = await sends(component);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect(composer).toHaveValue('A new request @Builder ');
  await expect(component.locator('[data-discussion-inline-mention]')).toContainText('@Builder');
});

test('capability loss blocks a selected message instead of silently sending text', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  await component.getByRole('button', { name: 'Mention someone', exact: true }).click();
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await component.getByRole('button', { name: 'Disable agent messaging' }).click();
  await expect(component.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(component.getByRole('alert')).toContainText('Update Intent on the host');
  await component.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  expect(await sends(component)).toHaveLength(0);
});

test('users remain mentionable without agent support and private discussions offer participants only', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost);
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await component.getByRole('button', { name: 'Mention someone', exact: true }).click();
  await expect(page.getByRole('option', { name: /Alex/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Reviewer/ })).toHaveCount(0);
  await composer.press('Escape');
  await component.update({ props: { conversationId: '0199e991-0000-7000-8000-000000000001' } });
  await component.getByRole('button', { name: 'Mention someone', exact: true }).click();
  await expect(page.getByRole('option', { name: /Alex/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Jordan|Morgan|Reviewer|Builder/ })).toHaveCount(0);
  await page.getByRole('option', { name: /Alex/ }).click();
  await expect(composer).toHaveValue('@Alex ');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  expect((await sends(component))[0]).toMatchObject({
    conversationId: '0199e991-0000-7000-8000-000000000001',
    body: '@Alex ',
  });
  expect((await sends(component))[0]).not.toHaveProperty('recipientAgentIds');
});

test('mentions list agents before people and select a user without sending', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 420, height: 800 });
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.press('@');
  const list = page.getByRole('listbox', { name: 'Mention someone' });
  await expect(list.getByRole('option')).toHaveCount(5);
  const labels = await list.getByRole('option').allTextContents();
  expect(labels.slice(0, 2).join(' ')).toContain('Reviewer');
  expect(labels.slice(0, 2).join(' ')).toContain('Builder');
  expect(labels[2]).toContain('Alex');
  await expect(composer).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('discussion-mentions-light.png') });
  await composer.pressSequentially('river');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toContainText('Alex');
  await expect(composer).toBeFocused();
  await composer.press('Enter');
  await expect(composer).toHaveValue('@Alex ');
  await expect(list).toHaveCount(0);
  expect(await sends(component)).toEqual([]);
  await expect(component.locator('[data-discussion-inline-mention]')).toHaveCount(0);
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  expect((await sends(component))[0]).toMatchObject({ body: '@Alex ' });
  expect((await sends(component))[0]).not.toHaveProperty('recipientAgentIds');
  expect((await sends(component))[0]).not.toHaveProperty('recipientPrincipalIds');
});

test('selecting a person preserves its identity through typing and sends it without changing conversation recipients', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost, { props: { principalMentions: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('Hi @Alex');
  await expect(page.getByRole('option', { name: /Alex/ })).toBeVisible();
  await composer.press('Tab');
  await composer.pressSequentially('please review');
  await expect(composer).toHaveValue('Hi @Alex please review');
  await expect(composer).toBeFocused();
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  expect((await sends(component))[0]).toMatchObject({
    body: 'Hi @Alex please review',
    principalMentions: [{ principalId: 'alex', name: 'Alex', start: 3, end: 8 }],
  });
  expect((await sends(component))[0]).not.toHaveProperty('recipientPrincipalIds');
  expect((await sends(component))[0]).not.toHaveProperty('recipientAgentIds');
});

test('mention selection preserves surrounding text and Escape leaves the draft editable', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('Hello  please review');
  await composer.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6));
  await composer.press('@');
  await composer.pressSequentially('Alex');
  await expect(page.getByRole('option', { name: /Alex/ })).toBeVisible();
  await composer.press('Tab');
  await expect(composer).toHaveValue('Hello @Alex  please review');
  await expect(composer).toBeFocused();
  await composer.pressSequentially('and ');
  await expect(composer).toHaveValue('Hello @Alex and  please review');
  await composer.press('@');
  const list = page.getByRole('listbox', { name: 'Mention someone' });
  await expect(list).toBeVisible();
  await composer.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(composer).toBeFocused();
  expect(await sends(component)).toEqual([]);
});

test('arrow keys select a person while composition and empty results never send', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.press('@');
  const list = page.getByRole('listbox', { name: 'Mention someone' });
  await expect(list.getByRole('option')).toHaveCount(5);
  await composer.press('ArrowDown');
  await composer.press('ArrowDown');
  await expect(list.getByRole('option', { selected: true })).toContainText('Alex');
  await composer.press('Enter');
  await expect(composer).toHaveValue('@Alex ');
  await composer.fill('@no-such-person');
  await expect(list.getByRole('option')).toHaveCount(0);
  await composer.press('Enter');
  await expect(composer).toHaveValue('@no-such-person');
  await composer.fill('@Alex');
  await expect(list).toBeVisible();
  await composer.dispatchEvent('compositionstart');
  await expect(list).toHaveCount(0);
  await composer.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await composer.dispatchEvent('compositionend');
  await expect(list).toBeVisible();
  expect(await sends(component)).toEqual([]);
});
