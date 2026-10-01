import { test, expect } from '../../../../../test/ct-test';
import type { Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';
import type { DocumentSession } from './document-session';
import Harness from './DifferentialProofHarness.svelte';
type Host = HTMLElement & { proof: DocumentSession; native: Editor };
async function state(page: Page, side: string) {
  return page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate((el) => {
      const h = el as Host,
        e = h.proof?.editor ?? h.native;
      return {
        doc: e!.getJSON(),
        selection: e!.state.selection.toJSON(),
        error: h.proof?.error ?? '',
      };
    });
}
async function settled(page: Page) {
  // Input acknowledgement can precede selectionchange/paint. Agreement at that instant
  // may still be the previous selection; allow the browser to finish before polling.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = window.getSelection();
        if (!selection?.anchorNode || !selection.focusNode) return true;
        for (const el of document.querySelectorAll('[data-testid="proof"]')) {
          const h = el as Host,
            e = h.proof?.editor ?? h.native;
          if (!e?.view.dom.contains(selection.anchorNode)) continue;
          return (
            e.state.selection.anchor ===
              e.view.posAtDOM(selection.anchorNode, selection.anchorOffset) &&
            e.state.selection.head === e.view.posAtDOM(selection.focusNode, selection.focusOffset)
          );
        }
        return true;
      }),
    )
    .toBe(true);
}
async function focus(page: Page, side: string) {
  await settled(page);
  await page.getByTestId(side).locator('.tiptap').focus();
  await settled(page);
}
async function select(page: Page, side: string, anchor: number, head = anchor) {
  await settled(page);
  await expect(page.getByTestId(side).locator('.tiptap')).toHaveCount(1);
  await page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate(
      (el, r) => {
        const h = el as Host,
          e = h.proof?.editor ?? h.native;
        e!.view.focus();
        e!.commands.setTextSelection({ from: r.anchor, to: r.head });
      },
      { anchor, head },
    );
  await expect
    .poll(async () => (await state(page, side)).selection)
    .toEqual({ type: 'text', anchor, head });
  await expect
    .poll(() =>
      page
        .getByTestId(side)
        .getByTestId('proof')
        .evaluate((el) => {
          const h = el as Host,
            e = h.proof?.editor ?? h.native,
            selection = window.getSelection()!;
          if (
            !selection.anchorNode ||
            !selection.focusNode ||
            !e!.view.dom.contains(selection.anchorNode)
          )
            return null;
          return {
            anchor: e!.view.posAtDOM(selection.anchorNode, selection.anchorOffset),
            head: e!.view.posAtDOM(selection.focusNode, selection.focusOffset),
          };
        }),
    )
    .toEqual({ anchor, head });
}
async function seam(page: Page) {
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  return page
    .getByTestId('native')
    .getByTestId('proof')
    .evaluate((el) => (el as Host).native.state.doc.firstChild!.nodeSize);
}
async function same(page: Page) {
  await settled(page);
  await expect(async () => {
    const native = await state(page, 'native');
    const bounded = await state(page, 'bounded');
    expect(native.error).toBe('');
    expect(bounded).toEqual(native);
  }).toPass({ timeout: 5000 });
}

for (const direction of ['forward', 'backward'] as const)
  test(`native differential: ${direction} Shift-selection crosses a source seam`, async ({
    mount,
    page,
  }) => {
    await mount(Harness);
    await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
    const edge = await seam(page);
    for (const side of ['native', 'bounded']) {
      await select(page, side, direction === 'forward' ? edge - 3 : edge + 3);
      for (let n = 0; n < 7; n++)
        await page.keyboard.press(direction === 'forward' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
    }
    await same(page);
  });

for (const key of ['Backspace', 'Delete', 'Enter'])
  test(`native differential: ${key}, undo and redo at the seam`, async ({ mount, page }) => {
    await mount(Harness);
    await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
    const edge = await seam(page);
    for (const side of ['native', 'bounded']) {
      await select(page, side, key === 'Backspace' ? edge + 1 : edge - 1);
      await page.keyboard.press(key);
    }
    await same(page);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+z');
    }
    await same(page);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+Shift+z');
    }
    await same(page);
  });

test('native differential: typing and bold undo grouping and selection restoration', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
  for (const side of ['native', 'bounded']) {
    await select(page, side, 1);
    await page.keyboard.type('hello');
    await page.keyboard.press('Shift+Home');
    await expect
      .poll(async () => (await state(page, side)).selection)
      .toEqual({ type: 'text', anchor: 6, head: 1 });
    await page.keyboard.press('Control+b');
  }
  await same(page);
  for (let n = 0; n < 2; n++) {
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+z');
    }
    await same(page);
  }
  for (let n = 0; n < 2; n++) {
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+Shift+z');
    }
    await same(page);
  }
});

