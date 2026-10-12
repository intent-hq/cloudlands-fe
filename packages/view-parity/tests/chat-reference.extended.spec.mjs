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
  expectNumberedRows,
  lineGeometry,
  openCallback,
  expectOpen,
  expectSourceIcon,
  overflowLabel,
  expectHit,
  chipCallback,
  expectChipCallbacks,
  clearChip,
} from '../lib/chat-reference.mjs';

test('chat reference R3: numbered and highlighted lines stay readable across actual light and dark themes', async ({
  page,
}, info) => {
  const item = exercise(await openReference(page), 'code');
  await captureReference(page, item.frame, 'lines-before', info);
  const text = 'const first = "alpha";\n\nconsole.log(first);';
  await field(item.section, 'Code').fill(text);
  await field(item.section, 'Start line number').fill('7');
  await field(item.section, 'Highlight lines, comma separated').fill('8,9');
  await expectCode(item.leaf, text);
  await expectNumberedRows(item.leaf, [7, 8, 9], info, 'light-highlight');
  await captureReference(page, item.frame, 'light-highlight', info);
  await toggle(item.section, 'Show line numbers', false);
  expect((await lineGeometry(item.leaf, info, 'numbers-hidden')).numbers).toEqual([]);
  await expectCode(item.leaf, text);
  await toggle(item.section, 'Show line numbers', true);
  await toggle(item.section, 'No border', true);
  await toggle(item.section, 'No margin', true);
  const customize = page.getByRole('button', { name: 'Customize preview', exact: true });
  await customize.click();
  await expect(customize).toHaveAttribute('aria-expanded', 'true');
  await page
    .getByTestId('catalog-theme-control')
    .getByRole('radio', { name: 'Dark', exact: true })
    .click();
  await expect(page.getByTestId('catalog-shell')).toHaveAttribute('data-catalog-theme', 'dark');
  await customize.click();
  await expect(customize).toHaveAttribute('aria-expanded', 'false');
  await expectNumberedRows(item.leaf, [7, 8, 9], info, 'dark-highlight');
  await expectCode(item.leaf, text);
  await captureReference(page, item.frame, 'dark-highlight', info);
  await field(item.section, 'Highlight lines, comma separated').fill('');
  await captureReference(page, item.frame, 'dark-without-highlight', info);
  // Highlight colors and palette are inspected in retained screenshots. These
  // text/geometry checks do not pretend to establish source-paired appearance.
});

