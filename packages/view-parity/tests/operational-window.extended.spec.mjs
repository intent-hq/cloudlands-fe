import {
  test,
  expect,
  openOperational,
  button,
  choice,
  toggle,
  focusScroll,
  scrollState,
  wheel,
  revealNewOperationalRowOnce,
  visibleRow,
  visibleRows,
  activate,
  sameNode,
  disconnected,
  outputJson,
  capture,
  rowByLabel,
  followingState,
  expectFollowingBottom,
  pressObservedEnd,
} from '../lib/operational-window.mjs';

test('operational-window OW4 native nested scrolling respects outer clipping', async ({
  page,
}, info) => {
  const { host, primary } = await openOperational(page);
  await choice(host, 'Scroll mode', 'nested');
  await focusScroll(primary.inner(0));
  const first = await visibleRow(primary);
  expect(JSON.parse(first.key)[1]).toBe('scope-a:first');
  const oldKeys = await primary.rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-caller-row-key')),
  );
  const beforeInner = await scrollState(primary.inner(0));
  const beforeOuter = await scrollState(primary.scroll);
  await capture(page, primary, 'OW4-before', info, primary.inner(0));
  await wheel(page, primary.inner(0), beforeInner.total / 2);
  await expect
    .poll(async () => (await scrollState(primary.inner(0))).top)
    .toBeGreaterThan(beforeInner.top);
  await revealNewOperationalRowOnce(page, primary, oldKeys, info);
  const next = await visibleRow(primary, oldKeys);
  expect(JSON.parse(next.key)[1]).toBe('scope-a:first');
  expect((await scrollState(primary.scroll)).top).toBe(beforeOuter.top);
  await activate(primary, next);
  await capture(page, primary, 'OW4-inner-after', info, primary.inner(0));
  await focusScroll(primary.scroll);
  await page.keyboard.press('End');
  await expect
    .poll(async () => (await scrollState(primary.scroll)).top)
    .toBeGreaterThan(beforeOuter.top);
  await expect
    .poll(async () =>
      (await visibleRows(primary)).some((row) => JSON.parse(row.key)[1] === 'scope-a:second'),
    )
    .toBe(true);
  const secondInfo = (await visibleRows(primary)).find(
    (row) => row.kind !== 'content' && JSON.parse(row.key)[1] === 'scope-a:second',
  );
  expect(secondInfo).toBeTruthy();
  const second = { ...secondInfo, node: rowByLabel(primary, secondInfo.label) };
  await activate(primary, second);
  // The control hit-test observes all ancestor clipping, independently of the
  // backend policy. We never compute an expected visible list with that policy.
  await capture(page, primary, 'OW4-after', info, button(second.node, `Observe ${second.label}`));
});

test('operational-window OW5 document fallback responds to native page scrolling', async ({
  page,
}, info) => {
  const { host, primary } = await openOperational(page);
  await choice(host, 'Scroll mode', 'document');
  // Content rows persist outside admission and provide a genuine clickable
  // target in normal document flow; no scrollTop/scrollIntoView script is used.
  await button(primary.region, 'Observe scope-a:first row 10').click();
  const row = await visibleRow(primary);
  const oldKeys = await primary.rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-caller-row-key')),
  );
  const before = await page.evaluate(() => ({
    top: document.scrollingElement.scrollTop,
    total: document.scrollingElement.scrollHeight,
  }));
  await capture(page, primary, 'OW5-before', info, button(row.node, `Observe ${row.label}`));
  await page.mouse.move(210, 450);
  await page.mouse.wheel(0, before.total / 3);
  await expect
    .poll(() => page.evaluate(() => document.scrollingElement.scrollTop))
    .toBeGreaterThan(before.top);
  const next = await visibleRow(primary, oldKeys);
  expect((await scrollState(primary.scroll)).top).toBe(0);
  expect((await scrollState(primary.inner(0))).top).toBe(0);
  expect((await scrollState(primary.inner(1))).top).toBe(0);
  await activate(primary, next);
  await capture(page, primary, 'OW5-after', info, button(next.node, `Observe ${next.label}`));
});

