import { test, expect } from '../../../../../test/ct-test';
import Harness from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';
const prefix = 'before KEEP\n\n- sibling END\n\n';
const fence =
  '```text\n' + Array.from({ length: 900 }, (_, i) => `line${i} café 🌍`).join('\n') + '\n```';
const table =
  '| H | R |\n| --- | --- |\n' +
  Array.from({ length: 800 }, (_, i) => `| cell${i} | value |`).join('\n');
const paragraph =
  'following START ' +
  Array.from({ length: 900 }, (_, i) => `segment${i} café 🌍`).join(' ') +
  ' following END';
for (const operation of [
  'Backspace',
  'Delete',
  'list-replace',
  'table-replace',
  'table-marked-replace',
  'list-type',
  'table-type',
]) {
  test(`full mixed Chromium ${operation} followed by a distant edit and history`, async ({
    mount,
    page,
  }, info) => {
    const marked = operation === 'table-marked-replace';
    const body = marked
      ? paragraph.replace(
          'segment450',
          '<!--anchor:browser-alias:start-->segment450<!--anchor:browser-alias:end-->',
        )
      : paragraph;
    const source = prefix + fence + '\n\n' + table + '\n\n' + body + '\n\nafter KEEP';
    await mount(Harness, { props: { sourceOverride: source, anchors: marked } });
    const tableMove = operation.startsWith('table-');
    const bounded = page.getByTestId('bounded').getByTestId('proof');
    if (marked)
      await bounded.evaluate((el) => {
        const service = (el as Host).proof.service;
        service.registerComment('browser-alias');
        service.stageCommentDraft('browser-alias', 0, 0, 'unsent browser draft');
      });
    await bounded.evaluate(
      async (el, at) => {
        await (el as Host).proof.seek(at);
      },
      tableMove ? source.indexOf('following START') : source.indexOf('```text'),
    );
    await bounded.evaluate((el) => {
      const p = (el as Host).proof,
        records: unknown[] = [];
      Reflect.set(el, 'inputTransactions', records);
      const dispatch = p.editor!.view.props.dispatchTransaction!;
      p.editor!.view.setProps({
        dispatchTransaction(tr) {
          records.push({
            selection: p.editor!.state.selection.toJSON(),
            steps: tr.steps.map((s) => s.toJSON()),
            sourceSelection: p.selection,
            from: p.projection!.start,
            to: p.projection!.context?.to,
          });
          dispatch.call(p.editor!.view, tr);
        },
      });
    });
    let originalNativeDoc = '';
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page
        .getByTestId(side)
        .getByTestId('proof')
        .evaluate(
          (el, data) => {
            const h = el as Host,
              e = h.proof?.editor ?? h.native;
            const roots: Array<{ node: typeof e.state.doc; at: number }> = [];
            e.state.doc.forEach((node, at) => roots.push({ node, at }));
            const index = data.tableMove
              ? roots.findIndex((r) => r.node.type.name === 'table')
              : roots.findIndex((r) => r.node.type.name === 'codeBlock') - 1;
            const leftRoot = roots[index],
              rightRoot = roots[index + 1];
            let left = -1,
              right = -1;
            if (leftRoot.node.isTextblock) left = leftRoot.at + leftRoot.node.nodeSize - 1;
            else
              leftRoot.node.descendants((n, at) => {
                if (n.isTextblock) left = leftRoot.at + at + n.nodeSize;
              });
            if (rightRoot.node.isTextblock) right = rightRoot.at + 1;
            else
              rightRoot.node.descendants((n, at) => {
                if (n.isTextblock && right < 0) right = rightRoot.at + at + 2;
              });
            e.commands.setTextSelection(
              data.operation.endsWith('replace') || data.operation.endsWith('type')
                ? { from: left - 1, to: right + 1 }
                : data.operation === 'Backspace'
                  ? right
                  : left,
            );
          },
          { tableMove, operation },
        );
      await settled(page);
      if (side === 'native') {
        originalNativeDoc = await page
          .getByTestId('native')
          .getByTestId('proof')
          .evaluate((el) => JSON.stringify((el as Host).native.getJSON()));
        if (marked) {
          await info.attach('native-before-marked-input.json', {
            body: originalNativeDoc,
            contentType: 'application/json',
          });
          expect(originalNativeDoc.match(/"type":"commentAnchor"/g)?.length ?? 0).toBe(2);
        }
      }
      if (operation.endsWith('replace')) await page.keyboard.insertText('MOVE');
      else if (operation.endsWith('type')) await page.keyboard.type('MOVE');
      else await page.keyboard.press(operation);
      await settled(page);
      if (side === 'native') {
        const actual = await page
          .getByTestId(side)
          .getByTestId('proof')
          .evaluate((el) => {
            const h = el as Host & { nativeMarkdown(): string };
            return {
              doc: h.native.getJSON(),
              selection: h.native.state.selection.toJSON(),
              canonical: h.nativeMarkdown(),
            };
          });
        await info.attach('actual-native-browser-result.json', {
          body: JSON.stringify(actual),
          contentType: 'application/json',
        });
      }
    }
    const transactions = await bounded.evaluate((el) => Reflect.get(el, 'inputTransactions'));
    await info.attach('replacement-input-transactions.json', {
      body: JSON.stringify(transactions),
      contentType: 'application/json',
    });
    const joined = await bounded.evaluate((el) => ({
      source: (el as Host).proof.service.region(0),
      error: (el as Host).proof.error,
    }));
    expect(joined.error).toBe('');
    const canonical = await page
      .getByTestId('native')
      .getByTestId('proof')
      .evaluate((el) => (el as Host & { nativeMarkdown(): string }).nativeMarkdown());
    const trees = await bounded.evaluate(async (el, canonical) => {
      const h = el as Host;
      return {
        actual: (await h.parseSource(h.proof.service.region(0))).doc,
        expected: (await h.parseSource(canonical)).doc,
      };
    }, canonical);
    expect(trees.actual).toEqual(trees.expected);
    const needle = tableMove ? 'segment450' : 'line450';
    const offset = tableMove ? 7 : 4;
    const target = joined.source.indexOf(needle) + offset;
    expect(target).toBeGreaterThan(4096);
    const admitted = await bounded.evaluate(async (el, target) => {
      const p = (el as Host).proof,
        old = p.editor!;
      p.save();
      await p.seek(target);
      return {
        destroyed: old.isDestroyed,
        mapped: p.projection!.sourceAt(p.projection!.pmAt(target)),
        snapshot: p.snapshot(),
      };
    }, target);
    expect(admitted.destroyed).toBe(true);
    expect(admitted.mapped).toBe(target);
    if (marked) {
      await bounded.evaluate(async (el) => {
        await (el as Host).proof.loadAnnotations();
      });
      await expect(bounded.locator('[data-proof-comment="browser-alias"]')).toHaveText(
        'segment450',
      );
    }
    await focus(page, 'native');
    await page
      .getByTestId('native')
      .getByTestId('proof')
      .evaluate(
        (el, { needle, offset }) => {
          const e = (el as Host).native;
          let target = -1;
          e.state.doc.descendants((node, at) => {
            if (node.isText && node.text!.includes(needle))
              target = at + node.text!.indexOf(needle) + offset;
          });
          if (target < 0) throw new Error('Native continued edit target missing');
          e.commands.setTextSelection(target);
        },
        { needle, offset },
      );
    await settled(page);
    await page.keyboard.insertText('EDIT');
    await settled(page);
    await focus(page, 'bounded');
    await bounded.evaluate((el, target) => {
      const p = (el as Host).proof;
      p.editor!.commands.setTextSelection(p.projection!.pmAt(target));
    }, target);
    await settled(page);
    await page.keyboard.insertText('EDIT');
    await settled(page);
    const edited = await bounded.evaluate((el) => (el as Host).proof.service.region(0));
    if (tableMove && operation.endsWith('replace')) {
      const expected = await page
        .getByTestId('native')
        .getByTestId('proof')
        .evaluate((el) => (el as Host & { nativeMarkdown(): string }).nativeMarkdown());
      const unchangedEnd = joined.source.indexOf('| cell799'),
        nativeStart = expected.indexOf('| cell799');
      expect(unchangedEnd).toBeGreaterThan(0);
      expect(nativeStart).toBeGreaterThan(0);
      expect(edited.slice(0, unchangedEnd)).toBe(joined.source.slice(0, unchangedEnd));
      expect(edited.slice(unchangedEnd).trimEnd()).toBe(expected.slice(nativeStart).trimEnd());
      await info.attach('continued-native-alias-source.json', {
        body: JSON.stringify({ source: edited, native: expected }),
        contentType: 'application/json',
      });
    } else
      expect(edited).toBe(joined.source.slice(0, target) + 'EDIT' + joined.source.slice(target));
    expect(edited.startsWith('before KEEP\n\n')).toBe(true);
    expect(edited.endsWith('\n\nafter KEEP')).toBe(true);
    if (marked) {
      const annotation = await bounded.evaluate(async (el) => {
        const p = (el as Host).proof;
        await p.loadAnnotations();
        return {
          ids: p.annotationPage!.items.map((a) => a.id),
          draft: p.service.commentDraftPage('browser-alias'),
          selection: p.selection.head,
        };
      });
      expect(annotation.ids).toContain('browser-alias');
      expect(annotation.draft!.text).toBe('unsent browser draft');
      expect(annotation.selection).toBe(edited.indexOf('segmentEDIT450') + 11);
      await expect(bounded.locator('[data-proof-comment="browser-alias"]')).toHaveText(
        'segmentEDIT450',
      );
    }
    const destroyed = await bounded.evaluate(async (el) => {
      const p = (el as Host).proof,
        old = p.editor!;
      p.save();
      await p.seek(p.selection.head);
      return old.isDestroyed;
    });
    expect(destroyed).toBe(true);
    const phases: unknown[] = [];
    const historyPhase = async (redo: boolean) => {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
        await settled(page);
      }
      const expected = await page
        .getByTestId('native')
        .getByTestId('proof')
        .evaluate((el) => {
          const h = el as Host & { nativeMarkdown(): string };
          return {
            doc: JSON.stringify(h.native.getJSON()),
            source: h.nativeMarkdown(),
            selection: h.native.state.selection.toJSON(),
          };
        });
      const actual = await bounded.evaluate(async (el, expected) => {
        const h = el as Host,
          p = h.proof;
        return {
          source: p.service.region(0),
          error: p.error,
          doc: (await h.parseSource(p.service.region(0))).doc,
          expected: (await h.parseSource(expected)).doc,
          selection: p.selection,
        };
      }, expected.source);
      phases.push({ redo, native: expected, bounded: actual });
      await info.attach(`native-history-phase-${phases.length}.json`, {
        body: JSON.stringify(phases.at(-1)),
        contentType: 'application/json',
      });
      expect(actual.error).toBe('');
      expect(actual.doc).toEqual(actual.expected);
      return { initial: expected.doc === originalNativeDoc, source: actual.source };
    };
    let undos = 0,
      initial = false;
    while (!initial && undos < 16) {
      const result = await historyPhase(false);
      initial = result.initial;
      undos++;
      if (initial) expect(result.source).toBe(source);
    }
    expect(initial).toBe(true);
    for (let i = 0; i < undos; i++) await historyPhase(true);
    const history = await bounded.evaluate((el) => {
      const p = (el as Host).proof;
      return { source: p.service.region(0), error: p.error, snapshot: p.snapshot() };
    });
    expect(history.source).toBe(edited);
    expect(history.error).toBe('');
    expect(history.snapshot.mounted).toBe(1);
    expect(history.snapshot.cachePages).toBeLessThanOrEqual(4);
    expect(history.snapshot.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    await focus(page, 'bounded');
    await settled(page);
    await info.attach('full-span-native-and-history.json', {
      body: JSON.stringify({ operation, joined, canonical, trees, admitted, history }),
      contentType: 'application/json',
    });
  });
}
