import { test, expect } from '../../../../../test/ct-test';
import Host from './CommentIsolationHost.svelte';

test('a live foreign-note event cannot appear in the current note sidebar', async ({
  mount,
  page,
}, info) => {
  await mount(Host);
  const note = page.getByTestId('first-note');
  await expect(note.locator('[role="button"][data-comment-id="isolation-a-spec"]')).toBeVisible();
  await page.clock.install();
  await page.getByRole('button', { name: 'Foreign event', exact: true }).click();
  await expect(page.getByTestId('cached-comments')).toContainText('isolation-b-task');
  // Drain the sidebar positioning debounce before asserting absence.
  await page.clock.runFor(500);
  await page.screenshot({ path: info.outputPath('foreign-event.png'), fullPage: true });
  await expect(note.locator('[role="button"][data-comment-id="isolation-b-task"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Same ID event', exact: true }).click();
  await expect(page.getByTestId('cached-comments')).toContainText('isolation-b-spec');
  await page.clock.runFor(500);
  await expect(note.locator('[role="button"][data-comment-id="isolation-b-spec"]')).toHaveCount(0);
  await expect(note.locator('[role="button"][data-comment-id="isolation-a-spec"]')).toBeVisible();
  const requests = JSON.parse(await page.getByTestId('requests').innerText());
  expect(requests).toContainEqual({
    workspaceId: 'isolation-b',
    noteId: 'task',
    includeComments: true,
  });
  expect(requests).toContainEqual({
    workspaceId: 'isolation-b',
    noteId: 'spec',
    includeComments: true,
  });
});

test('concurrent note views survive navigation and remount, with selection confined to its owner', async ({
  mount,
  page,
}, info) => {
  const host = await mount(Host);
  const first = page.getByTestId('first-note');
  const second = page.getByTestId('second-note');
  await expect(first.locator('[role="button"][data-comment-id="isolation-a-spec"]')).toBeVisible();
  await host.update({ props: { second: true } });
  await expect(second.locator('[role="button"][data-comment-id="isolation-b-spec"]')).toBeVisible();
  await expect(first.locator('[role="button"][data-comment-id="isolation-a-spec"]')).toBeVisible();
  await expect(first.locator('[role="button"][data-comment-id="isolation-b-spec"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Select first', exact: true }).click();
  await expect(
    first.locator('[role="button"][data-comment-id="isolation-a-spec"] [contenteditable="true"]'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Select second', exact: true }).click();
  await expect(
    second.locator('[role="button"][data-comment-id="isolation-b-spec"] [contenteditable="true"]'),
  ).toBeVisible();
  await expect(
    first.locator('[role="button"][data-comment-id="isolation-a-spec"] [contenteditable="true"]'),
  ).toBeVisible();
  await host.update({ props: { second: true, noteId: 'task' } });
  await expect(first.locator('[role="button"][data-comment-id="isolation-a-task"]')).toBeVisible();
  await expect(second.locator('[role="button"][data-comment-id="isolation-b-spec"]')).toBeVisible();
  await host.update({ props: { second: true, noteId: 'spec', generation: 1 } });
  await expect(first.locator('[role="button"][data-comment-id="isolation-a-spec"]')).toBeVisible();
  await expect(second.locator('[role="button"][data-comment-id="isolation-b-spec"]')).toBeVisible();
  await expect(first.locator('[role="button"][data-comment-id="isolation-b-spec"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('isolated-notes.png'), fullPage: true });
});

test('refresh rehydrates the owner after its live update and a foreign event', async ({
  mount,
  page,
}) => {
  const host = await mount(Host);
  const note = page.getByTestId('first-note');
  await expect(note.locator('[role="button"][data-comment-id="isolation-a-spec"]')).toBeVisible();
  await page.getByRole('button', { name: 'Own event', exact: true }).click();
  await expect(note.getByText('Updated own comment', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Foreign event', exact: true }).click();
  await expect(page.getByTestId('cached-comments')).toContainText('isolation-b-task');
  await host.unmount();
  await page.reload();
  await mount(Host);
  await expect(note.locator('[role="button"][data-comment-id="isolation-a-spec"]')).toBeVisible();
  await expect(note.locator('[role="button"][data-comment-id="isolation-b-task"]')).toHaveCount(0);
  expect(JSON.parse(await page.getByTestId('requests').innerText())).toEqual([
    { workspaceId: 'isolation-a', noteId: 'spec', includeComments: true },
  ]);
});
