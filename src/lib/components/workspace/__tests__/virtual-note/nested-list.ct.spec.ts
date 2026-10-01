import { test, expect } from '../../../../../test/ct-test';
import type { Page } from '@playwright/test';
import Harness from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';

const marker = (kind: string, index: number) =>
  kind === 'orderedList' ? `${17 + index}. ` : kind === 'taskList' ? '- [ ] ' : '- ';
const fixture = (kind: string) =>
  Array.from(
    { length: 1600 },
    (_, i) =>
      `${marker(kind, i)}item ${String(i).padStart(4, '0')} café with repeated text and exact spelling.`,
  ).join('\n');

async function selectItem(
  page: Page,
  side: string,
  sourceOffset: number,
  label: string,
  offset: number,
) {
  await focus(page, side);
  await page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate(
      (el, { sourceOffset, label, offset }) => {
        const h = el as Host,
          e = h.proof?.editor ?? h.native;
        let pos = -1;
        if (h.proof) pos = h.proof.projection!.pmAt(sourceOffset);
        else
          e.state.doc.descendants((n, p) => {
            if (
              n.type.name === 'paragraph' &&
              (label === 'item 0' ? n.textContent === label : n.textContent.startsWith(label))
            )
              pos = p + 1 + offset;
          });
        if (pos < 0) throw new Error('Native fixture item missing');
        e.commands.setTextSelection(pos);
      },
      { sourceOffset, label, offset },
    );
  await settled(page);
}
async function compare(page: Page, expected: string, at: number, liveBoundary = false) {
  await settled(page);
  const result = await page.evaluate(
    async ({ expected, at }) => {
      const h = document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host;
      const n = (document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host)
        .native;
      const p = h.proof,
        e = p.editor!;
      const canonical = (await h.parseSource(expected)).doc;
      // Native TrailingNode contributes one source-less terminal placeholder, also
      // retained after a list exit. Explicit source blank paragraphs stay in both trees.
      const actual = n.getJSON();
      if (
        actual.content?.length === (canonical.content?.length ?? 0) + 1 &&
        actual.content.at(-1)?.type === 'paragraph' &&
        !actual.content.at(-1)?.content
      )
        actual.content.pop();
      const endpoint = (editor: typeof n) => {
        const r = editor.state.selection.$head;
        return {
          before: r.parent.textContent.slice(Math.max(0, r.parentOffset - 12), r.parentOffset),
          after: r.parent.textContent.slice(r.parentOffset, r.parentOffset + 12),
          types: Array.from({ length: r.depth }, (_, i) => r.node(i + 1).type.name),
          ordinals: Array.from({ length: r.depth }, (_, i) => i + 1)
            .filter((d) => r.node(d).type.name === 'orderedList')
            .map((d) => r.node(d).attrs.start + r.index(d)),
        };
      };
      const difference = (actual: string, expected: string) => {
        let i = 0;
        while (i < actual.length && actual[i] === expected[i]) i++;
        return {
          at: i,
          actual: actual.slice(Math.max(0, i - 50), i + 150),
          expected: expected.slice(Math.max(0, i - 50), i + 150),
        };
      };
      return {
        sourceDifference: difference(p.service.region(0), expected),
        parserDifference: difference(JSON.stringify(actual), JSON.stringify(canonical)),
        error: p.error,
        exact: p.service.region(0) === expected,
        parserNative: JSON.stringify(actual) === JSON.stringify(canonical),
        head: p.selection.head,
        at,
        bounded: endpoint(e),
        native: endpoint(n),
        stats: { ...p.snapshot(), source: undefined, calls: undefined },
      };
    },
    { expected, at },
  );
  expect(result.error).toBe('');
  expect(result.stats.rejectedTransactions, result.stats.lastRejection).toBe(0);
  expect(result.exact, JSON.stringify(result.sourceDifference)).toBe(true);
  if (!liveBoundary)
    expect(result.parserNative, JSON.stringify(result.parserDifference)).toBe(true);
  else await compareLiveLists(page);
  expect(result.head).toBe(at);
  expect(result.bounded).toEqual(result.native);
  expect(result.stats.maxSourceRead).toBeLessThanOrEqual(4096);
  expect(result.stats.maxInlineContextBytes).toBeLessThanOrEqual(4096);
  expect(result.stats.maxParsedBytes).toBeLessThanOrEqual(16384);
  expect(result.stats.cacheBytes).toBeLessThanOrEqual(16384);
  expect(result.stats.cachePages).toBeLessThanOrEqual(4);
  expect(result.stats.pmNodes).toBeLessThanOrEqual(256);
  expect(result.stats.retainedEditorStates).toBe(0);
  expect(result.stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
  return result.stats;
}
// Compare native live groups directly. Canonical fresh-session topology is checked separately.
async function compareLiveLists(page: Page) {
  const result = await page.evaluate(() => {
    const native = (document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host)
      .native;
    const bounded = (
      document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host
    ).proof.editor!;
    const records = (editor: typeof native) => {
      const out: Array<{
        paragraph: unknown;
        text: string;
        groups: number[];
        ordinals: number[];
        top: number;
      }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'paragraph' || !node.textContent) return;
        const r = editor.state.doc.resolve(pos + 1),
          groups: number[] = [],
          ordinals: number[] = [];
        for (let d = 1; d < r.depth; d++)
          if (['bulletList', 'orderedList', 'taskList'].includes(r.node(d).type.name)) {
            groups.push(r.before(d));
            ordinals.push(
              r.node(d).type.name === 'orderedList' ? r.node(d).attrs.start + r.index(d) : 0,
            );
          }
        if (!groups.length) return;
        const dom = editor.view.nodeDOM(pos) as HTMLElement;
        out.push({
          paragraph: node.toJSON(),
          text: node.textContent,
          groups,
          ordinals,
          top: dom.getBoundingClientRect().top,
        });
      });
      return out;
    };
    const b = records(bounded),
      n = records(native);
    const selected = b.map((item) => {
      const matches = n.filter((other) => other.text === item.text);
      if (matches.length !== 1) throw new Error('Native visible item identity is ambiguous');
      return matches[0];
    });
    const normalize = (items: typeof b) => {
      const groups = new Map<number, number>();
      return items.map((item) => ({
        ...item,
        top: Math.round((item.top - items[0].top) * 100) / 100,
        groups: item.groups.map((g) => {
          if (!groups.has(g)) groups.set(g, groups.size);
          return groups.get(g);
        }),
      }));
    };
    return { bounded: normalize(b), native: normalize(selected) };
  });
  expect(result.bounded).toEqual(result.native);
}
for (const kind of ['bulletList', 'orderedList', 'taskList']) {
  test(`native ${kind} Enter and global undo survive list eviction`, async ({
    mount,
    page,
  }, info) => {
    const source = fixture(kind),
      at = source.indexOf('item 0800') + 6;
    await mount(Harness, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 20000 });
    const root = page.getByTestId('bounded').getByTestId('proof');
    await root.evaluate((el, at) => (el as Host).proof.seek(at), at);
    for (const side of ['native', 'bounded']) {
      await selectItem(page, side, at, 'item 0800', 6);
      if (kind === 'orderedList')
        expect(
          await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate((el) => {
              const h = el as Host,
                r = (h.proof?.editor ?? h.native).state.selection.$head;
              return r.node(1).attrs.start + r.index(1);
            }),
        ).toBe(817);
      await page.keyboard.press('Enter');
    }
    const insert = '\n' + marker(kind, 801),
      expected = source.slice(0, at) + insert + source.slice(at);
    await compare(page, expected, at + insert.length);
    await root.evaluate(async (el) => {
      const p = (el as Host).proof;
      p.save();
      const old = p.editor;
      for (const at of [0, 10000, 20000, 30000]) await p.seek(at);
      if (!old!.isDestroyed) throw new Error('View was not evicted');
    });
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+z');
    }
    await compare(page, source, at);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+Shift+z');
    }
    const stats = await compare(page, expected, at + insert.length);
    await info.attach(`list-${kind}-bounds`, {
      body: JSON.stringify(stats),
      contentType: 'application/json',
    });
  });
  test(`native ${kind} Tab and Shift-Tab preserve source and ancestor structure`, async ({
    mount,
    page,
  }) => {
    const source = fixture(kind),
      line = source.indexOf(marker(kind, 800) + 'item 0800'),
      at = source.indexOf('item 0800') + 6;
    await mount(Harness, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 20000 });
    await page
      .getByTestId('bounded')
      .getByTestId('proof')
      .evaluate((el, at) => (el as Host).proof.seek(at), at);
    for (const side of ['native', 'bounded']) {
      await selectItem(page, side, at, 'item 0800', 6);
      await page.keyboard.press('Tab');
    }
    const indent = kind === 'orderedList' ? '     ' : '  ';
    const expected =
      source.slice(0, line) +
      indent +
      (kind === 'orderedList' ? '1. ' + source.slice(line + 5) : source.slice(line));
    await compare(page, expected, at + indent.length - (kind === 'orderedList' ? 2 : 0));
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Shift+Tab');
    }
    await compare(page, source, at);
  });
}

