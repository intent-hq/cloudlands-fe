import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../test/ct-test';
import Preview from './assistant-panels.preview.svelte';

async function selectNoteView(panel: Locator, page: Page, name: 'Editor' | 'Rendered preview') {
  await panel.getByTestId('panel-actions-trigger').filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: /^Note view/ }).press('ArrowRight');
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

for (const note of [
  { link: 'Open the plan', id: 'plan', width: 1440 },
  { link: 'Open empty note', id: 'empty', width: 600 },
  { link: 'Open long note', id: 'long', width: 600 },
]) {
  test(`Assistant ${note.id} note opens editable, saves and reopens`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: note.width, height: 900 });
    const component = await mount(Preview);
    const draft = component.getByRole('textbox', { name: 'Message the Assistant' });
    await draft.fill('Keep my conversation draft');
    await component.getByRole('link', { name: note.link, exact: true }).click();
    const panel = component.locator('[data-assistant-content-panel]');
    const editor = panel.locator('.tiptap[contenteditable="true"]').filter({ visible: true });
    await expect(editor).toBeVisible();
    await testInfo.attach(`assistant-${note.id}-default`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Updated by me.');
    await selectNoteView(panel, page, 'Rendered preview');
    await expect(
      panel.getByTestId('rendered-note-preview').filter({ visible: true }),
    ).toContainText('Updated by me.');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                assistantNoteRequests?: Array<{ method: string; params: unknown }>;
              }
            ).assistantNoteRequests?.filter((request) => request.method === 'note.setContent') ??
            [],
        ),
      )
      .toHaveLength(1);
    const requests = await page.evaluate(
      () =>
        (
          window as typeof window & {
            assistantNoteRequests?: Array<{ method: string; params: unknown }>;
          }
        ).assistantNoteRequests ?? [],
    );
    expect(requests.find((request) => request.method === 'workspace.get')).toEqual({
      method: 'workspace.get',
      params: { workspaceId: '__chief__' },
    });
    expect(requests.find((request) => request.method === 'note.setContent')).toEqual({
      method: 'note.setContent',
      params: {
        workspaceId: '__chief__',
        noteId: note.id,
        expectedVersion: 1,
        content: expect.stringContaining('Updated by me.'),
      },
    });
    await component.getByRole('link', { name: 'Open the second plan', exact: true }).click();
    await component.getByRole('link', { name: note.link, exact: true }).click();
    await expect(
      panel.getByTestId('rendered-note-preview').filter({ visible: true }),
    ).toContainText('Updated by me.');
    await selectNoteView(panel, page, 'Editor');
    await component.getByRole('link', { name: note.link, exact: true }).click();
    await expect(editor).toContainText('Updated by me.');
    await expect(draft).toHaveValue('Keep my conversation draft');
    await testInfo.attach(`assistant-${note.id}-edited`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await testInfo.attach(`assistant-${note.id}-requests`, {
      body: JSON.stringify(requests, null, 2),
      contentType: 'application/json',
    });
  });
}