test('native differential: clipboard paste and cut across the seam', async ({
  mount,
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mount(Harness);
  await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
  const edge = await seam(page);
  const copied: string[] = [],
    cut: string[] = [];
  for (const side of ['native', 'bounded']) {
    await select(page, side, edge - 4, edge + 5);
    await page.keyboard.press('Control+c');
    copied.push(await page.evaluate(() => navigator.clipboard.readText()));
    await page.keyboard.press('Control+x');
    cut.push(await page.evaluate(() => navigator.clipboard.readText()));
  }
  expect(copied[0].length).toBeGreaterThan(0);
  expect(copied[1]).toBe(copied[0]);
  expect(cut[1]).toBe(cut[0]);
  await same(page);
  await page
    .getByTestId('bounded')
    .getByTestId('proof')
    .evaluate((el) => (el as Host).proof.show(0, true));
  await same(page);
  for (const side of ['native', 'bounded']) {
    await page.evaluate(() => navigator.clipboard.writeText('paste 🌍\n\nsecond'));
    await focus(page, side);
    await page.keyboard.press('Control+v');
    await expect(page.getByTestId(side).locator('.tiptap')).toContainText('paste 🌍');
  }
  await same(page);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+z');
  }
  await same(page);
});

test('native differential: real pointer drag across the seam preserves direction', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
  for (const side of ['native', 'bounded']) {
    await settled(page);
    const points = await page
      .getByTestId(side)
      .locator('.tiptap')
      .evaluate((el) => {
        const paragraphs = el.querySelectorAll('p');
        return [paragraphs[0], paragraphs[1]].map((p) => {
          const text = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()!;
          const range = document.createRange();
          range.setStart(text, 4);
          range.setEnd(text, 5);
          const r = range.getBoundingClientRect();
          return { x: r.left + 1, y: r.top + r.height / 2 };
        });
      });
    await page.mouse.move(points[1].x, points[1].y);
    await page.mouse.down();
    await page.mouse.move(points[0].x, points[0].y, { steps: 10 });
    await page.mouse.up();
  }
  await same(page);
});

test('native differential: Chromium composition grouping and restored selection', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
  const cdp = await page.context().newCDPSession(page);
  for (const side of ['native', 'bounded']) {
    await select(page, side, 1);
    await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: '日本語' });
    await expect(page.getByTestId(side).locator('.tiptap')).toContainText('日本語');
  }
  await same(page);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+z');
  }
  await same(page);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+Shift+z');
  }
  await same(page);
  await cdp.detach();
});

for (const kind of ['literal', 'bold-end', 'partial-bold', 'bold-link', 'bold-split'])
  test(`review regression: ${kind} survives save, reload, undo and redo`, async ({
    mount,
    page,
  }) => {
    await mount(Harness);
    await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
    for (const side of ['native', 'bounded']) {
      if (kind === 'literal') {
        await select(page, side, 1);
        await page.keyboard.type('a**b**c ');
      } else if (kind === 'bold-link') {
        const pos = await page
          .getByTestId(side)
          .getByTestId('proof')
          .evaluate((el) => {
            const h = el as Host,
              e = h.proof?.editor ?? h.native;
            let from = 0;
            e!.state.doc.descendants((n, p) => {
              if (!from && n.isText && n.marks.some((m) => m.type.name === 'link')) from = p;
            });
            return from;
          });
        await select(page, side, pos, pos + 4);
        await page.keyboard.press('Control+b');
      } else {
        await select(page, side, 1, 7);
        await page.keyboard.press('Control+b');
        if (kind === 'bold-end') {
          await page.keyboard.press('ArrowRight');
          await page.keyboard.type('Z');
        } else if (kind === 'partial-bold') {
          await select(page, side, 3, 5);
          await page.keyboard.press('Control+b');
        } else {
          await select(page, side, 4);
          await page.keyboard.press('Enter');
        }
      }
    }
    await same(page);
    await page
      .getByTestId('bounded')
      .getByTestId('proof')
      .evaluate(async (el) => {
        const p = (el as Host).proof;
        p.save();
        await p.show(0, true);
      });
    await same(page);
    for (const key of ['Control+z', 'Control+Shift+z']) {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(key);
      }
      await same(page);
    }
  });

for (const adapter of ['transaction', 'remote'])
  test(`review regression: ${adapter} changes map prior history without adding undo`, async ({
    mount,
    page,
  }) => {
    await mount(Harness);
    for (const side of ['native', 'bounded']) {
      await select(page, side, 11);
      await page.keyboard.type('A');
      await select(page, side, 1);
      await page.keyboard.type('BBBBB');
      await select(page, side, 22, 20);
      await page
        .getByTestId(side)
        .getByTestId('proof')
        .evaluate((el, adapter) => {
          const h = el as Host,
            e = h.proof?.editor ?? h.native;
          if (h.proof && adapter === 'remote') h.proof.remote({ from: 12, to: 12, insert: 'R' });
          else e!.view.dispatch(e!.state.tr.insertText('R', 13).setMeta('addToHistory', false));
        }, adapter);
    }
    await same(page);
    for (const key of ['Control+z', 'Control+z', 'Control+Shift+z', 'Control+Shift+z']) {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(key);
      }
      await same(page);
    }
  });

