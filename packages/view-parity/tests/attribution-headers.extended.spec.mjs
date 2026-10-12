import {
  test,
  expect,
  openHeaders,
  control,
  apply,
  choice,
  switchTo,
  clear,
  currentAgent,
  currentPr,
  agentOracle,
  prOracle,
  label,
  activate,
  zeroArgs,
  nativeEvent,
  capture,
  sameNode,
  detached,
  avatarArt,
  contained,
} from '../lib/attribution-headers.mjs';

test('attribution H6: same sender keeps its node and captured workspace with current callbacks', async ({
  page,
}, info) => {
  const { agent } = await openHeaders(page);
  const original = await agent.primary.elementHandle();
  await capture(page, agent.frame, 'H6-before', info);
  const raw = '  Café "review" 雪 <b>literal</b>  ';
  await apply(agent, { fromAgentName: raw, workspaceId: 'attribution-workspace-b' });
  await control(agent, 'replace-onOpenAssistantAgentFromEvent').click();
  await sameNode(agent.primary, original);
  await expect(agent.primary).toHaveAccessibleName(
    agentOracle.getAgentMessageAttribution({
      type: 'agent_message',
      fromAgentId: 'agent-11111111-1111-4111-8111-111111111111',
      fromAgentName: raw,
    }).displayName,
  );
  const expected = await currentAgent(agent);
  expect(expected.rawName).toBe(raw);
  const record = await activate(agent, agent.primary, {
    name: 'onOpenAssistantAgentFromEvent',
    revision: 1,
  });
  expect(record.arguments.slice(1)).toEqual(['attribution-workspace-a', expected.fromAgentId]);
  nativeEvent(record.arguments[0], record, 'agent-message-attribution');
  await control(agent, 'replace-ontoggle').click();
  zeroArgs(await activate(agent, agent.toggle, { name: 'ontoggle', revision: 1 }));
  await apply(agent); // Equal props retain the same sender-bound instance.
  await sameNode(agent.primary, original);
  await control(agent, 'remount').click();
  await detached(original);
  const remounted = await activate(agent, agent.primary, {
    name: 'onOpenAssistantAgentFromEvent',
    revision: 1,
    mountRevision: 1,
  });
  expect(remounted.arguments.slice(1)).toEqual(['attribution-workspace-b', expected.fromAgentId]);
  await apply(agent, { workspaceId: '' });
  await control(agent, 'remount').click();
  await clear(agent);
  await agent.primary.click();
  await expect.poll(agent.counts).toEqual({
    'native-pointerdown-capture': 1,
    'native-pointerdown-bubble': 1,
    'native-click-capture': 1,
  });
  expect(await agent.callbacks()).toEqual([]);
  await capture(page, agent.frame, 'H6-after', info);
  await original.dispose();
});

