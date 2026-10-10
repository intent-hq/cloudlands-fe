import { test, expect } from '../../../../test/ct-test';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import Harness from './NativeCommentInputHarness.svelte';
import PairHarness from './NativeCommentPairHarness.svelte';

type Host = HTMLElement & { editor: Editor; markdown(): string };
const source = 'before <!--anchor:caret:start-->protected<!--anchor:caret:end--> after KEEP';

for (const backward of [false, true]) {
  for (const input of ['typing', 'direct'] as const) {
    test(`composition edge ${backward ? 'backward' : 'forward'} accepts subsequent ${input}`, async ({
      mount,
      page,
    }, info) => {
      const host = page.getByTestId('native-comment-input');
      const settle = () =>
        page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
      const snapshot = () =>
        host.evaluate((el) => {
          const h = el as Host,
            e = h.editor,
            dom = document.getSelection()!;
          return {
            doc: e.getJSON(),
            source: h.markdown(),
            text: e.getText(),
            pm: { anchor: e.state.selection.anchor, head: e.state.selection.head },
            dom: {
              anchor: e.view.posAtDOM(dom.anchorNode!, dom.anchorOffset),
              head: e.view.posAtDOM(dom.focusNode!, dom.focusOffset),
            },
          };
        });
      const results = [];
      for (const original of [false, true]) {
        const component = await mount(Harness, { props: { source } });
        await expect.poll(() => host.evaluate((el) => !!(el as Host).editor)).toBe(true);
        await host.evaluate(
          (el, args) => {
            const e = (el as Host).editor,
              positions: number[] = [];
            if (args.original)
              e.view.dom.querySelectorAll<HTMLElement>('[data-anchor-id]').forEach((node) => {
                node.textContent = '';
                node.style.setProperty('display', 'none', 'important');
              });
            e.state.doc.descendants((node, pos) => {
              if (node.type.name === 'commentAnchor') positions.push(pos);
            });
            e.view.focus();
            e.commands.setTextSelection({
              from: args.backward ? positions[1] + 1 : positions[0],
              to: args.backward ? positions[0] : positions[1] + 1,
            });
          },
          { original, backward },
        );
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
        const committed = await snapshot();
        expect(committed.dom).toEqual(committed.pm);
        expect(committed.text.split('移動')).toHaveLength(2);
        if (input === 'typing') await page.keyboard.type('Q');
        else await page.keyboard.insertText('Q');
        await settle();
        const next = await snapshot();
        expect(next.dom).toEqual(next.pm);
        expect(next.text).toContain('移動Q');
        await host.evaluate((el) => (el as Host).editor.commands.undo());
        await settle();
        const undo = await snapshot();
        await host.evaluate((el) => (el as Host).editor.commands.redo());
        await settle();
        const redo = await snapshot();
        expect(redo.doc).toEqual(next.doc);
        results.push({ original, committed, next, undo, redo });
        await component.unmount();
      }
      await info.attach('native-caret-continuation.json', {
        body: JSON.stringify(results),
        contentType: 'application/json',
      });
      for (const phase of ['committed', 'next', 'undo', 'redo'] as const) {
        expect(results[0][phase]).toEqual(results[1][phase]);
      }
    });
  }
}

