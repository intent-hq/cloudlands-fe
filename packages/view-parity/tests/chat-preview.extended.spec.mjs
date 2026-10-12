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
  choice,
  toggle,
  mount,
  applyTool,
  expectPrompt,
  expectTool,
  expectHidden,
  expectTitle,
  capturePreview,
  expectContained,
  expectArtwork,
  expectIconSize,
} from '../lib/chat-preview.mjs';

test('chat preview P3: both prompt surfaces keep optional original artwork contained and accessible', async ({
  page,
}, info) => {
  const item = exercise(await openPreview(page), 'pinned');
  await expect(prompt(item).locator('svg')).toHaveCount(0);
  await capturePreview(page, item, 'surface-user-before', info);
  await choice(item, 'Prompt icon', 'pin');
  await expectArtwork(prompt(item), 'thumbtack', info);
  await expectPrompt(item, 'Review the changes.');
  await expectContained(item, info, 'surface-user', true);
  await capturePreview(page, item, 'surface-user-pin', info);
  await choice(item, 'Prompt surface', 'subscription');
  await choice(item, 'Prompt icon', 'file');
  await choice(item, 'Pinned prompt frame width', '180');
  const text =
    'A current prompt that must remain fully accessible even when its visual line is clipped.';
  await field(item, 'Prompt text').fill(text);
  await expectPrompt(item, text);
  await expectTitle(promptText(item), text, true);
  await expectArtwork(prompt(item), 'file-lines', info);
  await expectContained(item, info, 'surface-subscription', true);
  await capturePreview(page, item, 'surface-subscription-file', info);
  await prompt(item).press('Enter');
  await expect
    .poll(() => calls(item))
    .toEqual([{ callbackRevision: 0, argumentCount: 0, event: null }]);
  await choice(item, 'Prompt icon', 'none');
  await expect(prompt(item).locator('svg')).toHaveCount(0);
  await choice(item, 'Prompt surface', 'user');
  await expectPrompt(item, text);
  await capturePreview(page, item, 'surface-after', info);
  // Surface appearance is retained for inspection; no class/color oracle or
  // source-paired screenshot parity is inferred from this candidate capture.
});

test('chat preview P4: callback replacement and native remount dispose the old prompt title', async ({
  page,
}, info) => {
  const item = exercise(await openPreview(page), 'pinned');
  const long = 'Current callback and full prompt description '.repeat(8);
  await field(item, 'Prompt text').fill(long);
  await expectPrompt(item, long);
  await expectTitle(promptText(item), long, true);
  await capturePreview(page, item, 'prompt-owner-before', info);
  const oldButton = await prompt(item).elementHandle();
  const oldText = await promptText(item).elementHandle();
  try {
    await prompt(item).press('Enter');
    await button(item, 'Replace prompt callback').click();
    await prompt(item).press('Space');
    await expect
      .poll(() => calls(item))
      .toEqual([
        { callbackRevision: 0, argumentCount: 0, event: null },
        { callbackRevision: 1, argumentCount: 0, event: null },
      ]);
    expect(await oldButton.evaluate((node) => node.isConnected)).toBe(true);
    await mount(item, 'Pinned prompt', false);
    expect(await oldButton.evaluate((node) => node.isConnected)).toBe(false);
    expect(await oldText.evaluate((node) => node.getAttribute('title'))).toBeNull();
    const current = 'Recreated current prompt '.repeat(8);
    await field(item, 'Prompt text').fill(current);
    await button(item, 'Replace prompt callback').click();
    await mount(item, 'Pinned prompt', true);
    await expectPrompt(item, current);
    await expectTitle(promptText(item), current, true);
    await prompt(item).press('Enter');
    await expect
      .poll(() => calls(item))
      .toEqual([
        { callbackRevision: 0, argumentCount: 0, event: null },
        { callbackRevision: 1, argumentCount: 0, event: null },
        { callbackRevision: 2, argumentCount: 0, event: null },
      ]);
    const mountedText = await promptText(item).elementHandle();
    try {
      await button(item, 'Remount Pinned prompt').press('Enter');
      expect(await mountedText.evaluate((node) => node.isConnected)).toBe(false);
      expect(await mountedText.evaluate((node) => node.getAttribute('title'))).toBeNull();
      await expectPrompt(item, current);
      await expectTitle(promptText(item), current, true);
      await page.keyboard.press('Tab');
      await expect(prompt(item)).toBeFocused();
      await capturePreview(page, item, 'prompt-owner-after', info);
    } finally {
      await mountedText.dispose();
    }
  } finally {
    await oldButton.dispose();
    await oldText.dispose();
  }
});

