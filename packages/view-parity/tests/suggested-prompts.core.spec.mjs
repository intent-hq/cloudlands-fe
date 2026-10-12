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
  visibleText,
  linkParts,
  routingUrl,
  chiefPairs,
  chooseChief,
  editName,
} from '../lib/suggested-prompts.mjs';

test('suggested prompts P1: pointer Enter and Space select the raw prompt exactly once', async ({
  page,
}, info) => {
  const item = await openPrompts(page);
  const prompts = [
    'Review [the change](HTTPS://Example.test/Change) — 雪 & résumé.',
    '  Preserve leading and trailing whitespace  ',
    'Review [the change](HTTPS://Example.test/Change) — 雪 & résumé.',
  ];
  await capturePrompts(page, item, 'selection-before', info);
  await applyPrompts(item, prompts);
  const observed = [];
  for (const [index, key] of [
    [0, null],
    [1, 'Enter'],
    [2, 'Space'],
  ]) {
    const send = sendControl(item, index);
    await expect(send).toHaveAccessibleName(visibleText(prompts[index]).trim());
    if (key) await send.press(key);
    else await send.click();
    await expectCounts(item, observed.length + 1);
    observed.push(
      await expectRaw(item, 'select', prompts[index], index === 1 ? [1] : [0, 2], {
        callbackRevision: 0,
        composition: 'source',
        mountRevision: 0,
        inputRevision: 1,
      }),
    );
  }
  expect(new Set(observed.map((o) => o.callbackObjectId)).size).toBe(1);
  expect(new Set(observed.map((o) => o.inputArrayObjectId)).size).toBe(1);
  await capturePrompts(page, item, 'selection-after', info);
  await expectCounts(item, 3);
});

test('suggested prompts P2: edit stays independent and callbacks update after replacement and removal', async ({
  page,
}, info) => {
  const item = await openPrompts(page);
  const raw = 'Edit [this prompt](https://example.test/edit) without sending it.';
  await applyPrompts(item, [raw]);
  await capturePrompts(page, item, 'edit-before', info);
  await item.rows.first().hover();
  await editControl(item, 0).click();
  await expectCounts(item, 0, 1);
  const firstEdit = await expectRaw(item, 'edit', raw, [0], { callbackRevision: 0 });
  await sendControl(item, 0).press('Enter');
  await expectCounts(item, 1, 1);
  const firstSelect = await expectRaw(item, 'select', raw, [0], { callbackRevision: 0 });
  expect(firstEdit.callbackObjectId).not.toBe(firstSelect.callbackObjectId);
  await control(item, 'Replace prompt callbacks').click();
  await editControl(item, 0).press('Enter');
  await expectCounts(item, 1, 2);
  const secondEdit = await expectRaw(item, 'edit', raw, [0], { callbackRevision: 1 });
  expect(secondEdit.callbackObjectId).not.toBe(firstEdit.callbackObjectId);
  await toggle(item, 'Enable edit callback').click();
  await expect(item.frame.getByRole('button', { name: editName, exact: true })).toHaveCount(0);
  await sendControl(item, 0).press('Space');
  await expectCounts(item, 2, 2);
  const secondSelect = await expectRaw(item, 'select', raw, [0], { callbackRevision: 1 });
  expect(secondSelect.callbackObjectId).not.toBe(firstSelect.callbackObjectId);
  await toggle(item, 'Enable edit callback').click();
  await editControl(item, 0).press('Space');
  await expectCounts(item, 2, 3);
  const restoredEdit = await expectRaw(item, 'edit', raw, [0], { callbackRevision: 1 });
  expect(restoredEdit.callbackObjectId).toBe(secondEdit.callbackObjectId);
  expect(restoredEdit.inputArrayObjectId).toBe(firstEdit.inputArrayObjectId);
  await capturePrompts(page, item, 'edit-after', info);
  await expectCounts(item, 2, 3);
});

