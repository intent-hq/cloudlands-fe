import {
  test,
  expect,
  openWake,
  control,
  toggle,
  field,
  choice,
  apply,
  kind,
  activate,
  expectCounts,
  label,
  captureWake,
  sameNode,
  detached,
  expectOverflow,
  expectContained,
} from '../lib/automated-wake.mjs';

test('automated wake W6: current callbacks presentation and workspace update on stable nodes before branch replacement', async ({
  page,
}, info) => {
  const item = await openWake(page);
  const originalHeader = await item.header.elementHandle();
  const originalLabel = await item.primary.elementHandle();
  const originalChevron = await item.chevron.elementHandle();
  await captureWake(page, item, 'current-inputs-before', info);
  await activate(item, item.chevron, { name: 'ontoggle', args: 'button-event' });
  await control(item, 'Replace toggle callback').click();
  await field(item, 'Hook raw name').fill('Current watcher');
  await choice(item, 'hook-active', 'false').click();
  await apply(item);
  await sameNode(item.header, originalHeader);
  await sameNode(item.primary, originalLabel);
  await sameNode(item.chevron, originalChevron);
  await expect(item.primary).toHaveText('Current watcher');
  await expect(item.status).toHaveText(label('chat_hookWakeAttribution_wokeAgentRetired_after'));
  await activate(item, item.status, { name: 'ontoggle', revision: 1 });
  await activate(item, item.chevron, {
    name: 'ontoggle',
    via: 'Space',
    args: 'button-event',
    revision: 1,
  });
  await kind(item, 'pr');
  await detached(originalLabel);
  await sameNode(item.header, originalHeader);
  await sameNode(item.chevron, originalChevron);
  const originalChip = await item.chip.elementHandle();
  await activate(item, item.chip, {
    name: 'onOpenLink',
    stop: true,
    args: [
      'https://github.com/intent-hq/intent/pull/17',
      { workspaceId: 'wake-workspace-a', forceExternal: true },
    ],
  });
  await control(item, 'Replace link callback').click();
  await field(item, 'Workspace ID').fill('workspace-B-雪');
  await field(item, 'PR repository').fill('other/current');
  await field(item, 'PR number').fill('2048');
  await field(item, 'PR URL (empty uses canonical fallback)').fill(
    'https://Example.test/New?Case=Yes',
  );
  await apply(item);
  await sameNode(item.chip, originalChip);
  await expect(item.chip).toHaveAccessibleName('other/current #2048');
  await activate(item, item.chip, {
    name: 'onOpenLink',
    via: 'Enter',
    revision: 1,
    stop: true,
    args: [
      'https://Example.test/New?Case=Yes',
      { workspaceId: 'workspace-B-雪', forceExternal: true },
    ],
  });
  await toggle(item, 'Pinned callback enabled').click();
  await control(item, 'Replace pinned callback').click();
  await sameNode(item.chip, originalChip);
  await activate(item, item.chip, {
    name: 'onPinnedActivate',
    via: 'Space',
    revision: 1,
    stop: true,
  });
  await activate(item, item.chevron, {
    name: 'onPinnedActivate',
    via: 'Enter',
    revision: 1,
    args: 'button-event',
  });
  await kind(item, 'script');
  await detached(originalChip);
  await sameNode(item.header, originalHeader);
  await sameNode(item.chevron, originalChevron);
  await expect(item.script).toHaveText('Build');
  await captureWake(page, item, 'current-inputs-after', info);
  await expectCounts(item, 3, 2, 2);
  for (const node of [originalHeader, originalLabel, originalChevron, originalChip])
    await node.dispose();
});