test('oversized nested item keeps actual native caret at an artificial window edge', async ({
  mount,
  page,
}) => {
  const prefix = '17. outer parent\n    - middle parent\n      - ',
    body = 'long café repeated text '.repeat(60000),
    source = prefix + body + '\n18. next root';
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 20000 });
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el) => (el as Host).proof.seek(30000));
  const at = await root.evaluate((el) => (el as Host).proof.projection!.start);
  for (const side of ['native', 'bounded']) {
    await selectItem(page, side, at, 'long café', at - prefix.length);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.insertText('Z');
  }
  const expected = source.slice(0, at - 1) + 'Z' + source.slice(at - 1);
  await compare(page, expected, at);
});

test('native task checkbox state survives the actual canonical parser', async ({ mount, page }) => {
  await mount(Harness, { props: { sourceOverride: '- [ ] Native task' } });
  const native = page.getByTestId('native');
  await expect(native.locator('.tiptap')).toHaveCount(1);
  await native.getByRole('checkbox').click();
  const result = await native.getByTestId('proof').evaluate(async (el) => {
    const h = el as Host;
    return {
      live: h.native.getJSON().content![0].content![0].attrs,
      parsed: (await h.parseSource('- [/] Native task')).doc.content![0].content![0].attrs,
    };
  });
  expect(result.live).toEqual(result.parsed);
});

