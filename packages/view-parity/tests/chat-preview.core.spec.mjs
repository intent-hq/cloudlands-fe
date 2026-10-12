import {
  test,
  expect,
  openPreview,
  exercise,
  field,
  button,
  prompt,
  promptText,
  toolText,
  toolIcon,
  calls,
  promptName,
  choice,
  applyTool,
  expectPrompt,
  expectTool,
  expectHidden,
  expectTitle,
  capturePreview,
  expectContained,
  expectArtwork,
} from '../lib/chat-preview.mjs';

test('chat preview P1: pointer Enter and Space activate once with native focus and accessible text', async ({
  page,
}, info) => {
  const item = exercise(await openPreview(page), 'pinned');
  await expectPrompt(item, 'Review the changes.');
  await capturePreview(page, item, 'activation-before', info);
  await button(item, 'Remount Pinned prompt').click();
  await page.keyboard.press('Tab');
  await expect(prompt(item)).toBeFocused();
  await prompt(item).click();
  await expect.poll(async () => (await calls(item)).length).toBe(1);
  const [pointer] = await calls(item);
  expect(pointer).toMatchObject({
    callbackRevision: 0,
    argumentCount: 1,
    event: {
      sameAsCapturedNativeEvent: true,
      type: 'click',
      nativeType: 'click',
      detail: 1,
      isTrusted: true,
      currentTargetLabel: promptName(),
    },
  });
  // The React callback receives a distinct synthetic object wrapping the actual
  // captured native event. Original Svelte forwards that native event itself.
  expect(pointer.event.objectId).not.toBe(pointer.event.nativeObjectId);
  await expect(prompt(item)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => calls(item))
    .toEqual([pointer, { callbackRevision: 0, argumentCount: 0, event: null }]);
  await page.keyboard.press('Space');
  await expect
    .poll(() => calls(item))
    .toEqual([
      pointer,
      { callbackRevision: 0, argumentCount: 0, event: null },
      { callbackRevision: 0, argumentCount: 0, event: null },
    ]);
  await expect(prompt(item)).toBeFocused();
  await expectContained(item, info, 'activation', true);
  await capturePreview(page, item, 'activation-after', info);
});

test('chat preview P2: current prompt text and native width changes update full titles and descriptions', async ({
  page,
}, info) => {
  const item = exercise(await openPreview(page), 'pinned');
  const text = 'Review the migration changes.';
  await expectPrompt(item, 'Review the changes.');
  await expectTitle(promptText(item), 'Review the changes.', false);
  await capturePreview(page, item, 'prompt-title-before', info);
  await field(item, 'Prompt text').fill(text);
  await choice(item, 'Pinned prompt frame width', '180');
  await expectPrompt(item, text);
  await expectTitle(promptText(item), text, true);
  await expectContained(item, info, 'prompt-narrow', true);
  await capturePreview(page, item, 'prompt-title-narrow', info);
  await choice(item, 'Pinned prompt frame width', '320');
  await expectTitle(promptText(item), text, false);
  const long = 'Current prompt 日本語 & <literal> '.repeat(12);
  await field(item, 'Prompt text').fill(long);
  await expectPrompt(item, long);
  await expectTitle(promptText(item), long, true);
  await capturePreview(page, item, 'prompt-title-long', info);
  await field(item, 'Prompt text').fill('First line\nSecond line');
  await expectPrompt(item, 'First line\nSecond line');
  await field(item, 'Prompt text').fill('');
  await expectPrompt(item, '');
  await expect(promptText(item)).not.toHaveAttribute('title');
  await field(item, 'Prompt text').fill('Current');
  await expectPrompt(item, 'Current');
  await expectTitle(promptText(item), 'Current', false);
  await capturePreview(page, item, 'prompt-title-after', info);
});

