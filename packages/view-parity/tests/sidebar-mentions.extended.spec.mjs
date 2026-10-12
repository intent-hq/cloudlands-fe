import {
  test,
  expect,
  openLeafExample,
  outputJson,
  captureLeaf,
  expectContained,
  chooseProp,
  expectActive,
  expectIdentities,
} from '../lib/sidebar-mentions.mjs';

test('sidebar mentions S5: external query updates preserve header toolbar and files containment', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'sidebar-actions', 'sidebar-actions');
  const surface = host.getByTestId('sidebar-search-host');
  const input = surface.getByRole('searchbox');
  await captureLeaf(page, surface, 'external-before', info);
  await host
    .getByRole('textbox', { name: 'External query prop', exact: true })
    .fill('external controlled value');
  await host.getByRole('button', { name: 'Apply external query', exact: true }).click();
  await expect(input).toHaveValue('external controlled value');
  await expectContained(input, surface);
  await expectContained(surface.locator('[data-sidebar-search-clear]'), surface);
  await expectContained(surface.locator('[data-changes-refresh]'), surface);
  await host.getByRole('button', { name: 'Clear external query', exact: true }).click();
  // A parent clearing an expanded search does not itself collapse it.
  await expect(input).toHaveValue('');
  await host
    .getByRole('textbox', { name: 'External query prop', exact: true })
    .fill('updated from parent');
  await host.getByRole('button', { name: 'Apply external query', exact: true }).click();
  await expect(input).toHaveValue('updated from parent');
  const scope = host.getByRole('radiogroup', { name: 'Search scope', exact: true });
  const placement = host.getByRole('radiogroup', { name: 'Search placement', exact: true });
  for (const [nextScope, nextPlacement] of [
    ['context', 'header'],
    ['files', 'toolbar'],
  ]) {
    await scope.getByRole('radio', { name: nextScope, exact: true }).click();
    await placement.getByRole('radio', { name: nextPlacement, exact: true }).click();
    await expect(input).toHaveValue('updated from parent');
    await expect(input).toHaveAttribute('data-sidebar-search-input', nextScope);
    await expectContained(input, surface);
    await expectContained(surface.locator('[data-sidebar-search-clear]'), surface);
    await expectContained(surface.locator('[data-changes-refresh]'), surface);
    const box = await surface.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(420);
    await captureLeaf(page, surface, `external-${nextScope}-${nextPlacement}`, info);
  }
});

test('sidebar mentions M3: genuine pointer entry respects the movement gate', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'mention-navigation', 'mention-navigation');
  const exercise = host.getByTestId('mention-exercise');
  await chooseProp(page, exercise, 'Mention list props', 'flat');
  await page.mouse.move(0, 0);
  const input = exercise.getByRole('combobox', { name: 'Filter mentions', exact: true });
  await input.press('ArrowDown');
  const note = exercise.getByRole('option', { name: 'Flat note', exact: true });
  await expectActive(exercise, 'mention', note);
  await captureLeaf(page, exercise.getByTestId('mention-list-display'), 'pointer-before', info);
  const task = exercise.getByRole('option', { name: 'Flat task', exact: true });
  const box = await task.boundingBox();
  expect(box).not.toBeNull();
  // One actual move: mouseenter precedes mousemove, so the first entry is ignored.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expectActive(exercise, 'mention', note);
  const file = exercise.getByRole('option', { name: 'Flat file', exact: true });
  await file.hover();
  await expectActive(exercise, 'mention', file);
  await task.hover();
  await expectActive(exercise, 'mention', task);
  await task.click();
  await expect(input).toBeFocused();
  await expect
    .poll(async () => (await outputJson(exercise.getByTestId('mention-callback-state'))).selections)
    .toEqual([
      {
        id: 'flat-task',
        type: 'task',
        label: 'Flat task',
        uri: 'devspace://task/flat-task',
      },
    ]);
  await expectIdentities(exercise, 'mention', 1);
  await captureLeaf(page, exercise.getByTestId('mention-list-display'), 'pointer-after', info);
});

