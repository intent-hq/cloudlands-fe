import { test, expect } from '../../../../../test/ct-test';
import Harness from './DocumentProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';

for (const mode of ['typing', 'clipboard', 'delayed'] as const)
  test(`dense table ${mode} and destroyed-view history preserve native text, marks and exact source`, async ({
    mount,
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const copies: string[] = [];
    const performEdit = async () => {
      await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
      if (mode !== 'clipboard') {
        await page.keyboard.type('Z');
        return;
      }
      await page.keyboard.press('Shift+ArrowRight');
      await settled(page);
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('l');
      await page.keyboard.press('Control+c');
      copies.push(await page.evaluate(() => navigator.clipboard.readText()));
      await page.keyboard.press('Control+x');
      await settled(page);
      await page.clock.setFixedTime(new Date('2026-10-02T12:00:01Z'));
      await page.keyboard.press('Control+v');
      await settled(page);
    };
    const source =
      '| H |\n| --- |\n| CELL_START ' +
      '**bold** _italic_ `code` \\| \\\\ '.repeat(1500) +
      ' CELL_END |';
    let component = await mount(Harness, { props: { sourceOverride: source } });
    const root = page.getByTestId('proof');
    await expect(root.locator('.tiptap')).toHaveCount(1);
    const scrollMiddle = async () => {
      await root.evaluate((el) => {
        const scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
      });
      await settled(page);
    };
    await scrollMiddle();
    const target = await root.evaluate((el) => {
      const p = (el as Host).proof,
        editor = p.editor!;
      const scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
      const viewport = scroller.getBoundingClientRect();
      const strong = Array.from(editor.view.dom.querySelectorAll('strong')).find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top > viewport.top + 150 && rect.bottom < viewport.top + 350;
      });
      if (!strong) throw new Error('No visible dense marked target');
      const text = document.createTreeWalker(strong, NodeFilter.SHOW_TEXT).nextNode();
      if (text?.textContent !== 'bold') throw new Error('Native bold text leaf missing');
      const pm = editor.view.posAtDOM(text, 2);
      return { source: p.projection!.sourceAt(pm), point: p.projection!.table!.pointAt(pm)! };
    });
    await component.unmount();
    // Independent full native editor is an explicitly unbounded oracle only.
    component = await mount(Harness, { props: { sourceOverride: source, oracle: true } });
    await expect(root.locator('.tiptap')).toHaveCount(1);
    await root.evaluate((el, offset) => {
      const editor = (el as Host).native;
      let paragraph = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.textContent.startsWith('CELL_START'))
          paragraph = pos;
      });
      if (paragraph < 0) throw new Error('Native body cell missing');
      editor.view.focus();
      editor.commands.setTextSelection(paragraph + 1 + offset);
    }, target.point.offset);
    await settled(page);
    await performEdit();
    const native = await root.evaluate((el) => {
      const editor = (el as Host).native;
      return {
        doc: editor.getJSON(),
        offset: editor.state.selection.$head.parentOffset,
        marks: editor.state.selection.$head.marks().map((m) => m.toJSON()),
      };
    });
    expect(native.offset).toBe(target.point.offset + 1);
    expect(native.marks).toEqual([{ type: 'bold' }]);
    await page.keyboard.press('Control+z');
    await settled(page);
    const nativeUndo = await root.evaluate((el) => {
      const e = (el as Host).native;
      return { doc: e.getJSON(), offset: e.state.selection.$head.parentOffset };
    });
    await page.keyboard.press('Control+Shift+z');
    await settled(page);
    expect(await root.evaluate((el) => (el as Host).native.getJSON())).toEqual(native.doc);
    await component.unmount();
    component = await mount(Harness, { props: { sourceOverride: source } });
    await expect(root.locator('.tiptap')).toHaveCount(1);
    await scrollMiddle();
    const selected = await root.evaluate((el, target) => {
      const p = (el as Host).proof,
        editor = p.editor!;
      editor.view.focus();
      const pm = p.projection!.table!.pointPM(target.point)!;
      editor.commands.setTextSelection(pm);
      return p.projection!.table!.pointAt(pm);
    }, target);
    expect(selected).toEqual(target.point);
    await settled(page);
    await performEdit();
    await settled(page);
    const edited = await root.evaluate(async (el) => {
      const h = el as Host,
        p = h.proof;
      p.save();
      return {
        source: p.service.region(0),
        parsed: (await h.parseSource(p.service.region(0))).doc,
        point: p.selection.table!.head,
        error: p.error,
        stats: p.snapshot(),
        marks: p.editor!.state.selection.$head.marks().map((m) => m.toJSON()),
      };
    });
    await info.attach('dense-native-edit.json', {
      body: JSON.stringify({ target, native, edited }),
      contentType: 'application/json',
    });
    expect(edited.error).toBe('');
    expect(edited.source).toBe(
      mode === 'clipboard'
        ? source
        : source.slice(0, target.source) + 'Z' + source.slice(target.source),
    );
    if (mode === 'clipboard') expect(copies).toEqual(['l', 'l']);
    // The canonical parser contains source-backed nodes only. The actual native
    // editor additionally maintains its source-less terminal paragraph.
    expect(native.doc.content).toHaveLength(2);
    expect(native.doc.content![1]).toEqual({ type: 'paragraph' });
    const canonical = { type: 'doc', content: [native.doc.content![0]] };
    expect(edited.parsed).toEqual(canonical);
    expect(edited.point.offset).toBe(native.offset);
    expect(edited.marks).toEqual(native.marks);
    if (mode === 'delayed')
      await root.evaluate((el) => {
        const h = el as Host & { releaseDense: () => void };
        h.proof.delayFetch = () =>
          new Promise<void>((resolve) => {
            h.releaseDense = resolve;
          });
      });
    const destroyed = await root.evaluate(async (el) => {
      const p = (el as Host).proof,
        old = p.editor!;
      const scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
      Object.assign(el, { oldDenseView: old });
      scroller.scrollTop = 0;
      return p.destroyed;
    });
    await settled(page);
    if (mode === 'delayed') {
      await expect
        .poll(() =>
          root.evaluate((el) => typeof (el as Host & { releaseDense?: () => void }).releaseDense),
        )
        .toBe('function');
      expect(await root.evaluate((el) => (el as Host).proof.destroyed)).toBe(destroyed);
      await root.evaluate((el) => {
        const h = el as Host & { releaseDense: () => void };
        h.proof.delayFetch = undefined;
        h.releaseDense();
      });
      await settled(page);
    }
    expect(await root.evaluate((el) => (el as Host).proof.destroyed)).toBeGreaterThan(destroyed);
    expect(
      await root.evaluate(
        (el) =>
          (el as HTMLElement & { oldDenseView: { isDestroyed: boolean } }).oldDenseView.isDestroyed,
      ),
    ).toBe(true);
    await root.evaluate((el) => (el as Host).proof.editor!.view.focus());
    await page.keyboard.press('Control+z');
    await settled(page);
    const undone = await root.evaluate(async (el) => {
      const h = el as Host;
      return {
        source: h.proof.service.region(0),
        parsed: (await h.parseSource(h.proof.service.region(0))).doc,
        point: h.proof.selection.table!.head,
      };
    });
    expect(undone.source).toBe(
      mode === 'clipboard'
        ? source.slice(0, target.source) + source.slice(target.source + 1)
        : source,
    );
    expect(undone.parsed).toEqual({ type: 'doc', content: [nativeUndo.doc.content![0]] });
    expect(undone.point.offset).toBe(nativeUndo.offset);
    await page.keyboard.press('Control+Shift+z');
    await settled(page);
    const restored = await root.evaluate(async (el) => {
      const h = el as Host,
        p = h.proof;
      return {
        source: p.service.region(0),
        parsed: (await h.parseSource(p.service.region(0))).doc,
        point: p.selection.table!.head,
        error: p.error,
        stats: p.snapshot(),
      };
    });
    expect(restored.error).toBe('');
    expect(restored.source).toBe(edited.source);
    expect(restored.parsed).toEqual(canonical);
    expect(restored.point).toEqual(edited.point);
    for (const snapshot of [edited.stats, restored.stats]) {
      expect(snapshot.maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(snapshot.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
      expect(snapshot.cachePages).toBeLessThanOrEqual(4);
      expect(snapshot.cacheBytes).toBeLessThanOrEqual(16384);
      expect(snapshot.pmNodes).toBeLessThanOrEqual(4096);
    }
    await info.attach('dense-native-history.json', {
      body: JSON.stringify(restored),
      contentType: 'application/json',
    });
    await component.unmount();
    await mount(Harness, { props: { sourceOverride: restored.source, oracle: true } });
    await expect(root.locator('.tiptap')).toHaveCount(1);
    await root.evaluate((el) => {
      const editor = (el as Host).native;
      editor.view.focus();
      editor.commands.setTextSelection(4);
    });
    await settled(page);
    const reloaded = await root.evaluate((el) => (el as Host).native.getJSON());
    expect(reloaded).toEqual(native.doc);
    await info.attach('dense-native-reload.json', {
      body: JSON.stringify(reloaded),
      contentType: 'application/json',
    });
  });
