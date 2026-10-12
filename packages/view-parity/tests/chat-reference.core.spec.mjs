import {
  test,
  expect,
  openReference,
  captureReference,
  exercise,
  field,
  button,
  choose,
  toggle,
  expectCode,
  clipboardPermission,
  nativeCopy,
  openCallback,
  expectOpen,
  expectSourceIcon,
  chipObservations,
  chipCallback,
  nativeEvent,
  clearChip,
} from '../lib/chat-reference.mjs';

test('chat reference R1: current and latest code remain literal through genuine asynchronous highlighting', async ({
  page,
}, info) => {
  const item = exercise(await openReference(page), 'code');
  await captureReference(page, item.frame, 'current-before', info);
  const originalCode = await item.leaf.locator('code').elementHandle();
  try {
    const input = field(item.section, 'Code');
    const escaped =
      '<section data-literal="& quotes">\n<script>window.unwanted = true</script>\n</section>\n';
    await field(item.section, 'Code language').fill('plaintext');
    await input.fill(escaped);
    await expectCode(item.leaf, escaped);
    await captureReference(page, item.frame, 'literal-markup', info);
    // Ordinary successive caller updates. Never replace idle callbacks, clocks,
    // caches or highlighter promises to manufacture an async ordering.
    await field(item.section, 'Code language').fill('javascript');
    await input.fill('const previous = "superseded content";');
    const latest = 'const latest = "current 日本語 & <text>";\nconsole.log(latest);';
    await input.fill(latest);
    await expectCode(item.leaf, latest);
    await expect.poll(() => item.leaf.locator('code span').count()).toBeGreaterThan(0);
    await captureReference(page, item.frame, 'latest-after-highlight', info);
    await expectCode(item.leaf, latest);
    // Language is an input identity too; a real re-highlight keeps current text.
    await field(item.section, 'Code language').fill('plaintext');
    await expectCode(item.leaf, latest);
    await captureReference(page, item.frame, 'latest-plaintext', info);
    expect(await originalCode.evaluate((node) => node.isConnected)).toBe(true);
    expect(
      await originalCode.evaluate((node) => [...node.children].map((row) => row.textContent)),
    ).toEqual(latest.split('\n'));
  } finally {
    await originalCode.dispose();
  }
});

test('chat reference R2: real clipboard copies changed empty and full source without line numbers', async ({
  page,
  context,
}, info) => {
  await clipboardPermission(context);
  const item = exercise(await openReference(page), 'code');
  const paste = field(item.section, 'Paste copied code');
  await captureReference(page, item.frame, 'clipboard-before', info);
  const samples = [
    'const changed = "✓ & <literal>";\n\nconsole.log(changed);\n',
    '',
    `const full = "${'unbroken-source-'.repeat(60)}雪";\nconsole.log(full);`,
  ];
  for (let index = 0; index < samples.length; index++) {
    await field(item.section, 'Code').fill(samples[index]);
    await expectCode(item.leaf, samples[index]);
    await nativeCopy(page, item.leaf, paste, samples[index], [undefined, 'Enter', 'Space'][index]);
  }
  await captureReference(page, item.frame, 'clipboard-full-after', info);
});

test('chat reference R5: path priority line anchors zero and literal hashes produce exact targets', async ({
  page,
}, info) => {
  const item = exercise(await openReference(page), 'block');
  await captureReference(page, item.frame, 'targets-before', info);
  const callbacks = [];
  const cases = [
    ['src/zero.ts#L0', '', 'src/zero.ts', 1],
    ['src/range.ts#L7-9', '', 'src/range.ts', 7],
    ['src/literal#name.ts', '', 'src/literal#name.ts', undefined],
    ['src/example.ts#symbol:Thing', '', 'src/example.ts#symbol:Thing', undefined],
    ['', 'src/semantic.ts#L23-25', 'src/semantic.ts', 23],
    ['', 'src/semantic.ts#symbol:Thing', 'src/semantic.ts', undefined],
    ['src/explicit.ts#L7-9', 'src/semantic.ts#L23-25', 'src/explicit.ts', 7],
    ['src/explicit.ts', 'src/semantic.ts#L23-25', 'src/explicit.ts', 23],
  ];
  for (const [filePath, semanticId, path, line] of cases) {
    await field(item.section, 'Reference file path').fill(filePath);
    await field(item.section, 'Reference semantic ID').fill(semanticId);
    await item.leaf.getByRole('button').click();
    callbacks.push(openCallback(path, line));
    await expectOpen(item, callbacks);
  }
  await captureReference(page, item.frame, 'targets-after', info);
});

