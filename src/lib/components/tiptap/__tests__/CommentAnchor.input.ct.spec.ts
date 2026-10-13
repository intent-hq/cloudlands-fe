import { test, expect } from '../../../../test/ct-test';
import type { Editor } from '@tiptap/core';
import Harness from './NativeCommentInputHarness.svelte';

type NativeHost = HTMLElement & { editor: Editor; markdown(): string; evidence: unknown[] };
const source =
  '| A | B |\n| --- | --- |\n| left | right |\n\nfollowing START ' +
  Array.from({ length: 40 }, (_, i) =>
    i === 20 ? '<!--anchor:untouched:start-->protected<!--anchor:untouched:end-->' : `segment${i}`,
  ).join(' ') +
  '\n\nafter KEEP';

test('native direct input across a table preserves anchors outside the selected range', async ({
  mount,
  page,
}, info) => {
  await mount(Harness, { props: { source } });
  const host = page.getByTestId('native-comment-input');
  await expect.poll(() => host.evaluate((el) => !!(el as NativeHost).editor)).toBe(true);
  const before = await host.evaluate((el) => {
    const h = el as NativeHost,
      e = h.editor;
    e.view.focus();
    let tableEnd = 0;
    e.state.doc.forEach((n, at) => {
      if (n.type.name === 'table') tableEnd = at + n.nodeSize;
    });
    const left = e.state.doc.resolve(tableEnd - 3),
      right = tableEnd + 2;
    e.commands.setTextSelection({ from: left.pos, to: right });
    const records: unknown[] = [];
    h.evidence = records;
    const ids = (doc: typeof e.state.doc) => {
      const result: unknown[] = [];
      doc.descendants((n, at) => {
        if (n.type.name === 'commentAnchor') result.push({ at, id: n.attrs.id });
      });
      return result;
    };
    const dom = () =>
      Array.from(e.view.dom.querySelectorAll('[data-anchor-id]')).map((n) =>
        n.getAttribute('data-anchor-id'),
      );
    for (const event of ['beforeinput', 'input'])
      e.view.dom.addEventListener(
        event,
        (ev) => records.push({ event, inputType: (ev as InputEvent).inputType, dom: dom() }),
        true,
      );
    const observer = new MutationObserver((changes) =>
      records.push({
        event: 'mutation',
        dom: dom(),
        changes: changes.map((c) => ({
          type: c.type,
          added: Array.from(c.addedNodes).map((n) => n.textContent?.slice(0, 80)),
          removed: Array.from(c.removedNodes).map((n) => n.textContent?.slice(0, 80)),
        })),
      }),
    );
    observer.observe(e.view.dom, { childList: true, subtree: true, characterData: true });
    const dispatch = e.view.props.dispatchTransaction!;
    e.view.setProps({
      dispatchTransaction(tr) {
        records.push({
          event: 'transaction',
          steps: tr.steps.map((s) => s.toJSON()),
          markers: ids(tr.doc),
          selection: tr.selection.toJSON(),
        });
        dispatch.call(e.view, tr);
      },
    });
    return {
      markers: ids(e.state.doc),
      selection: e.state.selection.toJSON(),
      dom: dom(),
      layout: Array.from(e.view.dom.querySelectorAll('[data-anchor-id]')).map((node) => ({
        display: getComputedStyle(node).display,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      })),
    };
  });
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.keyboard.insertText('MOVE');
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  const after = await host.evaluate((el) => {
    const h = el as NativeHost;
    return { doc: h.editor.getJSON(), source: h.markdown(), evidence: h.evidence };
  });
  await info.attach('native-marker-mutations.json', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
  expect(before.markers).toHaveLength(2);
  expect(after.source).toContain('<!--anchor:untouched:start-->');
  expect(after.source).toContain('<!--anchor:untouched:end-->');
});

for (const operation of ['direct', 'typing', 'paste', 'composition'] as const) {
  for (const selected of operation === 'composition' ? [false, true, 'interior'] : [false, true]) {
    test(`native ${operation} ${!selected ? 'preserves distant' : operation === 'composition' && selected === true ? 'preserves native edge' : 'deletes interior'} anchors through history and reload`, async ({
      mount,
      page,
    }, info) => {
      const component = await mount(Harness, { props: { source } });
      const host = page.getByTestId('native-comment-input');
      await expect.poll(() => host.evaluate((el) => !!(el as NativeHost).editor)).toBe(true);
      const before = await host.evaluate((el, removeMarkers) => {
        const h = el as NativeHost,
          e = h.editor;
        const positions: number[] = [];
        e.state.doc.descendants((n, at) => {
          if (n.type.name === 'commentAnchor') positions.push(at);
        });
        let end = 0;
        e.state.doc.forEach((n, at) => {
          if (n.type.name === 'table') end = at + n.nodeSize;
        });
        e.view.focus();
        e.commands.setTextSelection(
          removeMarkers
            ? {
                from: positions[0] - (removeMarkers === 'interior' ? 1 : 0),
                to: positions[1] + (removeMarkers === 'interior' ? 2 : 1),
              }
            : { from: end - 3, to: end + 2 },
        );
        const events: unknown[] = [];
        h.evidence = events;
        for (const type of ['beforeinput', 'input', 'compositionstart', 'compositionend'])
          e.view.dom.addEventListener(
            type,
            (event) => {
              const selection = window.getSelection();
              events.push({
                type,
                inputType: (event as InputEvent).inputType,
                pm: e.state.selection.toJSON(),
                dom: selection && {
                  anchor:
                    selection.anchorNode &&
                    e.view.posAtDOM(selection.anchorNode, selection.anchorOffset),
                  head:
                    selection.focusNode &&
                    e.view.posAtDOM(selection.focusNode, selection.focusOffset),
                },
                ranges: Array.from((event as InputEvent).getTargetRanges?.() ?? []).map((r) => ({
                  from: e.view.posAtDOM(r.startContainer, r.startOffset),
                  to: e.view.posAtDOM(r.endContainer, r.endOffset),
                })),
              });
            },
            true,
          );
        return { doc: e.getJSON(), source: h.markdown(), selection: e.state.selection.toJSON() };
      }, selected);
      const settle = () =>
        page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
      await settle();
      if (operation === 'typing') await page.keyboard.type('MOVE');
      else if (operation === 'paste') {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.evaluate(() => navigator.clipboard.writeText('MOVE'));
        await page.keyboard.press('Control+v');
      } else if (operation === 'composition') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.imeSetComposition', {
          text: '移動',
          selectionStart: 2,
          selectionEnd: 2,
        });
        await settle();
        await cdp.send('Input.insertText', { text: '移動' });
        await cdp.detach();
      } else await page.keyboard.insertText('MOVE');
      await settle();
      const snapshot = () =>
        host.evaluate((el) => {
          const h = el as NativeHost,
            ids: string[] = [];
          h.editor.state.doc.descendants((n) => {
            if (n.type.name === 'commentAnchor') ids.push(n.attrs.id);
          });
          return {
            doc: h.editor.getJSON(),
            source: h.markdown(),
            ids,
            selection: h.editor.state.selection.toJSON(),
          };
        });
      const after = await snapshot();
      await info.attach('native-marker-input-phase.json', {
        body: JSON.stringify({
          before,
          after,
          events: await host.evaluate((el) => (el as NativeHost).evidence),
        }),
        contentType: 'application/json',
      });
      expect(after.source).toContain(operation === 'composition' ? '移動' : 'MOVE');
      if (operation === 'composition') expect(after.source.split('移動')).toHaveLength(2);
      const keepsMarkers = !selected || (operation === 'composition' && selected === true);
      expect(after.ids).toEqual(keepsMarkers ? ['untouched:start', 'untouched:end'] : []);
      expect(after.source.includes('<!--anchor:untouched:start-->')).toBe(keepsMarkers);
      expect(after.source.includes('<!--anchor:untouched:end-->')).toBe(keepsMarkers);
      if (!selected) expect(after.source).toContain('protected');
      expect(after.source.endsWith('after KEEP')).toBe(true);
      expect(after.source).not.toContain('\u2060');
      if (selected) expect(after.source).not.toContain('protected');
      const phases: unknown[] = [before, after];
      let undoCount = 0;
      while (undoCount < 5) {
        const changed = await host.evaluate((el) => (el as NativeHost).editor.commands.undo());
        if (!changed) break;
        undoCount++;
        await settle();
        const phase = await snapshot();
        phases.push({ undo: undoCount, ...phase });
        if (JSON.stringify(phase.doc) === JSON.stringify(before.doc)) break;
      }
      expect(undoCount).toBeGreaterThan(0);
      const restored = await snapshot();
      expect(restored.doc).toEqual(before.doc);
      expect(restored.source).toBe(before.source);
      expect(restored.ids).toEqual(['untouched:start', 'untouched:end']);
      for (let i = 0; i < undoCount; i++) {
        expect(await host.evaluate((el) => (el as NativeHost).editor.commands.redo())).toBe(true);
        await settle();
        phases.push({ redo: i + 1, ...(await snapshot()) });
      }
      expect((await snapshot()).doc).toEqual(after.doc);
      expect((await snapshot()).source).toBe(after.source);
      await component.unmount();
      await mount(Harness, { props: { source: after.source } });
      await expect.poll(() => host.evaluate((el) => !!(el as NativeHost).editor)).toBe(true);
      const fresh = await snapshot();
      expect([...new Set(fresh.ids)]).toEqual(
        keepsMarkers ? ['untouched:start', 'untouched:end'] : [],
      );
      expect(fresh.source).toContain(operation === 'composition' ? '移動' : 'MOVE');
      expect(fresh.source.endsWith('after KEEP')).toBe(true);
      if (operation === 'composition' && selected === true) {
        // Reproduce the original empty, display:none node view independently.
        // Chromium preserves atoms at the exact edges of its composition range.
        await host.evaluate(async (el, original) => {
          const h = el as NativeHost;
          h.editor.commands.setContent(original.doc);
          h.editor.view.dom.querySelectorAll<HTMLElement>('[data-anchor-id]').forEach((node) => {
            node.textContent = '';
            node.style.setProperty('display', 'none', 'important');
          });
          h.editor.view.focus();
          h.editor.commands.setTextSelection({
            from: original.selection.anchor,
            to: original.selection.head,
          });
        }, before);
        await settle();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.imeSetComposition', {
          text: '移動',
          selectionStart: 2,
          selectionEnd: 2,
        });
        await settle();
        await cdp.send('Input.insertText', { text: '移動' });
        await cdp.detach();
        await settle();
        const legacy = await snapshot();
        expect(after.doc).toEqual(legacy.doc);
        expect(after.selection).toEqual(legacy.selection);
        expect(after.source).toBe(legacy.source);
        phases.push({ legacy });
      }
      await info.attach('native-marker-lifecycle.json', {
        body: JSON.stringify({ operation, selected, phases, fresh }),
        contentType: 'application/json',
      });
    });
  }
}

