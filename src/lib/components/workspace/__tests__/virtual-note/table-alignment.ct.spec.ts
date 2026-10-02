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

test('native table paragraph marks and escaped literals survive editing, save and view destruction', async ({
  mount,
  page,
}, testInfo) => {
  await mount(Harness, { props: { oracle: true, sourceOverride: '| H |\n| --- |\n| body |' } });
  const host = page.getByTestId('proof');
  await expect.poll(() => host.evaluate((el) => !!(el as Host).native)).toBe(true);
  const html =
    '<strong>bold</strong> <em>italic</em> <a href="https://example.com/path">link</a> <code>a`b</code> <code>a\\|b</code> literal *stars* [brackets] | slash \\ adjacent \\|';
  const inline =
    '**bold** *italic* [link](https://example.com/path) ``a`b`` `a\\`<!-- -->`\\|b` literal \\*stars\\* &#91;brackets&#93; \\| slash \\\\ adjacent \\\\\\|';
  const expected = `| ${inline} |  |\n| :---: | --- |\n| ${inline} | plain! |`;
  const result = await host.evaluate(async (el, html) => {
    const h = el as Host & {
      nativeMarkdown: () => string;
      reloadNative: (source: string) => Promise<void>;
    };
    h.native.commands.setContent(
      `<table><tr><th align="center"><p>${html}</p></th><th><p></p></th></tr><tr><td align="center"><p>${html}</p></td><td><p>plain</p></td></tr></table>`,
    );
    let caret = -1;
    h.native.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === 'plain')
        caret = pos + 1 + node.textContent.length;
    });
    if (caret < 0) throw new Error('Missing native plain cell');
    h.native.commands.setTextSelection(caret);
    h.native.commands.insertContent('!');
    const before = h.native.state.doc.firstChild!.toJSON();
    const markdown = h.nativeMarkdown().trim();
    const canonical = await h.parseSource(markdown);
    const old = h.native;
    await h.reloadNative(markdown);
    return {
      before,
      markdown,
      canonical,
      destroyed: old.isDestroyed,
      after: h.native.state.doc.firstChild!.toJSON(),
    };
  }, html);
  await testInfo.attach('table-paragraph-roundtrip.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  expect(result.markdown).toBe(expected);
  expect(result.destroyed).toBe(true);
  expect(result.after).toEqual(result.before);
  expect(result.canonical.doc.content?.[0]).toEqual(result.before);
});

test('native table Shift+Enter retains breaks, cells and edit history through canonical save', async ({
  mount,
  page,
}, testInfo) => {
  await mount(Harness, { props: { oracle: true, sourceOverride: source } });
  const host = page.getByTestId('proof');
  await expect.poll(() => host.evaluate((el) => !!(el as Host).native)).toBe(true);
  const original = await host.evaluate((el) => {
    const h = el as Host;
    let caret = -1;
    h.native.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === 'b') caret = pos + 2;
    });
    h.native.commands.setTextSelection(caret);
    h.native.view.focus();
    return h.native.state.doc.firstChild!.toJSON();
  });
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('tail');
  const snapshot = () =>
    host.evaluate((el) => {
      const h = el as Host;
      return {
        table: h.native.state.doc.firstChild!.toJSON(),
        selection: h.native.state.selection.toJSON(),
      };
    });
  const edited = await snapshot();
  expect(edited.table.content![1].content![1].content).toHaveLength(1);
  expect(edited.table.content![1].content![1].content![0].content).toEqual([
    { type: 'text', text: 'b' },
    { type: 'hardBreak' },
    { type: 'text', text: 'tail' },
  ]);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await snapshot()).table).toEqual(original);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await snapshot()).toEqual(edited);
  const result = await host.evaluate(async (el) => {
    const h = el as Host & {
      nativeMarkdown: () => string;
      reloadNative: (source: string) => Promise<void>;
    };
    const markdown = h.nativeMarkdown().trim();
    const canonical = await h.parseSource(markdown);
    const selection = h.native.state.selection.toJSON();
    const old = h.native;
    await h.reloadNative(markdown);
    h.native.commands.setTextSelection({ from: selection.anchor!, to: selection.head! });
    return {
      markdown,
      canonical,
      destroyed: old.isDestroyed,
      table: h.native.state.doc.firstChild!.toJSON(),
      selection: h.native.state.selection.toJSON(),
    };
  });
  await testInfo.attach('table-hard-break-roundtrip.json', {
    body: JSON.stringify({ original, edited, result }),
    contentType: 'application/json',
  });
  expect(result.markdown).toBe(source.replace('| a | b |', '| a | b<br>tail |'));
  expect(result.destroyed).toBe(true);
  expect(result.table).toEqual(edited.table);
  expect(result.selection).toEqual(edited.selection);
  expect(result.canonical.doc.content?.[0]).toEqual(edited.table);
});

