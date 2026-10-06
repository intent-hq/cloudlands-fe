import { expect, test } from '../../test/ct-test';
import Preview from './assistant-panels.preview.svelte';

test('Assistant links replace content, retain history and keep the chat draft', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  const draft = component.getByRole('textbox', { name: 'Message the Assistant' });
  await draft.fill('Keep this draft');
  await testInfo.attach('assistant-before', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await expect(panel).toContainText('Plan for the repository');
  await component.getByRole('link', { name: 'Open the second plan', exact: true }).click();
  await expect(panel).toContainText('Second plan');
  await panel.getByTestId('pane-stack-selector-trigger').click();
  await page.getByRole('menuitem', { name: /Repository plan/ }).click();
  await expect(panel).toContainText('Plan for the repository');
  await expect(draft).toHaveValue('Keep this draft');
  await testInfo.attach('assistant-after', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await panel.getByRole('button', { name: 'Close active pane' }).click();
  await expect(panel).toContainText('Second plan');
  await panel.getByRole('button', { name: 'Close active pane' }).click();
  await expect(panel).toHaveCount(0);
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  await expect(panel).toContainText('Plan for the repository');
  await expect(draft).toHaveValue('Keep this draft');
});

test('Automatic Assistant opens reuse a panel and handle missing notes and narrow screens', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview);
  await component.getByRole('button', { name: 'Assistant shows a plan' }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await expect(panel).toContainText('Plan for the repository');
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  await panel.getByTestId('pane-stack-selector-trigger').click();
  await expect(page.getByRole('menuitem', { name: /Repository plan/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await component.getByRole('link', { name: 'Open workspace plan' }).click();
  await expect(panel).toContainText('A separate plan from another workspace.');
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  await expect(panel).toContainText('Plan for the repository');
  await component.getByRole('link', { name: 'Open missing note' }).click();
  await expect(panel).toContainText('Plan for the repository');
  await component.getByRole('link', { name: 'Open repository', exact: true }).click();
  await expect(panel.locator('[data-tab-id] webview')).toHaveAttribute(
    'src',
    /github.com\/acme\/studio/,
  );
  await panel.getByTestId('pane-stack-selector-trigger').click();
  await page.getByRole('menuitem', { name: /Repository plan/ }).click();
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(component.getByRole('textbox', { name: 'Message the Assistant' })).toBeVisible();
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await testInfo.attach('assistant-narrow', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Background content keeps the current page, pane and composer focus', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await expect(panel).toContainText('Plan for the repository');
  const draft = component.getByRole('textbox', { name: 'Message the Assistant' });
  await draft.fill('Keep reading this plan');
  await page.evaluate(() => window.__assistantPanels!.leaveAssistant());
  const before = await page.evaluate(() => window.__assistantPanels!.snapshot());
  await testInfo.attach('before-background-open', {
    body: await page.screenshot({ path: testInfo.outputPath('before-background-open.png') }),
    contentType: 'image/png',
  });
  await page.evaluate(() =>
    window.__assistantPanels!.navigate('intent://local/note/second', 'assistant-source'),
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.__assistantPanels!.snapshot().layouts.source.tabs.length),
    )
    .toBe(2);
  await expect(panel).toContainText('Plan for the repository');
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('Keep reading this plan');
  const after = await page.evaluate(() => window.__assistantPanels!.snapshot());
  expect(after.path).toBe(before.path);
  expect(after.destination).toBe(before.destination);
  expect(after.selectedThread).toBe(before.selectedThread);
  expect(after.layouts.source.activeTabId).toBe(before.layouts.source.activeTabId);
  expect(after.layouts.source.focusedPanelId).toBe(before.layouts.source.focusedPanelId);
  expect(after.layouts.source.pendingPanelReveal).toBe(before.layouts.source.pendingPanelReveal);
  await testInfo.attach('after-background-open', {
    body: await page.screenshot({ path: testInfo.outputPath('after-background-open.png') }),
    contentType: 'image/png',
  });
  await page.evaluate(() =>
    window.__assistantPanels!.navigate('intent://local/note/second', 'assistant-source'),
  );
  await expect.poll(() => page.evaluate(() => window.__assistantPanels!.calls.length)).toBe(3);
  await expect(panel).toContainText('Plan for the repository');
  await panel.getByTestId('pane-stack-selector-trigger').click();
  await expect(page.getByRole('menuitem', { name: /Second plan/ })).toHaveCount(1);
  await page.getByRole('menuitem', { name: /Second plan/ }).click();
  await expect(panel).toContainText('Second plan');
  await testInfo.attach('background-open-state', {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  });
});

test('Background notes and workspace opens stay with the sending thread', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview);
  await page.evaluate(() => {
    window.__assistantPanels!.addThread();
    window.__assistantPanels!.selectThread('assistant-other');
  });
  await component.getByRole('link', { name: 'Open the second plan', exact: true }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await expect(panel).toContainText('Second plan');
  await page.evaluate(() =>
    window.__assistantPanels!.navigate('intent://local/note/plan', 'assistant-source'),
  );
  await expect
    .poll(() => page.evaluate(() => window.__assistantPanels!.snapshot().layouts.source.tabs))
    .toEqual([{ type: 'note', noteId: 'plan', workspaceId: '__chief__' }]);
  await expect(panel).toContainText('Second plan');
  expect(await page.evaluate(() => window.__assistantPanels!.snapshot().selectedThread)).toBe(
    'assistant-other',
  );
  await page.evaluate(() => window.__assistantPanels!.selectThread('assistant-source'));
  await expect(panel).toContainText('Plan for the repository');
  await page.evaluate(() => window.__assistantPanels!.openWorkspace('assistant-other'));
  await expect
    .poll(() => page.evaluate(() => window.__assistantPanels!.snapshot().layouts.other.tabs))
    .toContainEqual({ type: 'workspace', workspaceId: 'example-workspace' });
  await expect(panel).toContainText('Plan for the repository');
  const calls = await page.evaluate(() => window.__assistantPanels!.calls);
  expect(calls).toContainEqual({ noteId: 'plan', workspaceId: '__chief__' });
  expect(calls).toContainEqual({ noteId: 'second', workspaceId: '__chief__' });
});

test('A delayed note click keeps its original thread after the user changes threads', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview);
  await page.evaluate(() => {
    window.__assistantPanels!.addThread();
    window.__assistantPanels!.holdNextRead();
  });
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__assistantPanels!.calls.length)).toBe(1);
  await page.evaluate(() => window.__assistantPanels!.selectThread('assistant-other'));
  await component.getByRole('link', { name: 'Open the second plan', exact: true }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await expect(panel).toContainText('Second plan');
  await page.evaluate(() => window.__assistantPanels!.release());
  await expect
    .poll(() => page.evaluate(() => window.__assistantPanels!.snapshot().layouts.source.tabs))
    .toEqual([{ type: 'note', noteId: 'plan', workspaceId: '__chief__' }]);
  await expect(panel).toContainText('Second plan');
  await page.evaluate(() => window.__assistantPanels!.selectThread('assistant-source'));
  await expect(panel).toContainText('Plan for the repository');
});