for (const markdownCopy of [false, true]) {
  test(`anchor rendering content stays out of ${markdownCopy ? 'Markdown' : 'rich'} clipboard and fresh editor text`, async ({
    mount,
    page,
    context,
  }, info) => {
    let component = await mount(Harness, { props: { source, markdownCopy } });
    const host = page.getByTestId('native-comment-input');
    await expect.poll(() => host.evaluate((el) => !!(el as NativeHost).editor)).toBe(true);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const inspect = () =>
      host.evaluate((el) => {
        const h = el as NativeHost,
          e = h.editor;
        e.view.focus();
        e.commands.selectAll();
        const clipboard = e.view.serializeForClipboard(e.state.selection.content());
        return {
          source: h.markdown(),
          text: e.getText(),
          html: e.getHTML(),
          rich: clipboard.dom.innerHTML,
          plain: clipboard.text,
          domAtoms: Array.from(e.view.dom.querySelectorAll('[data-anchor-id]')).map(
            (node) => node.textContent,
          ),
        };
      });
    const live = await inspect();
    expect(live.domAtoms).toEqual(['\u2060', '\u2060']);
    for (const value of [live.source, live.text, live.html, live.rich, live.plain]) {
      expect(value).not.toContain('\u2060');
      expect(value).toContain('protected');
    }
    expect(live.rich).toContain('data-anchor-id="untouched:start"');
    expect(live.rich).toContain('data-anchor-id="untouched:end"');
    await page.keyboard.press('Control+c');
    const actual = await page.evaluate(async () => {
      const entries: Array<{ type: string; text: string }> = [];
      for (const item of await navigator.clipboard.read()) {
        for (const type of item.types)
          entries.push({ type, text: await (await item.getType(type)).text() });
      }
      return entries;
    });
    expect(actual.map((entry) => entry.type).sort()).toEqual(
      markdownCopy ? ['text/plain'] : ['text/html', 'text/plain'],
    );
    for (const entry of actual) {
      expect(entry.text).not.toContain('\u2060');
      expect(entry.text).toContain('protected');
    }
    await component.unmount();
    component = await mount(Harness, { props: { source: live.source, markdownCopy } });
    await expect.poll(() => host.evaluate((el) => !!(el as NativeHost).editor)).toBe(true);
    const fresh = await inspect();
    expect(fresh.text).toBe(live.text);
    for (const value of [fresh.source, fresh.text, fresh.html, fresh.rich, fresh.plain])
      expect(value).not.toContain('\u2060');
    expect(fresh.domAtoms).toEqual(['\u2060', '\u2060']);
    await info.attach('native-marker-clipboard.json', {
      body: JSON.stringify({ live, actual, fresh }),
      contentType: 'application/json',
    });
    await component.unmount();
  });
}