test('Assistant opens workspace notes in their own editable workspace', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  await component.getByRole('link', { name: 'Open workspace plan' }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  const editor = panel.locator('.tiptap[contenteditable="true"]').filter({ visible: true });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(' Saved in its workspace.');
  await selectNoteView(panel, page, 'Rendered preview');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              assistantNoteRequests?: Array<{ method: string; params: unknown }>;
            }
          ).assistantNoteRequests?.find((request) => request.method === 'note.setContent')?.params,
      ),
    )
    .toEqual({
      workspaceId: 'example-workspace',
      noteId: 'plan',
      expectedVersion: 1,
      content: expect.stringContaining('Saved in its workspace.'),
    });
  await testInfo.attach('workspace-note-edited', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Assistant note menus fit a narrow panel and unavailable workspaces stay readable', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 420, height: 900 });
  const component = await mount(Preview);
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await expect(panel.locator('.tiptap[contenteditable="true"]')).toBeVisible();
  await panel.getByTestId('panel-actions-trigger').filter({ visible: true }).click();
  const menu = page.locator('[data-slot="menu-content"]');
  await expect(menu.getByRole('menuitem', { name: /Move panel/ })).toHaveCount(0);
  const view = menu.getByRole('menuitem', { name: /^Note view/ });
  await expect(view).toBeVisible();
  const bounds = await view.evaluate((node) => {
    const labels = Array.from(
      node.querySelectorAll('[data-note-setting-label], [data-note-setting-value]'),
    );
    const rects = labels.map((label) => label.getBoundingClientRect());
    return {
      separate: rects[0].bottom <= rects[1].top,
      contained: rects.every((rect) => rect.left >= 0 && rect.right <= innerWidth),
    };
  });
  expect(bounds).toEqual({ separate: true, contained: true });
  await testInfo.attach('assistant-note-menu-narrow', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await component.getByRole('link', { name: 'Open unavailable workspace note' }).click();
  await expect(panel.getByTestId('rendered-note-preview').filter({ visible: true })).toContainText(
    'Plan for the repository',
  );
  await expect(
    panel.locator('.tiptap[contenteditable="true"]').filter({ visible: true }),
  ).toHaveCount(0);
  await panel.getByTestId('panel-actions-trigger').filter({ visible: true }).click();
  await menu.getByRole('menuitem', { name: /^Note view/ }).press('ArrowRight');
  const views = page.getByRole('menu', { name: 'Note view', exact: true });
  await expect(views.getByRole('menuitemradio', { name: 'Editor', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(
    views.getByRole('menuitemradio', { name: 'Raw Markdown', exact: true }),
  ).toHaveAttribute('aria-disabled', 'true');
  await testInfo.attach('unavailable-workspace-note', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Assistant notes remain readable when the workspace lookup fails', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview);
  await component.getByRole('link', { name: 'Open workspace lookup failure note' }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await expect(panel.getByTestId('rendered-note-preview')).toContainText('Plan for the repository');
  await expect(panel.locator('.tiptap[contenteditable="true"]')).toHaveCount(0);
  await testInfo.attach('workspace-lookup-failure-note', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const mode of ['editor', 'raw'] as const) {
  test(`Assistant links preserve a ${mode} view open in another layout`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(Preview, { props: { workspaceView: mode } });
    await component.getByRole('link', { name: 'Open workspace plan' }).click();
    const panel = component.locator('[data-assistant-content-panel]');
    const view =
      mode === 'raw'
        ? panel.getByTestId('raw-note-view')
        : panel.locator('.tiptap[contenteditable="true"]');
    await expect(view).toBeVisible();
    await expect(panel.getByTestId('rendered-note-preview')).toHaveCount(0);
    await testInfo.attach(`workspace-${mode}-preserved`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

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

for (const backgroundNote of ['second', 'missing']) {
  test(`A slow user click survives a same-thread background open of ${backgroundNote}`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(Preview);
    await page.evaluate(() => window.__assistantPanels!.holdNextRead());
    await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__assistantPanels!.calls.length)).toBe(1);
    await page.evaluate(
      (noteId) =>
        window.__assistantPanels!.navigateBackground(
          `intent://local/note/${noteId}`,
          'assistant-source',
        ),
      backgroundNote,
    );
    await expect.poll(() => page.evaluate(() => window.__assistantPanels!.calls.length)).toBe(2);
    const panel = component.locator('[data-assistant-content-panel]');
    if (backgroundNote === 'second') await expect(panel).toContainText('Second plan');
    await page.evaluate(() => window.__assistantPanels!.release());
    await expect(panel).toContainText('Plan for the repository');
    const after = await page.evaluate(() => window.__assistantPanels!.snapshot());
    expect(after.selectedThread).toBe('assistant-source');
    await testInfo.attach('explicit-open-priority-state', {
      body: JSON.stringify({ backgroundNote, after }, null, 2),
      contentType: 'application/json',
    });
  });
}

for (const firstOpen of ['user', 'background']) {
  test(`A newer user click supersedes a slow ${firstOpen} open in the same thread`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(Preview);
    await page.evaluate(() => window.__assistantPanels!.holdNextRead());
    if (firstOpen === 'user')
      await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
    else
      await page.evaluate(() =>
        window.__assistantPanels!.navigate('intent://local/note/plan', 'assistant-source'),
      );
    await expect.poll(() => page.evaluate(() => window.__assistantPanels!.calls.length)).toBe(1);
    await component.getByRole('link', { name: 'Open the second plan', exact: true }).click();
    const panel = component.locator('[data-assistant-content-panel]');
    await expect(panel).toContainText('Second plan');
    await page.evaluate(() => window.__assistantPanels!.release());
    await expect(panel).toContainText('Second plan');
    const after = await page.evaluate(() => window.__assistantPanels!.snapshot());
    expect(after.layouts.source.tabs).toEqual([
      { type: 'note', noteId: 'second', workspaceId: '__chief__' },
    ]);
    await testInfo.attach('newer-explicit-open-state', {
      body: JSON.stringify({ firstOpen, after }, null, 2),
      contentType: 'application/json',
    });
  });
}

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