test('Opening a shared note in another thread preserves the user’s note mode', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview);
  await page.evaluate(() => {
    window.__assistantPanels!.addThread();
    window.__assistantPanels!.selectThread('assistant-other');
  });
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await expect(panel).toContainText('Plan for the repository');
  await page.evaluate(() => window.__assistantPanels!.setNoteMode('raw'));
  const before = await page.evaluate(() => window.__assistantPanels!.snapshot());
  await page.evaluate(() =>
    window.__assistantPanels!.navigate('intent://local/note/plan', 'assistant-source'),
  );
  await expect
    .poll(() => page.evaluate(() => window.__assistantPanels!.snapshot().layouts.source.tabs))
    .toEqual([{ type: 'note', noteId: 'plan', workspaceId: '__chief__' }]);
  const after = await page.evaluate(() => window.__assistantPanels!.snapshot());
  expect(after.planViewMode).toBe('raw');
  expect(after.selectedThread).toBe('assistant-other');
  expect(after.layouts.other.activeTabId).toBe(before.layouts.other.activeTabId);
  await testInfo.attach('shared-note-mode-state', {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  });
});

test('Unattributed background events cannot open notes in an arbitrary thread', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview);
  await page.evaluate(() => window.__assistantPanels!.addThread());
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await expect(panel).toContainText('Plan for the repository');
  await page.evaluate(() =>
    window.__assistantPanels!.navigateWithoutCaller('intent://local/note/second'),
  );
  expect(await page.evaluate(() => window.__assistantPanels!.calls)).toEqual([
    { noteId: 'plan', workspaceId: '__chief__' },
  ]);
  await expect(panel).toContainText('Plan for the repository');
});
