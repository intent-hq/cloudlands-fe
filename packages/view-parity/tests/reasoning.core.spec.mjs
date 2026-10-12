import {
  test,
  expect,
  openReasoning,
  capture,
  raw,
  button,
  field,
  choice,
  switchTo,
  saved,
  replaceSaved,
  remount,
  expanded,
  manual,
  search,
  sameNode,
  detached,
  originalProjection,
  label,
  clear,
  refresh,
  activate,
  linkArguments,
  mentionArguments,
  linkContent,
  updatedLinkContent,
  fileMention,
  noteMention,
} from '../lib/reasoning.mjs';

test('reasoning R1 pointer Enter and Space toggle once with native prevention and saved writes', async ({
  page,
}, info) => {
  const { thinking } = await openReasoning(page);
  await raw(thinking, '# Manual disclosure\n\nThe body becomes available after expansion.');
  await expanded(thinking, false);
  const row = await thinking.rows.elementHandle();
  const trigger = await thinking.trigger.elementHandle();
  const controls = await thinking.trigger.getAttribute('aria-controls');
  await capture(page, thinking.frame, 'R1-before', info);
  for (const [via, value] of [
    ['click', true],
    ['Enter', false],
    ['Space', true],
  ]) {
    await manual(thinking, via, value);
    expect((await saved(thinking)).snapshots).toEqual([
      { id: 1, value: { expanded: value, userToggled: true, searchOwnsExpansion: false } },
    ]);
    await sameNode(thinking.rows, row);
    await sameNode(thinking.trigger, trigger);
    await expect(thinking.trigger).toHaveAttribute('aria-controls', controls);
  }
  await clear(thinking);
  await thinking.trigger.press('ArrowRight');
  await expanded(thinking, true);
  const ignored = await refresh(thinking);
  expect(
    ignored.native.find((event) => event.phase === 'bubble' && event.type === 'keydown'),
  ).toMatchObject({ key: 'ArrowRight', isTrusted: true, defaultPrevented: false });
  await capture(page, thinking.frame, 'R1-after', info);
  await row.dispose();
  await trigger.dispose();
});

test('reasoning R2 saved seeds only on mount and replacement receives future writes', async ({
  page,
}, info) => {
  const { thinking } = await openReasoning(page);
  await expanded(thinking, false);
  const first = await thinking.rows.elementHandle();
  await capture(page, thinking.frame, 'R2-before', info);
  const seeded = { expanded: true, userToggled: true, searchOwnsExpansion: true };
  expect((await replaceSaved(thinking, seeded)).snapshots).toEqual([
    { id: 1, value: {} },
    { id: 2, value: seeded },
  ]);
  await expanded(thinking, false);
  await sameNode(thinking.rows, first);
  await remount(thinking);
  await detached(first);
  await expanded(thinking, true);
  const second = await thinking.rows.elementHandle();
  const replacement = { expanded: false, userToggled: false, searchOwnsExpansion: false };
  await replaceSaved(thinking, replacement);
  await expanded(thinking, true);
  await sameNode(thinking.rows, second);
  // Editing the next object's initial flags does not alter the actual current object.
  await choice(thinking, 'Initial saved expanded', 'true');
  expect((await saved(thinking)).snapshots.at(-1)).toEqual({ id: 3, value: replacement });
  await manual(thinking, 'Enter', false);
  expect((await saved(thinking)).snapshots).toEqual([
    { id: 1, value: {} },
    { id: 2, value: seeded },
    { id: 3, value: { expanded: false, userToggled: true, searchOwnsExpansion: false } },
  ]);
  await switchTo(thinking, 'Supply saved object', false);
  await manual(thinking, 'Space', true);
  const omitted = await saved(thinking);
  expect(omitted.supplied).toBe(false);
  expect(omitted.snapshots.at(-1).value.expanded).toBe(false);
  await switchTo(thinking, 'Supply saved object', true);
  await manual(thinking, 'Enter', false);
  await manual(thinking, 'click', true);
  expect((await saved(thinking)).snapshots.at(-1).value).toEqual({
    expanded: true,
    userToggled: true,
    searchOwnsExpansion: false,
  });
  await remount(thinking);
  await detached(second);
  await expanded(thinking, true);
  await capture(page, thinking.frame, 'R2-after', info);
  await first.dispose();
  await second.dispose();
});

