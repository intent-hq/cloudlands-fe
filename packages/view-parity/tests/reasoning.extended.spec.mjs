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
  remount,
  expanded,
  sameNode,
  detached,
  historyProjection,
  contained,
  activate,
  linkArguments,
  mentionArguments,
  linkContent,
  updatedLinkContent,
  fileMention,
  noteMention,
  search,
  saved,
} from '../lib/reasoning.mjs';

test('reasoning R7 History uses original parser order fallback bodies and reachable seams', async ({
  page,
}, info) => {
  const { history } = await openReasoning(page);
  await capture(page, history.frame, 'R7-before', info);
  const content =
    '**First plan**\n\n**Second plan**\n\nThe final body stays readable.\n\nThe second paragraph follows.';
  const items = await historyProjection(history, content, info);
  expect(items.map((item) => Boolean(item.body))).toEqual([false, true]);
  await expect(history.body).toContainText('The final body stays readable.');
  await expect(history.body).toContainText('The second paragraph follows.');
  const order = await history.frame.locator('[data-reasoning-section]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }),
  );
  expect(
    order[1].top,
    'Each reachable history title and body remains unobscured',
  ).toBeGreaterThanOrEqual(order[0].bottom - 1);
  await capture(page, history.frame, 'R7-parsed', info);
  await historyProjection(history, 'A complete sentence stays in the body.', info);
  await expect(history.rows).toHaveCount(0);
  await expect(history.body).toHaveText('A complete sentence stays in the body.');
  await historyProjection(history, 'Short history title', info);
  await expect(history.body).toHaveCount(0);
  await historyProjection(history, ' \n\t', info);
  await expect(history.frame.locator('[data-reasoning-section]')).toHaveCount(0);
  await historyProjection(
    history,
    '**Checking `src/*.ts` &amp; _private**\n\nCurrent history body.',
    info,
  );
  await expect(history.body).toHaveText('Current history body.');
  await capture(page, history.frame, 'R7-after', info);
});

test('reasoning R8 History item override owns rendered content and respects keyed lifetimes', async ({
  page,
}, info) => {
  const { history } = await openReasoning(page);
  const root = await history.frame.locator('[data-reasoning-history]').elementHandle();
  await capture(page, history.frame, 'R8-before', info);
  await switchTo(history, 'Supply history item', true);
  await expect(history.summaries).toHaveText('Override title');
  await expect(history.body).toHaveText('The actual override body.');
  await expect(history.frame.locator('[data-reasoning-section]')).toHaveCount(1);
  const section = await history.frame.locator('[data-reasoning-section]').elementHandle();
  await raw(history, '**Ignored raw title**\n\nIgnored raw body.');
  await expect(history.summaries).toHaveText('Override title');
  await expect(history.frame).not.toContainText('Ignored raw body.');
  await field(history, 'History item body').fill('The changed override body remains current.');
  await expect(history.body).toHaveText('The changed override body remains current.');
  await sameNode(history.frame.locator('[data-reasoning-section]'), section);
  await field(history, 'History item title').fill('Current override title');
  await expect(history.summaries).toHaveText('Current override title');
  await detached(section);
  await switchTo(history, 'History item title is null', true);
  await expect(history.rows).toHaveCount(0);
  await expect(history.frame.locator('[data-reasoning-section]')).not.toHaveAttribute(
    'aria-labelledby',
  );
  await expect(history.body).toHaveText('The changed override body remains current.');
  await field(history, 'History item body').fill('');
  await expect(history.body).toHaveCount(0);
  await expect(history.frame.locator('[data-reasoning-section]')).toHaveCount(1);
  await switchTo(history, 'History item title is null', false);
  await field(history, 'History item title').fill('');
  await expect(history.rows).toHaveCount(0);
  await switchTo(history, 'Supply history item', false);
  await expect(history.summaries).toHaveText('Ignored raw title');
  await expect(history.body).toHaveText('Ignored raw body.');
  await sameNode(history.frame.locator('[data-reasoning-history]'), root);
  const priorId = await history.frame.locator('[data-reasoning-section-title]').getAttribute('id');
  await remount(history);
  await detached(root);
  await expect(history.body).toHaveText('Ignored raw body.');
  const nextId = await history.frame.locator('[data-reasoning-section-title]').getAttribute('id');
  expect(nextId).not.toBe(priorId);
  await capture(page, history.frame, 'R8-after', info);
  await root.dispose();
  await section.dispose();
});