test('operational-window OW8 keyed replacement revokes old nodes and changes scope', async ({
  page,
}, info) => {
  const { host, primary } = await openOperational(page);
  await focusScroll(primary.scroll);
  const row = await visibleRow(primary);
  await row.node.getByRole('textbox').fill('Old physical row draft');
  const oldRow = await row.node.elementHandle();
  const oldWindow = await primary.windows.first().elementHandle();
  let replacement;
  try {
    await capture(page, primary, 'OW8-before', info);
    await button(host, 'Remount windows').click();
    await disconnected(oldRow);
    await disconnected(oldWindow);
    await focusScroll(primary.scroll);
    const remounted = await visibleRow(primary);
    await expect(remounted.node.getByRole('textbox')).toHaveValue('');
    const receipt = await activate(primary, remounted);
    expect(receipt.mountRevision).toBe(1);
    replacement = await remounted.node.elementHandle();
    await choice(host, 'Window scope', 'scope-b');
    await disconnected(replacement);
    await focusScroll(primary.scroll);
    const current = await visibleRow(primary);
    expect(JSON.parse(current.key)[1]).toMatch(/^scope-b:/);
    await activate(primary, current);
    const allKeys = await primary.rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-caller-row-key')),
    );
    expect(allKeys.every((key) => JSON.parse(key)[1].startsWith('scope-b:'))).toBe(true);
    expect(new Set(allKeys).size).toBe(allKeys.length);
    await capture(page, primary, 'OW8-after', info);
  } finally {
    await oldRow.dispose();
    await oldWindow.dispose();
    await replacement?.dispose();
  }
});

test('operational-window OW9 actual content growth reflows at fixed width', async ({
  page,
}, info) => {
  const { host, primary } = await openOperational(page);
  await choice(host, 'Items per window', '8');
  await focusScroll(primary.scroll);
  await page.keyboard.press('Home');
  const row = await visibleRow(primary);
  const old = await row.node.elementHandle();
  const text = row.node.locator('p').nth(1);
  const beforeText = await text.boundingBox();
  const beforeScroll = await scrollState(primary.scroll);
  try {
    await capture(page, primary, 'OW9-before', info);
    await toggle(host, 'Expanded row content', true);
    await focusScroll(primary.scroll);
    await sameNode(row.node, old);
    await expect
      .poll(async () => (await text.boundingBox()).height)
      .toBeGreaterThan(beforeText.height);
    await expect
      .poll(async () => (await scrollState(primary.scroll)).total)
      .toBeGreaterThan(beforeScroll.total);
    expect(await page.evaluate(() => innerWidth)).toBe(420);
    await activate(primary, row);
    await capture(page, primary, 'OW9-after', info);
    // Fixed-width content growth is the entire claim. Width-cache invalidation
    // and scroll-anchor correction during uninterrupted viewport retention are
    // not established by a caller toggle that may reveal controls elsewhere.
  } finally {
    await old.dispose();
  }
});

test('operational-window OW10 independent provider survives neighbor teardown and remount', async ({
  page,
}, info) => {
  const { host, primary, independent } = await openOperational(page);
  await toggle(host, 'Independent panel mounted', true);
  await focusScroll(primary.scroll);
  const first = await visibleRow(primary);
  await activate(primary, first);
  const oldPrimary = await primary.scroll.elementHandle();
  await focusScroll(independent.scroll);
  const independentRow = await visibleRow(independent);
  expect(JSON.parse(independentRow.key)[1]).toMatch(/^independent:scope-a:/);
  await activate(independent, independentRow);
  const independentRoot = await independent.scroll.elementHandle();
  try {
    await capture(page, independent, 'OW10-before', info);
    await toggle(host, 'Provider mounted', false);
    await disconnected(oldPrimary);
    await expect(primary.windows).toHaveCount(0);
    await sameNode(independent.scroll, independentRoot);
    await focusScroll(independent.scroll);
    const previousKeys = await independent.rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-caller-row-key')),
    );
    const before = await scrollState(independent.scroll);
    await wheel(page, independent.scroll, before.total / 2);
    await expect
      .poll(async () => (await scrollState(independent.scroll)).top)
      .toBeGreaterThan(before.top);
    const surviving = await visibleRow(independent, previousKeys);
    await activate(independent, surviving);
    await capture(page, independent, 'OW10-neighbor-absent', info);
    await button(host, 'Remount provider').click();
    await focusScroll(primary.scroll);
    const fresh = await visibleRow(primary);
    await activate(primary, fresh);
    await sameNode(independent.scroll, independentRoot);
    const observations = await outputJson(independent.observations);
    expect(
      observations.some((entry) => entry.event === 'activate' && entry.key === surviving.key),
    ).toBe(true);
    await capture(page, primary, 'OW10-after', info);
    // Actual StrictMode initial/ref replay is exercised by the frozen caller.
    // Do not infer listener counts or private owner identities from no errors.
  } finally {
    await oldPrimary.dispose();
    await independentRoot.dispose();
  }
});