test('chat reference R4: native scrolling and code unmount remount preserve current content and copy ownership', async ({
  page,
  context,
}, info) => {
  await clipboardPermission(context);
  const item = exercise(await openReference(page), 'code');
  await captureReference(page, item.frame, 'lifetime-before', info);
  const long = `const long = "${'horizontal-content-'.repeat(45)}";`;
  await field(item.section, 'Code').fill(long);
  await expectCode(item.leaf, long);
  const horizontal = item.leaf.locator('pre').locator('..');
  await horizontal.scrollIntoViewIfNeeded();
  const box = await horizontal.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(700, 0);
  await expect.poll(() => horizontal.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await captureReference(page, item.frame, 'native-horizontal-scroll', info);
  const multiline = Array.from(
    { length: 24 },
    (_, index) => `console.log("record ${index + 1}");`,
  ).join('\n');
  await field(item.section, 'Code').fill(multiline);
  await field(item.section, 'Maximum code height, blank for none').fill('120');
  await expectCode(item.leaf, multiline);
  const container = item.leaf.locator(':scope > div');
  await container.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => container.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await captureReference(page, item.frame, 'native-vertical-scroll', info);
  await page.mouse.wheel(0, -1000);
  await expect.poll(() => container.evaluate((node) => node.scrollTop)).toBe(0);
  await expectHit(
    page,
    item.leaf.getByRole('button', { name: 'Copy', exact: true }),
    item.frame,
    info,
    'copy-after-scroll',
  );
  await nativeCopy(page, item.leaf, field(item.section, 'Paste copied code'), multiline);
  const old = await item.leaf.locator('code').elementHandle();
  try {
    // Real pending feedback is disposed with the owner; no timer manipulation.
    await item.leaf.hover();
    await item.leaf.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(item.leaf.getByRole('button', { name: 'Copied!', exact: true })).toBeVisible();
    await field(item.section, 'Code').fill('const departing = "new input before unmount";');
    await toggle(item.section, 'Mount Code block', false);
    await expect(item.leaf).toHaveCount(0);
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    const latest = 'const remounted = "only the current input";\n';
    await field(item.section, 'Code').fill(latest);
    await field(item.section, 'Code language').fill('javascript');
    await captureReference(page, item.frame, 'code-unmounted', info);
    await toggle(item.section, 'Mount Code block', true);
    await expectCode(item.leaf, latest);
    await expect(item.leaf.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(1);
    await nativeCopy(page, item.leaf, field(item.section, 'Paste copied code'), latest, 'Enter');
    const mounted = await item.leaf.locator('code').elementHandle();
    try {
      await button(item.section, 'Remount Code block').click();
      expect(await mounted.evaluate((node) => node.isConnected)).toBe(false);
    } finally {
      await mounted.dispose();
    }
    await expectCode(item.leaf, latest);
    await nativeCopy(page, item.leaf, field(item.section, 'Paste copied code'), latest, 'Space');
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await captureReference(page, item.frame, 'code-remounted-after', info);
  } finally {
    await old.dispose();
  }
});

test('chat reference R7: current reference callbacks static branches and real snapshot consumer survive lifetime changes', async ({
  page,
  context,
}, info) => {
  await clipboardPermission(context);
  const item = exercise(await openReference(page), 'block');
  await captureReference(page, item.frame, 'reference-lifetime-before', info);
  const callbacks = [];
  await item.leaf.getByRole('button').press('Enter');
  callbacks.push(openCallback('src/example.ts', 7));
  await expectOpen(item, callbacks);
  const old = await item.leaf.getByRole('button').elementHandle();
  try {
    await button(item.section, 'Replace reference callback').click();
    await field(item.section, 'Reference file path').fill('src/current.ts#L0');
    await item.leaf.getByRole('button').press('Space');
    callbacks.push(openCallback('src/current.ts', 1, { revision: 1 }));
    await expectOpen(item, callbacks);
    expect(await old.evaluate((node) => node.isConnected)).toBe(true);
    await toggle(item.section, 'Include open callback', false);
    await expect(item.leaf.getByRole('button')).toHaveCount(0);
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await item.leaf.getByText('current.ts', { exact: true }).click();
    await expectOpen(item, callbacks);
    await toggle(item.section, 'Include snapshot', true);
    const snapshot = 'const snapshot = "<literal> & 雪";\n\nconsole.log(snapshot);';
    await field(item.section, 'Snapshot code').fill(snapshot);
    await field(item.section, 'Snapshot language').fill('');
    await expectCode(item.leaf, snapshot);
    await expectNumberedRows(item.leaf, [1, 2, 3], info, 'static-snapshot');
    await nativeCopy(page, item.leaf, field(item.section, 'Paste copied snapshot'), snapshot);
    await expectOpen(item, callbacks);
    await captureReference(page, item.frame, 'static-snapshot', info);
    await field(item.section, 'Snapshot code').fill('');
    await expect(item.leaf.locator('code')).toHaveCount(0);
    await expect(item.leaf.getByRole('button')).toHaveCount(0);
    await toggle(item.section, 'Include open callback', true);
    await field(item.section, 'Reference file path').fill('');
    await field(item.section, 'Reference semantic ID').fill('');
    await expect(item.leaf.getByRole('button')).toHaveCount(0);
    await toggle(item.section, 'Mount File reference', false);
    await button(item.section, 'Replace reference callback').click();
    await field(item.section, 'Reference file path').fill('src/remounted.ts#L7-9');
    await toggle(item.section, 'Mount File reference', true);
    await item.leaf.getByRole('button').press('Enter');
    callbacks.push(openCallback('src/remounted.ts', 7, { revision: 2 }));
    await expectOpen(item, callbacks);
    await button(item.section, 'Remount File reference').click();
    await item.leaf.getByRole('button').press('Space');
    callbacks.push(openCallback('src/remounted.ts', 7, { revision: 2 }));
    await expectOpen(item, callbacks);
    await captureReference(page, item.frame, 'reference-lifetime-after', info);
  } finally {
    await old.dispose();
  }
});

test('chat reference R9: custom known brand and unknown icons use the original adapter artwork', async ({
  page,
}, info) => {
  const item = exercise(await openReference(page), 'chip');
  await captureReference(page, item.frame, 'custom-icons-before', info);
  await choose(item.section, 'Context type', 'diff');
  for (const [choice, icon] of [
    ['note', 'note-sticky'],
    ['github', 'github'],
    ['folder', 'folder'],
    ['unknown', 'catalog-unknown-icon'],
  ]) {
    await choose(item.section, 'Custom context icon', choice);
    await expectSourceIcon(item, icon, info);
    await captureReference(page, item.frame, `custom-icon-${choice}`, info);
  }
  await choose(item.section, 'Custom context icon', 'default');
  await expectSourceIcon(item, 'code-branch', info);
  await captureReference(page, item.frame, 'custom-icons-restored', info);
});

test('chat reference R10: real overflow resizing and tooltip precedence follow the current label', async ({
  page,
}, info) => {
  const item = exercise(await openReference(page), 'chip');
  await captureReference(page, item.frame, 'titles-before', info);
  const label = 'Current context filename.ts';
  await field(item.section, 'Context label').fill(label);
  await field(item.section, 'Maximum label width').fill('280px');
  let span = await overflowLabel(item, label, false);
  await expect(span).not.toHaveAttribute('title');
  await expect(button(item.leaf, label)).toHaveAttribute('title', `Open ${label}`);
  await field(item.section, 'Maximum label width').fill('60px');
  span = await overflowLabel(item, label, true);
  await expect(span).toHaveAttribute('title', label);
  await expectHit(page, button(item.leaf, label), item.frame, info, 'truncated-open');
  await item.leaf.hover();
  await expectHit(page, button(item.leaf, 'Remove'), item.frame, info, 'truncated-remove');
  await captureReference(page, item.frame, 'titles-overflow', info);
  await choose(item.section, 'Context tooltip', 'equal');
  await expect(button(item.leaf, label)).not.toHaveAttribute('title');
  await expect(span).toHaveAttribute('title', label);
  await choose(item.section, 'Context tooltip', 'empty');
  await expect(button(item.leaf, label)).toHaveAttribute('title', '');
  await expect(span).toHaveAttribute('title', label);
  await choose(item.section, 'Context tooltip', 'custom');
  const tooltip = 'Current destination details';
  await field(item.section, 'Custom tooltip text').fill(tooltip);
  await expect(button(item.leaf, label)).toHaveAttribute('title', tooltip);
  await expect(span).not.toHaveAttribute('title');
  await choose(item.section, 'Context tooltip', 'omitted');
  await expect(span).toHaveAttribute('title', label);
  await field(item.section, 'Maximum label width').fill('280px');
  span = await overflowLabel(item, label, false);
  await expect(span).not.toHaveAttribute('title');
  await field(item.section, 'Maximum label width').fill('60px');
  const changed = 'Updated current context.ts';
  await field(item.section, 'Context label').fill(changed);
  span = await overflowLabel(item, changed, true);
  await expect(span).toHaveAttribute('title', changed);
  await toggle(item.section, 'Clickable chip', false);
  span = await overflowLabel(item, changed, true);
  await expect(span).toHaveAttribute('title', changed);
  await choose(item.section, 'Context tooltip', 'custom');
  // Static chip owns the title on its actual container, outside the label.
  await expect(span.locator('..')).toHaveAttribute('title', tooltip);
  await expect(span).not.toHaveAttribute('title');
  await captureReference(page, item.frame, 'titles-static-after', info);
});

test('chat reference R12: keyboard current and absent callbacks survive chip branch and owner replacement', async ({
  page,
}, info) => {
  const item = exercise(await openReference(page), 'chip');
  await captureReference(page, item.frame, 'chip-lifetime-before', info);
  await clearChip(item);
  await button(item.section, 'Remount Context chip').press('Tab');
  await expect(button(item.leaf, 'example.ts')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(button(item.leaf, 'Remove')).toBeFocused();
  const callbacks = [];
  for (const key of ['Enter', 'Space']) {
    await button(item.leaf, 'example.ts').press(key);
    callbacks.push(chipCallback('click', 'example.ts'));
    await button(item.leaf, 'Remove').press(key);
    callbacks.push(chipCallback('remove', 'example.ts'));
    await expectChipCallbacks(item, callbacks);
    await expect(button(item.leaf, 'Remove')).toBeFocused();
  }
  const oldButton = await button(item.leaf, 'example.ts').elementHandle();
  try {
    await button(item.section, 'Replace chip callbacks').click();
    const current = 'changed.ts';
    await field(item.section, 'Context label').fill(current);
    await toggle(item.section, 'Include source click callback', true);
    await button(item.leaf, current).press('Enter');
    callbacks.push(chipCallback('click', current, 1));
    await expectChipCallbacks(item, callbacks);
    expect(await oldButton.evaluate((node) => node.isConnected)).toBe(true);
    await toggle(item.section, 'Include click callback', false);
    await button(item.leaf, current).press('Space');
    callbacks.push(chipCallback('sourceClick', current, 1));
    await expectChipCallbacks(item, callbacks);
    await toggle(item.section, 'Include source click callback', false);
    await toggle(item.section, 'Include remove callback', false);
    await button(item.leaf, current).press('Enter');
    await button(item.leaf, 'Remove').press('Space');
    await expectChipCallbacks(item, callbacks);
    // The real observer is destroyed with its old label; inspect the detached
    // node without modifying it to verify no stale title remains.
    await field(item.section, 'Maximum label width').fill('20px');
    const label = await overflowLabel(item, current, true);
    await expect(label).toHaveAttribute('title', current);
    const oldLabel = await label.elementHandle();
    try {
      await toggle(item.section, 'Clickable chip', false);
      expect(
        await oldLabel.evaluate((node) => ({
          connected: node.isConnected,
          title: node.getAttribute('title'),
        })),
      ).toEqual({ connected: false, title: null });
      expect(await oldButton.evaluate((node) => node.isConnected)).toBe(false);
      await toggle(item.section, 'Clickable chip', true);
      await expect(await overflowLabel(item, current, true)).toHaveAttribute('title', current);
      await toggle(item.section, 'Mount Context chip', false);
      await expect(item.leaf).toHaveCount(0);
      await button(item.section, 'Replace chip callbacks').click();
      await toggle(item.section, 'Include click callback', true);
      await toggle(item.section, 'Include remove callback', true);
      await toggle(item.section, 'Mount Context chip', true);
      await button(item.leaf, current).press('Enter');
      callbacks.push(chipCallback('click', current, 2));
      await button(item.leaf, 'Remove').press('Space');
      callbacks.push(chipCallback('remove', current, 2));
      await expectChipCallbacks(item, callbacks);
      const mounted = await button(item.leaf, current).elementHandle();
      try {
        await button(item.section, 'Remount Context chip').click();
        expect(await mounted.evaluate((node) => node.isConnected)).toBe(false);
      } finally {
        await mounted.dispose();
      }
      await button(item.leaf, current).press('Space');
      callbacks.push(chipCallback('click', current, 2));
      await expectChipCallbacks(item, callbacks);
      await expect(await overflowLabel(item, current, true)).toHaveAttribute('title', current);
      await captureReference(page, item.frame, 'chip-lifetime-after', info);
    } finally {
      await oldLabel.dispose();
    }
  } finally {
    await oldButton.dispose();
  }
});
