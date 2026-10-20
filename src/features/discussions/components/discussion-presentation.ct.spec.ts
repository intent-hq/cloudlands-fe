import { expect, test } from '../../../test/ct-test';
import Host from './__tests__/DiscussionPresentationHost.svelte';

test('message actions toggle a reaction, retain reply target, restore composer focus, and copy the selected body', async ({
  mount,
  page,
}) => {
  const component = await mount(Host);
  const row = component.locator('[data-discussion-message="message-19"]');
  await row.hover();
  await expect(row.locator('[data-discussion-message-actions]')).toHaveCSS('opacity', '1');
  await page.mouse.move(0, 0);
  await expect(row.locator('[data-discussion-message-actions]')).toHaveCSS('opacity', '0');
  await row.getByRole('button', { name: 'Reply', exact: true }).focus();
  await expect(row.locator('[data-discussion-message-actions]')).toHaveCSS('opacity', '1');
  await row.getByRole('button', { name: 'Add reaction', exact: true }).click();
  await page.getByRole('menuitem', { name: '👍', exact: true }).click();
  const reaction = row.getByRole('button', { name: '👍, 1 reactions', exact: true });
  await expect(reaction).toHaveAttribute('aria-pressed', 'true');
  await reaction.click();
  await expect(reaction).toHaveCount(0);
  await row.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(component.locator('[data-reply-target]')).toContainText('message-19');
  await expect(row).toHaveAttribute('data-discussion-reply-selected', 'true');
  await expect(
    component.locator('[data-discussion-composer] [data-discussion-reply-preview]'),
  ).toBeVisible();
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
  await component.getByRole('button', { name: 'Cancel reply', exact: true }).click();
  await expect(component.locator('[data-discussion-reply-preview]')).toHaveCount(0);
  await expect(row).not.toHaveAttribute('data-discussion-reply-selected');
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Keep this draft',
  );
  await row.hover();
  await expect(row.locator('[data-discussion-message-actions]')).toHaveCSS('opacity', '1');
  await row.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy message', exact: true }).click();
  await expect(component.locator('[data-copied]')).toContainText('Review item 20.');
});

test('a sent reply reference scrolls to and focuses the original message', async ({ mount }) => {
  const component = await mount(Host);
  await component.getByRole('button', { name: 'Receive new message', exact: true }).click();
  const reply = component.locator('[data-discussion-message="arrived"]');
  await reply.getByRole('button', { name: 'Jump to message from Alex' }).click();
  const original = component.locator('[data-discussion-message="message-0"]');
  await expect(original).toBeFocused();
  const scroll = await component.locator('[data-discussion-scroll]').boundingBox();
  const bounds = await original.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(scroll!.y);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(scroll!.y + scroll!.height);
});

test('new arrivals preserve the history viewport until the reader jumps to newest', async ({
  mount,
}) => {
  const component = await mount(Host);
  const scroll = component.locator('[data-discussion-scroll]');
  await scroll.evaluate((el) => {
    el.scrollTop = 100;
    el.dispatchEvent(new Event('scroll'));
  });
  const before = await scroll.evaluate((el) => el.scrollTop);
  await component.getByRole('button', { name: 'Receive new message', exact: true }).click();
  await expect(component.getByRole('button', { name: '1 new', exact: true })).toBeVisible();
  expect(Math.abs((await scroll.evaluate((el) => el.scrollTop)) - before)).toBeLessThanOrEqual(1);
  await component.getByRole('button', { name: '1 new', exact: true }).click();
  await expect(component.locator('[data-read-through]')).toHaveText('21');
  await expect(component.getByRole('button', { name: '1 new', exact: true })).toHaveCount(0);
  const bottomGap = await scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  expect(bottomGap).toBeLessThanOrEqual(1);
});

test('in-stream retry uses the pending identity and does not consume a newer draft', async ({
  mount,
}) => {
  const component = await mount(Host);
  await component.getByRole('button', { name: 'Fail pending message', exact: true }).click();
  const failed = component.locator('[data-discussion-failed="retry-key"]');
  await failed.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(component.locator('[data-retried]')).toHaveText('retry-key');
  await expect(component.locator('[data-discussion-message="retry-key"]')).toContainText('Sending');
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Keep this draft',
  );
});

test('inactive panes retain unread messages until the conversation is focused', async ({
  mount,
}) => {
  const component = await mount(Host, { props: { focused: false, active: false } });
  const scroll = component.locator('[data-discussion-scroll]');
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event('scroll'));
  });
  await expect(component.locator('[data-read-through]')).toHaveText('0');
  await component.update({ props: { focused: true, active: true } });
  await expect(component.locator('[data-read-through]')).toHaveText('20');
});