test('chat preview T1: workspace API stays absent until a usable summary or prose title exists', async ({
  page,
}, info) => {
  const item = exercise(await openPreview(page), 'tool');
  await expectTool(item, 'Read pinned-user-prompt.tsx src/features/chat/components');
  await capturePreview(page, item, 'summary-before', info);
  const name = 'mcp__workspace-mcp__workspace_api';
  for (const input of [
    { code: 'return await ws.note.list()' },
    { code: 'return await ws.note.list()', summary: '' },
    { code: 'return await ws.note.list()', summary: ' \n ', _acpTitle: name },
    { code: 'return await ws.note.list()', _acpTitle: '//local/mcp/workspace_api' },
  ]) {
    await applyTool(item, name, input);
    await expectHidden(item);
  }
  await capturePreview(page, item, 'summary-hidden', info);
  await applyTool(
    item,
    name,
    {
      code: 'return await ws.note.list()',
      summary: '  Review current notes  ',
      _acpTitle: name,
    },
    'Enter',
  );
  await expectTool(item, 'Review current notes');
  await expectArtwork(toolIcon(item), 'note-sticky', info);
  await applyTool(
    item,
    name,
    {
      code: 'return await ws.note.list()',
      summary: 'Superseded summary',
      _acpTitle: 'Review the latest notes',
    },
    'Space',
  );
  await expectTool(item, 'Review the latest notes');
  await applyTool(item, name, {
    code: 'return await ws.note.list()',
    summary: 'Current summary',
    _acpTitle: 'mcp.workspace-mcp.workspace_api',
  });
  await expectTool(item, 'Current summary');
  await capturePreview(page, item, 'summary-after', info);
});

test('chat preview T2: real known generic and deferred inputs produce readable labels and original icons', async ({
  page,
}, info) => {
  const item = exercise(await openPreview(page), 'tool');
  await applyTool(item, 'Read', { file_path: 'src/example.ts' });
  await expectTool(item, 'Read example.ts src');
  await expectArtwork(toolIcon(item), 'file-lines', info);
  await capturePreview(page, item, 'classify-read', info);
  await applyTool(item, 'frobnicate_widget', {});
  await expectTool(item, 'Frobnicate widget');
  await expectArtwork(toolIcon(item), 'wrench', info);
  await capturePreview(page, item, 'classify-generic', info);
  await applyTool(item, 'ToolSearch', { query: 'select:mcp__workspace-mcp__workspace_api' });
  await expectTool(item, 'Loading tools');
  await expectArtwork(toolIcon(item), 'magnifying-glass', info);
  await capturePreview(page, item, 'classify-deferred', info);
  // An unstrippable raw MCP identifier has no user-readable fallback row.
  await applyTool(item, 'mcp__custom_server__frobnicate', {});
  await expectHidden(item);
  await applyTool(item, 'Read', { file_path: 'current.ts' });
  await expectTool(item, 'Read current.ts');
  await expectArtwork(toolIcon(item), 'file-lines', info);
  await capturePreview(page, item, 'classify-after', info);
});

test('chat preview T3: Markdown summary becomes current inert plain text without external effects', async ({
  page,
}, info) => {
  const item = exercise(await openPreview(page), 'tool');
  await capturePreview(page, item, 'plaintext-before', info);
  const name = 'workspace_api';
  const code = 'return await ws.note.list()';
  const tick = String.fromCharCode(96);
  await applyTool(item, name, {
    code,
    summary:
      '**Review** _notes_ and ' +
      tick +
      'code' +
      tick +
      ' with [readable links](https://example.com) &amp; context',
  });
  await expectTool(item, 'Review notes and code with readable links & context');
  await capturePreview(page, item, 'plaintext-markdown', info);
  await applyTool(item, name, {
    code,
    summary: '<b onclick="alert(1)">Current</b> &amp; **日本語**\n\nAfter<br>line',
  });
  await expectTool(item, 'Current & 日本語 After line');
  await applyTool(item, name, { code, summary: '**Previous** value' });
  await applyTool(item, name, { code, summary: '_Current_ value' });
  await expectTool(item, 'Current value');
  // Successive caller edits establish the final rendered value, not whether
  // any older promise was still pending at the time of replacement.
  await capturePreview(page, item, 'plaintext-after', info);
  await expect(toolText(item)).not.toHaveAttribute('title');
});
