import {
  test,
  expect,
  openContent,
  nav,
  excerpt,
  frame,
  field,
  button,
  toggle,
  observations,
  callback,
  expectLinkCall,
  oracle,
  capture,
  snippetFileButton,
  choose,
} from '../lib/navigation-content.mjs';

test('navigation content NC1: original target admission controls links unresolved text and empty output', async ({
  page,
}, info) => {
  const host = nav(await openContent(page));
  const targetFrame = frame(host, 'navigation-link');
  const source = await oracle(page, info);
  await capture(page, targetFrame, 'admission-before', info);
  await toggle(host, 'Pass navigation label', false);
  const targets = [
    '/settings',
    '/settings#%74heme',
    '/settings#unknown',
    '/settings#%E0%A4%A',
    '/specialists',
    '/workspaces/example',
    '/workspace/example',
    '/workspace/example#unregistered',
    '/agent/example',
    'https://example.com/settings',
    ' intent://local/file/src/example.ts ',
    'intent://',
    '',
  ];
  for (const target of targets) {
    await field(host, 'Navigation target').fill(target);
    const admitted = source.admission(target);
    await expect(targetFrame.getByRole('link')).toHaveCount(admitted ? 1 : 0);
    if (admitted) {
      await expect(targetFrame.getByRole('link')).toHaveAttribute('href', target);
      await expect(targetFrame.getByRole('link')).toHaveAccessibleName(target.trim());
    } else if (target) {
      await targetFrame.getByText(target, { exact: true }).click();
      expect((await observations(host, 'navigation')).callbacks).toEqual([]);
    } else await expect(targetFrame).toBeEmpty();
  }
  await toggle(host, 'Pass navigation label', true);
  await field(host, 'Navigation label').fill('Current unresolved label');
  await expect(targetFrame.getByText('Current unresolved label', { exact: true })).toBeVisible();
  await expect(targetFrame.getByRole('link')).toHaveCount(0);
  await field(host, 'Navigation label').fill('');
  await expect(targetFrame).toBeEmpty();
  await field(host, 'Navigation target').fill('/settings');
  await expect(targetFrame.getByRole('link')).toHaveAccessibleName('/settings');
  await field(host, 'Navigation label').fill('Latest link label');
  await expect(targetFrame.getByRole('link')).toHaveAccessibleName('Latest link label');
  await capture(page, targetFrame, 'admission-current-label', info);
});

test('navigation content NC2: intent pointer callbacks retain native events current options and trimmed targets', async ({
  page,
}, info) => {
  const host = nav(await openContent(page));
  const targetFrame = frame(host, 'navigation-link');
  const target = '  intent://local/file/src/example.ts  ';
  await field(host, 'Navigation target').fill(target);
  await capture(page, targetFrame, 'intent-before', info);
  const child = targetFrame.getByRole('link').getByText('Open local destination', { exact: true });
  for (const modifiers of [[], ['Control'], ['Meta']]) {
    const { record, observations: result } = await callback(host, 'navigation', 'onOpenLink', () =>
      child.click({ modifiers }),
    );
    expectLinkCall(record, {
      target: target.trim(),
      ctrl: modifiers.includes('Control'),
      meta: modifiers.includes('Meta'),
    });
    expect(record.arguments[1].event.currentTarget.rawHref).toBe(target);
    expect(result.counts.onNavigate ?? 0).toBe(0);
    expect(
      result.counts.canOpenFile ?? 0,
      'The source leaf passes the gate; it does not call it',
    ).toBe(0);
  }
  await field(host, 'Navigation workspace ID').fill('catalog-workspace-b');
  await toggle(host, 'Navigation file gate result', false);
  await button(host, 'Replace navigation callbacks').click();
  const changed = await callback(host, 'navigation', 'onOpenLink', () => child.click(), {
    revision: 1,
  });
  expectLinkCall(changed.record, { target: target.trim(), workspace: 'catalog-workspace-b' });
  await toggle(host, 'Pass navigation workspace', false);
  await toggle(host, 'Pass navigation file gate', false);
  await toggle(host, 'Navigation host link result', false);
  const omitted = await callback(host, 'navigation', 'onOpenLink', () => child.click(), {
    revision: 1,
  });
  expectLinkCall(omitted.record, { target: target.trim(), workspace: '[undefined]', gate: false });
  expect(omitted.record.result).toBe(false);
  expect(omitted.observations.counts.onNavigate ?? 0).toBe(0);
  await capture(page, targetFrame, 'intent-current-options', info);
});

test('navigation content NC3: native Enter and platform modifier Enter preserve distinct activation events', async ({
  page,
}, info) => {
  const host = nav(await openContent(page));
  const targetFrame = frame(host, 'navigation-link');
  const target = 'intent://local/note/spec';
  await field(host, 'Navigation target').fill(target);
  const source = await oracle(page, info);
  const platform = await page.evaluate(() => navigator.platform);
  const control = source.platformModifier({ ctrlKey: true, metaKey: false }, platform);
  await button(host, 'Replace navigation callbacks').click();
  const link = targetFrame.getByRole('link');
  for (let count = 0; count < 5; count++) {
    await page.keyboard.press('Tab');
    if (await link.evaluate((node) => document.activeElement === node)) break;
  }
  await expect(link).toBeFocused();
  await capture(page, targetFrame, 'keyboard-focused', info);
  const plain = await callback(host, 'navigation', 'onOpenLink', () => link.press('Enter'), {
    revision: 1,
  });
  expectLinkCall(plain.record, { target, detail: 0, phase: 2 });
  const modified = await callback(
    host,
    'navigation',
    'onOpenLink',
    () => link.press(control ? 'Control+Enter' : 'Meta+Enter'),
    { revision: 1 },
  );
  expectLinkCall(modified.record, {
    target,
    type: 'keydown',
    ctrl: control,
    meta: !control,
    phase: 2,
  });
  expect(modified.observations.counts.onOpenLink).toBe(2);
  expect(modified.observations.counts.onNavigate ?? 0).toBe(0);
  await capture(page, targetFrame, 'keyboard-after', info);
});

