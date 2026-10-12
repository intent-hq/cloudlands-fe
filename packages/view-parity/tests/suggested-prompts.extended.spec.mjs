import {
  test,
  expect,
  openPrompts,
  applyPrompts,
  control,
  toggle,
  sendControl,
  editControl,
  expectCounts,
  expectRaw,
  expectLink,
  capturePrompts,
  sameNode,
  detached,
  chooseChief,
  chiefPairs,
  expectContained,
} from '../lib/suggested-prompts.mjs';

test('suggested prompts P4: reused anchors call current URL workspace and callback after replacement', async ({
  page,
}, info) => {
  const item = await openPrompts(page);
  await applyPrompts(item, ['Open [target](HTTPS://Example.test/Old).']);
  const anchor = item.frame.getByRole('link', { name: 'target', exact: true });
  const originalNode = await anchor.elementHandle();
  const startUrl = page.url();
  await capturePrompts(page, item, 'link-replacement-before', info);
  await anchor.click();
  const first = await expectLink(item, {
    count: 1,
    url: 'https://Example.test/Old',
    label: 'target',
    inputRevision: 1,
  });
  await control(item, 'Replace prompt callbacks').click();
  await item.host
    .getByRole('textbox', { name: 'Prompt workspace ID', exact: true })
    .fill('workspace-B-雪');
  await anchor.press('Enter');
  const revised = await expectLink(item, {
    count: 2,
    url: 'https://Example.test/Old',
    label: 'target',
    key: 'Enter',
    workspaceId: 'workspace-B-雪',
    callbackRevision: 1,
    inputRevision: 1,
  });
  expect(revised.callbackObjectId).not.toBe(first.callbackObjectId);
  expect(revised.event.currentTarget.objectId).toBe(first.event.currentTarget.objectId);
  expect(revised.inputArrayObjectId).toBe(first.inputArrayObjectId);
  await applyPrompts(item, ['Open [replacement](INTENT://local/task/Replacement).']);
  const replacement = item.frame.getByRole('link', { name: 'replacement', exact: true });
  await sameNode(replacement, originalNode);
  await toggle(item, 'Include workspace context').click();
  await replacement.press('Space');
  const current = await expectLink(item, {
    count: 3,
    url: 'intent://local/task/Replacement',
    label: 'replacement',
    key: ' ',
    workspaceId: null,
    callbackRevision: 1,
    inputRevision: 2,
  });
  expect(current.event.currentTarget.objectId).toBe(first.event.currentTarget.objectId);
  expect(current.inputArrayObjectId).not.toBe(first.inputArrayObjectId);
  expect(current.callbackObjectId).not.toBe(revised.callbackObjectId);
  expect(page.url()).toBe(startUrl);
  await capturePrompts(page, item, 'link-replacement-after', info);
  await expectCounts(item, 0, 0, 3);
  await originalNode.dispose();
});

test('suggested prompts P6: reorder replace empty and mount changes preserve current values and native owner lifetime', async ({
  page,
}, info) => {
  const item = await openPrompts(page);
  const first = 'First [link](https://example.test/first).';
  const second = 'Second prompt.';
  await applyPrompts(item, [first, second]);
  const firstSlot = await sendControl(item, 0).elementHandle();
  const oldLeaf = await item.leaf.elementHandle();
  await capturePrompts(page, item, 'lifetime-before', info);
  await sendControl(item, 0).press('Enter');
  await expectCounts(item, 1);
  const initial = await expectRaw(item, 'select', first, [0], { inputRevision: 1 });
  await control(item, 'Reverse prompts').click();
  await sameNode(sendControl(item, 0), firstSlot);
  await sendControl(item, 0).press('Space');
  await expectCounts(item, 2);
  const reversed = await expectRaw(item, 'select', second, [0], { inputRevision: 2 });
  expect(reversed.inputArrayObjectId).not.toBe(initial.inputArrayObjectId);
  const replacement = 'Current replacement.';
  await applyPrompts(item, [replacement]);
  await sameNode(sendControl(item, 0), firstSlot);
  await sendControl(item, 0).click();
  await expectCounts(item, 3);
  await expectRaw(item, 'select', replacement, [0], { inputRevision: 3 });
  await applyPrompts(item, []);
  await expect(item.frame.getByTestId('suggested-prompts-surface')).toHaveCount(0);
  await detached(firstSlot);
  await sameNode(item.leaf, oldLeaf);
  await capturePrompts(page, item, 'lifetime-empty', info);
  await applyPrompts(item, [first]);
  const restored = await sendControl(item, 0).elementHandle();
  await sendControl(item, 0).press('Enter');
  await expectCounts(item, 4);
  await expectRaw(item, 'select', first, [0], { inputRevision: 5 });
  await toggle(item, 'Mount prompt component').click();
  await expect(item.leaf).toHaveCount(0);
  await detached(restored);
  await detached(oldLeaf);
  await control(item, 'Replace prompt callbacks').click();
  await toggle(item, 'Mount prompt component').click();
  await sendControl(item, 0).press('Space');
  await expectCounts(item, 5);
  await expectRaw(item, 'select', first, [0], {
    callbackRevision: 1,
    mountRevision: 1,
    inputRevision: 5,
  });
  const mountedLeaf = await item.leaf.elementHandle();
  await control(item, 'Remount prompt component').click();
  await detached(mountedLeaf);
  await sendControl(item, 0).press('Enter');
  await expectCounts(item, 6);
  await expectRaw(item, 'select', first, [0], {
    callbackRevision: 1,
    mountRevision: 2,
    inputRevision: 5,
  });
  await capturePrompts(page, item, 'lifetime-after', info);
  await expectCounts(item, 6);
  for (const handle of [firstSlot, oldLeaf, restored, mountedLeaf]) await handle.dispose();
});