for (const preserveAnchors of [true, false]) {
  test(`native combined table marks and rendered math survive serialization (anchors=${preserveAnchors})`, async ({
    mount,
    page,
  }, testInfo) => {
    await mount(Harness, { props: { oracle: true, sourceOverride: source } });
    const host = page.getByTestId('proof');
    await expect.poll(() => host.evaluate((el) => !!(el as Host).native)).toBe(true);
    const result = await host.evaluate(async (el, preserveAnchors) => {
      const h = el as Host & {
        nativeMarkdown: (preserveAnchors: boolean) => string;
        serializeHTML: (html: string, preserveAnchors: boolean) => string;
        parseSource: (
          source: string,
          renderMath?: boolean,
        ) => Promise<{
          html: string;
          doc: { content?: unknown[] };
        }>;
        reloadNative: (source: string) => Promise<void>;
      };
      const inline =
        '<strong><em>bold italic</em> <a href="https://example.com">bold link</a> <code>a\\|b</code></strong>';
      h.native.commands.setContent(
        `<table><tr><th align="center"><p>${inline}</p></th><th>Right</th></tr><tr><td align="center"><p>${inline}</p></td><td>edit</td></tr></table>`,
      );
      let caret = -1;
      h.native.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.textContent === 'edit') caret = pos + 5;
      });
      h.native.commands.setTextSelection(caret);
      h.native.commands.insertContent('!');
      const before = h.native.state.doc.firstChild!.toJSON();
      const markdown = h.nativeMarkdown(preserveAnchors).trim();
      const canonical = await h.parseSource(markdown);
      const direct = h.serializeHTML(canonical.html, preserveAnchors).trim();
      const old = h.native;
      await h.reloadNative(markdown);
      const mathSource = '| H |\n| --- |\n| $x_1 + y$ |';
      const math = await h.parseSource(mathSource, true);
      const anchors = h
        .serializeHTML(
          '<table><tr><th><p>H</p></th></tr><tr><td><p><span data-anchor-id="review:start"></span><strong>bold</strong><span data-anchor-id="review:end"></span></p></td></tr></table>',
          preserveAnchors,
        )
        .trim();
      return {
        before,
        markdown,
        canonical,
        direct,
        destroyed: old.isDestroyed,
        after: h.native.state.doc.firstChild!.toJSON(),
        mathSource,
        mathSaved: h.serializeHTML(math.html, preserveAnchors).trim(),
        anchors,
        anchorCanonical: (await h.parseSource(anchors)).html,
      };
    }, preserveAnchors);
    await testInfo.attach('table-combined-roundtrip.json', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
    expect(result.destroyed).toBe(true);
    expect(result.after).toEqual(result.before);
    expect(result.canonical.doc.content?.[0]).toEqual(result.before);
    expect(result.direct).toBe(result.markdown);
    expect(result.markdown.split('\n')[1]).toBe('| :---: | --- |');
    expect(result.mathSaved).toBe(result.mathSource);
    expect(result.anchors).toBe(
      '| H |\n| --- |\n| ' +
        (preserveAnchors
          ? '<!--anchor:review:start-->**bold**<!--anchor:review:end-->'
          : '**bold**') +
        ' |',
    );
    expect(result.anchorCanonical.includes('data-anchor-id="review:start"')).toBe(preserveAnchors);
  });
}
