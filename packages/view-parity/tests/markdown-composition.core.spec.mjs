import {
  test,
  expect,
  openComposition,
  control,
  copy,
  open,
  switchTo,
  clear,
  activate,
  capture,
  sameNode,
  label,
  specialPath,
  encodedPathUrl,
  changedPath,
  changedPathUrl,
  setCustom,
  minimalCustom,
  changedCustom,
  visibleNodeIds,
  binding,
  fileArgs,
  noteArgs,
} from '../lib/markdown-composition.mjs';

test('markdown composition MC1: media reason and default name follow current props', async ({
  page,
}, info) => {
  const { media } = await openComposition(page);
  const tile = await media.tile.elementHandle();
  await capture(page, media.frame, 'MC1-before', info);
  await control(media, 'name').fill('Current local image');
  const reasons = [
    ['missing', 'ui_mediaUnavailable_missing_description'],
    ['unsupported', 'ui_mediaUnavailable_unsupported_description'],
    ['load-failed', 'ui_mediaUnavailable_loadFailed_description'],
  ];
  for (const [reason, key] of reasons) {
    await control(media, `reason-${reason}`).click();
    await expect(media.tile).toHaveAttribute('role', 'status');
    await expect(media.tile).toHaveAttribute('data-reason', reason);
    await expect(media.tile).toContainText(label(key));
    for (const [other, otherKey] of reasons)
      if (other !== reason) await expect(media.tile).not.toContainText(label(otherKey));
    await expect(media.tile).toContainText('Current local image');
    await sameNode(media.tile, tile);
  }
  await control(media, 'name').fill('');
  await expect(media.tile).toContainText(label('ui_mediaUnavailable_title_label'));
  await control(media, 'name').fill('Ignored while omitted');
  await switchTo(media, 'omit-name', true);
  await expect(media.tile).toContainText(label('ui_mediaUnavailable_title_label'));
  await expect(media.tile).not.toContainText('Ignored while omitted');
  await switchTo(media, 'omit-name', false);
  await expect(media.tile).toContainText('Ignored while omitted');
  await sameNode(media.tile, tile);
  await capture(page, media.frame, 'MC1-after', info);
  await tile.dispose();
});

test('markdown composition MC2: path and workspace control actual media actions', async ({
  page,
}, info) => {
  const { media } = await openComposition(page);
  await capture(page, media.frame, 'MC2-before', info);
  await control(media, 'path').fill('docs/conditional.md');
  await control(media, 'workspace').fill('workspace-conditional');
  await expect(copy(media)).toBeEnabled();
  await expect(open(media)).toBeEnabled();
  await copy(media).focus();
  await copy(media).press('Tab');
  await expect(open(media)).toBeFocused();
  await switchTo(media, 'omit-path', true);
  await expect(copy(media)).toHaveCount(0);
  await expect(open(media)).toHaveCount(0);
  await switchTo(media, 'omit-path', false);
  await control(media, 'path').fill('');
  await expect(copy(media)).toHaveCount(0);
  await expect(open(media)).toHaveCount(0);
  await control(media, 'path').fill('docs/conditional.md');
  await switchTo(media, 'omit-workspace', true);
  await expect(copy(media)).toBeEnabled();
  await expect(open(media)).toHaveCount(0);
  await switchTo(media, 'omit-workspace', false);
  await control(media, 'workspace').fill('');
  await expect(copy(media)).toBeEnabled();
  await expect(open(media)).toHaveCount(0);
  await control(media, 'workspace').fill('workspace-conditional');
  const record = await activate(media, open(media), { name: 'onOpenLink', via: 'Enter' });
  expect(record.argumentCount).toBe(2);
  expect(record.arguments).toEqual([
    'intent://local/file/docs/conditional.md',
    { workspaceId: 'workspace-conditional' },
  ]);
  await capture(page, media.frame, 'MC2-after', info);
});

