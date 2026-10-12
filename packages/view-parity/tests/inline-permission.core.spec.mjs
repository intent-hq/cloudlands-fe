import {
  test,
  expect,
  openPermission,
  apply,
  field,
  disclosure,
  label,
  expectQuestion,
  expectDetails,
  expectArtwork,
  capturePermission,
  sameNode,
  setSwitch,
  withNativeKeys,
} from '../lib/inline-permission.mjs';

test('inline permission IP1: original parser display artwork and raw disclosure', async ({
  page,
}, info) => {
  const item = await openPermission(page);
  const examples = [
    {
      title: 'mcp__set_agent_name_workspace-mcp',
      data: { name: 'Atlas' },
      key: 'renameAgentTo',
      args: { name: 'Atlas' },
      details: null,
      category: 'write',
    },
    {
      title: 'str_replace',
      data: { path: '/project/src/edit.ts' },
      key: 'editFileNamed',
      args: { name: 'edit.ts' },
      details: '/project/src/edit.ts',
    },
    {
      title: 'intent://local/mcp/mcp__save_file_workspace-mcp',
      data: { path: '/project/new.ts' },
      key: 'saveFileNamed',
      args: { name: 'new.ts' },
      details: '/project/new.ts',
    },
    {
      title: 'launch_process',
      data: { command: 'echo permission-display' },
      key: 'runCommand',
      details: 'echo permission-display',
      category: 'execute',
    },
    {
      title: 'remove_file',
      data: { file_paths: ['/project/old.ts'] },
      key: 'deleteNamed',
      args: { name: 'old.ts' },
      details: '/project/old.ts',
      category: 'delete',
    },
    {
      title: 'read_file',
      data: { path: '/project/current.ts' },
      key: 'readFileNamed',
      args: { name: 'current.ts' },
      details: '/project/current.ts',
      category: 'read',
    },
    {
      title: 'create_note',
      data: { title: 'Agenda' },
      key: 'createNoteNamed',
      args: { title: 'Agenda' },
      details: null,
    },
    {
      title: 'update_note',
      data: { title: 'Agenda' },
      question: 'Update note "Agenda"?',
      details: null,
    },
    {
      title: 'navigate_browser_Playwright',
      data: { url: 'https://example.test/path?q=1' },
      key: 'navigate',
      details: 'https://example.test/path?q=1',
      category: 'other',
    },
    {
      title: 'github_api',
      data: { path: '/repos/example/pulls' },
      key: 'apiRequest',
      details: '/repos/example/pulls',
    },
    {
      title: 'mcp__scanThing_Context_7',
      data: { query: 'current query' },
      question: 'Scan thing?',
      details: 'current query',
    },
    { title: 'read_file', raw: '{broken JSON', key: 'readFile', details: null },
  ];
  await info.attach('original-parser-examples.json', {
    body: JSON.stringify(examples, null, 2),
    contentType: 'application/json',
  });
  for (const sample of examples) {
    const description = sample.raw ?? JSON.stringify(sample.data);
    await apply(item, { title: sample.title, description });
    await expectQuestion(
      item,
      sample.question ?? label(`chat_permissionParser_${sample.key}_question`, sample.args),
    );
    await expectDetails(item, sample.details);
    if (sample.category) {
      await expectArtwork(
        item.card.locator(':scope > div').first().locator('svg'),
        'faShieldHalved',
        info,
      );
      await capturePermission(page, item, `parser-${sample.category}`, info);
    }
  }
  await expectArtwork(disclosure(item).locator('svg'), 'faChevronLeft', info);
  await disclosure(item).click();
  await expectArtwork(disclosure(item, true).locator('svg'), 'faChevronDown', info);
  await expect(item.card.getByText('{broken JSON', { exact: true })).toBeVisible();
  await capturePermission(page, item, 'raw-open', info);
  await disclosure(item, true).press('Space');
  await expect(item.card.getByText('{broken JSON', { exact: true })).toHaveCount(0);
  await expect(disclosure(item)).toBeFocused();
  await capturePermission(page, item, 'raw-closed', info);
});

