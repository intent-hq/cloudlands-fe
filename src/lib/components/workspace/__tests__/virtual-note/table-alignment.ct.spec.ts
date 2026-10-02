import { test, expect } from '../../../../../test/ct-test';
import Harness from './DocumentProofHarness.svelte';
import type { Host } from './paragraph-browser';

const source =
  '| Left | Center | Right | Default |\n| :--- | :---: | ---: | --- |\n| a | b | **c** | d |';

for (const input of ['markdown', 'native HTML'] as const) {
  test(`native ${input} retains table alignment through Markdown and destroyed-view reload`, async ({
    mount,
    page,
  }, testInfo) => {
    await mount(Harness, { props: { oracle: true, sourceOverride: source } });
    const host = page.getByTestId('proof');
    await expect.poll(() => host.evaluate((el) => !!(el as Host).native)).toBe(true);
    const result = await host.evaluate(async (el, input) => {
      const h = el as Host & {
        nativeMarkdown: () => string;
        reloadNative: (source: string) => Promise<void>;
      };
      if (input === 'native HTML')
        h.native.commands.setContent(
          '<table><tr><th align="left">Left</th><th align="center">Center</th><th align="right">Right</th><th>Default</th></tr><tr><td align="left">a</td><td align="center">b</td><td align="right"><strong>c</strong></td><td>d</td></tr></table>',
        );
      const snapshot = () => ({
        table: h.native.state.doc.firstChild!.toJSON(),
        computed: Array.from(
          h.native.view.dom.querySelectorAll('th,td'),
          (cell) => getComputedStyle(cell).textAlign,
        ),
        colgroup: h.native.view.dom.querySelector('colgroup')?.outerHTML,
      });
      const before = snapshot();
      const nativeHTML = h.native.getHTML();
      const markdown = h.nativeMarkdown().trim();
      const canonical = await h.parseSource(markdown);
      const old = h.native;
      await h.reloadNative(markdown);
      return {
        before,
        nativeHTML,
        markdown,
        canonical,
        destroyed: old.isDestroyed,
        after: snapshot(),
      };
    }, input);
    await testInfo.attach('table-alignment-roundtrip.json', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
    expect(result.markdown).toBe(source);
    expect(result.nativeHTML).toContain('text-align: right');
    expect(result.destroyed).toBe(true);
    expect(result.after).toEqual(result.before);
    expect(result.after.computed).toEqual([
      'left',
      'center',
      'right',
      'left',
      'left',
      'center',
      'right',
      'left',
    ]);
    expect(result.canonical.doc.content?.[0]).toEqual(result.after.table);
    const cells = result.after.table.content!.flatMap((row) => row.content!);
    expect(cells.map((cell) => cell.attrs?.align)).toEqual([
      'left',
      'center',
      'right',
      null,
      'left',
      'center',
      'right',
      null,
    ]);
    for (const cell of cells)
      expect(cell.attrs).toMatchObject({ colwidth: null, colspan: 1, rowspan: 1 });
  });
}