test('suggested prompts P7: hints track only the first three positions on the actual platform', async ({
  page,
}, info) => {
  const item = await openPrompts(page);
  const prompts = ['One task.', 'Two tasks.', 'Three tasks.', 'Four tasks.'];
  await applyPrompts(item, prompts);
  const hints = item.frame.locator('[data-suggested-prompt-hint]');
  await expect(hints).toHaveCount(0);
  await capturePrompts(page, item, 'hints-hidden-before', info);
  const platform = await page.evaluate(() => navigator.platform);
  const prefix = platform.toUpperCase().includes('MAC') ? '⌃' : 'Alt+';
  await info.attach('actual-platform.json', {
    body: JSON.stringify({ platform, prefix }),
    contentType: 'application/json',
  });
  await toggle(item, 'Show shortcut hints').click();
  await expect(hints).toHaveText([`${prefix}1`, `${prefix}2`, `${prefix}3`]);
  await expect(item.rows.nth(3).locator('[data-suggested-prompt-hint]')).toHaveCount(0);
  await control(item, 'Reverse prompts').click();
  for (let index = 0; index < 3; index += 1) {
    await expect(sendControl(item, index)).toHaveAccessibleName(prompts[3 - index]);
    await expect(item.rows.nth(index).locator('[data-suggested-prompt-hint]')).toHaveText(
      `${prefix}${index + 1}`,
    );
  }
  await expect(item.rows.nth(3).locator('[data-suggested-prompt-hint]')).toHaveCount(0);
  await capturePrompts(page, item, 'hints-reordered', info);
  await applyPrompts(item, [prompts[0]]);
  await expect(hints).toHaveText([`${prefix}1`]);
  await toggle(item, 'Show shortcut hints').click();
  await expect(hints).toHaveCount(0);
  await capturePrompts(page, item, 'hints-hidden-after', info);
  await expectCounts(item, 0);
});

test('suggested prompts P8: long prose and real controls remain contained in compact and regular narrow views', async ({
  page,
}, info) => {
  const item = await openPrompts(page);
  const prompts = [
    'Review the current work carefully, explain the risks to people joining later, and consult [the short note](https://example.test/note) before choosing the next action.',
    'Discuss the café résumé and 雪 project with the team, preserve the original question, and explain the next step in clear words that stay readable in this narrow panel.',
  ];
  await applyPrompts(item, prompts);
  await toggle(item, 'Show shortcut hints').click();
  await item.rows.first().hover();
  await expectContained(item, info, 'regular-prose');
  await capturePrompts(page, item, 'regular-prose-before', info);
  await toggle(item, 'Compact prompts').click();
  await item.rows.first().hover();
  await expectContained(item, info, 'compact-prose');
  await sendControl(item, 0).press('Enter');
  await expectCounts(item, 1);
  await expectRaw(item, 'select', prompts[0], [0]);
  await editControl(item, 1).press('Space');
  await expectCounts(item, 1, 1);
  await expectRaw(item, 'edit', prompts[1], [1]);
  await capturePrompts(page, item, 'compact-prose-after', info);
  await expectCounts(item, 1, 1);
});

test('suggested prompts P10: Chief callback composition and remount changes never select stale content', async ({
  page,
}, info) => {
  const item = await openPrompts(page);
  await chooseChief(item);
  const firstOwner = await item.leaf.elementHandle();
  await capturePrompts(page, item, 'chief-lifetime-before', info);
  await sendControl(item, 0).press('Enter');
  await expectCounts(item, 1);
  const initial = await expectRaw(item, 'select', chiefPairs[0].prompt, null, {
    callbackRevision: 0,
    mountRevision: 1,
    composition: 'chief',
  });
  await control(item, 'Replace prompt callbacks').click();
  await sameNode(item.leaf, firstOwner);
  await sendControl(item, 4).press('Space');
  await expectCounts(item, 2);
  const revised = await expectRaw(item, 'select', chiefPairs[4].prompt, null, {
    callbackRevision: 1,
    mountRevision: 1,
    composition: 'chief',
  });
  expect(revised.callbackObjectId).not.toBe(initial.callbackObjectId);
  await chooseChief(item, false);
  await detached(firstOwner);
  const raw = 'Independent source prompt after Chief.';
  await applyPrompts(item, [raw]);
  await sendControl(item, 0).press('Enter');
  await expectCounts(item, 3);
  await expectRaw(item, 'select', raw, [0], {
    composition: 'source',
    callbackRevision: 1,
    mountRevision: 2,
  });
  await chooseChief(item);
  await expect(item.rows).toHaveCount(5);
  const beforeRemount = await item.leaf.elementHandle();
  await control(item, 'Remount prompt component').click();
  await detached(beforeRemount);
  await sendControl(item, 1).click();
  await expectCounts(item, 4);
  await expectRaw(item, 'select', chiefPairs[1].prompt, null, {
    composition: 'chief',
    callbackRevision: 1,
    mountRevision: 4,
  });
  await capturePrompts(page, item, 'chief-lifetime-after', info);
  await expectCounts(item, 4);
  await firstOwner.dispose();
  await beforeRemount.dispose();
});
