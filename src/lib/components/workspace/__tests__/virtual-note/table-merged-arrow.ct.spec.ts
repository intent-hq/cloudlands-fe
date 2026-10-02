import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';
import type { SourceJournal } from './source-journal';
import type { DocumentSession } from './document-session';
import type { TableIndex } from './table-source';

for (const key of ['ArrowUp', 'ArrowDown'])
  test(`native delayed ${key} traverses a visible merged paragraph boundary`, async ({
    mount,
    page,
  }, info) => {
    const source =
      '| H | R |\n| --- | --- |\n' +
      Array.from({ length: 120 }, (_, r) => `| left${r} | right${r} |`).join('\n');
    await mount(Pair, { props: { sourceOverride: source } });
    const fixture = await page.evaluate(async () => {
      const host = (side: string) =>
        document.querySelector(`[data-testid="${side}"] [data-testid="proof"]`) as Host;
      const native = host('native').native;
      const cells: number[] = [];
      native.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableCell' && node.textContent.startsWith('left')) cells.push(pos);
      });
      native.commands.setCellSelection({ anchorCell: cells[0], headCell: cells.at(-1)! });
      if (!native.commands.mergeCells()) throw new Error('Native merged fixture failed');
      const saved = (host('native') as Host & { nativeMarkdown(): string }).nativeMarkdown();
      const old = host('bounded').proof;
      // Fixture setup is full native oracle/backing state, not a bounded merge claim.
      const service = new (old.service.constructor as typeof SourceJournal)(() => saved, 1);
      const backing = service as unknown as {
        tableIndex(source: string, start: number): TableIndex[];
        tableStates: Map<string, string>;
      };
      const raw = backing.tableIndex(saved, 0)[0];
      native.state.doc.firstChild!.forEach((row, _p, r) =>
        row.forEach((cell, _q, c) => {
          backing.tableStates.set(
            `cell:${raw.rows[r].cells[c].from}`,
            JSON.stringify(cell.toJSON()),
          );
        }),
      );
      const fixtureBytes = new TextEncoder().encode(
        JSON.stringify([...backing.tableStates]),
      ).length;
      old.destroy();
      const p = new (old.constructor as typeof DocumentSession)(
        service,
        host('bounded').querySelector('[data-testid="editor-host"]')!,
      );
      host('bounded').proof = p;
      await p.seek(saved.indexOf('left0'));
      return {
        saved,
        fixtureBytes,
        paragraphs: native.state.doc.firstChild!.child(1).firstChild!.childCount,
      };
    });

    const root = page.getByTestId('bounded').getByTestId('proof');
    await focus(page, 'bounded');
    await root.evaluate((el) => {
      const scroll = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
      scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * 0.5;
    });
    await settled(page);
    const target = await root.evaluate((el, key) => {
      const h = el as Host & { releaseArrow?: () => void },
        p = h.proof;
      const entry = p.projection!.table!.entries.find((e) => e.cell.owner)!;
      if (!entry) throw Error('Merged owner not mounted');
      const paragraphs = p.projection!.table!.paragraphs.filter(
        (q) => q.cell.from === entry.cell.from,
      );
      const paragraph = key === 'ArrowUp' ? paragraphs[0] : paragraphs.at(-1)!;
      const at = key === 'ArrowUp' ? paragraph.pm : paragraph.end;
      const point = p.projection!.table!.pointAt(at)!;
      const text = p.editor!.state.doc.nodeAt(paragraph.pm - 1)!.textContent;
      p.delayFetch = () =>
        new Promise<void>((resolve) => {
          h.releaseArrow = resolve;
        });
      p.editor!.commands.setTextSelection(at);
      return {
        point,
        text,
        blocks: entry.cell.blocks!.map((b) => b.index),
        count: entry.cell.blockCount!,
      };
    }, key);
    expect(target.blocks[0]).toBeGreaterThan(0);
    expect(target.blocks.at(-1)!).toBeLessThan(target.count - 1);
    await page.keyboard.press(key);
    await root.evaluate((el) => {
      const h = el as Host & { releaseArrow?: () => void };
      h.proof.delayFetch = undefined;
      h.releaseArrow?.();
    });
    await expect
      .poll(() => root.evaluate((el) => (el as Host).proof.service.pendingInputs))
      .toBe(0);
    await settled(page);
    const bounded = await root.evaluate(async (el) => {
      const p = (el as Host).proof;
      const selected = structuredClone(p.selection.table!);
      const actual = p.projection!.table!.pointAt(p.editor!.state.selection.head);
      const old = p.editor!;
      await p.seek(p.selection.head);
      return {
        selected,
        actual,
        restored: p.selection.table,
        destroyed: old.isDestroyed,
        source: p.service.region(0),
        error: p.error,
        stats: p.snapshot(),
      };
    });
    await focus(page, 'native');
    await page
      .getByTestId('native')
      .getByTestId('proof')
      .evaluate((el, target) => {
        const editor = (el as Host).native;
        let at = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'paragraph' && node.textContent === target.text)
            at = pos + 1 + target.point.offset;
        });
        if (at < 1) throw Error('Native merged paragraph not found');
        editor.commands.setTextSelection(at);
        editor.view.dispatch(editor.state.tr.scrollIntoView());
      }, target);
    await settled(page);
    await expect
      .poll(() =>
        root.evaluate((el) => {
          const p = (el as Host).proof;
          return !p.pendingFetch && !p.service.pendingInputs && !p.navigating;
        }),
      )
      .toBe(true);
    // Scrolling the full native oracle can finish an independent bounded scroll mount.
    // Activate the native editor only after that fixture navigation has settled.
    await focus(page, 'native');
    const nativeBefore = await page
      .getByTestId('native')
      .getByTestId('proof')
      .evaluate((el) => {
        const editor = (el as Host).native,
          dom = window.getSelection();
        return {
          active: document.activeElement === editor.view.dom,
          pm: editor.state.selection.toJSON(),
          dom:
            dom?.focusNode && editor.view.dom.contains(dom.focusNode)
              ? {
                  anchor: editor.view.posAtDOM(dom.anchorNode!, dom.anchorOffset),
                  head: editor.view.posAtDOM(dom.focusNode, dom.focusOffset),
                }
              : null,
        };
      });
    await info.attach('native-arrow-precondition.json', {
      body: JSON.stringify(nativeBefore),
      contentType: 'application/json',
    });
    expect(nativeBefore.active).toBe(true);
    expect(nativeBefore.dom).toEqual({
      anchor: nativeBefore.pm.anchor,
      head: nativeBefore.pm.head,
    });
    await page.keyboard.press(key);
    await settled(page);
    const native = await page
      .getByTestId('native')
      .getByTestId('proof')
      .evaluate((el) => {
        const s = (el as Host).native.state.selection;
        return { block: s.$head.index(3), offset: s.$head.parentOffset };
      });
    await info.attach('merged-arrow.json', {
      body: JSON.stringify({ fixture, target, bounded, native }),
      contentType: 'application/json',
    });
    expect(native.block).toBe(target.point.block + (key === 'ArrowUp' ? -1 : 1));
    expect(bounded.selected.head).toEqual({ cell: target.point.cell, ...native });
    expect(bounded.actual).toEqual(bounded.selected.head);
    expect(bounded.restored).toEqual(bounded.selected);
    expect(bounded.destroyed).toBe(true);
    expect(bounded.error).toBe('');
    expect(bounded.source).toBe(fixture.saved);
    expect(bounded.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(bounded.stats.pmNodes).toBeLessThanOrEqual(4096);
  });