for (const size of [3000, 5000])
  test(`review regression: ${size}-byte paste retains its inverse atomically`, async ({
    mount,
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mount(Harness);
    for (const side of ['native', 'bounded']) {
      await select(page, side, 1);
      await page.evaluate((n) => navigator.clipboard.writeText('x'.repeat(n)), size);
      await page.keyboard.press('Control+v');
      await expect(page.getByTestId(side).locator('.tiptap')).toContainText('x'.repeat(size));
      if (size === 3000) {
        const edge = await page
          .getByTestId(side)
          .getByTestId('proof')
          .evaluate((el) => {
            const h = el as Host;
            return (h.proof?.editor ?? h.native)!.state.doc.firstChild!.nodeSize;
          });
        await select(page, side, edge + 1);
        await page.keyboard.type('J');
        await select(page, side, 1, 3001);
        await page.evaluate(() => navigator.clipboard.writeText('y'.repeat(3000)));
        await page.keyboard.press('Control+v');
        await expect(page.getByTestId(side).locator('.tiptap')).toContainText('y'.repeat(3000));
      }
    }
    await same(page);
    const bounds = await page
      .getByTestId('bounded')
      .getByTestId('proof')
      .evaluate((el) => (el as Host).proof.snapshot());
    expect(bounds.maxSpliceBytes).toBeLessThanOrEqual(4096);
    expect(bounds.backingStagedJournalBytes).toBe(0);
    for (const key of ['Control+z', 'Control+Shift+z']) {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(key);
      }
      await same(page);
    }
    await page
      .getByTestId('bounded')
      .getByTestId('proof')
      .evaluate((el) => (el as Host).proof.show(0, true));
    await same(page);
  });

test('review regression: 200 delayed navigations coalesce before capturing source', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(page.getByTestId('bounded').locator('.tiptap')).toHaveCount(1);
  const result = await page
    .getByTestId('bounded')
    .getByTestId('proof')
    .evaluate(async (el) => {
      const p = (el as Host).proof,
        releases: Array<() => void> = [];
      p.delayFetch = () => new Promise<void>((resolve) => releases.push(resolve));
      const pending = Array.from({ length: 200 }, () => p.show(0));
      const before = p.snapshot(),
        delayed = releases.length;
      p.delayFetch = undefined;
      releases.forEach((r) => r());
      const accepted = await Promise.all(pending);
      return { before, delayed, accepted: accepted.filter(Boolean).length, after: p.snapshot() };
    });
  expect(result.delayed).toBe(1);
  expect(result.before.pendingWindowRequests).toBe(1);
  expect(result.before.pendingNavigationRequests).toBe(1);
  expect(result.before.inFlightBytes).toBeLessThanOrEqual(16384);
  expect(result.accepted).toBe(1);
  expect(result.after.inFlightBytes).toBe(0);
});

test('review regression: rejected journal admission rolls back the editor, source, selection and redo branch', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await select(page, 'bounded', 1);
  await page.keyboard.type('A');
  await page.keyboard.press('Control+z');
  const result = await page
    .getByTestId('bounded')
    .getByTestId('proof')
    .evaluate((el) => {
      const p = (el as Host).proof;
      const snapshot = () => ({
        doc: p.editor!.getJSON(),
        selection: p.editor!.state.selection.toJSON(),
        logical: { ...p.selection },
        source: p.service.slice(0, p.service.length),
        revision: p.service.revision,
        depth: p.service.depth,
        cursor: p.service.cursor,
        anchors: structuredClone(p.service.anchors),
      });
      const before = snapshot(),
        record = p.service.record.bind(p.service);
      p.service.record = () => {
        throw new Error('Injected journal admission failure');
      };
      p.editor!.view.dispatch(p.editor!.state.tr.insertText('lost?'));
      const after = snapshot(),
        error = p.error;
      p.service.record = record;
      return { before, after, error };
    });
  expect(result.after).toEqual(result.before);
  expect(result.error).toContain('Injected journal admission failure');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('ARegion');
});

test('rapid seam selection preserves every native keyboard movement after repeated selection updates', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
  const edge = await seam(page);
  // Repeated native bursts expose a redraw racing the browser selectionchange task.
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const side of ['native', 'bounded']) {
      await select(page, side, edge - 3);
      for (let n = 0; n < 7; n++) await page.keyboard.press('Shift+ArrowRight');
      await settled(page);
    }
    await same(page);
  }
});