test('markdown composition MC3: real Copy path pastes current text through the native clipboard', async ({
  page,
  context,
}, info) => {
  const { media } = await openComposition(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  const paste = control(media, 'paste');
  await capture(page, media.frame, 'MC3-before', info);
  await clear(media);
  for (const [index, value] of [specialPath, changedPath].entries()) {
    await paste.fill(`Native clipboard seed ${index}`);
    await paste.press('ControlOrMeta+A');
    await paste.press('ControlOrMeta+C');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(`Native clipboard seed ${index}`);
    await paste.fill('');
    await control(media, 'path').fill(value);
    if (index === 0) await copy(media).click();
    else await copy(media).press('Enter');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(value);
    await paste.press('ControlOrMeta+V');
    await expect(paste).toHaveValue(value);
    const record = (await media.observations()).callbacks.at(-1);
    expect(record.name).toBe('onPaste');
    expect(record.argumentCount).toBe(2);
    expect(record.arguments[0]).toBe(value);
    expect(record.arguments[1]).toMatchObject({ type: 'paste', isTrusted: true });
    expect((await media.observations()).counts.onPaste).toBe(index + 1);
  }
  expect((await media.observations()).counts.onOpenLink).toBeUndefined();
  await capture(page, media.frame, 'MC3-after', info);
});

test('markdown composition MC4: encoded media URL and replacement callback use current workspace', async ({
  page,
}, info) => {
  const { media } = await openComposition(page);
  await control(media, 'path').fill(specialPath);
  await control(media, 'workspace').fill('workspace-a');
  const tile = await media.tile.elementHandle();
  await capture(page, media.frame, 'MC4-before', info);
  const initial = await activate(media, open(media), { name: 'onOpenLink' });
  expect(initial.argumentCount).toBe(2);
  expect(initial.arguments).toEqual([encodedPathUrl, { workspaceId: 'workspace-a' }]);
  await control(media, 'path').fill(changedPath);
  await control(media, 'workspace').fill('workspace-b');
  await control(media, 'replace-onOpenLink').click();
  await sameNode(media.tile, tile);
  const updated = await activate(media, open(media), {
    name: 'onOpenLink',
    revision: 1,
    via: 'Space',
  });
  expect(updated.argumentCount).toBe(2);
  expect(updated.arguments).toEqual([changedPathUrl, { workspaceId: 'workspace-b' }]);
  expect((await media.observations()).callbacks.map((entry) => entry.callbackRevision)).toEqual([
    0, 1,
  ]);
  await capture(page, media.frame, 'MC4-after', info);
  await tile.dispose();
});

test('markdown composition MC6: canonical defaults normalize complete custom JSON and replace current content', async ({
  page,
}, info) => {
  const { diagram } = await openComposition(page);
  await capture(page, diagram.frame, 'MC6-before', info);
  let renderer = await setCustom(diagram, minimalCustom);
  await expect.poll(() => visibleNodeIds(renderer)).toEqual(['file', 'note']);
  await expect(binding(diagram, 'Read local document', 'file')).toBeEnabled();
  await expect(binding(diagram, 'Read task note', 'note')).toBeEnabled();
  await expect(diagram.frame.getByRole('alert')).toHaveCount(0);
  await expect(diagram.presentation).toHaveAttribute('data-diagram-kind', 'custom');
  await capture(page, diagram.frame, 'MC6-normalized', info);
  const oldNode = await binding(diagram, 'Read local document', 'file').elementHandle();
  renderer = await setCustom(diagram, changedCustom);
  await expect.poll(() => visibleNodeIds(renderer)).toEqual(['current']);
  await expect(binding(diagram, 'Read local document', 'file')).toHaveCount(0);
  await expect(binding(diagram, 'Current content', 'file')).toBeEnabled();
  await expect.poll(() => oldNode.evaluate((node) => node.isConnected)).toBe(false);
  const request = await activate(diagram, binding(diagram, 'Current content', 'file'), {
    name: 'onOpenFile',
    via: 'Enter',
  });
  fileArgs(request, 'system-design', 'docs/current.md', false, 'markdown-inner');
  await capture(page, diagram.frame, 'MC6-after', info);
  await oldNode.dispose();
});

test('markdown composition MC7: actual binding events preserve modifiers nearest panel and current host callbacks', async ({
  page,
}, info) => {
  const { diagram } = await openComposition(page);
  await setCustom(diagram);
  await control(diagram, 'workspace').fill('workspace-a');
  await clear(diagram);
  await capture(page, diagram.frame, 'MC7-before', info);
  const file = binding(diagram, 'Read local document', 'file');
  const note = binding(diagram, 'Read task note', 'note');
  fileArgs(
    await activate(diagram, file, { name: 'onOpenFile', modifiers: ['Control'] }),
    'workspace-a',
    'docs/Release #1.md',
    true,
    'markdown-inner',
  );
  noteArgs(
    await activate(diagram, note, { name: 'onOpenLink', modifiers: ['Meta'] }),
    'intent://local/workspace-a/note/review-note',
    'workspace-a',
    true,
    'markdown-inner',
  );
  await control(diagram, 'workspace').fill('workspace-current');
  await control(diagram, 'inner-panel').fill('nearest-current-panel');
  await control(diagram, 'replace-onOpenFile').click();
  await control(diagram, 'replace-onOpenLink').click();
  fileArgs(
    await activate(diagram, file, { name: 'onOpenFile', revision: 1, via: 'Enter' }),
    'workspace-current',
    'docs/Release #1.md',
    false,
    'nearest-current-panel',
  );
  await expect(file).toBeFocused();
  noteArgs(
    await activate(diagram, note, { name: 'onOpenLink', revision: 1, via: 'Space' }),
    'intent://local/workspace-current/note/review-note',
    'workspace-current',
    false,
    'nearest-current-panel',
  );
  await expect(note).toBeFocused();
  await switchTo(diagram, 'omit-inner-panel', true);
  noteArgs(
    await activate(diagram, note, { name: 'onOpenLink', revision: 1 }),
    'intent://local/workspace-current/note/review-note',
    'workspace-current',
    false,
    'markdown-outer',
  );
  await switchTo(diagram, 'omit-outer-panel', true);
  fileArgs(
    await activate(diagram, file, { name: 'onOpenFile', revision: 1 }),
    'workspace-current',
    'docs/Release #1.md',
    false,
    null,
  );
  noteArgs(
    await activate(diagram, note, { name: 'onOpenLink', revision: 1 }),
    'intent://local/workspace-current/note/review-note',
    'workspace-current',
    false,
    null,
  );
  expect(
    (await diagram.observations()).callbacks.map(({ name, callbackRevision }) => [
      name,
      callbackRevision,
    ]),
  ).toEqual([
    ['onOpenFile', 0],
    ['onOpenLink', 0],
    ['onOpenFile', 1],
    ['onOpenLink', 1],
    ['onOpenLink', 1],
    ['onOpenFile', 1],
    ['onOpenLink', 1],
  ]);
  await capture(page, diagram.frame, 'MC7-after', info);
});