test('delayed oversized nested Delete, Enter and typing replay once with global history', async ({
  mount,
  page,
}, info) => {
  const prefix = '- parent\n  - previous\n  - ',
    body = 'abcdefghijklmnopqrstuvwxy'.repeat(4000),
    source = prefix + body + '\n- after';
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el) => (el as Host).proof.seek(30000));
  const at = await root.evaluate((el) => (el as Host).proof.snapshot().windowTo);
  await root.evaluate((el) => {
    const h = el as Host & { release: () => void };
    h.proof.delayFetch = () => new Promise((resolve) => (h.release = resolve));
  });
  for (const side of ['native', 'bounded']) {
    await selectItem(page, side, at, 'abcdefghijkl', at - prefix.length);
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
    await page.keyboard.press('Delete');
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:01Z'));
    await page.keyboard.press('Enter');
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:02Z'));
    await page.keyboard.insertText('NEXT');
  }
  const waiting = await root.evaluate((el) => (el as Host).proof.snapshot());
  expect(waiting.pendingInputs).toBe(3);
  await root.evaluate((el) => {
    const h = el as Host & { release: () => void };
    h.proof.delayFetch = undefined;
    h.release();
  });
  await expect.poll(() => root.evaluate((el) => (el as Host).proof.service.pendingInputs)).toBe(0);
  const deleted = source.slice(0, at) + source.slice(at + 1),
    split = deleted.slice(0, at) + '\n  - ' + deleted.slice(at),
    typed = split.slice(0, at + 5) + 'NEXT' + split.slice(at + 5);
  await compare(page, typed, at + 9);
  await root.evaluate(async (el) => {
    const p = (el as Host).proof;
    p.save();
    await p.seek(0);
    await p.seek(60000);
  });
  for (const [key, expected, caret] of [
    ['Control+z', split, at + 5],
    ['Control+z', deleted, at],
    ['Control+z', source, at],
    ['Control+Shift+z', deleted, at],
    ['Control+Shift+z', split, at + 5],
    ['Control+Shift+z', typed, at + 9],
  ] as const) {
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press(key);
    }
    await compare(page, expected, caret);
  }
  await info.attach('nested-delayed-bounds', {
    body: JSON.stringify({
      waiting,
      final: await root.evaluate((el) => (el as Host).proof.snapshot()),
    }),
    contentType: 'application/json',
  });
});