test('reasoning R3 streaming follows automatic policy until a manual toggle owns expansion', async ({
  page,
}, info) => {
  const { thinking } = await openReasoning(page);
  await raw(thinking, 'Streaming content is still arriving.');
  await expanded(thinking, false);
  await expect(thinking.trigger).toHaveAccessibleName(label('chat_thinkingBlock_reasoning_label'));
  const row = await thinking.rows.elementHandle();
  await capture(page, thinking.frame, 'R3-before', info);
  await choice(thinking, 'Thinking isStreaming', 'true');
  await expanded(thinking, true);
  await expect(thinking.trigger).toHaveAccessibleName(label('chat_thinkingBlock_thinking_label'));
  await raw(thinking, 'Latest streamed text is now available.');
  await expect(thinking.body).toContainText('Latest streamed text is now available.');
  expect((await saved(thinking)).snapshots).toEqual([{ id: 1, value: {} }]);
  await choice(thinking, 'Thinking isStreaming', 'false');
  await expanded(thinking, false);
  expect((await saved(thinking)).snapshots).toEqual([{ id: 1, value: {} }]);
  await choice(thinking, 'Thinking autoExpandWhileStreaming', 'false');
  await choice(thinking, 'Thinking isStreaming', 'true');
  await expanded(thinking, false);
  await choice(thinking, 'Thinking autoExpandWhileStreaming', 'true');
  await expanded(thinking, true);
  await manual(thinking, 'Enter', false);
  await choice(thinking, 'Thinking isStreaming', 'false');
  await choice(thinking, 'Thinking isStreaming', 'true');
  await expanded(thinking, false);
  await manual(thinking, 'Space', true);
  await choice(thinking, 'Thinking isStreaming', 'false');
  await expanded(thinking, true);
  await sameNode(thinking.rows, row);
  await expect(thinking.body).toContainText('Latest streamed text is now available.');
  await capture(page, thinking.frame, 'R3-after', info);
  await row.dispose();
});

test('reasoning R4 canonical search controls retain ownership restore and current path semantics', async ({
  page,
}, info) => {
  const { thinking } = await openReasoning(page);
  const row = await thinking.rows.elementHandle();
  await capture(page, thinking.frame, 'R4-before', info);
  expect((await search(thinking, 'expand')).at(-1)).toEqual({
    request: 'expand',
    targetId: 'thinking:b:1:c:0',
  });
  await expanded(thinking, true);
  expect((await saved(thinking)).snapshots.at(-1).value).toEqual({
    expanded: true,
    searchOwnsExpansion: true,
  });
  await choice(thinking, 'Thinking isStreaming', 'true');
  await choice(thinking, 'Thinking isStreaming', 'false');
  await expanded(thinking, true);
  await search(thinking, 'restore');
  await expanded(thinking, false);
  expect((await saved(thinking)).snapshots.at(-1).value).toEqual({
    expanded: false,
    searchOwnsExpansion: false,
  });
  // A single native caller action invokes the canonical utility twice in one task.
  await search(thinking, 'both');
  await expanded(thinking, false);
  expect((await saved(thinking)).snapshots.at(-1).value).toEqual({
    expanded: false,
    searchOwnsExpansion: false,
  });
  await choice(thinking, 'Thinking isStreaming', 'true');
  await expanded(thinking, true);
  const automatic = await saved(thinking);
  await search(thinking, 'expand');
  await search(thinking, 'restore');
  await expanded(thinking, true);
  expect(await saved(thinking)).toEqual(automatic);
  await manual(thinking, 'Enter', false);
  await search(thinking, 'expand');
  await expanded(thinking, true);
  await search(thinking, 'restore');
  await expanded(thinking, false);
  await search(thinking, 'expand');
  await manual(thinking, 'Enter', false);
  await search(thinking, 'restore');
  await expanded(thinking, false);
  expect((await saved(thinking)).snapshots.at(-1).value).toEqual({
    expanded: false,
    userToggled: true,
    searchOwnsExpansion: false,
  });
  await field(thinking, 'Thinking searchPath').fill('current:reasoning');
  expect((await search(thinking, 'expand')).at(-1).targetId).toBe('thinking:current:reasoning');
  await expanded(thinking, true);
  await switchTo(thinking, 'Supply searchPath', false);
  expect((await search(thinking, 'restore')).at(-1).targetId).toBeNull();
  await expanded(thinking, true);
  await switchTo(thinking, 'Supply searchPath', true);
  await search(thinking, 'restore');
  await expanded(thinking, false);
  await sameNode(thinking.rows, row);
  await choice(thinking, 'Thinking isStreaming', 'false');
  await capture(page, thinking.frame, 'R4-after', info);
  await row.dispose();
});

