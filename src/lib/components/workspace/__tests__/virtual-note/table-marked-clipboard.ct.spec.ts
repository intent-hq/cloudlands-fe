import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

test('dense native clipboard crosses bold, italic and code without losing marks or untouched source', async ({
  mount,
  page,
  context,
}, info) => {
  // Both full native/canonical oracles and four clipboard/history comparisons
  // run here. This is a correctness budget, not a renderer latency assertion.
  test.setTimeout(60_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const source =
    '| H |\n| --- |\n| CELL_START ' +
    '**bold** _italic_ `code` \\| \\\\ '.repeat(1500) +
    ' CELL_END |';
  await mount(Pair, { props: { sourceOverride: source } });
  const from = source.indexOf('bold') + 2,
    to = source.indexOf('`code`') + 6;
  const envelopeFrom = source.indexOf('**bold**');
  const roots = {
    native: page.getByTestId('native').getByTestId('proof'),
    bounded: page.getByTestId('bounded').getByTestId('proof'),
  };
  for (const side of ['native', 'bounded'] as const) {
    await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
    await focus(page, side);
    await roots[side].evaluate((el, from) => {
      const h = el as Host,
        editor = h.proof?.editor ?? h.native;
      let pm = -1;
      if (h.proof) pm = h.proof.projection!.pmAt(from);
      else
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'paragraph' && node.textContent.startsWith('CELL_START'))
            pm = pos + 1 + 'CELL_START bo'.length;
        });
      if (pm < 0) throw new Error('Native marked clipboard target missing');
      editor.commands.setTextSelection(pm);
    }, from);
    await settled(page);
    for (let n = 0; n < 14; n++) await page.keyboard.press('Shift+ArrowRight');
    await settled(page);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('ld italic code');
    await page.keyboard.press('Control+c');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('ld italic code');
    await page.keyboard.press('Control+x');
    await settled(page);
  }
  const compare = async (phase: string) => {
    await settled(page);
    const native = await roots.native.evaluate((el) => {
      const e = (el as Host).native;
      return { doc: e.getJSON(), offset: e.state.selection.$head.parentOffset };
    });
    const actual = await roots.bounded.evaluate(async (el) => {
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
    await info.attach(`table-marked-clipboard-${phase}.json`, {
      body: JSON.stringify({ native, actual }),
      contentType: 'application/json',
    });
    expect(actual.error).toBe('');
    expect(actual.source.startsWith(source.slice(0, envelopeFrom))).toBe(true);
    expect(actual.source.endsWith(source.slice(to))).toBe(true);
    expect(actual.parsed).toEqual({ type: 'doc', content: [native.doc.content![0]] });
    expect(actual.point.offset).toBe(native.offset);
    expect(actual.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(actual.stats.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
    expect(actual.stats.pmNodes).toBeLessThanOrEqual(4096);
    expect(actual.stats.cacheBytes).toBeLessThanOrEqual(16384);
    return actual.source;
  };
  const cut = await compare('cut');
  for (const side of ['native', 'bounded'] as const) {
    await page.clock.setFixedTime(new Date('2026-10-02T12:00:01Z'));
    await focus(page, side);
    await page.keyboard.press('Control+v');
    await settled(page);
  }
  const pasted = await compare('paste');
  await roots.bounded.evaluate((el) => {
    const p = (el as Host).proof;
    Object.assign(el, { clipboardOldView: p.editor! });
    const scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
    scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
  });
  await settled(page);
  expect(
    await roots.bounded.evaluate(
      (el) =>
        (el as Host & { clipboardOldView: { isDestroyed: boolean } }).clipboardOldView.isDestroyed,
    ),
  ).toBe(true);
  for (const key of ['Control+z', 'Control+Shift+z']) {
    for (const side of ['native', 'bounded'] as const) {
      await focus(page, side);
      await page.keyboard.press(key);
      await settled(page);
    }
    expect(await compare(key)).toBe(key === 'Control+z' ? cut : pasted);
  }
});