test('native bounded list selection, copy, cut and paste preserve exact source', async ({
  mount,
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const source = fixture('bulletList'),
    at = source.indexOf('item 0800') + 6;
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el, at) => (el as Host).proof.seek(at), at);
  const copies = [];
  for (const side of ['native', 'bounded']) {
    await selectItem(page, side, at, 'item 0800', 6);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+ArrowRight');
      await settled(page);
    }
    await page.keyboard.press('Control+c');
    copies.push(await page.evaluate(() => navigator.clipboard.readText()));
    await page.keyboard.press('Control+x');
  }
  expect(copies).toEqual([source.slice(at, at + 8), source.slice(at, at + 8)]);
  const cut = source.slice(0, at) + source.slice(at + 8);
  await compare(page, cut, at);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+v');
  }
  await compare(page, source, at + 8);
});

for (const kind of ['bulletList', 'orderedList', 'taskList']) {
  test(`deep native ${kind} Enter and Delete keep unloaded mixed ancestors`, async ({
    mount,
    page,
  }) => {
    const prefix = '- outer\n  17. ordered parent\n',
      source =
        prefix +
        fixture(kind)
          .split('\n')
          .map((line) => '      ' + line)
          .join('\n') +
        '\n- after';
    const at = source.indexOf('item 0800') + 6;
    await mount(Harness, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 20000 });
    const root = page.getByTestId('bounded').getByTestId('proof');
    await root.evaluate((el, at) => (el as Host).proof.seek(at), at);
    for (const side of ['native', 'bounded']) {
      await selectItem(page, side, at, 'item 0800', 6);
      await page.keyboard.press('Enter');
    }
    const insert = '\n      ' + marker(kind, 801),
      split = source.slice(0, at) + insert + source.slice(at);
    await compare(page, split, at + insert.length);
    for (const side of ['native', 'bounded']) {
      await selectItem(page, side, at, 'item 0', 6);
      await page.keyboard.press('Delete');
    }
    await compare(page, source, at);
  });
}

test('native Backspace lifts then joins a list item without phantom ancestor text', async ({
  mount,
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
  const source = fixture('bulletList'),
    start = source.indexOf('item 0800'),
    lineEnd = source.indexOf('\n', start);
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el, at) => (el as Host).proof.seek(at), start);
  for (const side of ['native', 'bounded']) {
    await selectItem(page, side, start, 'item 0800', 0);
    await page.keyboard.press('Backspace');
  }
  const lifted =
    source.slice(0, start - 2) + '\n' + source.slice(start, lineEnd) + '\n' + source.slice(lineEnd);
  await compare(page, lifted, start - 1);
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:01Z'));
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Backspace');
  }
  const joined =
    source.slice(0, start - 3) + source.slice(start, lineEnd) + '\n' + source.slice(lineEnd);
  await compare(page, joined, start - 3, true);
  await root.evaluate(async (el) => {
    const p = (el as Host).proof,
      old = p.editor;
    p.save();
    for (const at of [0, 10000, 20000, 30000]) await p.seek(at);
    if (!old!.isDestroyed) throw new Error('View survived eviction');
  });
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+z');
  }
  await compare(page, lifted, start - 1);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+Shift+z');
  }
  await compare(page, joined, start - 3, true);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.insertText('Z');
  }
  const typed = joined.slice(0, start - 3) + 'Z' + joined.slice(start - 3),
    at = start - 2;
  await compare(page, typed, at, true);
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:03Z'));
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Enter');
  }
  const split = typed.slice(0, at) + '\n- ' + typed.slice(at);
  await compare(page, split, at + 3, true);
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:04Z'));
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Backspace');
  }
  const end = typed.indexOf('\n', at),
    liftedAgain =
      typed.slice(0, at) + '\n\n' + typed.slice(at, end) + '\n\n' + typed.slice(end + 2);
  await compare(page, liftedAgain, at + 2);
});

test('native Enter exits an empty list item at the real document end', async ({ mount, page }) => {
  const source = fixture('bulletList'),
    at = source.length;
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el, at) => (el as Host).proof.seek(at), at);
  const label = 'item 1599',
    offset = source.slice(source.lastIndexOf(label)).length;
  for (const side of ['native', 'bounded']) {
    await selectItem(page, side, at, label, offset);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
  }
  await compare(page, source + '\n\n\n', at + 2);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.insertText('NEXT');
  }
  await compare(page, source + '\n\nNEXT\n', at + 6);
});