test('reasoning R9 History forwards current host callbacks through context and streaming replacement', async ({
  page,
}, info) => {
  const { history } = await openReasoning(page);
  await raw(history, linkContent);
  await switchTo(history, 'History supply workspaceId', false);
  await choice(history, 'History workspace context', 'workspace');
  await field(history, 'History context workspaceId').fill('history-context-one');
  await capture(page, history.frame, 'R9-before', info);
  linkArguments(
    await activate(
      history,
      history.frame.getByRole('link', { name: 'Web request', exact: true }),
      'onOpenLink',
      { via: 'Enter' },
    ),
    'https://example.com/reasoning',
    'history-context-one',
    'reasoning-history-panel',
  );
  mentionArguments(
    await activate(history, fileMention(history), 'onOpenFile'),
    'history-context-one',
    'src/a.ts',
    'reasoning-history-panel',
    { file: true, line: 10 },
  );
  mentionArguments(
    await activate(history, noteMention(history), 'onOpenNote', { modifiers: ['Control'] }),
    'history-context-one',
    'spec',
    'reasoning-history-panel',
    { adjacent: true },
  );
  const root = await history.frame.locator('[data-reasoning-history]').elementHandle();
  await choice(history, 'History isStreaming', 'true');
  await raw(history, updatedLinkContent);
  await choice(history, 'History isStreaming', 'false');
  await field(history, 'History context workspaceId').fill('history-context-current');
  await field(history, 'History source panelId').fill('history-panel-current');
  await button(history, 'Replace History callbacks').click();
  linkArguments(
    await activate(
      history,
      history.frame.getByRole('link', { name: 'Current request', exact: true }),
      'onOpenLink',
      { revision: 1 },
    ),
    'https://example.com/current-reasoning',
    'history-context-current',
    'history-panel-current',
  );
  mentionArguments(
    await activate(history, fileMention(history), 'onOpenFile', { revision: 1 }),
    'history-context-current',
    'docs/current.ts',
    'history-panel-current',
    { file: true, line: 23 },
  );
  mentionArguments(
    await activate(history, noteMention(history), 'onOpenNote', { revision: 1 }),
    'history-context-current',
    'current-note',
    'history-panel-current',
  );
  await switchTo(history, 'History supply workspaceId', true);
  await field(history, 'History workspaceId').fill('explicit-history-workspace');
  mentionArguments(
    await activate(history, noteMention(history), 'onOpenNote', { revision: 1 }),
    'explicit-history-workspace',
    'current-note',
    'history-panel-current',
  );
  await sameNode(history.frame.locator('[data-reasoning-history]'), root);
  await capture(page, history.frame, 'R9-after', info);
  await root.dispose();
});

test('reasoning R10 long titles remain operable at 420 and adjacent rows cleanly unmount', async ({
  page,
}, info) => {
  const { thinking, history } = await openReasoning(page);
  await choice(thinking, 'Thinking frame width', '420');
  await choice(history, 'History frame width', '420');
  const longTitle =
    'Review the complete reasoning history and preserve every current caller boundary without hiding its controls '
      .repeat(3)
      .trim();
  await raw(
    thinking,
    `# ${longTitle}\n\nThe full body is available through the same keyboard control.`,
  );
  await expect(thinking.trigger).toHaveAccessibleName(longTitle);
  await contained(thinking, info, 'R10-collapsed');
  await capture(page, thinking.frame, 'R10-before', info);
  await thinking.trigger.press('Enter');
  await expanded(thinking, true);
  await expect(thinking.trigger).toBeFocused();
  await contained(thinking, info, 'R10-expanded');
  await choice(thinking, 'Thinking adjacentOperationalRow', 'true');
  await capture(page, thinking.frame, 'R10-thinking-adjacent', info);
  await thinking.trigger.press('Space');
  await expanded(thinking, false);
  await raw(history, `# ${longTitle}\n\nThe history body stays within its narrow frame.`);
  await choice(history, 'History adjacentOperationalRow', 'true');
  await expect(history.summaries).toHaveAccessibleName(longTitle);
  await contained(history, info, 'R10-history', false);
  await capture(page, history.frame, 'R10-history-adjacent', info);
  const disclosureId = await thinking.trigger.getAttribute('aria-controls');
  const historyId = await history.frame
    .locator('[data-reasoning-section-title]')
    .getAttribute('id');
  expect(historyId).not.toBe(disclosureId);
  const row = await thinking.rows.elementHandle();
  const historyRoot = await history.frame.locator('[data-reasoning-history]').elementHandle();
  await switchTo(thinking, 'Mount Thinking', false);
  await switchTo(history, 'Mount History', false);
  await detached(row);
  await detached(historyRoot);
  await expect(thinking.rows).toHaveCount(0);
  await expect(history.frame.locator('[data-reasoning-history]')).toHaveCount(0);
  const oldSaved = await saved(thinking);
  expect((await search(thinking, 'expand')).at(-1).targetId).toBeNull();
  expect(await saved(thinking)).toEqual(oldSaved);
  await switchTo(thinking, 'Mount Thinking', true);
  await switchTo(history, 'Mount History', true);
  await expanded(thinking, false);
  expect(await thinking.trigger.getAttribute('aria-controls')).not.toBe(disclosureId);
  expect(await history.frame.locator('[data-reasoning-section-title]').getAttribute('id')).not.toBe(
    historyId,
  );
  await capture(page, thinking.frame, 'R10-after', info);
  await row.dispose();
  await historyRoot.dispose();
});
