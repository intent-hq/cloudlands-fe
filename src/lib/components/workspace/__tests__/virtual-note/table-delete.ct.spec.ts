import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';
import type { JSONContent } from '@tiptap/core';

for (const newlineCount of [2, 4]) {
  test(`native table deletion preserves live boundary and fresh parser phases (${newlineCount} left newlines)`, async ({
    mount,
    page,
  }, info) => {
    const prefix = 'untouched **prefix**' + '\n'.repeat(newlineCount);
    const table =
      '| H | R |\n| --- | --- |\n' +
      Array.from({ length: 80 }, (_, r) => `| left${r} | right${r} |`).join('\n') +
      '\n';
    const suffix = '\nuntouched _suffix_';
    const source = prefix + table + suffix,
      saved = prefix + suffix;
    await mount(Pair, { props: { sourceOverride: source } });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const a = document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host;
          const b = document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host;
          return !!a?.native?.isInitialized && !!b?.proof?.editor?.isInitialized;
        }),
      )
      .toBe(true);
    const phases = await page.evaluate(
      async ({ source, saved }) => {
        const native = (
          document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host
        ).native;
        const host = document.querySelector(
          '[data-testid="bounded"] [data-testid="proof"]',
        ) as Host & {
          parseSource(source: string): Promise<{ doc: JSONContent }>;
        };
        const p = host.proof;
        await p.seek(source.indexOf('right30'));
        for (const editor of [native, p.editor!]) {
          let at = -1;
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name === 'paragraph' && node.textContent === 'right30') at = pos + 1;
          });
          if (at < 0) throw Error('Deletion fixture endpoint missing');
          editor.commands.setTextSelection(at);
        }
        const initial = native.getJSON();
        const accepted = [native.commands.deleteTable(), p.editor!.commands.deleteTable()];
        p.save();
        const old = p.editor!;
        await p.seek(p.selection.head);
        const live = {
          native: native.getJSON(),
          bounded: p.editor!.getJSON(),
          nativeSelection: native.state.selection.toJSON(),
          boundedSelection: p.editor!.state.selection.toJSON(),
          source: p.service.region(0),
          destroyed: old.isDestroyed,
          error: p.error,
        };
        const fresh = (await host.parseSource(saved)).doc;
        await p.history();
        native.commands.undo();
        const undo = {
          source: p.service.region(0),
          native: native.getJSON(),
          initial,
          error: p.error,
        };
        await p.history(true);
        native.commands.redo();
        const redo = {
          source: p.service.region(0),
          native: native.getJSON(),
          bounded: p.editor!.getJSON(),
          nativeSelection: native.state.selection.toJSON(),
          boundedSelection: p.editor!.state.selection.toJSON(),
          error: p.error,
        };
        return { accepted, live, fresh, undo, redo, snapshot: p.snapshot() };
      },
      { source, saved },
    );
    expect(phases.accepted).toEqual([true, true]);
    expect(phases.live.error).toBe('');
    expect(phases.live.destroyed).toBe(true);
    expect(phases.live.source).toBe(saved);
    expect(phases.live.bounded).toEqual(phases.live.native);
    expect(phases.live.boundedSelection).toEqual(phases.live.nativeSelection);
    expect(phases.fresh.content).toHaveLength(phases.live.native.content!.length + 1);
    expect(phases.fresh.content?.filter((n) => n.content?.length)).toEqual(
      phases.live.native.content?.filter((n) => n.content?.length),
    );
    expect(phases.undo.error).toBe('');
    expect(phases.undo.source).toBe(source);
    expect(phases.undo.native).toEqual(phases.undo.initial);
    expect(phases.redo.error).toBe('');
    expect(phases.redo.source).toBe(saved);
    expect(phases.redo.bounded).toEqual(phases.redo.native);
    expect(phases.redo.boundedSelection).toEqual(phases.redo.nativeSelection);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.type('TYPED');
      if (side === 'bounded') await settled(page);
    }
    const edited = await page.evaluate(async () => {
      const native = (
        document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host
      ).native;
      const host = document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host;
      const p = host.proof,
        old = p.editor!;
      await p.seek(p.selection.head);
      return {
        native: native.getJSON(),
        bounded: p.editor!.getJSON(),
        source: p.service.region(0),
        destroyed: old.isDestroyed,
        error: p.error,
        snapshot: p.snapshot(),
      };
    });
    expect(edited.error).toBe('');
    expect(edited.destroyed).toBe(true);
    expect(edited.bounded).toEqual(edited.native);
    expect(edited.source.replace('TYPED', '')).toBe(saved);
    expect(edited.snapshot.maxSourceRead).toBeLessThanOrEqual(4096);
    expect(edited.snapshot.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(edited.snapshot.cachePages).toBeLessThanOrEqual(4);
    expect(edited.snapshot.cacheBytes).toBeLessThanOrEqual(16384);
    expect(edited.snapshot.pmNodes).toBeLessThanOrEqual(256);
    await info.attach('deletion-phases', {
      body: JSON.stringify({ phases, edited }),
      contentType: 'application/json',
    });
  });
}
