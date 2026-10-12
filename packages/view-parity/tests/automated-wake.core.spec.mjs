import {
  test,
  expect,
  openWake,
  toggle,
  field,
  choice,
  apply,
  kind,
  activate,
  expectCounts,
  label,
  captureWake,
  expectArtwork,
} from '../lib/automated-wake.mjs';

test('automated wake W1: hook states and verbatim names preserve original labels and artwork', async ({
  page,
}, info) => {
  const item = await openWake(page);
  await expect(item.header).toHaveAttribute('data-wake-state', 'active');
  await expect(item.status).toHaveText(
    label('chat_hookWakeAttribution_wokeAgentStillActive_after'),
  );
  await expectArtwork(item, 'faBolt', info);
  await expectArtwork(item, 'faChevronDown', info);
  await captureWake(page, item, 'hook-active-before', info);
  const raw = '  Café "build" 雪  ';
  await field(item, 'Hook raw name').fill(raw);
  await apply(item);
  await expect(item.primary).toHaveText('Café "build" 雪');
  await expect(item.primary).toHaveAttribute('title', raw);
  const states = [
    ['dispatched', 'false', 'retired', 'chat_hookWakeAttribution_wokeAgentRetired_after'],
    ['dispatched', 'undefined', 'delivered', 'chat_hookWakeAttribution_wokeAgent_after'],
    ['evicted', 'true', 'retired', 'chat_hookWakeAttribution_wokeAgentRetired_after'],
  ];
  for (const [reason, active, state, key] of states) {
    await field(item, 'Hook reason').fill(reason);
    await choice(item, 'hook-active', active).click();
    await apply(item);
    await expect(item.header).toHaveAttribute('data-wake-state', state);
    await expect(item.status).toHaveText(label(key));
    await expect(item.primary).toHaveAttribute('title', raw);
    await captureWake(page, item, `hook-${reason}-${active}`, info);
  }
  await field(item, 'Hook raw name').fill('');
  await apply(item);
  await expect(item.primary).toHaveText(label('chat_hookWakeAttribution_fallbackName_label'));
  // Empty rawName is distinct from an absent title, even when the fallback overflows.
  await expect(item.primary).toHaveAttribute('title', '');
  await captureWake(page, item, 'hook-empty-name-after', info);
  await expectCounts(item, 0);
});

test('automated wake W2: supported script reasons retain their localized status and source artwork', async ({
  page,
}, info) => {
  const item = await openWake(page);
  await kind(item, 'script');
  await expectArtwork(item, 'faTerminal', info);
  await expect(item.header).toHaveAttribute('data-wake-state', 'delivered');
  await captureWake(page, item, 'script-before', info);
  for (const [reason, key] of [
    ['finished', 'chat_scriptMonitor_finished_description'],
    ['ttl-expired', 'chat_scriptMonitor_expired_description'],
    ['output-match', 'chat_scriptMonitor_matched_description'],
    ['line-count', 'chat_scriptMonitor_counted_description'],
  ]) {
    await choice(item, 'script-reason', reason).click();
    await apply(item);
    await expect(item.status).toHaveText(label(key));
    await captureWake(page, item, `script-${reason}`, info);
  }
  await expectCounts(item, 0);
});

test('automated wake W3: PR labels and exact host link arguments follow owner and workspace context', async ({
  page,
}, info) => {
  const item = await openWake(page);
  await kind(item, 'pr');
  const urlBefore = page.url();
  await expectArtwork(item, 'faCodePullRequest', info);
  await expect(item.status).toHaveText(label('chat_prMonitorWakeAttribution_wokeAgent_after'));
  await captureWake(page, item, 'pr-before', info);
  // Independent input/output examples from original PR helper contracts.
  const cases = [
    {
      repo: 'intent-hq/intent',
      number: '17',
      owner: 'intent-hq',
      workspaceRepo: 'intent',
      mode: 'present',
      label: 'intent #17',
      url: '',
      expectedUrl: 'https://github.com/intent-hq/intent/pull/17',
      via: 'click',
    },
    {
      repo: 'Intent-HQ/Other',
      number: '1000',
      owner: 'INTENT-HQ',
      workspaceRepo: 'intent',
      mode: 'present',
      label: 'Other #1000',
      url: 'https://Example.test/Exact?A=B#Part',
      expectedUrl: 'https://Example.test/Exact?A=B#Part',
      via: 'Enter',
    },
    {
      repo: 'outside/project',
      number: '23',
      owner: 'intent-hq',
      workspaceRepo: 'intent',
      mode: 'present',
      label: 'outside/project #23',
      url: '',
      expectedUrl: 'https://github.com/outside/project/pull/23',
      via: 'Space',
    },
    {
      repo: 'intent-hq/intent',
      number: '17',
      owner: 'intent-hq',
      workspaceRepo: '',
      mode: 'present',
      label: 'intent-hq/intent #17',
      url: '',
      expectedUrl: 'https://github.com/intent-hq/intent/pull/17',
      via: 'click',
    },
    {
      repo: 'intent-hq/intent',
      number: '17',
      owner: 'intent-hq',
      workspaceRepo: 'intent',
      mode: 'null',
      label: 'intent-hq/intent #17',
      url: '',
      expectedUrl: 'https://github.com/intent-hq/intent/pull/17',
      via: 'Enter',
    },
    {
      repo: 'intent-hq/intent',
      number: '17',
      owner: 'intent-hq',
      workspaceRepo: 'intent',
      mode: 'undefined',
      label: 'intent-hq/intent #17',
      url: '',
      expectedUrl: 'https://github.com/intent-hq/intent/pull/17',
      via: 'Space',
    },
  ];
  for (const sample of cases) {
    await field(item, 'PR repository').fill(sample.repo);
    await field(item, 'PR number').fill(sample.number);
    await field(item, 'PR URL (empty uses canonical fallback)').fill(sample.url);
    await field(item, 'Workspace repository owner').fill(sample.owner);
    await field(item, 'Workspace repository name').fill(sample.workspaceRepo);
    await choice(item, 'workspace-mode', sample.mode).click();
    await apply(item);
    await expect(item.chip).toHaveAccessibleName(sample.label);
    await expect(item.chip).toHaveAttribute(
      'title',
      label('chat_prMonitorWakeAttribution_openPrWithLabel_tooltip', { label: sample.label }),
    );
    await activate(item, item.chip, {
      name: 'onOpenLink',
      via: sample.via,
      stop: true,
      args: [
        sample.expectedUrl,
        {
          workspaceId: sample.mode === 'present' ? 'wake-workspace-a' : { type: 'undefined' },
          forceExternal: true,
        },
      ],
    });
    expect(page.url()).toBe(urlBefore);
  }
  await expectCounts(item, 0, 0, cases.length);
  expect(page.context().pages()).toHaveLength(1);
  await captureWake(page, item, 'pr-context-after', info);
});

