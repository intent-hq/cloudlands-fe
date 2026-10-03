import { test, expect } from '../../../../../test/ct-test';
import Harness from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

const opening = '<!--anchor:cmt-cross:start-->',
  closing = '<!--anchor:cmt-cross:end-->';
const prefix = 'outside repeated café 🌍 '.repeat(200);
const body =
  'inside repeated café 🌍 '.repeat(220) + 'EDITME' + 'inside repeated café 🌍 '.repeat(220);
const source = prefix + opening + body + closing + ' following repeated café 🌍 '.repeat(200);
const target = source.indexOf('EDITME') + 2;

test('visible annotation overlap and dirty draft survive native typing, eviction and keyboard history', async ({
  mount,
  page,
}, info) => {
  await mount(Harness, { props: { sourceOverride: source, anchors: true } });
  await focus(page, 'bounded');
  await page
    .getByTestId('bounded')
    .getByTestId('proof')
    .evaluate(async (el, target) => {
      const p = (el as Host).proof;
      p.service.anchors = [];
      p.service.registerComment('cmt-cross');
      p.service.stageCommentDraft('cmt-cross', 0, 0, 'unsent café 🌍 draft');
      p.service.replaceAttribution(p.service.revision, p.service.generation, [
        {
          id: 'author-cross',
          from: target - 200,
          to: target + 200,
          alive: true,
          authorId: 'agent-1',
        },
      ]);
      await p.seek(target);
    }, target);
  const initial = await page
    .getByTestId('bounded')
    .getByTestId('proof')
    .evaluate((el) => {
      const p = (el as Host).proof;
      return {
        start: p.projection!.start,
        end: p.projection!.start + p.projection!.source.length,
        items: p.annotationPage!.items,
        stats: p.snapshot(),
      };
    });
  expect(initial.start).toBeGreaterThan(prefix.length + opening.length);
  expect(initial.end).toBeLessThan(prefix.length + opening.length + body.length);
  expect(initial.items.map((a) => a.id)).toEqual(['cmt-cross', 'author-cross']);
  await expect(
    page.getByTestId('bounded').locator('[data-proof-comment="cmt-cross"]'),
  ).not.toHaveCount(0);
  await expect(
    page.getByTestId('bounded').locator('[data-proof-attribution="author-cross"]'),
  ).not.toHaveCount(0);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page
      .getByTestId(side)
      .getByTestId('proof')
      .evaluate((el, target) => {
        const h = el as Host,
          e = h.proof?.editor ?? h.native;
        let at = h.proof?.projection!.pmAt(target) ?? -1;
        if (!h.proof)
          e.state.doc.descendants((node, pos) => {
            if (node.isText && node.text!.includes('EDITME'))
              at = pos + node.text!.indexOf('EDITME') + 2;
          });
        if (at < 0) throw new Error('Native target missing');
        e.commands.setTextSelection(at);
      }, target);
    await settled(page);
    await page.keyboard.type('X');
  }
  await settled(page);
  const edited = source.slice(0, target) + 'X' + source.slice(target);
  const evicted = await page
    .getByTestId('bounded')
    .getByTestId('proof')
    .evaluate(async (el, expected) => {
      const p = (el as Host).proof,
        old = p.editor!;
      const exact = p.service.region(0) === expected;
      p.save();
      await p.seek(p.service.length - 100);
      return { exact, destroyed: old.isDestroyed, error: p.error };
    }, edited);
  expect(evicted).toEqual({ exact: true, destroyed: true, error: '' });
  const phases = [];
  for (const [key, expected] of [
    ['Control+z', source],
    ['Control+Shift+z', edited],
  ]) {
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press(key);
      await settled(page);
    }
    const result = await page.evaluate((expected) => {
      const h = document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host;
      const n = (document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host)
        .native;
      const p = h.proof,
        e = p.editor!;
      const endpoint = (editor: typeof n) => {
        const r = editor.state.selection.$head;
        return {
          before: r.parent.textContent.slice(r.parentOffset - 20, r.parentOffset),
          after: r.parent.textContent.slice(r.parentOffset, r.parentOffset + 20),
          parent: r.parent.type.name,
        };
      };
      const dom = window.getSelection()!;
      return {
        exact: p.service.region(0) === expected,
        native: endpoint(n),
        bounded: endpoint(e),
        logical: p.selection.head,
        mapped: p.projection!.sourceAt(e.state.selection.head),
        dom: e.view.posAtDOM(dom.focusNode!, dom.focusOffset),
        pm: e.state.selection.head,
        draft: p.service.commentDraftPage('cmt-cross')!.text,
        items: p.annotationPage!.items,
        stats: p.snapshot(),
        error: p.error,
      };
    }, expected);
    phases.push(result);
    expect(result.exact).toBe(true);
    expect(result.bounded).toEqual(result.native);
    expect(result.dom).toBe(result.pm);
    expect(result.mapped).toBe(result.logical);
    expect(result.error).toBe('');
    expect(result.draft).toBe('unsent café 🌍 draft');
    expect(result.items.map((a) => a.id)).toEqual(['cmt-cross']);
    expect(result.stats.cachePages).toBeLessThanOrEqual(4);
    expect(result.stats.cacheBytes).toBeLessThanOrEqual(16384);
    expect(result.stats.maxAnnotationPageBytes).toBeLessThanOrEqual(4096);
    expect(result.stats.retainedEditorStates).toBe(0);
  }
  await info.attach('annotation-history.json', {
    body: JSON.stringify({ initial, evicted, phases }),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('annotation-history.png') });
});
