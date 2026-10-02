import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

test('native Tab appends once at the true end of a horizontally paged table and restores column zero', async ({
  mount,
  page,
}, info) => {
  const source =
    '| ' +
    Array.from({ length: 80 }, (_, n) => `H${n}`).join(' | ') +
    ' |\n| ' +
    Array(80).fill('---').join(' | ') +
    ' |\n| ' +
    Array.from({ length: 80 }, (_, n) => `C${n}`).join(' | ') +
    ' |';
  await mount(Pair, { props: { sourceOverride: source } });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const native = document.querySelector(
          '[data-testid="native"] [data-testid="proof"]',
        ) as Host;
        const bounded = document.querySelector(
          '[data-testid="bounded"] [data-testid="proof"]',
        ) as Host;
        return !!native?.native?.isInitialized && !!bounded?.proof?.editor?.isInitialized;
      }),
    )
    .toBe(true);
  await page.evaluate(async (source) => {
    const native = (document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host)
      .native;
    const p = (document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host)
      .proof;
    await p.seek(source.indexOf('C79'));
    for (const editor of [native, p.editor!]) {
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.textContent === 'C79') at = pos + 1;
      });
      if (at < 0) throw Error('Native true-end cell missing');
      editor.commands.setTextSelection(at);
    }
  }, source);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Tab');
    await settled(page);
  }
  await expect
    .poll(() =>
      page.evaluate(() => {
        const p = (document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host)
          .proof;
        return p.projection?.table?.entries.find(
          (e) => e.cell.from === p.selection.table?.head.cell,
        )?.cell.row;
      }),
    )
    .toBe(2);
  const result = await page.evaluate(async () => {
    const nativeHost = document.querySelector(
      '[data-testid="native"] [data-testid="proof"]',
    ) as Host & { reloadNative(source: string): Promise<void> };
    const native = nativeHost.native;
    const host = document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host,
      p = host.proof;
    const full = native.getJSON(),
      source = p.service.region(0),
      entry = p.projection!.table!.entries.find(
        (e) => e.cell.from === p.selection.table!.head.cell,
      )!;
    const nativePoint = {
      row: native.state.selection.$head.index(1),
      column: native.state.selection.$head.index(2),
      offset: native.state.selection.$head.parentOffset,
    };
    const boundedPoint = {
      row: entry.cell.row,
      column: entry.cell.column,
      offset: p.editor!.state.selection.$head.parentOffset,
    };
    const old = p.editor!;
    p.save();
    await p.seek(p.selection.head);
    const destroyed = old.isDestroyed,
      selection = structuredClone(p.selection);
    await p.history();
    native.commands.undo();
    const undo = p.service.region(0);
    await p.history(true);
    native.commands.redo();
    await nativeHost.reloadNative(p.service.region(0));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return {
      full,
      source,
      nativePoint,
      boundedPoint,
      destroyed,
      selection,
      restored: p.selection,
      undo,
      redo: p.service.region(0),
      canonical: nativeHost.native.getJSON(),
      error: p.error,
      snapshot: p.snapshot(),
    };
  });
  expect(result.error).toBe('');
  expect(result.nativePoint).toEqual({ row: 2, column: 0, offset: 0 });
  expect(result.boundedPoint).toEqual(result.nativePoint);
  expect(result.source.startsWith(source)).toBe(true);
  expect(result.destroyed).toBe(true);
  expect(result.undo).toBe(source);
  expect(result.redo).toBe(result.source);
  expect(result.restored).toEqual({ ...result.selection, revision: result.restored.revision });
  expect(result.canonical).toEqual(result.full);
  expect(result.snapshot.maxSourceContextBytes).toBeLessThanOrEqual(16384);
  expect(result.snapshot.cachePages).toBeLessThanOrEqual(4);
  expect(result.snapshot.cacheBytes).toBeLessThanOrEqual(16384);
  expect(result.snapshot.maxSourceRead).toBeLessThanOrEqual(4096);
  await info.attach('true-end-tab', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
});