for (const change of ['destroy', 'blur', 'range', 'current', 'other-editor'] as const) {
  test(`queued composition caret repair respects ${change}`, async ({ mount, page }, info) => {
    const results = [];
    for (const composition of [false, true]) {
      const component = await mount(PairHarness, { props: { source } });
      const hosts = page.getByTestId('native-comment-input');
      await expect
        .poll(() => hosts.evaluateAll((els) => els.filter((el) => !!(el as Host).editor).length))
        .toBe(2);
      const result = await hosts.evaluateAll(
        async (els, args) => {
          const { change, composition } = args;
          const first = (els[0] as Host).editor,
            second = (els[1] as Host).editor;
          const initial = first.getJSON();
          first.view.focus();
          first.commands.setTextSelection(2);
          first.commands.insertContent('Z');
          // Finish the existing onUpdate focus restoration before isolating a
          // later composition-end microtask from lifecycle changes.
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const before = first.getJSON(),
            secondBefore = second.getJSON();
          const view = first.view,
            dom = document.getSelection()!;
          if (composition) {
            const anchor = view.dom.querySelector('[data-anchor-id]')!;
            dom.collapse(anchor.firstChild!, 1);
            view.dom.dispatchEvent(
              new CompositionEvent('compositionend', { bubbles: true, data: '' }),
            );
          }
          if (change === 'destroy') first.destroy();
          if (change === 'blur') (document.activeElement as HTMLElement).blur();
          if (change === 'range') first.commands.setTextSelection({ from: 2, to: 5 });
          if (change === 'current') first.commands.setTextSelection(4);
          if (change === 'other-editor') {
            second.view.focus();
            second.commands.setTextSelection(3);
          }
          const expectedSelection = first.state.selection.toJSON();
          const expectedFocus = document.activeElement;
          const transactions: {
            docChanged: boolean;
            selectionSet: boolean;
            addToHistory: unknown;
            focus: boolean;
            blur: boolean;
          }[] = [];
          const record = ({ transaction }: { transaction: Transaction }) => {
            transactions.push({
              docChanged: transaction.docChanged,
              selectionSet: transaction.selectionSet,
              addToHistory: transaction.getMeta('addToHistory'),
              focus: !!transaction.getMeta('focus'),
              blur: !!transaction.getMeta('blur'),
            });
          };
          first.on('transaction', record);
          second.on('transaction', record);
          await Promise.resolve();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const after = first.getJSON(),
            secondAfter = second.getJSON();
          const selection = first.state.selection.toJSON();
          const focusUnchanged = document.activeElement === expectedFocus;
          const active = change === 'other-editor' ? second : first;
          const browser = document.getSelection()!;
          const mapped =
            change === 'destroy' || change === 'blur'
              ? null
              : {
                  anchor: active.view.posAtDOM(browser.anchorNode!, browser.anchorOffset),
                  head: active.view.posAtDOM(browser.focusNode!, browser.focusOffset),
                };
          const current = {
            anchor: active.state.selection.anchor,
            head: active.state.selection.head,
          };
          first.off('transaction', record);
          second.off('transaction', record);
          return {
            initial,
            before,
            after,
            secondBefore,
            secondAfter,
            transactions,
            expectedSelection,
            selection,
            focusUnchanged,
            mapped,
            current,
          };
        },
        { change, composition },
      );
      await info.attach(`lifecycle-${composition ? 'composition' : 'control'}.json`, {
        body: JSON.stringify(result),
        contentType: 'application/json',
      });
      expect(result.after).toEqual(result.before);
      expect(result.secondAfter).toEqual(result.secondBefore);
      expect(result.selection).toEqual(result.expectedSelection);
      expect(result.focusUnchanged).toBe(true);
      if (result.mapped) expect(result.mapped).toEqual(result.current);
      for (const transaction of result.transactions) {
        expect(transaction.docChanged).toBe(false);
        expect(transaction.selectionSet).toBe(false);
      }
      if (change === 'other-editor') {
        await page.keyboard.type('Q');
        expect(await hosts.nth(1).evaluate((el) => (el as Host).editor.getText())).toContain(
          'beQfore',
        );
        expect(await hosts.nth(0).evaluate((el) => (el as Host).editor.getJSON())).toEqual(
          result.before,
        );
      }
      if (change !== 'destroy') {
        const undone = await hosts.nth(0).evaluate((el) => {
          const e = (el as Host).editor;
          e.commands.undo();
          return e.getJSON();
        });
        expect(undone).toEqual(result.initial);
      }
      results.push(result);
      await component.unmount();
    }
    // Compare native lifecycle notifications without a composition event. The
    // repair must add no transactions, including empty or history-only ones.
    expect(results[1]).toEqual(results[0]);
  });
}

test('ordinary composition outside anchors preserves native input and undo grouping', async ({
  mount,
  page,
}) => {
  const host = page.getByTestId('native-comment-input');
  const results = [];
  for (const original of [false, true]) {
    const component = await mount(Harness, { props: { source } });
    await expect.poll(() => host.evaluate((el) => !!(el as Host).editor)).toBe(true);
    await host.evaluate((el, original) => {
      const e = (el as Host).editor;
      if (original)
        e.view.dom.querySelectorAll<HTMLElement>('[data-anchor-id]').forEach((n) => {
          n.textContent = '';
          n.style.setProperty('display', 'none', 'important');
        });
      e.view.focus();
      e.commands.setTextSelection(3);
    }, original);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '移動', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: '移動' });
    await cdp.detach();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.keyboard.type('Q');
    results.push(
      await host.evaluate((el) => {
        const h = el as Host,
          e = h.editor,
          dom = document.getSelection()!;
        const next = {
          doc: e.getJSON(),
          source: h.markdown(),
          pm: e.state.selection.toJSON(),
          dom: e.view.posAtDOM(dom.focusNode!, dom.focusOffset),
        };
        e.commands.undo();
        const undo = { doc: e.getJSON(), pm: e.state.selection.toJSON() };
        e.commands.redo();
        const redo = { doc: e.getJSON(), pm: e.state.selection.toJSON() };
        return { next, undo, redo };
      }),
    );
    await component.unmount();
  }
  expect(results[0]).toEqual(results[1]);
  expect(results[0].next.source).toContain('be移動Qfore');
});
