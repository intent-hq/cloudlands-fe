import { test, expect } from '../../../../../test/ct-test';
import Harness from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

const source = [
  'plain café 🌍 repeated repeated',
  'marked **café 🌍 repeated** and [repeated](https://example.test)',
  '- parent café repeated\n  - child 🌍 repeated\n- sibling repeated',
  '```text\nfenced café 🌍 repeated\n```',
  '| H | R |\n| --- | --- |\n| cell café 🌍 | repeated |',
  'following café 🌍 repeated repeated',
].join('\n\n');

test('mixed admitted source has native construct types before and after fresh reload', async ({
  mount,
  page,
}, info) => {
  await mount(Harness, { props: { sourceOverride: source } });
  for (const side of ['bounded', 'native']) await focus(page, side);
  const result = await page.evaluate(() => {
    const bounded = (
      document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host
    ).proof;
    const native = (document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host)
      .native;
    return {
      bounded: bounded.editor!.getJSON(),
      native: native.getJSON(),
      source: bounded.service.region(0),
      admitted: bounded.projection!.source,
      error: bounded.error,
      stats: bounded.snapshot(),
    };
  });
  await info.attach('mixed-initial.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  expect(result.source).toBe(source);
  expect(result.admitted).toBe(source);
  expect(result.error).toBe('');
  expect(result.bounded).toEqual(result.native);
  await page
    .getByTestId('bounded')
    .getByTestId('proof')
    .evaluate(async (el, text) => {
      await (el as Host & { reopenProof: (source: string) => Promise<void> }).reopenProof(text);
    }, source);
  await focus(page, 'bounded');
  expect(
    await page
      .getByTestId('bounded')
      .getByTestId('proof')
      .evaluate((el) => (el as Host).proof.editor!.getJSON()),
  ).toEqual(result.native);
});

for (const direction of ['forward', 'backward']) {
  test(`native ${direction} Shift selection crosses fence and table`, async ({
    mount,
    page,
  }, info) => {
    await mount(Harness, { props: { sourceOverride: source } });
    const results = [];
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page
        .getByTestId(side)
        .getByTestId('proof')
        .evaluate((el, direction) => {
          const h = el as Host,
            e = h.proof?.editor ?? h.native;
          let at = -1;
          e.state.doc.descendants((node, pos) => {
            if (direction === 'forward' && node.type.name === 'codeBlock')
              at = pos + node.nodeSize - 1;
            if (direction === 'backward' && node.isTextblock && node.textContent === 'H')
              at = pos + 1;
          });
          if (at < 0) throw new Error('Required mixed native construct was not mounted');
          e.commands.setTextSelection(at);
        }, direction);
      await settled(page);
      await page.keyboard.press(direction === 'forward' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
      await settled(page);
      results.push(
        await page
          .getByTestId(side)
          .getByTestId('proof')
          .evaluate((el) => {
            const h = el as Host,
              e = h.proof?.editor ?? h.native,
              s = e.state.selection;
            const dom = window.getSelection()!;
            return {
              type: s.toJSON().type,
              anchorParent: s.$anchor.parent.type.name,
              headParent: s.$head.parent.type.name,
              anchorOffset: s.$anchor.parentOffset,
              headOffset: s.$head.parentOffset,
              dom: {
                anchor: e.view.posAtDOM(dom.anchorNode!, dom.anchorOffset),
                head: e.view.posAtDOM(dom.focusNode!, dom.focusOffset),
              },
              pm: { anchor: s.anchor, head: s.head },
              error: h.proof?.error ?? '',
            };
          }),
      );
    }
    await info.attach('mixed-selection.json', {
      body: JSON.stringify(results),
      contentType: 'application/json',
    });
    for (const r of results) expect(r.dom).toEqual(r.pm);
    expect(results[1]).toEqual(results[0]);
  });
}