test('suggested prompts P3: actual anchors preserve native events and never activate the prompt or navigate', async ({
  page,
  context,
}, info) => {
  const item = await openPrompts(page);
  const raw =
    'Read [the document](HTTPS://Example.test/Foo_(Bar)) and [the note](INTENT://local/note/Spec).';
  await applyPrompts(item, [raw]);
  const startUrl = page.url();
  const initialPages = context.pages().length;
  await capturePrompts(page, item, 'native-links-before', info);
  const document = item.frame.getByRole('link', { name: 'the document', exact: true });
  const note = item.frame.getByRole('link', { name: 'the note', exact: true });
  const expected = {
    url: 'https://Example.test/Foo_(Bar)',
    label: 'the document',
    callbackRevision: 0,
  };
  await document.click();
  const first = await expectLink(item, { ...expected, count: 1 });
  await document.click({ modifiers: ['Control', 'Shift'] });
  const modified = await expectLink(item, { ...expected, count: 2, ctrlKey: true, shiftKey: true });
  expect(modified.event.currentTarget.objectId).toBe(first.event.currentTarget.objectId);
  expect(modified.event.objectId).not.toBe(first.event.objectId);
  await note.press('Alt+Enter');
  const entered = await expectLink(item, {
    count: 3,
    url: 'intent://local/note/Spec',
    label: 'the note',
    key: 'Enter',
    altKey: true,
  });
  await note.press('Shift+Space');
  const spaced = await expectLink(item, {
    count: 4,
    url: 'intent://local/note/Spec',
    label: 'the note',
    key: ' ',
    shiftKey: true,
  });
  expect(spaced.event.currentTarget.objectId).toBe(entered.event.currentTarget.objectId);
  expect(spaced.event.objectId).not.toBe(entered.event.objectId);
  expect(page.url()).toBe(startUrl);
  expect(context.pages().length).toBe(initialPages);
  await capturePrompts(page, item, 'native-links-after', info);
  await expectCounts(item, 0, 0, 4);
});

test('suggested prompts P5: original parser semantics drive actual links and accessible text without rewriting raw values', async ({
  page,
}, info) => {
  const item = await openPrompts(page);
  const prompts = [
    'Start [Case](HTTPS://Example.test/Foo_(Bar)) and [task](INTENT://local/note/Spec).',
    '[first](HTTP://Example.test/Path) and [second](https://example.test/2)',
    'Literal ![image](https://example.test/a.png) [mail](mailto:a@b.test) [reference][ref]',
    'Nested ![outer [inner](https://example.test)](https://example.test/image) then [ok](https://example.test/ok)',
    'Nested [[label]](https://example.test) and [bad](javascript:alert(1))',
    '[broken [inner](https://example.test)\n[after](https://example.test/next)',
    'Spaces [bad](https://example.test/a b) [deep](https://example.test/a((b))) and [ok](https://example.test/end)',
    'Bare https://example.test and #123 and [](https://example.test) stay literal.',
    '',
  ];
  await capturePrompts(page, item, 'parser-before', info);
  await applyPrompts(item, prompts);
  for (const [index, raw] of prompts.entries()) {
    const row = item.rows.nth(index);
    const expectedVisible = visibleText(raw);
    expect(await row.locator('[data-suggested-prompt-label]').textContent()).toBe(expectedVisible);
    await expect(sendControl(item, index)).toHaveAttribute('aria-label', expectedVisible);
    await expect(sendControl(item, index)).toHaveAccessibleName(
      expectedVisible.replace(/\s+/g, ' ').trim(),
    );
    const expectedLinks = linkParts(raw);
    await expect(row.getByRole('link')).toHaveCount(expectedLinks.length);
    for (const [linkIndex, part] of expectedLinks.entries()) {
      const anchor = row.getByRole('link').nth(linkIndex);
      await expect(anchor).toHaveAccessibleName(part.label);
      await expect(anchor).toHaveAttribute('href', routingUrl(part.url));
      await expect(anchor).toHaveAttribute('title', routingUrl(part.url));
    }
    // This also reaches the source's empty or link-leading send span without
    // adding DOM content to give it a pointer target.
    await sendControl(item, index).press('Enter');
    await expectCounts(item, index + 1);
    await expectRaw(item, 'select', raw, [index]);
  }
  await expect(item.frame.locator('img')).toHaveCount(0);
  await capturePrompts(page, item, 'parser-after', info);
  await expectCounts(item, prompts.length);
});

test('suggested prompts P9: all five actual localized Chief labels select their full original prompts', async ({
  page,
}, info) => {
  const item = await openPrompts(page);
  await capturePrompts(page, item, 'chief-source-before', info);
  await chooseChief(item);
  await expect(item.rows).toHaveCount(5);
  const keys = [null, 'Enter', 'Space', null, 'Enter'];
  const records = [];
  for (const [index, pair] of chiefPairs.entries()) {
    const button = item.frame.getByRole('button', { name: pair.label, exact: true });
    if (keys[index]) await button.press(keys[index]);
    else await button.click();
    await expectCounts(item, index + 1);
    records.push(
      await expectRaw(item, 'select', pair.prompt, null, {
        composition: 'chief',
        inputRevision: null,
        inputArrayObjectId: null,
        mountRevision: 1,
      }),
    );
  }
  expect(new Set(records.map((r) => r.callbackObjectId)).size).toBe(1);
  await capturePrompts(page, item, 'chief-all-five-after', info);
  await expectCounts(item, 5);
});