test('sidebar mentions M4: loading empty replacement and ref lifetime follow source behavior', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'mention-navigation', 'mention-navigation');
  const exercise = host.getByTestId('mention-exercise');
  const input = exercise.getByRole('combobox', { name: 'Filter mentions', exact: true });
  const state = () => outputJson(exercise.getByTestId('mention-callback-state'));
  const display = exercise.getByTestId('mention-list-display');
  await captureLeaf(page, display, 'props-before', info);
  await input.fill('no-such-result');
  await expect(exercise.getByRole('option')).toHaveCount(0);
  await expect.poll(async () => (await state()).activeOption).toBeNull();
  await input.press('ArrowUp');
  await input.press('Enter');
  expect((await state()).selections).toEqual([]);
  await captureLeaf(page, display, 'props-empty', info);
  await exercise.getByRole('switch', { name: 'Loading mentions', exact: true }).click();
  await input.press('Enter');
  expect((await state()).selections).toEqual([]);
  await captureLeaf(page, display, 'props-loading', info);
  await input.fill('service');
  await expect(exercise.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
  // Unlike the skill list, source EnhancedMentionList permits loaded rows while busy.
  await input.press('Enter');
  await expect
    .poll(async () => (await state()).selections.map((item) => item.id))
    .toEqual(['script-development']);
  await exercise.getByRole('switch', { name: 'Loading mentions', exact: true }).click();
  await exercise.getByRole('button', { name: 'Clear mention query', exact: true }).click();
  await input.press('ArrowDown');
  await exercise.getByRole('button', { name: 'Replace mention props', exact: true }).click();
  const replacement = exercise.getByRole('option', { name: 'Replacement note', exact: true });
  const oldId = await expectActive(exercise, 'mention', replacement);
  await input.press('Enter');
  const expected = {
    id: 'replacement-note',
    type: 'note',
    label: 'Replacement note',
    uri: 'devspace://note/replacement-note',
  };
  expect((await state()).selections.at(-1)).toEqual(expected);
  await exercise.getByRole('switch', { name: 'Mount mention list', exact: true }).click();
  await expect(exercise.getByRole('listbox')).toHaveCount(0);
  await input.press('Enter');
  expect((await state()).keys.at(-1)).toEqual({
    key: 'Enter',
    handled: false,
    defaultPrevented: false,
    native: true,
    refPresent: false,
  });
  expect((await state()).selections).toHaveLength(2);
  await exercise.getByRole('button', { name: 'Remount mentions', exact: true }).click();
  const newId = await expectActive(exercise, 'mention', replacement);
  expect(newId).not.toBe(oldId);
  await input.press('Enter');
  expect((await state()).selections.slice(1)).toEqual([expected, expected]);
  await expectIdentities(exercise, 'mention', 3);
  expect((await state()).keys.at(-1)).toEqual({
    key: 'Enter',
    handled: true,
    defaultPrevented: true,
    native: true,
    refPresent: true,
  });
  await captureLeaf(page, display, 'props-after', info);
});

test('sidebar mentions M5: keyboard wrap scrolls the last real row into view', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'mention-navigation', 'mention-navigation');
  const exercise = host.getByTestId('mention-exercise');
  await chooseProp(page, exercise, 'Mention list props', 'many');
  const list = exercise.getByTestId('mention-list-display');
  const input = exercise.getByRole('combobox', { name: 'Filter mentions', exact: true });
  await expect(exercise.getByRole('option')).toHaveCount(24);
  await captureLeaf(page, list, 'wrap-before', info);
  await input.press('ArrowUp');
  const last = exercise.getByRole('option', { name: 'developer-module-23.ts', exact: true });
  await expectActive(exercise, 'mention', last);
  await expect
    .poll(() =>
      last.evaluate((row) => {
        const list = row.closest('[role="listbox"]');
        const bounds = row.getBoundingClientRect();
        const outer = list.getBoundingClientRect();
        return bounds.top >= outer.top && bounds.bottom <= outer.bottom;
      }),
    )
    .toBe(true);
  await input.press('Enter');
  await expect
    .poll(async () =>
      (await outputJson(exercise.getByTestId('mention-callback-state'))).selections.map(
        (item) => item.id,
      ),
    )
    .toEqual(['file-23']);
  await expectIdentities(exercise, 'mention', 1);
  await captureLeaf(page, list, 'wrap-after', info);
  await input.press('ArrowDown');
  await expectActive(exercise, 'mention', exercise.getByRole('option').first());
});

test('sidebar mentions K2: skill loading error retry empty and reset remain distinct', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'mention-navigation', 'mention-navigation');
  const exercise = host.getByTestId('skill-exercise');
  const input = exercise.getByRole('combobox', { name: 'Filter skills', exact: true });
  const state = () => outputJson(exercise.getByTestId('skill-callback-state'));
  await input.press('ArrowDown');
  await expectActive(
    exercise,
    'skill',
    exercise.getByRole('option', { name: 'fixture-plan', exact: true }),
  );
  const display = exercise.getByTestId('skill-list-display');
  await captureLeaf(page, display, 'skill-states-before', info);
  for (const mode of ['loading', 'error', 'empty']) {
    await chooseProp(page, exercise, 'Skill list props', mode);
    await expect(exercise.getByRole('listbox')).toHaveCount(0);
    await expect.poll(async () => (await state()).activeOption).toBeNull();
    await input.press('ArrowDown');
    await input.press('Enter');
    expect((await state()).selections).toEqual([]);
    expect((await state()).keys.slice(-2)).toEqual(
      ['ArrowDown', 'Enter'].map((key) => ({
        key,
        handled: false,
        defaultPrevented: false,
        native: true,
        refPresent: true,
      })),
    );
    await captureLeaf(page, display, `skill-state-${mode}`, info);
    if (mode === 'error') {
      await expect(exercise.getByRole('alert')).toBeVisible();
      await exercise.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect.poll(async () => (await state()).retryCallbacks).toBe(1);
      await expectActive(
        exercise,
        'skill',
        exercise.getByRole('option', { name: 'fixture-review', exact: true }),
      );
    }
  }
  await chooseProp(page, exercise, 'Skill list props', 'ready');
  await expectActive(
    exercise,
    'skill',
    exercise.getByRole('option', { name: 'fixture-review', exact: true }),
  );
  await input.fill('plan');
  await input.press('Enter');
  await expect
    .poll(async () => (await state()).selections.map((item) => item.name))
    .toEqual(['fixture-plan']);
  await expectIdentities(exercise, 'skill', 1);
  await input.fill('');
  await expectActive(
    exercise,
    'skill',
    exercise.getByRole('option', { name: 'fixture-review', exact: true }),
  );
  await captureLeaf(page, display, 'skill-states-after', info);
  await chooseProp(page, exercise, 'Skill list props', 'loading');
  await input.press('Escape');
  await expect.poll(async () => (await state()).dismissCallbacks).toBe(1);
  await expect(input).toBeFocused();
});