test('reasoning R5 original helper governs latest headings standalone rows and empty content', async ({
  page,
}, info) => {
  const { thinking } = await openReasoning(page);
  await manual(thinking, 'click', true);
  const row = await thinking.rows.elementHandle();
  await capture(page, thinking.frame, 'R5-before', info);
  for (const [content, body] of [
    [
      '## Checking `src/*.ts` &amp; _private\n\nATX body remains current.',
      'ATX body remains current.',
    ],
    [
      'Restore task\n---\n\nSetext body replaces the previous paragraph.',
      'Setext body replaces the previous paragraph.',
    ],
    ['Considering restoration\n\nPlain title body follows once.', 'Plain title body follows once.'],
    [
      'An ordinary sentence remains body text.\n\nNo title is promoted.',
      'An ordinary sentence remains body text.',
    ],
  ]) {
    const oracle = await originalProjection(page, content, info);
    await raw(thinking, content);
    expect(oracle.standalone).toBeNull();
    await expect(thinking.trigger).toHaveAccessibleName(
      oracle.heading.heading ?? label('chat_thinkingBlock_reasoning_label'),
    );
    await expect(thinking.body).toContainText(body);
    await sameNode(thinking.rows, row);
  }
  const titles =
    '**Reading `src/*.ts`**\n\n## Compare &lt;Widget&gt; &amp; props\n\nReading again\n===';
  const oracle = await originalProjection(page, titles, info);
  await raw(thinking, titles);
  await expect(thinking.trigger).toHaveCount(0);
  await expect(thinking.body).toHaveCount(0);
  await expect.poll(() => thinking.summaries.allTextContents()).toEqual(oracle.standalone);
  await expect(thinking.frame.getByRole('button')).toHaveCount(0);
  const titleRows = await thinking.rows.elementHandles();
  const updated = '**Reading updated**\n\n## Current second\n\nReading updated\n===';
  const nextOracle = await originalProjection(page, updated, info);
  await raw(thinking, updated);
  await expect.poll(() => thinking.summaries.allTextContents()).toEqual(nextOracle.standalone);
  for (let index = 0; index < titleRows.length; index += 1)
    await sameNode(thinking.rows.nth(index), titleRows[index]);
  await capture(page, thinking.frame, 'R5-standalone', info);
  await raw(thinking, `${updated}\n\nThe final body turns these titles into disclosure content.`);
  await expanded(thinking, true);
  await expect(thinking.body).toContainText(
    'The final body turns these titles into disclosure content.',
  );
  await raw(thinking, '');
  await expanded(thinking, true, { emptyBody: true });
  await expect(thinking.trigger).toHaveAccessibleName(label('chat_thinkingBlock_reasoning_label'));
  await expect(thinking.body).toHaveText('');
  await capture(page, thinking.frame, 'R5-after', info);
  for (const handle of [row, ...titleRows]) await handle.dispose();
});

test('reasoning R6 Thinking forwards current native host callbacks context and file policy', async ({
  page,
}, info) => {
  const { thinking } = await openReasoning(page);
  await raw(thinking, linkContent);
  await manual(thinking, 'click', true);
  const row = await thinking.rows.elementHandle();
  await capture(page, thinking.frame, 'R6-before', info);
  linkArguments(
    await activate(
      thinking,
      thinking.frame.getByRole('link', { name: 'Web request', exact: true }),
      'onOpenLink',
    ),
    'https://example.com/reasoning',
    'reasoning-workspace-a',
    'reasoning-thinking-panel',
  );
  mentionArguments(
    await activate(thinking, fileMention(thinking), 'onOpenFile', { modifiers: ['Control'] }),
    'reasoning-workspace-a',
    'src/a.ts',
    'reasoning-thinking-panel',
    { file: true, adjacent: true, line: 10 },
  );
  mentionArguments(
    await activate(thinking, noteMention(thinking), 'onOpenNote'),
    'reasoning-workspace-a',
    'spec',
    'reasoning-thinking-panel',
  );
  await raw(thinking, updatedLinkContent);
  await field(thinking, 'Thinking workspaceId').fill('reasoning-workspace-current');
  await field(thinking, 'Thinking source panelId').fill('current-thinking-panel');
  await choice(thinking, 'Thinking canOpenFile', 'true');
  await button(thinking, 'Replace Thinking callbacks').click();
  const currentLink = thinking.frame.getByRole('link', { name: 'Current request', exact: true });
  const fn = linkArguments(
    await activate(thinking, currentLink, 'onOpenLink', { via: 'Control+Enter', revision: 1 }),
    'https://example.com/current-reasoning',
    'reasoning-workspace-current',
    'current-thinking-panel',
    { canOpen: true, keyboard: true },
  );
  mentionArguments(
    await activate(thinking, fileMention(thinking), 'onOpenFile', { revision: 1 }),
    'reasoning-workspace-current',
    'docs/current.ts',
    'current-thinking-panel',
    { file: true, line: 23 },
  );
  mentionArguments(
    await activate(thinking, noteMention(thinking), 'onOpenNote', { revision: 1 }),
    'reasoning-workspace-current',
    'current-note',
    'current-thinking-panel',
  );
  await choice(thinking, 'Thinking canOpenFile', 'false');
  await clear(thinking);
  await fileMention(thinking).click();
  const denied = await refresh(thinking);
  expect(denied.callbacks.filter((entry) => entry.name !== 'canOpenFile')).toEqual([]);
  expect(denied.callbacks.filter((entry) => entry.name === 'canOpenFile').at(-1)).toMatchObject({
    argumentCount: 0,
    arguments: [],
    result: false,
  });
  const nextFn = linkArguments(
    await activate(thinking, currentLink, 'onOpenLink', { revision: 1 }),
    'https://example.com/current-reasoning',
    'reasoning-workspace-current',
    'current-thinking-panel',
    { canOpen: true },
  );
  expect(nextFn.objectId).not.toBe(fn.objectId);
  mentionArguments(
    await activate(thinking, noteMention(thinking), 'onOpenNote', { revision: 1 }),
    'reasoning-workspace-current',
    'current-note',
    'current-thinking-panel',
  );
  await sameNode(thinking.rows, row);
  await capture(page, thinking.frame, 'R6-after', info);
  await row.dispose();
});
