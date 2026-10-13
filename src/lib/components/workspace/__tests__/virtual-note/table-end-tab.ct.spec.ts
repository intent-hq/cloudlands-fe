import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

for (const columns of [2, 80])
  test(`native Tab appends once at the true end of a ${columns}-column table and restores column zero`, async ({
    mount,
    page,
  }, info) => {
    const source =
      '| ' +
      Array.from({ length: columns }, (_, n) => `H${n}`).join(' | ') +
      ' |\n| ' +
      Array(columns).fill('---').join(' | ') +
      ' |\n| ' +
      Array.from({ length: columns }, (_, n) => `C${n}`).join(' | ') +
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
    await page.evaluate(
      async ({ source, last }) => {
        const native = (
          document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host
        ).native;
        const p = (document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host)
          .proof;
        await p.seek(source.indexOf(last));
        for (const editor of [native, p.editor!]) {
          let at = -1;
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name === 'paragraph' && node.textContent === last) at = pos + 1;
          });
          if (at < 0) throw Error('Native true-end cell missing');
          editor.commands.setTextSelection(at);
        }
      },
      { source, last: `C${columns - 1}` },
    );
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Tab');
      await settled(page);
    }
    await expect
      .poll(() =>
        page.evaluate(() => {
          const p = (
            document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host
          ).proof;
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
        boundedLive = p.editor!.getJSON(),
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
        liveAfterEviction = p.editor!.getJSON(),
        liveTrailing = p.editor!.state.doc.lastChild!.toJSON(),
        selection = structuredClone(p.selection);
      await p.history();
      native.commands.undo();
      const undo = p.service.region(0),
        nativeUndo = native.getJSON(),
        boundedUndo = p.editor!.getJSON();
      await p.history(true);
      native.commands.redo();
      const nativeRedo = native.getJSON(),
        boundedRedo = p.editor!.getJSON();
      const restored = structuredClone(p.selection),
        redo = p.service.region(0),
        snapshot = p.snapshot();
      await nativeHost.reloadNative(p.service.region(0));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await (host as Host & { reopenProof(source: string): Promise<void> }).reopenProof(source);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return {
        full,
        boundedLive,
        liveAfterEviction,
        boundedUndo,
        boundedRedo,
        freshBounded: host.proof.editor!.getJSON(),
        source,
        nativePoint,
        boundedPoint,
        destroyed,
        liveTrailing,
        nativeUndo,
        nativeRedo,
        selection,
        restored,
        undo,
        redo,
        canonical: nativeHost.native.getJSON(),
        error: p.error,
        snapshot,
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
    // Native Tab appends the editor's trailing paragraph during the live transaction.
    // A new canonical reload does not append it until a later native transaction.
    // paragraph-enter.test.ts independently verifies both phases without the proof.
    expect(result.canonical.content).toHaveLength(1);
    expect(result.canonical.content![0].type).toBe('table');
    expect(result.full).toEqual({
      type: 'doc',
      content: [...result.canonical.content!, { type: 'paragraph' }],
    });
    expect(result.liveTrailing).toEqual({ type: 'paragraph' });
    expect(result.nativeRedo).toEqual(result.full);
    if (columns === 2) {
      expect(result.boundedLive).toEqual(result.full);
      expect(result.liveAfterEviction).toEqual(result.full);
      expect(result.boundedUndo).toEqual(result.nativeUndo);
      expect(result.boundedRedo).toEqual(result.nativeRedo);
      expect(result.freshBounded).toEqual(result.canonical);
    }
    expect(result.nativeUndo.content![0].content).toHaveLength(2);
    expect(result.snapshot.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(result.snapshot.cachePages).toBeLessThanOrEqual(4);
    expect(result.snapshot.cacheBytes).toBeLessThanOrEqual(16384);
    expect(result.snapshot.maxSourceRead).toBeLessThanOrEqual(4096);
    await info.attach('true-end-tab', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
  });