test('remote ancestor revision during a nested draft preserves real native chronological history', async ({
  mount,
  page,
}) => {
  const prefix = '17. parent\n',
    source =
      prefix +
      fixture('bulletList')
        .split('\n')
        .map((line) => '    ' + line)
        .join('\n') +
      '\n18. after',
    at = source.indexOf('item 0800') + 6;
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el, at) => (el as Host).proof.seek(at), at);
  for (const side of ['native', 'bounded']) {
    await selectItem(page, side, at, 'item 0800', 6);
    await page.keyboard.insertText('A');
  }
  await root.evaluate((el) => (el as Host).proof.remote({ from: 0, to: 2, insert: '27' }));
  await page
    .getByTestId('native')
    .getByTestId('proof')
    .evaluate((el) => {
      const e = (el as Host).native;
      e.view.dispatch(
        e.state.tr
          .setNodeMarkup(0, undefined, { ...e.state.doc.firstChild!.attrs, start: 27 })
          .setMeta('addToHistory', false),
      );
    });
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:01Z'));
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.insertText('B');
  }
  const remote = '27' + source.slice(2),
    edited = remote.slice(0, at) + 'AB' + remote.slice(at);
  await compare(page, edited, at + 2);
  await root.evaluate(async (el) => {
    const p = (el as Host).proof;
    p.save();
    await p.seek(0);
    await p.seek(40000);
  });
  for (const [key, expected, caret] of [
    ['Control+z', remote.slice(0, at) + 'A' + remote.slice(at), at + 1],
    ['Control+z', remote, at],
    ['Control+Shift+z', remote.slice(0, at) + 'A' + remote.slice(at), at + 1],
    ['Control+Shift+z', edited, at + 2],
  ] as const) {
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press(key);
    }
    await compare(page, expected, caret);
  }
});

test('native indentation moves unloaded descendants of a giant parent and reverses after eviction', async ({
  mount,
  page,
}, info) => {
  const prefix = '- previous\n- ',
    body = 'abcdefghijklmnop'.repeat(70000),
    children = Array.from({ length: 1200 }, (_, i) => `  - child ${i} preserved text`).join('\n'),
    source = prefix + body + '\n' + children + '\n- after';
  const at = prefix.length + 30001;
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 20000 });
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el, at) => (el as Host).proof.seek(at), at);
  for (const side of ['native', 'bounded']) {
    await selectItem(page, side, at, 'abcdefghijkl', at - prefix.length);
    await page.keyboard.press('Tab');
  }
  const expected =
    '- previous\n  - ' +
    body +
    '\n' +
    children
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n') +
    '\n- after';
  const stats = await compare(page, expected, at + 2);
  expect(stats.backingListRepairs).toBe(1200);
  expect(stats.maxListRepairRead).toBeLessThanOrEqual(4096);
  await root.evaluate(async (el) => {
    const p = (el as Host).proof;
    p.save();
    await p.seek(0);
    await p.seek(60000);
  });
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+z');
  }
  await compare(page, source, at);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+Shift+z');
  }
  await compare(page, expected, at + 2);
  await info.attach('descendant-bounds', {
    body: JSON.stringify(stats),
    contentType: 'application/json',
  });
});

test('delayed backward selection across a nested item crop copies no synthetic ancestor text', async ({
  mount,
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const prefix = '- parent\n  - previous\n  - ',
    body = 'abcdefghijklmnopqrstuvwxy'.repeat(5000),
    source = prefix + body + '\n- after';
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el) => (el as Host).proof.seek(30000));
  const at = await root.evaluate((el) => (el as Host).proof.projection!.start);
  await root.evaluate((el) => {
    const h = el as Host & { release: () => void };
    h.proof.delayFetch = () => new Promise((resolve) => (h.release = resolve));
  });
  for (const side of ['native', 'bounded']) {
    await selectItem(page, side, at, 'abcdefghijkl', at - prefix.length);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Shift+ArrowLeft');
      await settled(page);
    }
  }
  expect(await root.evaluate((el) => (el as Host).proof.service.pendingInputs)).toBe(3);
  await root.evaluate((el) => {
    const h = el as Host & { release: () => void };
    h.proof.delayFetch = undefined;
    h.release();
  });
  await expect.poll(() => root.evaluate((el) => (el as Host).proof.service.pendingInputs)).toBe(0);
  const copies = [];
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+c');
    copies.push(await page.evaluate(() => navigator.clipboard.readText()));
  }
  expect(copies).toEqual([source.slice(at - 3, at), source.slice(at - 3, at)]);
  expect(
    await root.evaluate((el) => {
      const p = (el as Host).proof;
      return { selection: p.selection };
    }),
  ).toMatchObject({ selection: { anchor: at, head: at - 3 } });
  await compare(page, source, at - 3);
});

