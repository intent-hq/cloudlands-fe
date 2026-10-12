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
  capturePermission,
  sameNode,
  detached,
  setSwitch,
  withNativeKeys,
  expectControlContained,
} from '../lib/inline-permission.mjs';

test('inline permission IP5: genuine shortcuts respect enabled editable and modifier contexts', async ({
  page,
}, info) => {
  const item = await openPermission(page);
  await setSwitch(item, 'supply-keyboardShortcutsEnabled', true);
  await withNativeKeys(page, info, async (keys) => {
    const anchor = field(item, 'focus-anchor');
    await keys.press(anchor, '1', '1', false);
    await keys.press(anchor, 'Escape', 'Escape', false);
    await setSwitch(item, 'shortcuts', true);
    for (const [key, prevented] of [
      ['1', true],
      ['2', true],
      ['0', false],
      ['3', false],
      ['9', false],
      ['Escape', true],
      ['a', false],
    ]) {
      const event = await keys.press(anchor, key, key, prevented);
      expect(event.capture.defaultPrevented).toBe(false);
    }
    for (const [key, modifier] of [
      ['Control+1', 'ctrlKey'],
      ['Meta+1', 'metaKey'],
      ['Alt+1', 'altKey'],
    ]) {
      await keys.press(anchor, key, '1', false, { [modifier]: true });
    }
    await keys.press(anchor, 'Shift+Escape', 'Escape', true, { shiftKey: true });
    await keys.press(anchor, 'Shift+Digit1', '!', false, { shiftKey: true });
    const input = field(item, 'editable-anchor');
    await input.fill('input-');
    await keys.press(input, '1', '1', false, { target: { tag: 'input', editableAncestor: true } });
    await expect(input).toHaveValue('input-1');
    await keys.press(input, 'Escape', 'Escape', false);
    const textarea = field(item, 'description');
    await textarea.fill('textarea-');
    await keys.press(textarea, '2', '2', false, {
      target: { tag: 'textarea', editableAncestor: true },
    });
    await expect(textarea).toHaveValue('textarea-2');
    await keys.press(textarea, 'Escape', 'Escape', false);
    await setSwitch(item, 'shortcuts', false);
    await keys.press(anchor, '1', '1', false);
  });
  await info.attach('shortcut-runtime-limit.json', {
    body: JSON.stringify(
      {
        alreadyPreventedValidNumericOrEscape:
          'UNVERIFIED runtime: no genuine caller trigger; explicitly accepted source-preservation-only limit.',
        fakePreventionOrEventsUsed: false,
        dispatchedRequestOrOptionObserved: false,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await capturePermission(page, item, 'shortcut-contexts', info);
});

test('inline permission IP6: current options and real unmount remount govern keyboard lifetime', async ({
  page,
}, info) => {
  const item = await openPermission(page);
  await setSwitch(item, 'supply-keyboardShortcutsEnabled', true);
  await setSwitch(item, 'shortcuts', true);
  const anchor = field(item, 'focus-anchor');
  const stableAnchor = await anchor.elementHandle();
  const originalCard = await item.card.elementHandle();
  await disclosure(item).click();
  await withNativeKeys(page, info, async (keys) => {
    await keys.press(anchor, '3', '3', false);
    await apply(item, {
      requestId: 'latest-request',
      title: 'delete_file',
      description: '{"path":"/current/later.txt"}',
      options: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
        { id: 'c', label: 'Current third' },
      ],
    });
    await sameNode(item.card, originalCard);
    await expectQuestion(
      item,
      label('chat_permissionParser_deleteNamed_question', { name: 'later.txt' }),
    );
    await expect(disclosure(item, true)).toBeVisible();
    await keys.press(anchor, '3', '3', true);
    await apply(item, { options: [{ id: 'only', label: 'Only current' }] });
    await keys.press(anchor, '3', '3', false);
    await keys.press(anchor, '1', '1', true);
    // Escape is prevented in source even with no deny/destructive option. No
    // option dispatch can be observed or claimed in this unadmitted runtime.
    await keys.press(anchor, 'Escape', 'Escape', true);
    await apply(item, { options: [] });
    await keys.press(anchor, '1', '1', false);
    await keys.press(anchor, 'Escape', 'Escape', true);
    await apply(item, {
      options: [{ id: 'reject_once', label: 'Current deny', destructive: true }],
    });
    await setSwitch(item, 'mounted', false);
    await expect(item.card).toHaveCount(0);
    await detached(originalCard);
    await sameNode(anchor, stableAnchor);
    await keys.press(anchor, '1', '1', false);
    await keys.press(anchor, 'Escape', 'Escape', false);
    await setSwitch(item, 'mounted', true);
    await expect(item.card).toHaveCount(1);
    await expect(disclosure(item)).toBeVisible();
    await keys.press(anchor, '1', '1', true);
    const remounted = await item.card.elementHandle();
    await disclosure(item).click();
    await field(item, 'remount').click();
    await detached(remounted);
    await remounted.dispose();
    await expect(disclosure(item)).toBeVisible();
    await sameNode(anchor, stableAnchor);
    await keys.press(anchor, '1', '1', true);
    await setSwitch(item, 'shortcuts', false);
    await keys.press(anchor, '1', '1', false);
    await keys.press(anchor, 'Escape', 'Escape', false);
  });
  await stableAnchor.dispose();
  await originalCard.dispose();
  await capturePermission(page, item, 'current-remounted-request', info);
});

test('inline permission IP7: literal raw content and empty or long descriptions follow original rules', async ({
  page,
}, info) => {
  const item = await openPermission(page);
  const raw =
    '<img src="x" onerror="unexpected()"><script>unexpected()</script> "Café 雪" & details';
  await apply(item, { description: raw });
  await disclosure(item).click();
  const rawText = item.card.getByText(raw, { exact: true });
  await expect(rawText).toBeVisible();
  expect(await rawText.textContent()).toBe(raw);
  await expect(item.card.locator('img,script,iframe')).toHaveCount(0);
  await capturePermission(page, item, 'escaped-raw-text', info);
  for (const mode of ['text', 'null', 'undefined']) {
    await apply(item, { description: '', descriptionMode: mode });
    await expect(disclosure(item)).toHaveCount(0);
    await expect(disclosure(item, true)).toHaveCount(0);
    await expect(rawText).toHaveCount(0);
  }
  await apply(item, { descriptionMode: 'text', description: raw });
  await expect(disclosure(item, true)).toBeVisible();
  expect(await item.card.getByText(raw, { exact: true }).textContent()).toBe(raw);
  await disclosure(item, true).click();
  const command80 = 'echo ' + 'x'.repeat(75);
  await apply(item, {
    title: 'launch_process',
    description: JSON.stringify({ command: command80 }),
  });
  await expectDetails(item, command80);
  await apply(item, { description: JSON.stringify({ command: command80 + 'y' }) });
  await expectDetails(item, 'echo ' + 'x'.repeat(72) + '...');
  await disclosure(item).click();
  expect(
    await item.card
      .getByText(JSON.stringify({ command: command80 + 'y' }), { exact: true })
      .textContent(),
  ).toBe(JSON.stringify({ command: command80 + 'y' }));
  await disclosure(item, true).click();
  await apply(item, { title: 'scan_item', description: JSON.stringify({ query: 'q'.repeat(50) }) });
  await expectDetails(item, 'q'.repeat(50));
  await apply(item, { description: JSON.stringify({ query: 'q'.repeat(51) }) });
  await expectDetails(item, 'q'.repeat(47) + '...');
  await capturePermission(page, item, 'source-truncation-boundaries', info);
});

test('inline permission IP8: narrow keyboard controls and local raw-detail scrolling stay usable', async ({
  page,
}, info) => {
  const item = await openPermission(page);
  const raw = 'unbroken-' + 'longdetail'.repeat(150) + ' ' + 'readable details '.repeat(180);
  await apply(item, { description: raw });
  const anchor = field(item, 'editable-anchor');
  const show = disclosure(item);
  const allow = item.card.getByRole('button', { name: /Allow once/ });
  const deny = item.card.getByRole('button', { name: /Deny/ });
  await anchor.press('Tab');
  await expect(show).toBeFocused();
  await show.press('Enter');
  await expect(disclosure(item, true)).toBeFocused();
  await disclosure(item, true).press('Enter');
  await show.press('Tab');
  await expect(allow).toBeFocused();
  await allow.press('Space');
  await expect(allow).toBeFocused();
  await allow.press('Tab');
  await expect(deny).toBeFocused();
  await deny.press('Enter');
  await deny.press('Shift+Tab');
  await expect(allow).toBeFocused();
  for (const [name, control] of [
    ['show', show],
    ['allow', allow],
    ['deny', deny],
  ]) {
    await expectControlContained(item, control, info, `${name}-narrow`);
  }
  await capturePermission(page, item, 'narrow-keyboard-before', info);
  await show.click();
  const rawBox = item.card.getByText(raw, { exact: true });
  const dimensions = await rawBox.evaluate((node) => ({
    width: node.clientWidth,
    height: node.clientHeight,
    scrollWidth: node.scrollWidth,
    scrollHeight: node.scrollHeight,
  }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.width);
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.height);
  await rawBox.hover();
  const pageBefore = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await page.mouse.wheel(250, 80);
  await expect
    .poll(() =>
      rawBox.evaluate((node) => ({
        horizontal: node.scrollLeft > 0,
        vertical: node.scrollTop > 0,
      })),
    )
    .toEqual({ horizontal: true, vertical: true });
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(pageBefore);
  await expectControlContained(item, disclosure(item, true), info, 'hide-after-scroll');
  await expectControlContained(item, allow, info, 'allow-after-scroll');
  await info.attach('raw-scroll-dimensions.json', {
    body: JSON.stringify(dimensions, null, 2),
    contentType: 'application/json',
  });
  await capturePermission(page, item, 'narrow-raw-scrolled', info);
});
