import { test, expect } from '../../../../../test/ct-test';
import Harness from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';
import type { Editor } from '@tiptap/core';

const source =
  'plain café 🌍\n\nmarked **repeated**\n\n- parent\n  - child\n\n```text\nTARGET café 🌍\n```\n\n' +
  'following repeated café 🌍 '.repeat(800);
const target = source.indexOf('TARGET') + 2;

for (const cancel of [false, true]) {
  test(`Chromium mixed list/fence composition ${cancel ? 'cancel' : 'commit'} retains the view through delayed reads and remote invalidation`, async ({
    mount,
    page,
  }, info) => {
    await mount(Harness, { props: { sourceOverride: source } });
    const cdp = await page.context().newCDPSession(page);
    const observations = [];
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      const root = page.getByTestId(side).getByTestId('proof');
      await root.evaluate((el, target) => {
        const h = el as Host,
          e = h.proof?.editor ?? h.native;
        let at = h.proof?.projection!.pmAt(target) ?? -1;
        if (!h.proof)
          e.state.doc.descendants((node, pos) => {
            if (node.isText && node.text!.includes('TARGET'))
              at = pos + node.text!.indexOf('TARGET') + 2;
          });
        if (at < 0) throw new Error('Native composition target missing');
        e.commands.setTextSelection(at);
      }, target);
      await settled(page);
      if (side === 'bounded')
        await root.evaluate((el) => {
          const h = el as Host & { old: Editor; pending: Promise<boolean>; release: () => void };
          h.old = h.proof.editor!;
          h.proof.delayFetch = () =>
            new Promise<void>((resolve) => {
              h.release = resolve;
            });
          h.pending = h.proof.seek(h.proof.service.length - 100);
        });
      await cdp.send('Input.imeSetComposition', {
        text: '日本',
        selectionStart: 2,
        selectionEnd: 2,
      });
      await expect(root.locator('pre')).toContainText('日本');
      const during = await root.evaluate(async (el) => {
        const h = el as Host & { old: Editor; pending: Promise<boolean>; release: () => void };
        const e = h.proof?.editor ?? h.native;
        if (h.proof) {
          h.proof.remote({ from: 0, to: 0, insert: 'R ' });
          h.proof.delayFetch = undefined;
          h.release();
          return {
            accepted: await h.pending,
            sameView: h.old === h.proof.editor,
            destroyed: h.old.isDestroyed,
            composing: e.view.composing,
            error: h.proof.error,
          };
        }
        e.view.dispatch(e.state.tr.insertText('R ', 1).setMeta('addToHistory', false));
        return { composing: e.view.composing };
      });
      if (cancel)
        await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
      else await cdp.send('Input.insertText', { text: '日本語' });
      await settled(page);
      const after = await root.evaluate((el) => {
        const h = el as Host,
          e = h.proof?.editor ?? h.native;
        let code;
        e.state.doc.descendants((node) => {
          if (node.type.name === 'codeBlock') code = node.toJSON();
        });
        const dom = window.getSelection()!;
        return {
          code,
          offset: e.state.selection.$head.parentOffset,
          dom: e.view.posAtDOM(dom.focusNode!, dom.focusOffset),
          pm: e.state.selection.head,
          source: h.proof?.service.region(0),
          error: h.proof?.error ?? '',
          mapped: h.proof?.projection!.sourceAt(e.state.selection.head),
          logical: h.proof?.selection.head,
        };
      });
      observations.push({ during, after });
    }
    await info.attach('mixed-composition.json', {
      body: JSON.stringify(observations),
      contentType: 'application/json',
    });
    const [native, bounded] = observations;
    expect(bounded.during).toMatchObject({
      accepted: false,
      sameView: true,
      destroyed: false,
      composing: true,
      error: 'Stale or composing view pinned',
    });
    expect(bounded.after.error).toBe('');
    expect(bounded.after.code).toEqual(native.after.code);
    expect(bounded.after.offset).toBe(native.after.offset);
    for (const { after } of observations) expect(after.dom).toBe(after.pm);
    expect(bounded.after.mapped).toBe(bounded.after.logical);
    expect(bounded.after.source).toBe(
      'R ' + source.slice(0, target) + (cancel ? '' : '日本語') + source.slice(target),
    );
    const root = page.getByTestId('bounded').getByTestId('proof');
    await expect
      .poll(() => root.evaluate((el) => (el as Host).proof.editor!.view.composing))
      .toBe(false);
    expect(
      await root.evaluate(async (el) => {
        const p = (el as Host).proof,
          old = p.editor!;
        p.save();
        await p.seek(p.service.length - 100);
        return old.isDestroyed;
      }),
    ).toBe(true);
    if (!cancel) {
      const history = [];
      for (const [key, expected] of [
        ['Control+z', 'R ' + source],
        ['Control+Shift+z', bounded.after.source!],
      ]) {
        const states = [];
        for (const side of ['native', 'bounded']) {
          await focus(page, side);
          await page.keyboard.press(key);
          await settled(page);
          states.push(
            await page
              .getByTestId(side)
              .getByTestId('proof')
              .evaluate((el) => {
                const h = el as Host,
                  e = h.proof?.editor ?? h.native;
                let code;
                e.state.doc.descendants((node) => {
                  if (node.type.name === 'codeBlock') code = node.toJSON();
                });
                const dom = window.getSelection()!;
                return {
                  code,
                  offset: e.state.selection.$head.parentOffset,
                  dom: e.view.posAtDOM(dom.focusNode!, dom.focusOffset),
                  pm: e.state.selection.head,
                  source: h.proof?.service.region(0),
                  error: h.proof?.error ?? '',
                  mapped: h.proof?.projection!.sourceAt(e.state.selection.head),
                  logical: h.proof?.selection.head,
                };
              }),
          );
        }
        history.push(states);
        expect(states[1].source).toBe(expected);
        expect(states[1].code).toEqual(states[0].code);
        expect(states[1].offset).toBe(states[0].offset);
        expect(states[1].error).toBe('');
        expect(states[1].mapped).toBe(states[1].logical);
        for (const state of states) expect(state.dom).toBe(state.pm);
      }
      await info.attach('mixed-composition-history.json', {
        body: JSON.stringify(history),
        contentType: 'application/json',
      });
    }
    await cdp.detach();
  });
}