test('sidebar mentions B1: absent-session avatar and changing badge props retain native accessibility', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'mention-navigation', 'mention-navigation');
  const leaves = host.getByTestId('mention-agent-leaves');
  const avatar = leaves.locator('[data-agent-avatar-with-state]');
  await expect(avatar).toHaveAccessibleName('Idle');
  await expect(leaves.getByLabel('1 unread response', { exact: true })).toBeVisible();
  const display = leaves.getByTestId('agent-leaf-display');
  await captureLeaf(page, display, 'badge-before', info);
  for (const [count, label] of [
    ['2', '2 unread responses'],
    ['1000', '1,000 unread responses'],
  ]) {
    await chooseProp(page, leaves, 'Badge count prop', count);
    const badge = leaves.getByLabel(label, { exact: true });
    await expect(badge).toBeVisible();
    // Observe native animation state. Never change the clock, CSS or animation.
    await expect
      .poll(() =>
        badge.evaluate(
          (node) =>
            node
              .getAnimations()
              .filter((animation) => animation.playState === 'running' || animation.pending).length,
        ),
      )
      .toBe(0);
    await info.attach(`badge-${count}-ax.txt`, {
      body: await display.ariaSnapshot(),
      contentType: 'text/plain',
    });
  }
  await chooseProp(page, leaves, 'Badge count prop', '0');
  await expect(leaves.locator('[aria-label$="unread responses"]')).toHaveCount(0);
  await expect(avatar).toHaveAccessibleName('Idle');
  await leaves.getByRole('switch', { name: 'Mount agent leaves', exact: true }).click();
  await expect(avatar).toHaveCount(0);
  await leaves.getByRole('switch', { name: 'Mount agent leaves', exact: true }).click();
  await expect(avatar).toHaveAccessibleName('Idle');
  await chooseProp(page, leaves, 'Badge count prop', '1');
  await expect(leaves.getByLabel('1 unread response', { exact: true })).toBeVisible();
  await captureLeaf(page, display, 'badge-after', info);
});

test('sidebar mentions S6: unmount releases search Escape and header refs before remount', async ({
  page,
}, info) => {
  const host = await openLeafExample(page, 'sidebar-actions', 'sidebar-actions');
  const open = host.getByRole('button', { name: 'Open sidebar dialog', exact: true });
  const state = () => outputJson(host.getByTestId('sidebar-callback-state'));
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Sidebar search parent', exact: true });
  const surface = dialog.getByTestId('sidebar-search-host');
  await surface.locator('[data-sidebar-action="search"]').press('Enter');
  await surface.getByRole('searchbox').pressSequentially('retained');
  await captureLeaf(page, surface, 'disposal-before', info);
  const mount = dialog.getByRole('switch', { name: 'Mount sidebar leaves', exact: true });
  await mount.click();
  await expect(dialog.getByTestId('sidebar-leaves')).toHaveCount(0);
  await expect
    .poll(async () =>
      (await state()).callbacks.filter((entry) => entry.callback === 'header-ref').at(-1),
    )
    .toEqual({ callback: 'header-ref', attached: false });
  const queryCount = (await state()).callbacks.filter((entry) => entry.callback === 'query').length;
  await mount.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  expect((await state()).callbacks.filter((entry) => entry.callback === 'query')).toHaveLength(
    queryCount,
  );
  await open.click();
  await dialog.getByRole('switch', { name: 'Mount sidebar leaves', exact: true }).click();
  const input = dialog.getByRole('searchbox');
  await expect(input).toHaveValue('retained');
  await expect
    .poll(async () =>
      (await state()).callbacks.filter((entry) => entry.callback === 'header-ref').at(-1),
    )
    .toEqual({ callback: 'header-ref', attached: true });
  await input.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(input).toHaveCount(0);
  await captureLeaf(page, surface, 'disposal-after', info);
  await surface.locator('[data-sidebar-action="search"]').press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () =>
      (await state()).callbacks.filter((entry) => entry.callback === 'dialog-close'),
    )
    .toHaveLength(2);
});