test('chat preview T4: title follows native resize current inputs hidden branches and new DOM owners', async ({
  page,
}, info) => {
  const item = exercise(await openPreview(page), 'tool');
  const name = 'workspace_api';
  const code = 'return await ws.note.list()';
  const text = 'Review the migration changes.';
  await applyTool(item, name, { code, summary: text });
  await choice(item, 'Tool preview frame width', '180');
  await expectTool(item, text);
  await expectTitle(toolText(item), text, true);
  await capturePreview(page, item, 'tool-title-narrow', info);
  const oldText = await toolText(item).elementHandle();
  try {
    await choice(item, 'Tool preview frame width', '320');
    await expectTitle(toolText(item), text, false);
    const long = 'Current full tool label 日本語 '.repeat(15);
    await applyTool(item, name, { code, summary: long });
    await expectTool(item, long.trim());
    await expectTitle(toolText(item), long.trim(), true);
    expect(await oldText.evaluate((node) => node.isConnected)).toBe(true);
    await expectContained(item, info, 'tool-long');
    await capturePreview(page, item, 'tool-title-long', info);
    await applyTool(item, name, { code });
    await expectHidden(item);
    expect(await oldText.evaluate((node) => node.isConnected)).toBe(false);
    expect(await oldText.evaluate((node) => node.getAttribute('title'))).toBeNull();
    await applyTool(item, name, { code, summary: long });
    await expectTool(item, long.trim());
    await expectTitle(toolText(item), long.trim(), true);
    const shownText = await toolText(item).elementHandle();
    try {
      await mount(item, 'Tool preview', false);
      expect(await shownText.evaluate((node) => node.isConnected)).toBe(false);
      expect(await shownText.evaluate((node) => node.getAttribute('title'))).toBeNull();
      await applyTool(item, name, { code, summary: 'After unmount' }, 'Enter');
      await mount(item, 'Tool preview', true);
      await expectTool(item, 'After unmount');
      await expectTitle(toolText(item), 'After unmount', false);
      const mountedText = await toolText(item).elementHandle();
      try {
        await button(item, 'Remount Tool preview').press('Space');
        expect(await mountedText.evaluate((node) => node.isConnected)).toBe(false);
        await expectTool(item, 'After unmount');
        await expectTitle(toolText(item), 'After unmount', false);
        await capturePreview(page, item, 'tool-owner-after', info);
      } finally {
        await mountedText.dispose();
      }
    } finally {
      await shownText.dispose();
    }
  } finally {
    await oldText.dispose();
  }
});

test('chat preview T5: local icon branches preserve size visibility and reduced-motion rendering', async ({
  page,
}, info) => {
  const item = exercise(await openPreview(page), 'tool');
  await applyTool(item, 'Read', { file_path: 'current.ts' });
  await expectTool(item, 'Read current.ts');
  await expectArtwork(toolIcon(item), 'file-lines', info);
  await expectIconSize(item, 12, info, 'tool-default');
  await capturePreview(page, item, 'icon-before', info);
  const size = item.section.getByRole('spinbutton', {
    name: 'Tool icon size, blank for default',
    exact: true,
  });
  await size.fill('24');
  await expectIconSize(item, 24, info, 'tool-resized');
  await toggle(item, 'Animate tool icon', true);
  await expectTool(item, 'Read current.ts');
  await expectArtwork(toolIcon(item), 'file-lines', info);
  await expectContained(item, info, 'tool-animated-reduced');
  await capturePreview(page, item, 'icon-animate-reduced', info);
  // This samples animate=true rendering under the fixed reduced-motion profile;
  // it does not establish full-motion timing or unobserved animation progress.
  await toggle(item, 'Show tool icon', false);
  await expect(toolIcon(item)).toHaveCount(0);
  await expectTool(item, 'Read current.ts');
  await capturePreview(page, item, 'icon-hidden', info);
  await toggle(item, 'Show tool icon', true);
  await toggle(item, 'Animate tool icon', false);
  await applyTool(item, 'mcp__context7__frobnicate_widget', {});
  await expectTool(item, 'Frobnicate widget');
  await expectArtwork(toolIcon(item), 'context7', info);
  await expectIconSize(item, 24, info, 'tool-context7');
  await capturePreview(page, item, 'icon-context7', info);
  await applyTool(item, 'mcp__slack__frobnicate_widget', {});
  await expectTool(item, 'Frobnicate widget');
  await expectArtwork(toolIcon(item), 'slack', info);
  await expectIconSize(item, 24, info, 'tool-slack');
  await capturePreview(page, item, 'icon-slack', info);
  await size.fill('');
  await expectIconSize(item, 12, info, 'tool-size-restored');
  await applyTool(item, 'Read', { file_path: 'current.ts' });
  await expectTool(item, 'Read current.ts');
  await expectArtwork(toolIcon(item), 'file-lines', info);
  await expectIconSize(item, 12, info, 'tool-native-restored');
  await expectContained(item, info, 'tool-icon-after');
  await capturePreview(page, item, 'icon-after', info);
});
