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
  observeNativeScroll,
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
  expect((await scrollState(primary.scroll)).top).toBe(0);
  // Keep the actual expansion control and selected row together before retaining
  // the row. A Home key at the already-top root can scroll its document ancestor.
  const expansion = host.getByRole('switch', { name: 'Expanded row content', exact: true });
  const expansionHandle = await expansion.elementHandle();
  expect(expansionHandle).not.toBeNull();
  let framed;
  try {
    const readFrame = () =>
      primary.scroll.evaluate((root, control) => {
        const rect = (node) => {
          const { left, top, right, bottom, width, height } = node.getBoundingClientRect();
          return { left, top, right, bottom, width, height };
        };
        const row = root.querySelector('[data-caller-row-key][data-admitted="true"]');
        if (!row) throw new Error('A real admitted first row is required before framing');
        const port = rect(root);
        const selected = rect(row);
        const switchBox = rect(control);
        const scaleX = port.width / root.offsetWidth;
        const scaleY = port.height / root.offsetHeight;
        const left = Math.max(0, port.left + root.clientLeft * scaleX);
        const top = Math.max(0, port.top + root.clientTop * scaleY);
        const right = Math.min(
          innerWidth,
          port.left + (root.clientLeft + root.clientWidth) * scaleX,
        );
        const bottom = Math.min(
          innerHeight,
          port.top + (root.clientTop + root.clientHeight) * scaleY,
        );
        const clip = { left, top, right, bottom };
        const inside = (box, bounds) =>
          box.width > 0 &&
          box.height > 0 &&
          box.left >= bounds.left &&
          box.top >= bounds.top &&
          box.right <= bounds.right &&
          box.bottom <= bounds.bottom;
        const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
        const hit = document.elementFromPoint(
          (switchBox.left + switchBox.right) / 2,
          (switchBox.top + switchBox.bottom) / 2,
        );
        const point = { x: port.left / 2, y: innerHeight / 2 };
        const wheelHit = document.elementFromPoint(point.x, point.y);
        let documentWheel = Boolean(wheelHit && point.x > 0 && !root.contains(wheelHit));
        for (
          let node = wheelHit;
          node && node !== document.documentElement;
          node = node.parentElement
        ) {
          const style = getComputedStyle(node);
          if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight)
            documentWheel = false;
        }
        const spanTop = Math.min(switchBox.top, selected.top);
        const spanBottom = Math.max(switchBox.bottom, selected.bottom);
        return {
          document: { x: scrollX, y: scrollY },
          rootTop: root.scrollTop,
          viewport,
          port,
          selected,
          switchBox,
          clip,
          point,
          documentWheel,
          span: spanBottom - spanTop,
          delta: (spanTop + spanBottom - innerHeight) / 2,
          coFramed: inside(switchBox, viewport) && control.contains(hit) && inside(selected, clip),
        };
      }, expansionHandle);
    await expect(primary.windows.first().locator('[data-caller-row-key]').first()).toHaveAttribute(
      'data-admitted',
      'true',
    );
    const before = await readFrame();
    await info.attach('OW9-framing-plan.json', {
      body: JSON.stringify(before, null, 2),
      contentType: 'application/json',
    });
    expect(before.span).toBeLessThan(before.viewport.bottom);
    expect(before.documentWheel).toBe(true);
    expect(Math.abs(before.delta)).toBeGreaterThan(0);
    expect(Math.abs(before.delta)).toBeLessThanOrEqual(before.viewport.bottom);
    await observeNativeScroll(
      page.locator('html'),
      primary.scroll,
      info,
      'OW9-framing',
      async (read) => {
        await page.mouse.move(before.point.x, before.point.y);
        await page.mouse.wheel(0, before.delta);
        await expect.poll(async () => (await readFrame()).coFramed).toBe(true);
        framed = await readFrame();
        const receipt = await read();
        const wheels = receipt.events.filter((event) => event.type === 'wheel');
        expect(wheels).toHaveLength(1);
        expect(wheels[0]).toMatchObject({
          trusted: true,
          targetInside: true,
          sameCurrentTarget: true,
          delta: { x: 0, y: before.delta, mode: 0 },
        });
        expect(framed.document.y).not.toBe(before.document.y);
        expect(framed.document.x).toBe(before.document.x);
        expect(framed.rootTop).toBe(before.rootTop);
        expect(receipt.current.active).toEqual(receipt.armed.state.active);
      },
    );
    await info.attach('OW9-framing-geometry.json', {
      body: JSON.stringify({ before, after: framed }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await expansionHandle.dispose();
  }
  const row = await visibleRow(primary);
  const old = await row.node.elementHandle();
  const text = row.node.locator('p').nth(1);
  const beforeText = await text.boundingBox();
  const beforeScroll = await scrollState(primary.scroll);
  let continuity;
  try {
    continuity = await old.evaluateHandle((node) => {
      const root = node.closest('[data-testid="operational-panel-scroll"]');
      const key = node.getAttribute('data-caller-row-key');
      const observations = [];
      const violations = [];
      const sample = (phase) => {
        const box = root.getBoundingClientRect();
        const scaleX = box.width / root.offsetWidth;
        const scaleY = box.height / root.offsetHeight;
        const clip = {
          left: Math.max(0, box.left + root.clientLeft * scaleX),
          top: Math.max(0, box.top + root.clientTop * scaleY),
          right: Math.min(innerWidth, box.left + (root.clientLeft + root.clientWidth) * scaleX),
          bottom: Math.min(innerHeight, box.top + (root.clientTop + root.clientHeight) * scaleY),
        };
        const entry = {
          phase,
          at: performance.now(),
          connected: node.isConnected,
          admitted: node.getAttribute('data-admitted'),
          key: node.getAttribute('data-caller-row-key'),
          clip,
          positiveClip: clip.bottom > clip.top && clip.right > clip.left,
          document: { x: scrollX, y: scrollY },
        };
        observations.push(entry);
        if (
          !entry.connected ||
          entry.admitted !== 'true' ||
          entry.key !== key ||
          !entry.positiveClip
        )
          violations.push(entry);
        return entry;
      };
      sample('armed');
      const observer = new MutationObserver((records) => {
        for (const record of records)
          if (
            record.target === node &&
            record.attributeName === 'data-admitted' &&
            record.oldValue === 'false'
          )
            violations.push({ phase: 'admission-transition', oldValue: record.oldValue });
        sample('native-mutation');
      });
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-admitted'],
        attributeOldValue: true,
      });
      return {
        read: () => ({
          current: sample('read'),
          observations: [...observations],
          violations: [...violations],
        }),
        dispose: () => observer.disconnect(),
      };
    });
    const assertRetained = async () => {
      const receipt = await continuity.evaluate((observer) => observer.read());
      expect(receipt.current).toMatchObject({
        connected: true,
        admitted: 'true',
        key: row.key,
        positiveClip: true,
      });
      expect(receipt.violations).toEqual([]);
    };
    await assertRetained();
    await capture(page, primary, 'OW9-before', info, button(row.node, `Observe ${row.label}`));
    const beforeExpansion = await expansion.evaluate((control) => {
      const { left, top, right, bottom, width, height } = control.getBoundingClientRect();
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return {
        document: { x: scrollX, y: scrollY },
        bounds: { left, top, right, bottom, width, height },
        hittable:
          width > 0 &&
          height > 0 &&
          left >= 0 &&
          top >= 0 &&
          right <= innerWidth &&
          bottom <= innerHeight &&
          control.contains(hit),
      };
    });
    expect(beforeExpansion.hittable).toBe(true);
    await toggle(host, 'Expanded row content', true);
    const afterExpansionDocument = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await info.attach('OW9-expansion-action.json', {
      body: JSON.stringify(
        { before: beforeExpansion, afterDocument: afterExpansionDocument },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(afterExpansionDocument).toEqual(beforeExpansion.document);
    await assertRetained();
    await focusScroll(primary.scroll);
    await sameNode(row.node, old);
    await assertRetained();
    await expect
      .poll(async () => (await text.boundingBox()).height)
      .toBeGreaterThan(beforeText.height);
    await expect
      .poll(async () => (await scrollState(primary.scroll)).total)
      .toBeGreaterThan(beforeScroll.total);
    expect(await page.evaluate(() => innerWidth)).toBe(420);
    await info.attach('OW9-growth.json', {
      body: JSON.stringify(
        {
          before: { text: beforeText, scroll: beforeScroll },
          after: { text: await text.boundingBox(), scroll: await scrollState(primary.scroll) },
          width: await page.evaluate(() => innerWidth),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await activate(primary, row);
    await assertRetained();
    const finalControl = button(row.node, `Observe ${row.label}`);
    await expect(finalControl).toBeFocused();
    await sameNode(row.node, old);
    const readFinalFrame = () =>
      primary.scroll.evaluate((root) => {
        const { left, top, right, bottom, width, height } = root.getBoundingClientRect();
        const documentRoot = document.scrollingElement;
        if (!documentRoot) throw new Error('A native document scroll root is required');
        const documentY = scrollY;
        const maximum = documentRoot.scrollHeight - documentRoot.clientHeight;
        const requestedCenterDelta = (top + bottom - innerHeight) / 2;
        const delta = Math.min(Math.max(requestedCenterDelta, -documentY), maximum - documentY);
        const point = { x: left / 2, y: innerHeight / 2 };
        const hit = document.elementFromPoint(point.x, point.y);
        let documentWheel = Boolean(hit && point.x > 0 && !root.contains(hit));
        const hitPath = [];
        for (let node = hit; node && node !== document.documentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          hitPath.push({
            tag: node.tagName.toLowerCase(),
            testId: node.getAttribute('data-testid'),
            overflowY: style.overflowY,
            clientHeight: node.clientHeight,
            scrollHeight: node.scrollHeight,
          });
          if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight)
            documentWheel = false;
        }
        return {
          bounds: { left, top, right, bottom, width, height },
          viewport: { width: innerWidth, height: innerHeight },
          rootTop: root.scrollTop,
          document: {
            x: scrollX,
            y: documentY,
            maximum,
            height: documentRoot.clientHeight,
            total: documentRoot.scrollHeight,
          },
          point,
          documentWheel,
          hitPath,
          requestedCenterDelta,
          delta,
          contained:
            width > 0 &&
            height > 0 &&
            left >= 0 &&
            top >= 0 &&
            right <= innerWidth &&
            bottom <= innerHeight,
        };
      });
    const finalBefore = await readFinalFrame();
    await info.attach('OW9-final-framing-plan.json', {
      body: JSON.stringify(finalBefore, null, 2),
      contentType: 'application/json',
    });
    expect(finalBefore.bounds.width).toBeGreaterThan(0);
    expect(finalBefore.bounds.height).toBeGreaterThan(0);
    expect(finalBefore.bounds.height).toBeLessThanOrEqual(finalBefore.viewport.height);
    expect(finalBefore.bounds.left).toBeGreaterThanOrEqual(0);
    expect(finalBefore.bounds.right).toBeLessThanOrEqual(finalBefore.viewport.width);
    if (!finalBefore.contained) {
      expect(finalBefore.documentWheel).toBe(true);
      expect(Math.abs(finalBefore.delta)).toBeGreaterThan(0);
      expect(Math.abs(finalBefore.delta)).toBeLessThanOrEqual(finalBefore.viewport.height);
      expect(finalBefore.bounds.top - finalBefore.delta).toBeGreaterThanOrEqual(0);
      expect(finalBefore.bounds.bottom - finalBefore.delta).toBeLessThanOrEqual(
        finalBefore.viewport.height,
      );
      expect(finalBefore.document.y + finalBefore.delta).toBeGreaterThanOrEqual(0);
      expect(finalBefore.document.y + finalBefore.delta).toBeLessThanOrEqual(
        finalBefore.document.maximum,
      );
      await observeNativeScroll(
        page.locator('html'),
        primary.scroll,
        info,
        'OW9-final-framing',
        async (read) => {
          await page.mouse.move(finalBefore.point.x, finalBefore.point.y);
          await page.mouse.wheel(0, finalBefore.delta);
          await expect.poll(async () => (await readFinalFrame()).contained).toBe(true);
          const receipt = await read();
          const wheels = receipt.events.filter((event) => event.type === 'wheel');
          expect(wheels).toHaveLength(1);
          expect(wheels[0]).toMatchObject({
            trusted: true,
            targetInside: true,
            sameCurrentTarget: true,
            delta: { x: 0, y: finalBefore.delta, mode: 0 },
          });
          expect(receipt.current.document.y).not.toBe(finalBefore.document.y);
          expect(receipt.current.active).toEqual(receipt.armed.state.active);
        },
      );
    }
    const finalAfter = await readFinalFrame();
    await info.attach('OW9-final-framing-geometry.json', {
      body: JSON.stringify({ before: finalBefore, after: finalAfter }, null, 2),
      contentType: 'application/json',
    });
    expect(finalAfter.contained).toBe(true);
    expect(finalAfter.rootTop).toBe(finalBefore.rootTop);
    expect(finalAfter.document.x).toBe(finalBefore.document.x);
    await expect(finalControl).toBeFocused();
    await sameNode(row.node, old);
    await assertRetained();
    await capture(page, primary, 'OW9-after', info);
    // Fixed-width growth and an admitted physical row are the complete claim.
    // This does not establish width-cache invalidation or uninterrupted reader
    // anchoring through the global caller control and genuine root reveal.
  } finally {
    try {
      if (continuity) {
        try {
          await info.attach('OW9-admission-continuity.json', {
            body: JSON.stringify(await continuity.evaluate((observer) => observer.read()), null, 2),
            contentType: 'application/json',
          });
        } finally {
          try {
            await continuity.evaluate((observer) => observer.dispose());
          } finally {
            await continuity.dispose();
          }
        }
      }
    } finally {
      await old.dispose();
    }
  }
});

test('operational-window OW10 independent provider survives neighbor teardown and remount', async ({
  page,
}, info) => {
  const { host, primary, independent } = await openOperational(page);
  const framePanel = async (item, name) => {
    const observation = await item.scroll.evaluateHandle((root) => {
      const exercise = root.closest('[data-functional-example="operational-window"]');
      const documentRoot = document.scrollingElement;
      if (!exercise || !documentRoot)
        throw new Error('Actual panel and document roots are required');
      const ownerRoots = Array.from(
        exercise.querySelectorAll('[data-testid="operational-panel-scroll"]'),
      ).filter((node) => node.isConnected);
      const focused = document.activeElement;
      const read = () => {
        const currentRoots = Array.from(
          exercise.querySelectorAll('[data-testid="operational-panel-scroll"]'),
        ).filter((node) => node.isConnected);
        const { left, top, right, bottom, width, height } = root.getBoundingClientRect();
        const maximum = documentRoot.scrollHeight - documentRoot.clientHeight;
        const requestedCenterDelta = (top + bottom - innerHeight) / 2;
        const delta = Math.min(Math.max(requestedCenterDelta, -scrollY), maximum - scrollY);
        const point = { x: left / 2, y: innerHeight / 2 };
        const hit = document.elementFromPoint(point.x, point.y);
        const hitPath = [];
        let documentWheel = Boolean(
          hit &&
          point.x > 0 &&
          point.x < innerWidth &&
          !ownerRoots.some((node) => node.contains(hit)),
        );
        for (let node = hit; node && node !== document.documentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          hitPath.push({
            tag: node.localName,
            testId: node.getAttribute('data-testid'),
            overflowY: style.overflowY,
            clientHeight: node.clientHeight,
            scrollHeight: node.scrollHeight,
          });
          if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight)
            documentWheel = false;
        }
        return {
          bounds: { left, top, right, bottom, width, height },
          viewport: { width: innerWidth, height: innerHeight },
          document: { x: scrollX, y: scrollY, maximum },
          ownerRoots: ownerRoots.map((node) => ({
            connected: node.isConnected,
            top: node.scrollTop,
            left: node.scrollLeft,
          })),
          sameOwnerNodes:
            currentRoots.length === ownerRoots.length &&
            ownerRoots.every((node, index) => currentRoots[index] === node),
          sameTarget: root.isConnected && currentRoots.includes(root),
          sameFocus: document.activeElement === focused,
          point,
          hitPath,
          documentWheel,
          requestedCenterDelta,
          delta,
          contained:
            width > 0 &&
            height > 0 &&
            left >= 0 &&
            top >= 0 &&
            right <= innerWidth &&
            bottom <= innerHeight,
        };
      };
      return { read };
    });
    let before;
    try {
      const read = () => observation.evaluate((observer) => observer.read());
      before = await read();
      await info.attach(name + '-plan.json', {
        body: JSON.stringify(before, null, 2),
        contentType: 'application/json',
      });
      expect(before.sameTarget).toBe(true);
      expect(before.sameOwnerNodes).toBe(true);
      expect(before.ownerRoots.length).toBeGreaterThan(0);
      expect(before.ownerRoots.every((root) => root.connected)).toBe(true);
      expect(before.bounds.width).toBeGreaterThan(0);
      expect(before.bounds.height).toBeGreaterThan(0);
      expect(before.bounds.height).toBeLessThanOrEqual(before.viewport.height);
      expect(before.bounds.left).toBeGreaterThanOrEqual(0);
      expect(before.bounds.right).toBeLessThanOrEqual(before.viewport.width);
      if (!before.contained) {
        expect(before.documentWheel).toBe(true);
        expect(Math.abs(before.delta)).toBeGreaterThan(0);
        expect(before.bounds.top - before.delta).toBeGreaterThanOrEqual(0);
        expect(before.bounds.bottom - before.delta).toBeLessThanOrEqual(before.viewport.height);
        expect(before.document.y + before.delta).toBeGreaterThanOrEqual(0);
        expect(before.document.y + before.delta).toBeLessThanOrEqual(before.document.maximum);
        await observeNativeScroll(
          page.locator('html'),
          item.scroll,
          info,
          name,
          async (readNative) => {
            await page.mouse.move(before.point.x, before.point.y);
            await page.mouse.wheel(0, before.delta);
            await expect.poll(async () => (await read()).contained).toBe(true);
            const receipt = await readNative();
            const wheels = receipt.events.filter((event) => event.type === 'wheel');
            expect(wheels).toHaveLength(1);
            expect(wheels[0]).toMatchObject({
              trusted: true,
              targetInside: true,
              sameCurrentTarget: true,
              delta: { x: 0, y: before.delta, mode: 0 },
            });
            expect(receipt.current.document.y).not.toBe(before.document.y);
            expect(receipt.current.active).toEqual(receipt.armed.state.active);
          },
        );
      }
      const after = await read();
      expect(after.contained).toBe(true);
      expect(after.sameTarget).toBe(true);
      expect(after.sameOwnerNodes).toBe(true);
      expect(after.ownerRoots).toEqual(before.ownerRoots);
      expect(after.sameFocus).toBe(true);
      expect(after.document.x).toBe(before.document.x);
    } finally {
      try {
        await info.attach(name + '-geometry.json', {
          body: JSON.stringify(
            { before, after: await observation.evaluate((observer) => observer.read()) },
            null,
            2,
          ),
          contentType: 'application/json',
        });
      } finally {
        await observation.dispose();
      }
    }
  };
  await toggle(host, 'Independent panel mounted', true);
  await framePanel(primary, 'OW10-primary-initial-framing');
  await focusScroll(primary.scroll);
  const first = await visibleRow(primary);
  await activate(primary, first);
  const oldPrimary = await primary.scroll.elementHandle();
  await framePanel(independent, 'OW10-independent-initial-framing');
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
    await framePanel(independent, 'OW10-independent-surviving-framing');
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
    await framePanel(primary, 'OW10-primary-remounted-framing');
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
