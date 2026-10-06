import { expect, test } from '../../test/ct-test';
import Preview from './assistant-panels.preview.svelte';

for (const note of [
  { link: 'Open the plan', id: 'plan', width: 1440 },
  { link: 'Open empty note', id: 'empty', width: 600 },
  { link: 'Open long note', id: 'long', width: 600 },
]) {
  test(`Assistant ${note.id} note can be edited, saved and reopened`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: note.width, height: 900 });
    const component = await mount(Preview);
    const draft = component.getByRole('textbox', { name: 'Message the Assistant' });
    await draft.fill('Keep my conversation draft');
    await component.getByRole('link', { name: note.link, exact: true }).click();
    const panel = component.locator('[data-assistant-content-panel]');
    await panel.getByRole('button', { name: 'Edit note', exact: true }).click();
    const editor = panel.locator('.tiptap[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Updated by me.');
    await panel.getByRole('button', { name: 'Rendered preview', exact: true }).click();
    await expect(panel.getByTestId('rendered-note-preview')).toContainText('Updated by me.');
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
    await expect(panel.getByTestId('rendered-note-preview')).toContainText('Updated by me.');
    await panel.getByRole('button', { name: 'Edit note', exact: true }).click();
    await component.getByRole('link', { name: note.link, exact: true }).click();
    await expect(panel.locator('.tiptap[contenteditable="true"]')).toContainText('Updated by me.');
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
  await panel.getByRole('button', { name: 'Edit note', exact: true }).click();
  const editor = panel.locator('.tiptap[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(' Saved in its workspace.');
  await panel.getByRole('button', { name: 'Rendered preview', exact: true }).click();
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
  await panel.getByTestId('panel-actions-trigger').filter({ visible: true }).click();
  const menu = page.locator('[data-slot="menu-content"]');
  await expect(menu.getByRole('menuitem', { name: 'Edit note', exact: true })).toBeVisible();
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
  await expect(panel.getByTestId('rendered-note-preview')).toContainText('Plan for the repository');
  await expect(panel.getByRole('button', { name: 'Edit note', exact: true })).toHaveCount(0);
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
  await expect(panel.getByRole('button', { name: 'Edit note', exact: true })).toHaveCount(0);
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