test('native adjacent list join preserves live groups and reopens with canonical groups', async ({
  mount,
  page,
}) => {
  const source = '- before\n- item\n- after';
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  await selectItem(page, 'native', 11, 'item', 0);
  await page.keyboard.press('Backspace');
  await settled(page);
  await page.keyboard.press('Backspace');
  await settled(page);
  const result = await page
    .getByTestId('native')
    .getByTestId('proof')
    .evaluate(async (el) => {
      const h = el as Host;
      const live = h.native.getJSON();
      if (live.content?.at(-1)?.type === 'paragraph' && !live.content.at(-1)?.content)
        live.content.pop();
      return { live, parsed: (await h.parseSource('- beforeitem\n- after')).doc };
    });
  // Original failing equality is retained in checkpoint1a4a241. Live topology and reopening
  // are different native behaviors; neither tree is normalized to pretend equivalence.
  expect(result.live.content!.filter((n) => n.type === 'bulletList')).toHaveLength(2);
  expect(result.parsed.content!.filter((n) => n.type === 'bulletList')).toHaveLength(1);
  type ReopenHost = Host & {
    nativeMarkdown: () => string;
    reloadNative: (s: string) => Promise<void>;
    reopenProof: (s: string) => Promise<void>;
  };
  const native = page.getByTestId('native').getByTestId('proof'),
    bounded = page.getByTestId('bounded').getByTestId('proof');
  const saved = await native.evaluate((el) => (el as ReopenHost).nativeMarkdown());
  expect(saved).toBe('- beforeitem\n\n- after');
  await native.evaluate((el, s) => (el as ReopenHost).reloadNative(s), saved);
  await bounded.evaluate((el, s) => (el as ReopenHost).reopenProof(s), saved);
  for (const side of ['native', 'bounded']) await selectItem(page, side, 8, 'beforeitem', 6);
  await compare(page, saved, 8);
  await compareLiveLists(page);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.insertText('Z');
  }
  await compare(page, '- beforeZitem\n\n- after', 9);
  await compareLiveLists(page);
});

test('records native adjacent-list save reload and continued editing behavior', async ({
  mount,
  page,
}, info) => {
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
  await mount(Harness, { props: { sourceOverride: '- before\n- item\n- after' } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  type NativeHost = Host & {
    nativeMarkdown: () => string;
    reloadNative: (s: string) => Promise<void>;
  };
  const host = page.getByTestId('native').getByTestId('proof');
  const snapshots: Array<{ label: string; [key: string]: unknown }> = [];
  const capture = async (label: string) => {
    await settled(page);
    const value = await host.evaluate((el) => {
      const h = el as NativeHost,
        e = h.native,
        r = e.state.selection.$head;
      return {
        doc: e.getJSON(),
        html: e.getHTML(),
        source: h.nativeMarkdown(),
        selection: e.state.selection.toJSON(),
        endpoint: {
          text: r.parent.textContent,
          offset: r.parentOffset,
          ancestors: Array.from({ length: r.depth }, (_, i) => r.node(i + 1).type.name),
        },
        lists: Array.from(e.view.dom.querySelectorAll('ul')).map((n) => {
          const r = n.getBoundingClientRect(),
            style = getComputedStyle(n);
          return {
            top: r.top,
            bottom: r.bottom,
            marginTop: style.marginTop,
            marginBottom: style.marginBottom,
          };
        }),
      };
    });
    snapshots.push({ label, ...value });
    return value;
  };
  await selectItem(page, 'native', 11, 'item', 0);
  await page.keyboard.press('Backspace');
  await capture('lift');
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:01Z'));
  await page.keyboard.press('Backspace');
  const joined = await capture('joined');
  await info.attach('native-list-live.png', {
    body: await page.getByTestId('native').screenshot(),
    contentType: 'image/png',
  });
  expect(joined.doc.content!.filter((n) => n.type === 'bulletList')).toHaveLength(2);
  const exercise = async (phase: string) => {
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:03Z'));
    await page.keyboard.insertText('Z');
    await capture(phase + ' type');
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:04Z'));
    await page.keyboard.press('Enter');
    await capture(phase + ' enter');
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:05Z'));
    await page.keyboard.press('Backspace');
    await capture(phase + ' backspace');
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Control+z');
      await capture(phase + ' undo ' + i);
    }
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Control+Shift+z');
      await capture(phase + ' redo ' + i);
    }
  };
  await exercise('live');
  await host.evaluate((el, source) => (el as NativeHost).reloadNative(source), joined.source);
  await selectItem(page, 'native', 0, 'beforeitem', 6);
  await capture('reload');
  await info.attach('native-list-reloaded.png', {
    body: await page.getByTestId('native').screenshot(),
    contentType: 'image/png',
  });
  await exercise('reloaded');
  await info.attach('native-list-roundtrip.json', {
    body: JSON.stringify(snapshots, null, 2),
    contentType: 'application/json',
  });
});