test('operational-window E4 nested inner End retains native scroll ownership', async ({
  page,
}, info) => {
  const { host, primary } = await openOperational(page);
  await choice(host, 'Scroll mode', 'nested');
  const inner = primary.inner(0);
  await focusScroll(inner);
  await expect(primary.scroll).toHaveAttribute('data-following-bottom', 'false');
  await capture(page, primary, 'E4-before', info, inner);
  const beforeOuter = await followingState(primary.scroll);
  const beforeInner = await scrollState(inner);
  // The unqualified fallback may follow a near-bottom outer root; this case
  // establishes the actual far-from-bottom precondition instead of assuming it.
  expect(beforeOuter.maximum - beforeOuter.top).toBeGreaterThan(100);
  await pressObservedEnd(page, inner, primary.scroll, info, 'E4-inner-End', {
    prevented: false,
    nativeScrollEnd: true,
  });
  expect((await scrollState(inner)).top).toBeGreaterThan(beforeInner.top);
  const afterOuter = await followingState(primary.scroll);
  expect(afterOuter.top).toBe(beforeOuter.top);
  expect(afterOuter.maximum - afterOuter.top).toBeGreaterThan(100);
  await expect(primary.scroll).toHaveAttribute('data-following-bottom', 'false');
  await expect(inner).toBeFocused();
  await capture(page, primary, 'E4-after', info, inner);
  await expect(primary.scroll).toHaveAttribute('data-following-bottom', 'false');
  // Real measurement can extend the inner content: no final-bottom claim.
});

test('operational-window E5 modified outer End remains available to the browser', async ({
  page,
}, info) => {
  const { primary } = await openOperational(page);
  await focusScroll(primary.scroll);
  await expect(primary.scroll).toHaveAttribute('data-following-bottom', 'false');
  await capture(page, primary, 'E5-before', info);
  await pressObservedEnd(page, primary.scroll, primary.scroll, info, 'E5-Shift-End', {
    shift: true,
    prevented: false,
  });
  await info.attach('E5-browser-outcome.json', {
    body: JSON.stringify(
      {
        root: await followingState(primary.scroll),
        selection: await page.evaluate(() => document.getSelection()?.toString() ?? null),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await capture(page, primary, 'E5-after', info);
  // The preserved fallback may follow if the browser reaches near bottom.
  // Ownership is the trusted unprevented modifier receipt, not inert scrolling.
});

test('operational-window E6 StrictMode provider remount restores usable following', async ({
  page,
}, info) => {
  const { host, primary } = await openOperational(page);
  await focusScroll(primary.scroll);
  await pressObservedEnd(page, primary.scroll, primary.scroll, info, 'E6-initial-End', {
    prevented: true,
  });
  await expectFollowingBottom(primary.scroll);
  await capture(page, primary, 'E6-before', info);
  const oldRoot = await primary.scroll.elementHandle();
  expect(oldRoot).not.toBeNull();
  try {
    await button(host, 'Remount provider').click();
    await disconnected(oldRoot);
    expect(await primary.scroll.evaluate((node, previous) => node === previous, oldRoot)).toBe(
      false,
    );
    await expect(primary.scroll).toHaveAttribute('data-following-bottom', 'false');
    await focusScroll(primary.scroll);
    await capture(page, primary, 'E6-remounted', info);
    await pressObservedEnd(page, primary.scroll, primary.scroll, info, 'E6-remounted-End', {
      prevented: true,
    });
    await expectFollowingBottom(primary.scroll);
    const finalRow = rowByLabel(primary, 'scope-a:second row 59');
    await expect(finalRow).toHaveCount(1);
    await button(finalRow, 'Observe scope-a:second row 59').click();
    expect((await outputJson(primary.observations)).at(-1)).toMatchObject({
      event: 'activate',
      trusted: true,
      label: 'scope-a:second row 59',
      admitted: true,
    });
    await expectFollowingBottom(primary.scroll);
    await capture(page, primary, 'E6-after', info);
  } finally {
    await oldRoot.dispose();
  }
  // Functional StrictMode replay/remount is not an observer-count or pending
  // frame cancellation oracle. No detached old-node event is synthesized.
});