test('attribution H7: sender keys and branch replacement detach old controls without stale callbacks', async ({
  page,
}, info) => {
  const { agent } = await openHeaders(page);
  const oldSender = await agent.primary.elementHandle();
  await capture(page, agent.frame, 'H7-before', info);
  const nextId = 'agent-22222222-2222-4222-8222-222222222222';
  await apply(agent, { fromAgentId: nextId, workspaceId: 'attribution-workspace-b' });
  await detached(oldSender);
  const record = await activate(agent, agent.primary, { name: 'onOpenAssistantAgentFromEvent' });
  expect(record.arguments.slice(1)).toEqual(['attribution-workspace-b', nextId]);
  const oldButton = await agent.primary.elementHandle();
  await choice(agent, 'kind', 'chief');
  await apply(agent);
  await detached(oldButton);
  const anchor = await agent.primary.elementHandle();
  await control(agent, 'replace-onOpenLink').click();
  await apply(agent, { sourceMessageId: 'message-current-source' });
  await sameNode(agent.primary, anchor);
  const attribution = await currentAgent(agent);
  const link = await activate(agent, agent.primary, {
    name: 'onOpenLink',
    revision: 1,
    via: 'Enter',
  });
  expect(link.arguments[0]).toBe(attribution.sourceUrl);
  expect(link.arguments[1].workspaceId).toBe('attribution-workspace-b');
  nativeEvent(link.arguments[1].event, link, 'agent-message-attribution', { via: 'Enter' });
  await clear(agent);
  await agent.primary.dblclick();
  await expect.poll(agent.counts).toEqual({
    'native-pointerdown-capture': 2,
    'native-pointerdown-bubble': 2,
    'native-click-capture': 2,
    onOpenLink: 2,
    'native-dblclick-capture': 1,
  });
  expect((await agent.callbacks()).map((x) => x.callbackRevision)).toEqual([1, 1]);
  await switchTo(agent, 'pinned', true);
  await detached(anchor);
  await expect(agent.header.getByRole('link')).toHaveCount(0);
  const pinnedSpan = await agent.primary.elementHandle();
  await switchTo(agent, 'mounted', false);
  await detached(pinnedSpan);
  await expect(agent.header).toHaveCount(0);
  await clear(agent);
  await control(agent, 'sibling').click();
  expect(await agent.callbacks()).toEqual([]);
  await switchTo(agent, 'pinned', false);
  await switchTo(agent, 'mounted', true);
  await activate(agent, agent.primary, { name: 'onOpenLink', revision: 1, mountRevision: 1 });
  await capture(page, agent.frame, 'H7-after', info);
  for (const handle of [oldSender, oldButton, anchor, pinnedSpan]) await handle.dispose();
  // Detachment and new controls are observable; inaccessible listener counts or
  // real nonempty Store subscription delivery are intentionally not claimed.
});

test('attribution H8: narrow long names leave controls usable and empty Store avatars use original art', async ({
  page,
}, info) => {
  const { agent } = await openHeaders(page);
  const initial = await currentAgent(agent);
  await avatarArt(agent.header, initial.fromAgentId, null, info);
  await capture(page, agent.frame, 'H8-before', info);
  await switchTo(agent, 'specialist-override', true);
  await avatarArt(agent.header, initial.fromAgentId, 'implementor', info);
  await capture(page, agent.frame, 'H8-implementor', info);
  await apply(agent, { specialist: 'verifier' });
  await avatarArt(agent.header, initial.fromAgentId, 'verifier', info);
  await control(agent, 'long-name').click();
  await apply(agent);
  const expected = await currentAgent(agent);
  await expect(agent.primary).toHaveAccessibleName(expected.displayName);
  await expect(agent.primary).toHaveAttribute(
    'title',
    label('chat_msgAttribution_openAgent_title', { name: expected.displayName }),
  );
  await contained(agent.frame, info);
  await capture(page, agent.frame, 'H8-long-name', info);
  await activate(agent, agent.primary, { name: 'onOpenAssistantAgentFromEvent', via: 'Enter' });
  zeroArgs(await activate(agent, agent.toggle, { name: 'ontoggle', via: 'Space' }));
  await apply(agent, { fromAgentName: '   ' });
  await expect(agent.primary).toHaveAccessibleName((await currentAgent(agent)).displayName);
  await switchTo(agent, 'specialist-override', false);
  await avatarArt(agent.header, initial.fromAgentId, null, info);
  await capture(page, agent.frame, 'H8-after', info);
});