test('automated wake W4: row and native chevron activation occur once while disclosure stays controlled', async ({
  page,
}, info) => {
  const item = await openWake(page);
  await expect(item.chevron).toHaveAttribute('aria-expanded', 'false');
  await expect(item.chevron).toHaveAttribute('aria-controls', 'automated-wake-body-a');
  await expect(item.chevron).toHaveAccessibleName(
    label('chat_agentSubscriptions_expandWatches_ariaLabel'),
  );
  await captureWake(page, item, 'controlled-before', info);
  await activate(item, item.status, { name: 'ontoggle' });
  for (const via of ['click', 'Enter', 'Space']) {
    await activate(item, item.chevron, { name: 'ontoggle', via, args: 'button-event' });
    await expect(item.chevron).toHaveAttribute('aria-expanded', 'false');
  }
  await field(item, 'Disclosure controls ID').fill('wake-body-current');
  await apply(item);
  await toggle(item, 'Controlled expanded').click();
  await expect(item.chevron).toHaveAttribute('aria-expanded', 'true');
  await expect(item.chevron).toHaveAttribute('aria-controls', 'wake-body-current');
  await expect(item.chevron).toHaveAccessibleName(
    label('chat_agentSubscriptions_collapseWatches_ariaLabel'),
  );
  await expect(item.host.locator('#wake-body-current')).toBeVisible();
  await activate(item, item.chevron, { name: 'ontoggle', via: 'Enter', args: 'button-event' });
  await expect(item.chevron).toHaveAttribute('aria-expanded', 'true');
  await expect(item.header.getByRole('button')).toHaveCount(1);
  await expectCounts(item, 5);
  await captureWake(page, item, 'controlled-after', info);
});

test('automated wake W5: pinned activation takes priority for row PR chip and chevron without host navigation', async ({
  page,
}, info) => {
  const item = await openWake(page);
  await kind(item, 'pr');
  const urlBefore = page.url();
  await captureWake(page, item, 'unpinned-before', info);
  await toggle(item, 'Pinned callback enabled').click();
  const pinnedLabel = label('chat_stickyMessageHeader_scrollToPrevious_title');
  await expect(item.chevron).toHaveAccessibleName(pinnedLabel);
  await expect(item.chip).toHaveAttribute('title', pinnedLabel);
  await expect(item.chevron).not.toHaveAttribute('aria-expanded');
  await expect(item.chevron).not.toHaveAttribute('aria-controls');
  await activate(item, item.status, { name: 'onPinnedActivate' });
  for (const via of ['click', 'Enter', 'Space']) {
    await activate(item, item.chip, { name: 'onPinnedActivate', via, stop: true });
    await activate(item, item.chevron, { name: 'onPinnedActivate', via, args: 'button-event' });
  }
  await expectCounts(item, 0, 7);
  await toggle(item, 'Controlled expanded').click();
  await expect(item.chevron).not.toHaveAttribute('aria-expanded');
  await expect(item.chevron).not.toHaveAttribute('aria-controls');
  await captureWake(page, item, 'pinned-after', info);
  await toggle(item, 'Pinned callback enabled').click();
  await expect(item.chevron).toHaveAttribute('aria-expanded', 'true');
  await activate(item, item.chip, {
    name: 'onOpenLink',
    via: 'Enter',
    stop: true,
    args: [
      'https://github.com/intent-hq/intent/pull/17',
      { workspaceId: 'wake-workspace-a', forceExternal: true },
    ],
  });
  await expectCounts(item, 0, 7, 1);
  expect(page.url()).toBe(urlBefore);
  expect(page.context().pages()).toHaveLength(1);
});