test('native ordered join boundaries preserve marks, escaped spelling, and ordinals', async ({
  mount,
  page,
}) => {
  const source = '17. **before**\n18. i\\.tem\n19. after',
    at = source.indexOf('i\\.tem');
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  for (const side of ['native', 'bounded']) {
    await selectItem(page, side, at, 'i.tem', 0);
    await page.keyboard.press('Backspace');
    await settled(page);
    await page.keyboard.press('Backspace');
  }
  const joined = '17. **before**i\\.tem\n\n19. after';
  await compare(page, joined, 14, true);
});

test('repeated native list joins bound session metadata and preserve older boundaries through history', async ({
  mount,
  page,
}, info) => {
  let source = fixture('bulletList'),
    beforeJoin = '',
    beforeCaret = 0,
    caret = 0;
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  const root = page.getByTestId('bounded').getByTestId('proof');
  for (let i = 0; i < 8; i++) {
    const label = `item ${String(800 + i * 2).padStart(4, '0')}`,
      at = source.indexOf(label),
      end = source.indexOf('\n', at);
    await root.evaluate((el, at) => (el as Host).proof.seek(at), at);
    beforeJoin = source.slice(0, at - 2) + '\n' + source.slice(at, end) + '\n' + source.slice(end);
    beforeCaret = at - 1;
    for (const side of ['native', 'bounded']) {
      await selectItem(page, side, at, label, 0);
      await page.clock.setFixedTime(new Date(Date.UTC(2026, 9, 1, 12, 0, i * 2)));
      await page.keyboard.press('Backspace');
      await settled(page);
      await page.clock.setFixedTime(new Date(Date.UTC(2026, 9, 1, 12, 0, i * 2 + 1)));
      await page.keyboard.press('Backspace');
      await settled(page);
    }
    source = source.slice(0, at - 3) + source.slice(at, end) + '\n' + source.slice(end);
    caret = at - 3;
    const stats = await compare(page, source, caret, true);
    expect(stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
    expect(stats.maxSeamMetadataBytes).toBeLessThanOrEqual(4096);
    expect(stats.maxSeamAdmissionBytes).toBeLessThanOrEqual(4096);
    expect(stats.maxResidentAndInFlightSeamBytes).toBeLessThanOrEqual(8192);
    expect(stats.backingSeamCount).toBe(i + 1);
  }
  await root.evaluate(async (el) => {
    const p = (el as Host).proof,
      old = p.editor;
    p.save();
    for (const at of [0, 10000, 20000, 30000]) await p.seek(at);
    if (!old!.isDestroyed) throw new Error('View not evicted');
  });
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+z');
  }
  await compare(page, beforeJoin, beforeCaret, true);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+Shift+z');
  }
  const stats = await compare(page, source, caret, true);
  expect(stats.backingSeamCount).toBe(8);
  expect(stats.maxJournalRead).toBeLessThanOrEqual(4096);
  await info.attach('repeated-seam-bounds.json', {
    body: JSON.stringify(stats),
    contentType: 'application/json',
  });
});