test('navigation content NC4: routes call the current required host with the raw target', async ({
  page,
}, info) => {
  const host = nav(await openContent(page));
  const targetFrame = frame(host, 'navigation-link');
  const url = page.url();
  await capture(page, targetFrame, 'route-before', info);
  const first = '  /workspace/first  ';
  await field(host, 'Navigation target').fill(first);
  const link = targetFrame.getByRole('link');
  const handle = await link.elementHandle();
  try {
    const pointer = await callback(host, 'navigation', 'onNavigate', () => link.click());
    expect(pointer.record.argumentCount).toBe(1);
    expect(pointer.record.arguments).toEqual([first]);
    await field(host, 'Navigation target').fill('/agent/latest');
    await field(host, 'Navigation label').fill('Current route label');
    await button(host, 'Replace navigation callbacks').click();
    const key = await callback(host, 'navigation', 'onNavigate', () => link.press('Enter'), {
      revision: 1,
    });
    expect(key.record.arguments).toEqual(['/agent/latest']);
    expect(key.observations.counts.onOpenLink ?? 0).toBe(0);
    expect(await handle.evaluate((node) => node.isConnected)).toBe(true);
    expect(await link.evaluate((node, old) => node === old, handle)).toBe(true);
    expect(page.url()).toBe(url);
    await capture(page, targetFrame, 'route-current', info);
  } finally {
    await handle.dispose();
  }
});

test('navigation content NC7: code paths retain original colon display quirks and full callback paths', async ({
  page,
}, info) => {
  const host = excerpt(await openContent(page));
  const targetFrame = frame(host, 'code-excerpt');
  const file = snippetFileButton(host);
  await expect(file).toHaveCount(1);
  await capture(page, targetFrame, 'paths-before', info);
  const samples = [
    ['src/example.ts:10-20', 'example.ts', ':10-20'],
    ['src/example.ts:10-20:ignored', 'example.ts', ':10-20'],
    ['src/example.ts::trailing', 'example.ts', null],
    ['C:\\work\\example.ts:15', 'C', ':\\work\\example.ts'],
    ['src/plain.ts', 'plain.ts', null],
  ];
  for (const [path, basename, range] of samples) {
    await field(host, 'Excerpt path').fill(path);
    await expect(file.getByText(basename, { exact: true })).toBeVisible();
    if (range) await expect(file.getByText(range, { exact: true })).toBeVisible();
    else await expect(file).toHaveText(basename);
    const { record } = await callback(host, 'excerpt', 'onOpenFile', () => file.click());
    expect(record.argumentCount).toBe(1);
    expect(record.arguments).toEqual([
      { path, openInAdjacentPanel: false, sourcePanelId: 'catalog-inner-panel' },
    ]);
  }
  await field(host, 'Excerpt path').fill('');
  const before = await observations(host, 'excerpt');
  await file.press('Enter');
  expect((await observations(host, 'excerpt')).callbacks).toEqual(before.callbacks);
  await capture(page, targetFrame, 'paths-empty', info);
});

test('navigation content NC8: excerpt native modifiers and keyboard use the nearest actual panel', async ({
  page,
}, info) => {
  const host = excerpt(await openContent(page));
  const targetFrame = frame(host, 'code-excerpt');
  const file = snippetFileButton(host);
  await capture(page, targetFrame, 'panel-before', info);
  for (const modifiers of [[], ['Control'], ['Meta']]) {
    const { record } = await callback(host, 'excerpt', 'onOpenFile', () =>
      file.getByText('example.ts', { exact: true }).click({ modifiers }),
    );
    expect(record.arguments).toEqual([
      {
        path: 'src/example.ts:10-20',
        openInAdjacentPanel: modifiers.length > 0,
        sourcePanelId: 'catalog-inner-panel',
      },
    ]);
    expect(record.lastCapturedEvent).toMatchObject({
      kind: 'native',
      type: 'click',
      isTrusted: true,
      ctrlKey: modifiers.includes('Control'),
      metaKey: modifiers.includes('Meta'),
      target: { tag: 'SPAN', closestPanel: 'catalog-inner-panel' },
    });
  }
  await choose(host, 'Excerpt panel ancestry', 'outer');
  const outer = await callback(host, 'excerpt', 'onOpenFile', () => file.press('Enter'));
  expect(outer.record.arguments).toEqual([
    {
      path: 'src/example.ts:10-20',
      openInAdjacentPanel: false,
      sourcePanelId: 'catalog-outer-panel',
    },
  ]);
  expect(outer.record.lastCapturedEvent).toMatchObject({
    type: 'click',
    isTrusted: true,
    detail: 0,
  });
  await choose(host, 'Excerpt panel ancestry', 'none');
  expect(await file.evaluate((node) => node.closest('[data-panel-id]') === null)).toBe(true);
  const absent = await callback(host, 'excerpt', 'onOpenFile', () => file.press('Space'));
  expect(absent.record.arguments).toEqual([
    { path: 'src/example.ts:10-20', openInAdjacentPanel: false, sourcePanelId: '[undefined]' },
  ]);
  await capture(page, targetFrame, 'panel-absent', info);
});
