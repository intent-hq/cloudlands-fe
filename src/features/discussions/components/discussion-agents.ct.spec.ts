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

test('explicit mentions send only selected agents and show their replies in light and dark narrow panes', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('Can you review this? ');
  await composer.press('@');
  await expect(page.getByRole('combobox', { name: 'Address an agent' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Address an agent' }).fill('Reviewer');
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await expect(composer).toHaveValue('Can you review this? @Reviewer ');
  await expect(component.locator('[data-discussion-agent-recipients]')).toContainText('@Reviewer');
  await expect(composer).toBeFocused();
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  expect(await sends(component)).toEqual([
    {
      workspaceId: 'discussion-test',
      messageId: expect.any(String),
      body: 'Can you review this? @Reviewer ',
      recipientAgentIds: ['agent-reviewer'],
    },
  ]);
  await expect(component.locator('[data-discussion-message-agents]')).toContainText('@Reviewer');
  await component.getByRole('button', { name: 'Receive agent reply' }).click();
  await expect(component.locator('[data-discussion-agent-author]')).toHaveText('Agent');
  await expect(component.getByRole('log')).toContainText('I checked the changes.');
  await page.setViewportSize({ width: 390, height: 800 });
  await component.getByRole('button', { name: 'Address an agent', exact: true }).click();
  await expect(page.getByRole('option', { name: /Retired helper/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /Deleted helper/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /Elsewhere helper/ })).toHaveCount(0);
  await page.getByRole('option', { name: /Builder/ }).click();
  const scroller = component.locator('[data-discussion-scroll]');
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThan(2);
  const replyBottom = await component
    .getByText('I checked the changes. The layout looks good.', { exact: true })
    .boundingBox();
  const historyBounds = await scroller.boundingBox();
  expect(replyBottom!.y + replyBottom!.height).toBeLessThanOrEqual(
    historyBounds!.y + historyBounds!.height,
  );
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    await component
      .locator('[data-discussion-test-pane]')
      .screenshot({ path: testInfo.outputPath(`discussion-agents-${theme}.png`) });
    expect(
      await component
        .locator('[data-discussion-composer]')
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
});

test('changing addressed agents preserves an older reading position', async ({ mount, page }) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const scroller = component.locator('[data-discussion-scroll]');
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
  await scroller.evaluate((el) => {
    el.scrollTop = 150;
    el.dispatchEvent(new Event('scroll'));
  });
  const before = await scroller.evaluate((el) => el.scrollTop);
  await component.getByRole('button', { name: 'Address an agent', exact: true }).click();
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await expect(component.locator('[data-discussion-agent-recipients]')).toBeVisible();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(before);
  await component
    .locator('[data-discussion-agent-recipients]')
    .getByRole('button', { name: /Remove/ })
    .click();
  await expect(component.locator('[data-discussion-agent-recipients]')).toHaveCount(0);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(before);
});

test('deleting or removing a selected mention leaves ordinary text and links without delivery targets', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await component.getByRole('button', { name: 'Address an agent', exact: true }).click();
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await composer.fill(
    'Ordinary @Reviewer [Reviewer](intent://local/discussion-test/agent/agent-reviewer)',
  );
  await expect(component.locator('[data-discussion-agent-recipients]')).toHaveCount(0);
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  expect((await sends(component))[0]).not.toHaveProperty('recipientAgentIds');
  await component.getByRole('button', { name: 'Address an agent', exact: true }).click();
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await component
    .locator('[data-discussion-agent-recipients]')
    .getByRole('button', { name: /Remove/ })
    .click();
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
  await component.getByRole('button', { name: 'Address an agent', exact: true }).click();
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await composer.press('Enter');
  await expect(component.locator('[data-discussion-failed]')).toBeVisible();
  await composer.fill('A new request ');
  await component.getByRole('button', { name: 'Address an agent', exact: true }).click();
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
  await expect(component.locator('[data-discussion-agent-recipients]')).toContainText('@Builder');
});

test('capability loss blocks a selected message instead of silently sending text', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost, { props: { agentMessaging: true } });
  await component.getByRole('button', { name: 'Address an agent', exact: true }).click();
  await page.getByRole('option', { name: /Reviewer/ }).click();
  await component.getByRole('button', { name: 'Disable agent messaging' }).click();
  await expect(component.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(component.getByRole('alert')).toContainText('Update Intent on the host');
  await component.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  expect(await sends(component)).toHaveLength(0);
});

test('older daemons disable addressing and private conversations have no agent picker', async ({
  mount,
}) => {
  const component = await mount(DiscussionHost);
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
  await expect(
    component.getByRole('button', { name: 'Address an agent', exact: true }),
  ).toBeDisabled();
  await component.update({ props: { conversationId: '0199e991-0000-7000-8000-000000000001' } });
  await expect(
    component.getByRole('button', { name: 'Address an agent', exact: true }),
  ).toHaveCount(0);
});