test('automated wake W7: real resizing content replacement and remounts update overflow titles', async ({
  page,
}, info) => {
  const item = await openWake(page);
  await field(item, 'Hook raw name').fill('A');
  await apply(item);
  await expectOverflow(item.primary, false, null);
  await captureWake(page, item, 'title-short-before', info);
  const hookNode = await item.primary.elementHandle();
  const longHook = 'Review the current build output with the team before continuing';
  await field(item, 'Hook raw name').fill(longHook);
  await apply(item);
  await choice(item, 'width', '180').click();
  await sameNode(item.primary, hookNode);
  await expectOverflow(item.primary, true, longHook);
  const raw = `  ${longHook}  `;
  await field(item, 'Hook raw name').fill(raw);
  await apply(item);
  await expectOverflow(item.primary, true, raw);
  await captureWake(page, item, 'title-hook-overflow', info);
  await field(item, 'Hook raw name').fill('A');
  await apply(item);
  await choice(item, 'width', '640').click();
  await expectOverflow(item.primary, false, null);
  await kind(item, 'script');
  await detached(hookNode);
  const scriptNode = await item.script.elementHandle();
  const statusNode = await item.status.elementHandle();
  const longScript = 'Review the build output and record the complete test result';
  await field(item, 'Script name').fill(longScript);
  await choice(item, 'script-reason', 'ttl-expired').click();
  await apply(item);
  await choice(item, 'width', '180').click();
  await sameNode(item.script, scriptNode);
  await expectOverflow(item.script, true, longScript);
  await captureWake(page, item, 'title-script-overflow', info);
  await field(item, 'Script name').fill('A');
  await apply(item);
  await expectOverflow(item.status, true, label('chat_scriptMonitor_expired_description'));
  await captureWake(page, item, 'title-status-overflow', info);
  await choice(item, 'script-reason', 'finished').click();
  await apply(item);
  await choice(item, 'width', '640').click();
  await expectOverflow(item.script, false, null);
  await expectOverflow(item.status, false, null);
  await sameNode(item.script, scriptNode);
  await sameNode(item.status, statusNode);
  await choice(item, 'width', '180').click();
  await expectOverflow(item.status, true, label('chat_scriptMonitor_finished_description'));
  await toggle(item, 'Header mounted').click();
  await expect(item.header).toHaveCount(0);
  await detached(scriptNode);
  await detached(statusNode);
  // truncatedTitle.destroy removes its title from the real detached nodes.
  expect(await scriptNode.getAttribute('title')).toBeNull();
  expect(await statusNode.getAttribute('title')).toBeNull();
  await control(item, 'Replace toggle callback').click();
  await choice(item, 'width', '640').click();
  await toggle(item, 'Header mounted').click();
  await expectOverflow(item.script, false, null);
  await activate(item, item.chevron, { name: 'ontoggle', args: 'button-event', revision: 1 });
  const mountedNode = await item.script.elementHandle();
  await control(item, 'Remount header').click();
  await detached(mountedNode);
  await expectOverflow(item.script, false, null);
  await activate(item, item.chevron, {
    name: 'ontoggle',
    via: 'Space',
    args: 'button-event',
    revision: 1,
    mountRevision: 1,
  });
  await captureWake(page, item, 'title-remount-after', info);
  await expectCounts(item, 2);
  for (const node of [hookNode, scriptNode, statusNode, mountedNode]) await node.dispose();
});

test('automated wake W8: bounded long prose keeps PR and disclosure controls reachable at 420 pixels', async ({
  page,
}, info) => {
  const item = await openWake(page);
  const prose =
    'Review the current build with the team and explain the next step before continuing';
  await field(item, 'Hook raw name').fill(prose);
  await apply(item);
  await expectContained(item, info, 'long-hook');
  await captureWake(page, item, 'long-prose-before', info);
  await activate(item, item.chevron, { name: 'ontoggle', via: 'Enter', args: 'button-event' });
  await expect(item.chevron).toBeFocused();
  await kind(item, 'script');
  await field(item, 'Script name').fill(prose);
  await apply(item);
  await expectContained(item, info, 'long-script');
  await activate(item, item.chevron, { name: 'ontoggle', via: 'Space', args: 'button-event' });
  await kind(item, 'pr');
  await field(item, 'PR repository').fill('external/project-with-a-long-but-bounded-name');
  await apply(item);
  await expectContained(item, info, 'long-pr');
  await activate(item, item.chip, {
    name: 'onOpenLink',
    stop: true,
    args: [
      'https://github.com/external/project-with-a-long-but-bounded-name/pull/17',
      { workspaceId: 'wake-workspace-a', forceExternal: true },
    ],
  });
  await page.keyboard.press('Tab');
  await expect(item.chevron).toBeFocused();
  await activate(item, item.chevron, { name: 'ontoggle', via: 'Space', args: 'button-event' });
  await page.keyboard.press('Shift+Tab');
  await expect(item.chip).toBeFocused();
  await activate(item, item.chip, {
    name: 'onOpenLink',
    via: 'Enter',
    stop: true,
    args: [
      'https://github.com/external/project-with-a-long-but-bounded-name/pull/17',
      { workspaceId: 'wake-workspace-a', forceExternal: true },
    ],
  });
  await captureWake(page, item, 'long-prose-after', info);
  await expectCounts(item, 3, 0, 2);
});
