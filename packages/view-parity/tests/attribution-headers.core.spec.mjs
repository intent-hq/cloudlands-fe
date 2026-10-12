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
  label,
  activate,
  zeroArgs,
  nativeEvent,
  capture,
  linksOracle,
  prOracle,
} from '../lib/attribution-headers.mjs';

test('attribution H1: sibling disclosure uses zero arguments and controlled accessible state', async ({
  page,
}, info) => {
  const { agent } = await openHeaders(page);
  const attribution = await currentAgent(agent);
  await expect(agent.primary).toHaveAccessibleName(attribution.displayName);
  await expect(agent.toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(agent.toggle).toHaveAttribute('aria-controls', 'attribution-agent-body-a');
  await expect(agent.header.locator('button button, button a, a button')).toHaveCount(0);
  await capture(page, agent.frame, 'H1-before', info);
  for (const via of ['click', 'Enter', 'Space']) {
    zeroArgs(await activate(agent, agent.toggle, { name: 'ontoggle', via }));
    await expect(agent.toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(control(agent, 'disclosure-body')).toBeHidden();
  }
  await switchTo(agent, 'expanded', true);
  await apply(agent, { controlsId: 'attribution-body-current' });
  await expect(agent.toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(agent.toggle).toHaveAttribute('aria-controls', 'attribution-body-current');
  await expect(control(agent, 'disclosure-body')).toBeVisible();
  await agent.primary.focus();
  await page.keyboard.press('Tab');
  await expect(agent.toggle).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(agent.primary).toBeFocused();
  const counts = await agent.counts();
  expect(counts.onOpenAssistantAgentFromEvent ?? 0).toBe(0);
  expect(counts.onPinnedActivate ?? 0).toBe(0);
  await capture(page, agent.frame, 'H1-after', info);
});

test('attribution H2: pinned siblings and row activate once without disclosure or navigation', async ({
  page,
}, info) => {
  const { agent } = await openHeaders(page);
  await switchTo(agent, 'pinned', true);
  await expect(agent.toggle).not.toHaveAttribute('aria-expanded');
  await expect(agent.toggle).not.toHaveAttribute('aria-controls');
  await capture(page, agent.frame, 'H2-before', info);
  zeroArgs(await activate(agent, agent.primary, { name: 'onPinnedActivate' }));
  zeroArgs(await activate(agent, agent.toggle, { name: 'onPinnedActivate', via: 'Enter' }));
  zeroArgs(await activate(agent, agent.toggle, { name: 'onPinnedActivate', via: 'Space' }));
  // Real top padding of the pinned row; no forced click or synthesized event.
  zeroArgs(
    await activate(agent, agent.header, {
      name: 'onPinnedActivate',
      nativeStop: false,
      cancelled: false,
      position: { x: 2, y: 2 },
    }),
  );
  await control(agent, 'replace-onPinnedActivate').click();
  zeroArgs(await activate(agent, agent.primary, { name: 'onPinnedActivate', revision: 1 }));
  const counts = await agent.counts();
  expect(counts.ontoggle ?? 0).toBe(0);
  expect(counts.onOpenAssistantAgentFromEvent ?? 0).toBe(0);
  expect(counts.onOpenLink ?? 0).toBe(0);
  await choice(agent, 'kind', 'chief');
  await apply(agent);
  await expect(agent.primary).not.toHaveAttribute('href');
  zeroArgs(
    await activate(agent, agent.primary, {
      name: 'onPinnedActivate',
      revision: 1,
      nativeStop: false,
      cancelled: false,
    }),
  );
  await capture(page, agent.frame, 'H2-after', info);
});

test('attribution H3: assistant callback receives the real trusted control event and nearest panel', async ({
  page,
}, info) => {
  const { agent } = await openHeaders(page);
  const attribution = await currentAgent(agent);
  await capture(page, agent.frame, 'H3-before', info);
  for (const modifiers of [[], ['Control'], ['Meta']]) {
    const record = await activate(agent, agent.primary, {
      name: 'onOpenAssistantAgentFromEvent',
      modifiers,
    });
    expect(record.argumentCount).toBe(3);
    expect(record.arguments.slice(1)).toEqual(['attribution-workspace-a', attribution.fromAgentId]);
    expect(record.result).toBe(true);
    nativeEvent(record.arguments[0], record, 'agent-message-attribution', { modifiers });
  }
  await apply(agent, { panelId: 'attribution-current-panel' });
  await switchTo(agent, 'assistant-panels', false);
  const record = await activate(agent, agent.primary, {
    name: 'onOpenAssistantAgentFromEvent',
    via: 'Enter',
  });
  nativeEvent(record.arguments[0], record, 'agent-message-attribution', {
    via: 'Enter',
    panel: 'attribution-current-panel',
    assistant: false,
  });
  // A chosen handled result is an ordinary host contract, not the canonical
  // assistant helper or proof of a real action, panel open or navigation saga.
  await clear(agent);
  await agent.primary.dblclick();
  await expect.poll(agent.counts).toEqual({
    'native-pointerdown-capture': 2,
    'native-pointerdown-bubble': 2,
    'native-click-capture': 2,
    onOpenAssistantAgentFromEvent: 2,
    'native-dblclick-capture': 1,
  });
  const callbacks = await agent.callbacks();
  expect(callbacks.map((x) => x.arguments[0].detail)).toEqual([1, 2]);
  for (const callback of callbacks)
    expect(callback.arguments[0]).toMatchObject({
      isTrusted: true,
      defaultPrevented: true,
      cancelBubble: true,
    });
  await clear(agent);
  await control(agent, 'sibling').click();
  expect(await agent.callbacks()).toEqual([]);
  await expect.poll(agent.counts).toEqual({
    'native-pointerdown-capture': 1,
    'native-pointerdown-bubble': 1,
    'native-click-capture': 1,
    'native-click-bubble': 1,
    'react-click-bubble': 1,
  });
  await capture(page, agent.frame, 'H3-after', info);
});

test('attribution H4: Chief links use click and Enter; Space and missing source do not activate', async ({
  page,
}, info) => {
  const { agent } = await openHeaders(page);
  await choice(agent, 'kind', 'chief');
  await apply(agent, { fromAgentName: '  Caller name must not replace Chief 雪  ' });
  const attribution = await currentAgent(agent);
  const expectedUrl = linksOracle.conversationMessageUrl(
    '__chief__',
    attribution.fromAgentId,
    (await agent.state()).inputs.applied.sourceMessageId,
  );
  await expect(agent.primary).toHaveAttribute('href', expectedUrl);
  await expect(agent.primary).toHaveAccessibleName(label('layout_chiefCard_title'));
  const originalUrl = page.url();
  await capture(page, agent.frame, 'H4-before', info);
  for (const via of ['click', 'Enter']) {
    const record = await activate(agent, agent.primary, { name: 'onOpenLink', via });
    expect(record.argumentCount).toBe(2);
    expect(record.arguments[0]).toBe(expectedUrl);
    expect(Object.keys(record.arguments[1]).sort()).toEqual(['event', 'workspaceId']);
    expect(record.arguments[1].workspaceId).toBe('attribution-workspace-a');
    nativeEvent(record.arguments[1].event, record, 'agent-message-attribution', { via });
  }
  await agent.primary.press('Space');
  // A following ordinary activation flushes observable callbacks without a sleep.
  zeroArgs(await activate(agent, agent.toggle, { name: 'ontoggle', via: 'Enter' }));
  expect((await agent.counts()).onOpenLink).toBe(2);
  expect(page.url()).toBe(originalUrl);
  await choice(agent, 'source-url', 'absent');
  await apply(agent);
  expect((await currentAgent(agent)).sourceUrl).toBeUndefined();
  await expect(agent.primary).not.toHaveAttribute('href');
  await expect(agent.header.getByRole('link')).toHaveCount(0);
  const before = await agent.counts();
  await agent.primary.click();
  zeroArgs(await activate(agent, agent.toggle, { name: 'ontoggle', via: 'Space' }));
  expect((await agent.counts()).onOpenLink).toBe(before.onOpenLink);
  expect((await agent.counts()).onOpenAssistantAgentFromEvent ?? 0).toBe(0);
  await capture(page, agent.frame, 'H4-after', info);
});

test('attribution H5: PR pointer Enter and Space pass only exact external link arguments', async ({
  page,
}, info) => {
  const { pr } = await openHeaders(page);
  const attribution = await currentPr(pr);
  await expect(pr.header.getByTestId('pr-monitor-wake-status')).toHaveText(
    label('chat_prMonitorWakeAttribution_wokeAgent_after'),
  );
  const originalUrl = page.url();
  await capture(page, pr.frame, 'H5-before', info);
  for (const via of ['click', 'Enter', 'Space']) {
    const record = await activate(pr, pr.primary, { name: 'onOpenLink', via, nativeStop: false });
    expect(record.argumentCount).toBe(2);
    expect(record.arguments).toEqual([
      prOracle.getPrMonitorWakeUrl(attribution),
      { workspaceId: 'attribution-workspace-a', forceExternal: true },
    ]);
    // PR Button uses React's callback: native parent sees the event before React
    // cancels it at the root. Agent/Chief use direct native bindings instead.
    expect(record.capturedClick.currentTarget?.testId).not.toBe('pr-monitor-wake-chip');
  }
  expect(page.url()).toBe(originalUrl);
  await capture(page, pr.frame, 'H5-after', info);
});