test('inline permission IP2: always filtering first nine hints and current option ordering', async ({
  page,
}, info) => {
  const item = await openPermission(page);
  const visible = Array.from({ length: 10 }, (_, index) => ({
    id: `option-${index + 1}`,
    label: `Choice ${index + 1}`,
    description: index === 0 ? 'Original detail' : '',
    destructive: index === 9,
  }));
  const hidden = [
    { id: 'allow_ALWAYS', label: 'Hidden uppercase' },
    { id: 'prefix-always-suffix', label: 'Hidden embedded' },
  ];
  await apply(item, {
    options: [hidden[0], ...visible.slice(0, 4), hidden[1], ...visible.slice(4)],
  });
  const choices = item.card.getByRole('button').filter({ hasText: /^\d*\s*Choice / });
  await expect(choices).toHaveCount(10);
  for (const option of hidden)
    await expect(item.card.getByRole('button', { name: new RegExp(option.label) })).toHaveCount(0);
  for (let index = 0; index < visible.length; index += 1) {
    await expect(choices.nth(index)).toContainText(visible[index].label);
    if (index < 9) await expect(choices.nth(index).locator('kbd')).toHaveText(String(index + 1));
    else await expect(choices.nth(index).locator('kbd')).toHaveCount(0);
  }
  const first = await choices.first().elementHandle();
  await capturePermission(page, item, 'options-before-reorder', info);
  await apply(item, {
    options: [...visible]
      .reverse()
      .map((option) =>
        option.id === 'option-1' ? { ...option, description: 'Current detail' } : option,
      ),
  });
  await sameNode(choices.last(), first);
  await expect(choices.first()).toContainText('Choice 10');
  await expect(choices.first().locator('kbd')).toHaveText('1');
  await expect(choices.last()).toContainText('Choice 1');
  await expect(choices.last()).toContainText('Current detail');
  await expect(choices.last().locator('kbd')).toHaveCount(0);
  await first.dispose();
  await capturePermission(page, item, 'options-after-reorder', info);
});

test('inline permission IP3: omitted defaults current props and disclosure instance lifetime', async ({
  page,
}, info) => {
  const item = await openPermission(page);
  await expect(field(item, 'supply-pendingCount')).toHaveAttribute('aria-checked', 'false');
  await expect(field(item, 'supply-keyboardShortcutsEnabled')).toHaveAttribute(
    'aria-checked',
    'false',
  );
  const originalCard = await item.card.elementHandle();
  const pendingBadge = item.card.locator(':scope > div').first().locator(':scope > span');
  await disclosure(item).click();
  await apply(item, {
    pendingCount: 7,
    requestId: 'current-request-b',
    agentName: 'Current agent',
    description: '{"path":"/current/request.ts"}',
  });
  await sameNode(item.card, originalCard);
  await expect(disclosure(item, true)).toBeVisible();
  await expect(
    item.card.getByText(label('chat_inlinePermission_from_label', { name: 'Current agent' }), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    item.card.getByText(label('chat_inlinePermission_pending_label', { count: '7' }), {
      exact: true,
    }),
  ).toHaveCount(0);
  await setSwitch(item, 'supply-pendingCount', true);
  await expect(
    item.card.getByText(label('chat_inlinePermission_pending_label', { count: '7' }), {
      exact: true,
    }),
  ).toBeVisible();
  for (const [count, formatted] of [
    [0, '0'],
    [1, '1'],
    [2, '2'],
    [1000, '1,000'],
  ]) {
    await apply(item, { pendingCount: count });
    const badge = item.card.getByText(
      label('chat_inlinePermission_pending_label', { count: formatted }),
      { exact: true },
    );
    if (count > 1) await expect(badge).toBeVisible();
    else await expect(pendingBadge).toHaveCount(0);
  }
  await apply(item, { agentName: '' });
  await expect(
    item.card.getByText(label('chat_inlinePermission_from_label', { name: 'Current agent' }), {
      exact: true,
    }),
  ).toHaveCount(0);
  await setSwitch(item, 'shortcuts', true);
  await withNativeKeys(page, info, async (keys) => {
    const anchor = field(item, 'focus-anchor');
    await keys.press(anchor, '1', '1', false);
    await setSwitch(item, 'supply-keyboardShortcutsEnabled', true);
    await keys.press(anchor, '1', '1', true);
    await setSwitch(item, 'supply-keyboardShortcutsEnabled', false);
    await keys.press(anchor, '1', '1', false);
  });
  await setSwitch(item, 'supply-pendingCount', false);
  await expect(
    item.card.getByText(label('chat_inlinePermission_pending_label', { count: '1,000' }), {
      exact: true,
    }),
  ).toHaveCount(0);
  await sameNode(item.card, originalCard);
  await originalCard.dispose();
  await capturePermission(page, item, 'optional-props-current', info);
});

test('inline permission IP4: real option buttons remain safe without actual workspace admission', async ({
  page,
}, info) => {
  const item = await openPermission(page);
  const originalUrl = page.url();
  for (const workspaceId of ['', 'catalog-unadmitted-workspace']) {
    await apply(item, { workspaceId });
    const before = await item.state();
    for (const name of [/Allow once/, /Deny/]) {
      const button = item.card.getByRole('button', { name });
      await expect(button).toBeEnabled();
      await button.click();
      await button.press('Enter');
      await button.press('Space');
      await expect(button).toBeEnabled();
      expect(await item.state()).toEqual(before);
      await expectQuestion(
        item,
        label('chat_permissionParser_readFileNamed_question', { name: 'example.ts' }),
      );
    }
    expect(page.url()).toBe(originalUrl);
    expect(page.context().pages()).toHaveLength(1);
    await capturePermission(
      page,
      item,
      workspaceId ? 'unadmitted-workspace-buttons' : 'missing-workspace-buttons',
      info,
    );
  }
  // The unchanged network fixture establishes zero requests to the daemon. This
  // case observes no permission success, dispatch payload or provider response.
});