test('chat reference R6: trusted Ctrl and Meta clicks report the nearest actual panel', async ({
  page,
}, info) => {
  const item = exercise(await openReference(page), 'block');
  await captureReference(page, item.frame, 'panels-before', info);
  await field(item.section, 'Enclosing panel ID, blank for none').fill('outer-real');
  await field(item.section, 'Nested panel ID, blank for none').fill('inner-real');
  const callbacks = [];
  const events = [];
  const target = item.leaf.getByRole('button');
  const label = await target.textContent();
  for (const modifiers of [[], ['Control'], ['Meta']]) {
    // Click the actual nested text, so closest() starts below the button.
    await target.getByText('example.ts', { exact: true }).click({ modifiers });
    callbacks.push(
      openCallback('src/example.ts', 7, { panelId: 'inner-real', adjacent: !!modifiers.length }),
    );
    events.push(
      nativeEvent('click', label, {
        panelId: 'inner-real',
        ctrlKey: modifiers.includes('Control'),
        metaKey: modifiers.includes('Meta'),
      }),
    );
    await expectOpen(item, callbacks);
    await expect.poll(async () => (await item.state()).observations.captureEvents).toEqual(events);
  }
  await field(item.section, 'Nested panel ID, blank for none').fill('');
  await target.press('Enter');
  callbacks.push(openCallback('src/example.ts', 7, { panelId: 'outer-real' }));
  await expectOpen(item, callbacks);
  await field(item.section, 'Enclosing panel ID, blank for none').fill('');
  expect(await target.evaluate((node) => node.closest('[data-panel-id]'))).toBeNull();
  await target.press('Space');
  callbacks.push({
    revision: 0,
    args: [{ path: 'src/example.ts', line: 7, openInAdjacentPanel: false }],
  });
  await expectOpen(item, callbacks);
  await captureReference(page, item.frame, 'panels-absent-after', info);
});

test('chat reference R8: all ordinary chip types render the original mapped SVG without extra AX names', async ({
  page,
}, info) => {
  const item = exercise(await openReference(page), 'chip');
  await captureReference(page, item.frame, 'ordinary-icons-before', info);
  // Source ContextChip and original FaWrapper mapping independently define
  // these choices. Memory/personality intentionally use the default file icon.
  const cases = [
    ['file', 'file-lines'],
    ['diff', 'code-branch'],
    ['note', 'note-sticky'],
    ['spec', 'clipboard'],
    ['selection', 'i-cursor'],
    ['folder', 'folder'],
    ['workspace', 'folder'],
    ['memory', 'file-lines'],
    ['personality', 'file-lines'],
    ['linear', 'ticket'],
    ['github', 'code-pull-request'],
    ['sentry', 'bug'],
    ['external', 'link'],
  ];
  for (const [type, icon] of cases) {
    await choose(item.section, 'Context type', type);
    await expectSourceIcon(item, icon, info);
    await expect(item.leaf.getByRole('button', { name: 'example.ts', exact: true })).toBeEnabled();
  }
  await captureReference(page, item.frame, 'ordinary-icons-after', info);
});

test('chat reference R11: clickable and static removal preserve distinct native event isolation', async ({
  page,
}, info) => {
  const item = exercise(await openReference(page), 'chip');
  await captureReference(page, item.frame, 'pointer-before', info);
  // Positive observer control: native events reach the genuine neutral parent.
  await item.leaf.getByText('Parent observation area', { exact: true }).click();
  await expect
    .poll(() => chipObservations(item))
    .toEqual({
      callbacks: [],
      parentClicks: [nativeEvent('click', null)],
      parentPointerDowns: [nativeEvent('pointerdown', null)],
    });
  await clearChip(item);
  await button(item.leaf, 'example.ts').click();
  await item.leaf.hover();
  await button(item.leaf, 'Remove').click();
  await expect
    .poll(() => chipObservations(item))
    .toEqual({
      callbacks: [chipCallback('click', 'example.ts'), chipCallback('remove', 'example.ts')],
      parentClicks: [nativeEvent('click', 'example.ts')],
      parentPointerDowns: [
        nativeEvent('pointerdown', 'example.ts'),
        nativeEvent('pointerdown', 'Remove'),
      ],
    });
  await toggle(item.section, 'Clickable chip', false);
  await clearChip(item);
  await item.leaf.hover();
  await button(item.leaf, 'Remove').click();
  await expect
    .poll(() => chipObservations(item))
    .toEqual({
      callbacks: [chipCallback('remove', 'example.ts')],
      parentClicks: [nativeEvent('click', 'Remove')],
      parentPointerDowns: [nativeEvent('pointerdown', 'Remove')],
    });
  await toggle(item.section, 'Removable chip', false);
  await expect(item.leaf.getByRole('button')).toHaveCount(0);
  await captureReference(page, item.frame, 'pointer-static-after', info);
});
