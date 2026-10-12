import {
  test,
  expect,
  openOperational,
  button,
  choice,
  toggle,
  focusScroll,
  pageDownAndWaitForScrollEnd,
  scrollState,
  wheel,
  visibleRow,
  activate,
  sameNode,
  disconnected,
  readSnapshot,
  outputJson,
  geometry,
  capture,
  rowByLabel,
} from '../lib/operational-window.mjs';

test('operational-window OW1 initial admission preserves content and spacer coverage', async ({
  page,
}, info) => {
  const { host, primary } = await openOperational(page);
  await focusScroll(primary.scroll);
  const row = await visibleRow(primary);
  await capture(page, primary, 'OW1-before', info);
  await activate(primary, row);
  const inputs = await outputJson(host.getByLabel('Operational caller inputs', { exact: true }));
  const view = await geometry(primary);
  expect(view.windows).toHaveLength(2);
  for (const window of view.windows) {
    // Count represents ordinary caller descriptors. This verifies production
    // projection coverage, not a duplicated window/admission implementation.
    expect(window.parts.reduce((sum, part) => sum + (part.key ? 1 : part.spacerRows), 0)).toBe(
      inputs.count,
    );
    const content = window.parts.filter((part) => part.kind === 'content');
    expect(content).toHaveLength(Math.floor(inputs.count / 10));
    expect(window.parts.filter((part) => part.spacerRows > 0).length).toBeGreaterThan(0);
    for (const spacer of window.parts.filter((part) => part.spacerRows > 0)) {
      expect(spacer.bounds.height).toBeGreaterThan(0);
      expect(spacer.hidden).toBe('true');
    }
  }
  const snapshot = await readSnapshot(primary);
  const contentKeys = view.windows.flatMap((window) =>
    window.parts.filter((part) => part.kind === 'content').map((part) => part.key),
  );
  for (const key of contentKeys) expect(snapshot.mountedKeys).not.toContain(key);
  expect(
    new Set(
      view.windows.flatMap((window) =>
        window.parts.filter((part) => part.key).map((part) => part.key),
      ),
    ).size,
  ).toBe(
    view.windows.reduce((sum, window) => sum + window.parts.filter((part) => part.key).length, 0),
  );
  await focusScroll(primary.scroll);
  await capture(page, primary, 'OW1-after', info);
});

test('operational-window OW2 trusted wheel admits new destination rows', async ({ page }, info) => {
  const { primary } = await openOperational(page);
  await focusScroll(primary.scroll);
  await visibleRow(primary);
  const oldKeys = await primary.rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-caller-row-key')),
  );
  const before = await scrollState(primary.scroll);
  await capture(page, primary, 'OW2-before', info);
  await wheel(page, primary.scroll, before.total / 2);
  await expect
    .poll(async () => (await scrollState(primary.scroll)).top)
    .toBeGreaterThan(before.top);
  const next = await visibleRow(primary, oldKeys);
  expect((await scrollState(primary.scroll)).documentTop).toBe(before.documentTop);
  expect(next.admitted).toBe(true);
  await activate(primary, next);
  await capture(page, primary, 'OW2-after', info);
});

test('operational-window OW3 native PageDown and End expose usable rows', async ({
  page,
}, info) => {
  const { primary } = await openOperational(page);
  await focusScroll(primary.scroll);
  await visibleRow(primary);
  const before = await scrollState(primary.scroll);
  await capture(page, primary, 'OW3-before', info);
  await pageDownAndWaitForScrollEnd(page, primary.scroll, info);
  await expect
    .poll(async () => (await scrollState(primary.scroll)).top)
    .toBeGreaterThan(before.top);
  await visibleRow(primary);
  await expect(primary.scroll).toBeFocused();
  await page.keyboard.press('End');
  await expect
    .poll(async () => {
      const current = await scrollState(primary.scroll);
      return Math.abs(current.total - current.height - current.top);
    })
    .toBeLessThanOrEqual(1);
  const finalOperational = rowByLabel(primary, 'scope-a:second row 59');
  await expect(finalOperational).toHaveCount(1);
  // The final content row remains outside operational admission; its immediate
  // operational predecessor must still be physically available and usable.
  await button(finalOperational, 'Observe scope-a:second row 59').click();
  const receipt = (await outputJson(primary.observations)).at(-1);
  expect(receipt).toMatchObject({
    event: 'activate',
    trusted: true,
    label: 'scope-a:second row 59',
    admitted: true,
  });
  await capture(page, primary, 'OW3-after', info);
});

test('operational-window OW6 focused offscreen row survives then releases', async ({
  page,
}, info) => {
  const { primary } = await openOperational(page);
  await focusScroll(primary.scroll);
  const row = await visibleRow(primary);
  const input = row.node.getByRole('textbox');
  await input.fill('Retained native draft');
  await expect(input).toBeFocused();
  const old = await row.node.elementHandle();
  try {
    await capture(page, primary, 'OW6-before', info);
    const before = await scrollState(primary.scroll);
    await wheel(page, primary.scroll, before.total * 0.65);
    await expect
      .poll(async () => (await scrollState(primary.scroll)).top)
      .toBeGreaterThan(before.top);
    await visibleRow(primary, [row.key]);
    await sameNode(row.node, old);
    await expect(input).toBeFocused();
    const outside = await row.node.evaluate((node) => {
      const rowBox = node.getBoundingClientRect();
      const port = node.closest('[data-testid="operational-panel-scroll"]').getBoundingClientRect();
      return rowBox.bottom <= port.top || rowBox.top >= port.bottom;
    });
    expect(outside).toBe(true);
    // Read-only geometry and activeElement preserve focus. A snapshot button
    // would move focus and invalidate this observation, so it is not used here.
    await capture(page, primary, 'OW6-pinned', info);
    await readSnapshot(primary);
    await disconnected(old);
    await focusScroll(primary.scroll);
    const destination = await visibleRow(primary, [row.key]);
    await activate(primary, destination);
    await capture(page, primary, 'OW6-after', info);
  } finally {
    await old.dispose();
  }
});

test('operational-window OW7 current items callbacks and reorder retain node identity', async ({
  page,
}, info) => {
  const { host, primary } = await openOperational(page);
  await choice(host, 'Items per window', '8');
  await focusScroll(primary.scroll);
  const row = await visibleRow(primary);
  await row.node.getByRole('textbox').fill('Keep this row draft');
  const old = await row.node.elementHandle();
  try {
    await capture(page, primary, 'OW7-before', info);
    await button(host, 'Replace same-key items').click();
    await sameNode(row.node, old);
    await activate(primary, row, { revision: 1, draft: 'Keep this row draft' });
    await button(host, 'Replace row callback').click();
    await sameNode(row.node, old);
    await activate(primary, row, {
      revision: 1,
      callbackRevision: 1,
      draft: 'Keep this row draft',
    });
    await toggle(host, 'Reverse item order', true);
    await sameNode(row.node, old);
    await activate(primary, row, {
      revision: 1,
      callbackRevision: 1,
      draft: 'Keep this row draft',
    });
    await expect
      .poll(() =>
        primary.windows
          .first()
          .locator('[data-caller-row-key]')
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const key = JSON.parse(node.getAttribute('data-caller-row-key'));
              return key[2];
            }),
          ),
      )
      .toEqual([
        'block-8',
        'block-7',
        'block-6',
        'block-5',
        'block-4',
        'block-3',
        'block-2',
        'block-1',
      ]);
    await capture(page, primary, 'OW7-after', info);
  } finally {
    await old.dispose();
  }
});