test('attribution H9: PR current metadata and callback preserve initial workspace until remount', async ({
  page,
}, info) => {
  const { pr } = await openHeaders(page);
  const initialNode = await pr.primary.elementHandle();
  await capture(page, pr.frame, 'H9-before', info);
  await apply(pr, {
    repo: 'other-owner/library',
    prNumber: '12034',
    url: ' https://example.test/reviews/current ',
    workspaceId: 'attribution-workspace-b',
  });
  await control(pr, 'replace-onOpenLink').click();
  await sameNode(pr.primary, initialNode);
  const attribution = await currentPr(pr);
  const expectedUrl = prOracle.getPrMonitorWakeUrl(attribution);
  const record = await activate(pr, pr.primary, {
    name: 'onOpenLink',
    revision: 1,
    nativeStop: false,
  });
  expect(record.arguments).toEqual([
    expectedUrl,
    { workspaceId: 'attribution-workspace-a', forceExternal: true },
  ]);
  await apply(pr);
  await sameNode(pr.primary, initialNode);
  await control(pr, 'remount').click();
  await detached(initialNode);
  const remounted = await activate(pr, pr.primary, {
    name: 'onOpenLink',
    revision: 1,
    mountRevision: 1,
    nativeStop: false,
    via: 'Enter',
  });
  expect(remounted.arguments).toEqual([
    expectedUrl,
    { workspaceId: 'attribution-workspace-b', forceExternal: true },
  ]);
  const beforeUnmount = await pr.primary.elementHandle();
  await switchTo(pr, 'mounted', false);
  await detached(beforeUnmount);
  await apply(pr, { workspaceId: '' });
  await clear(pr);
  await control(pr, 'sibling').click();
  expect(await pr.callbacks()).toEqual([]);
  await switchTo(pr, 'mounted', true);
  const noWorkspace = await activate(pr, pr.primary, {
    name: 'onOpenLink',
    revision: 1,
    mountRevision: 2,
    nativeStop: false,
    via: 'Space',
  });
  expect(noWorkspace.arguments).toEqual([
    expectedUrl,
    { workspaceId: '[undefined]', forceExternal: true },
  ]);
  await capture(page, pr.frame, 'H9-after', info);
  await initialNode.dispose();
  await beforeUnmount.dispose();
});

test('attribution H10: PR empty and omitted metadata use original extraction and narrow label contracts', async ({
  page,
}, info) => {
  const { pr } = await openHeaders(page);
  await capture(page, pr.frame, 'H10-before', info);
  // The real Store stays empty: every label uses the original unknown-workspace
  // branch. Same-owner hydrated workspace labels are explicitly unverified.
  await apply(pr, {
    repo: 'owner-with-a-long-name/repository-with-a-long-name',
    prNumber: '123456',
    url: '   ',
  });
  const withoutUrl = await currentPr(pr);
  expect(withoutUrl.url).toBeUndefined();
  let record = await activate(pr, pr.primary, { name: 'onOpenLink', nativeStop: false });
  expect(record.arguments).toEqual([
    prOracle.getPrMonitorWakeUrl(withoutUrl),
    { workspaceId: 'attribution-workspace-a', forceExternal: true },
  ]);
  await contained(pr.frame, info);
  await capture(page, pr.frame, 'H10-long-pr', info);
  await switchTo(pr, 'omitUrl', true);
  await apply(pr, { url: 'https://example.test/ignored' });
  expect(await currentPr(pr)).toEqual(withoutUrl);
  record = await activate(pr, pr.primary, { name: 'onOpenLink', nativeStop: false, via: 'Enter' });
  expect(record.arguments[0]).toBe(prOracle.getPrMonitorWakeUrl(withoutUrl));
  const prior = await pr.primary.elementHandle();
  await switchTo(pr, 'omitRepo', true);
  await apply(pr);
  expect(await currentPr(pr)).toBeNull();
  await detached(prior);
  await expect(pr.header).toHaveCount(0);
  await switchTo(pr, 'omitRepo', false);
  await switchTo(pr, 'omitNumber', true);
  await apply(pr);
  expect(await currentPr(pr)).toBeNull();
  await expect(pr.header).toHaveCount(0);
  await switchTo(pr, 'omitNumber', false);
  await apply(pr, { prNumber: '' });
  expect(await currentPr(pr)).toBeNull();
  await apply(pr, { repo: 'intent-hq/intent', prNumber: '17' });
  const recovered = await currentPr(pr);
  record = await activate(pr, pr.primary, { name: 'onOpenLink', nativeStop: false, via: 'Space' });
  expect(record.arguments).toEqual([
    prOracle.getPrMonitorWakeUrl(recovered),
    { workspaceId: 'attribution-workspace-a', forceExternal: true },
  ]);
  await capture(page, pr.frame, 'H10-after', info);
  await prior.dispose();
});
