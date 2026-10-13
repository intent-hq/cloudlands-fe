import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import type { Host } from './paragraph-browser';

for (const kind of ['bold', 'link', 'combined'])
  test(`inherits ${kind} with both delimiters outside the window`, async ({ mount, page }) => {
    const text = 'repeated café 🌍 text repeated. '.repeat(2048).trimEnd();
    const source =
      kind === 'bold'
        ? `**${text}**`
        : kind === 'link'
          ? `[${text}](https://example.test/path)`
          : `[**${text}**](https://example.test/path)`;
    await mount(Pair, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    const evidence = await page
      .getByTestId('bounded')
      .getByTestId('proof')
      .evaluate(async (el) => {
        const h = el as Host;
        await h.proof.seek(20000);
        const native = (
          document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host
        ).native;
        const canonical = await h.parseSource(h.proof.service.region(0));
        return {
          actual: h.proof.editor!.getJSON().content![0].content![0].marks,
          native: native.getJSON().content![0].content![0].marks,
          canonical: canonical.doc.content![0].content![0].marks,
          snapshot: h.proof.snapshot(),
        };
      });
    expect(evidence.native).toEqual(evidence.canonical);
    expect(evidence.actual).toEqual(evidence.canonical);
    expect(evidence.snapshot.maxSourceRead).toBeLessThanOrEqual(4096);
    expect(evidence.snapshot.activeBytes).toBeLessThanOrEqual(16384);
  });

import { focus, settled } from './paragraph-browser';
import type { Page } from '@playwright/test';
const root = (page: Page, side = 'bounded') => page.getByTestId(side).getByTestId('proof');
async function select(page: Page, side: string, sourceAt: number, prefix: number, length = 0) {
  await focus(page, side);
  await root(page, side).evaluate(
    (el, { sourceAt, prefix, length }) => {
      const h = el as Host;
      const e = h.proof?.editor ?? h.native;
      const from = h.proof ? h.proof.projection!.pmAt(sourceAt) : sourceAt - prefix + 1;
      const to = h.proof ? h.proof.projection!.pmAt(sourceAt + length) : from + length;
      e.commands.setTextSelection({ from, to });
    },
    { sourceAt, prefix, length },
  );
  await settled(page);
}
async function sameCanonical(page: Page, expected?: string, normalizeBold = false) {
  const result = await root(page).evaluate(async (el, expected) => {
    const h = el as Host;
    h.proof.save();
    const source = h.proof.service.region(0);
    const native = (document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host)
      .native;
    // Independent fixture grammar, not the proof's coordinate map.
    const visibleOffset = (at: number) =>
      source
        .slice(0, at)
        .replace(/\]\(https:\/\/example\.test\/path\)/g, '')
        .replace(/\*\*|\[/g, '').length;
    return {
      selection: {
        anchor: visibleOffset(h.proof.selection.anchor),
        head: visibleOffset(h.proof.selection.head),
      },
      nativeSelection: {
        anchor: native.state.doc.textBetween(0, native.state.selection.anchor, '\n\n').length,
        head: native.state.doc.textBetween(0, native.state.selection.head, '\n\n').length,
      },
      source,
      error: h.proof.error,
      actual: (await h.parseSource(source)).doc,
      native: native.getJSON(),
      expected: expected === undefined ? undefined : (await h.parseSource(expected)).doc,
    };
  }, expected);
  expect(result.error).toBe('');
  expect(result.selection).toEqual(result.nativeSelection);
  if (expected !== undefined) expect(result.source).toBe(expected);
  const normalized = (doc: import('@tiptap/core').JSONContent) =>
    doc.content?.map((paragraph) => {
      const chars = (paragraph.content ?? []).flatMap((n) =>
        [...(n.text ?? '')].map((text) => ({ text, marks: n.marks ?? [] })),
      );
      for (let i = 0; i < chars.length;) {
        if (!chars[i].marks.some((m) => m.type === 'bold')) {
          i++;
          continue;
        }
        let end = i + 1;
        while (end < chars.length && chars[end].marks.some((m) => m.type === 'bold')) end++;
        let first = i,
          last = end;
        while (first < end && /\s/u.test(chars[first].text)) first++;
        while (last > first && /\s/u.test(chars[last - 1].text)) last--;
        for (let at = i; at < end; at++)
          if (at < first || at >= last)
            chars[at].marks = chars[at].marks.filter((m) => m.type !== 'bold');
        i = end;
      }
      return chars;
    });
  expect(
    JSON.stringify(normalizeBold ? normalized(result.actual) : result.actual) ===
      JSON.stringify(normalizeBold ? normalized(result.native) : result.native),
    'canonical source differs from native text/marks',
  ).toBe(true);
  return result.source;
}
for (const kind of ['bold', 'link', 'combined'])
  test(`native typing, deletion and chronological undo inside inherited ${kind}`, async ({
    mount,
    page,
  }) => {
    const text = 'repeated café 🌍 text repeated. '.repeat(2400).trimEnd();
    const open = kind === 'bold' ? '**' : kind === 'link' ? '[' : '[**';
    const close =
      kind === 'bold'
        ? '**'
        : kind === 'link'
          ? '](https://example.test/path)'
          : '**](https://example.test/path)';
    const source = open + text + close;
    await mount(Pair, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    await root(page).evaluate((el) => (el as Host).proof.seek(20000));
    for (const side of ['native', 'bounded']) {
      await select(page, side, 20000, open.length);
      await page.keyboard.type('NEW');
      await page.keyboard.press('Backspace');
      await settled(page);
    }
    const edited = source.slice(0, 20000) + 'NE' + source.slice(20000);
    await sameCanonical(page, edited);
    const selection = await root(page).evaluate((el) => (el as Host).proof.selection.head);
    expect(selection).toBe(20002);
    await root(page).evaluate(async (el) => {
      const p = (el as Host).proof;
      await p.seek(60000);
      await p.seek(20002);
    });
    await sameCanonical(page, edited);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+z');
      await settled(page);
    }
    await sameCanonical(page, source);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+Shift+z');
      await settled(page);
    }
    await sameCanonical(page, edited);
  });

test('removes bold from a selected subrange of an unloaded combined span', async ({
  mount,
  page,
}) => {
  const text = 'repeated café 🌍 text repeated. '.repeat(2400).trimEnd();
  const source = `[**${text}**](https://example.test/path)`;
  await mount(Pair, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  const at = 3 + 600 * 'repeated café 🌍 text repeated. '.length;
  await root(page).evaluate((el, at) => (el as Host).proof.seek(at), at);
  for (const side of ['native', 'bounded']) {
    await select(page, side, at, 3, 8);
    await page.keyboard.press('Control+b');
    await settled(page);
  }
  const changed = await sameCanonical(page, undefined, true);
  expect(changed).toBe(
    source.slice(0, at - 1) + '**' + source.slice(at - 1, at + 9) + '**' + source.slice(at + 9),
  );
  expect(changed.slice(0, at - 1)).toBe(source.slice(0, at - 1));
  expect(changed.endsWith(source.slice(at + 9))).toBe(true);
  await root(page).evaluate(async (el, at) => {
    const p = (el as Host).proof;
    await p.seek(60000);
    await p.seek(at);
  }, at);
  await sameCanonical(page, changed, true);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+z');
    await settled(page);
  }
  await sameCanonical(page, source);
});

for (const kind of ['bold', 'combined'])
  test(`Enter split, join and two history events preserve inherited ${kind}`, async ({
    mount,
    page,
  }) => {
    const text = 'repeated café 🌍 text repeated. '.repeat(2400).trimEnd();
    const open = kind === 'bold' ? '**' : '[**';
    const close = kind === 'bold' ? '**' : '**](https://example.test/path)';
    const source = open + text + close;
    const at = open.length + 600 * 'repeated café 🌍 text repeated. '.length + 4;
    await mount(Pair, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    await root(page).evaluate((el, at) => (el as Host).proof.seek(at), at);
    const time = Date.UTC(2026, 9, 1, 12);
    for (const side of ['native', 'bounded']) {
      await page.clock.setFixedTime(time);
      await select(page, side, at, open.length);
      await page.keyboard.press('Enter');
      await settled(page);
    }
    const split = source.slice(0, at) + close + '\n\n' + open + source.slice(at);
    await sameCanonical(page, split);
    for (const side of ['native', 'bounded']) {
      await page.clock.setFixedTime(time + 1000);
      await focus(page, side);
      await page.keyboard.press('Backspace');
      await settled(page);
    }
    await sameCanonical(page, source);
    expect(await root(page).evaluate((el) => (el as Host).proof.service.depth)).toBe(2);
    for (const [key, expected] of [
      ['Control+z', split],
      ['Control+z', source],
      ['Control+Shift+z', split],
      ['Control+Shift+z', source],
    ]) {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(key);
        await settled(page);
      }
      await sameCanonical(page, expected);
    }
  });

for (const direction of ['forward', 'backward'])
  test(`native ${direction} selection and formatting cross an inherited crop edge`, async ({
    mount,
    page,
  }) => {
    const text = 'repeated café 🌍 text repeated. '.repeat(2400).trimEnd();
    const source = `**${text}**`;
    await mount(Pair, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    await root(page).evaluate((el) => (el as Host).proof.seek(20000));
    const at = direction === 'forward' ? 21532 : 18466;
    for (const side of ['native', 'bounded']) {
      await select(page, side, at, 2);
      for (let n = 0; n < 8; n++)
        await page.keyboard.press(direction === 'forward' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
      await settled(page);
      await page.keyboard.press('Control+b');
      await settled(page);
    }
    const changed = await sameCanonical(page, undefined, true);
    const state = await root(page).evaluate((el) => (el as Host).proof.snapshot());
    expect(state.windowFrom).not.toBe(17952);
    expect(state.error).toBe('');
    await root(page).evaluate(async (el, at) => {
      const p = (el as Host).proof;
      await p.seek(60000);
      await p.seek(at);
    }, at);
    await sameCanonical(page, changed, true);
  });

test('one MiB combined span retains bounded context while seeking middle and end', async ({
  mount,
  page,
}, info) => {
  const source =
    '[**' +
    'repeated café 🌍 text repeated. '.repeat(36000).trimEnd() +
    '**](https://example.test/path)';
  await mount(Pair, { props: { sourceOverride: source } });
  // The full native oracle parses >1 MiB asynchronously before mounting.
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
  const evidence = await root(page).evaluate(async (el) => {
    const h = el as Host,
      p = h.proof;
    const native = (document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host)
      .native;
    const canonical = (await h.parseSource(p.service.region(0))).doc;
    const snapshots = [];
    for (const at of [20000, p.service.length - 6000]) {
      await p.seek(at);
      snapshots.push(p.snapshot());
      if (
        JSON.stringify(p.editor!.getJSON().content![0].content![0].marks) !==
        JSON.stringify(canonical.content![0].content![0].marks)
      )
        throw new Error('Inherited marks differ');
    }
    return {
      snapshots,
      nativeEqualsCanonical: JSON.stringify(native.getJSON()) === JSON.stringify(canonical),
      fixtureBytes: new TextEncoder().encode(p.service.region(0)).length,
    };
  });
  expect(evidence.nativeEqualsCanonical).toBe(true);
  expect(evidence.fixtureBytes).toBeGreaterThan(1024 * 1024);
  for (const stats of evidence.snapshots) {
    expect(stats.maxSourceRead).toBeLessThanOrEqual(4096);
    expect(stats.activeBytes).toBeLessThanOrEqual(16384);
    expect(stats.maxInlineContextBytes).toBeLessThanOrEqual(4096);
    expect(stats.cachePages).toBeLessThanOrEqual(4);
    expect(stats.sourceReplicaPayloadBytes).toBeLessThan(65536);
    expect(stats.tokenProvenancePayloadBytes + stats.provenancePayloadBytes).toBeLessThan(
      1024 * 1024,
    );
    expect(stats.backingIndexBuilds).toBe(1);
    expect(stats.backingIndexSourceBytes).toBeGreaterThan(1024 * 1024);
    expect(stats.mounted).toBe(1);
  }
  await info.attach('inline-scaling.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
  await info.attach('inherited-context.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const backward of [false, true])
  test(`delayed ${backward ? 'Backspace' : 'Delete'} then Enter retains inherited context and input order`, async ({
    mount,
    page,
  }, info) => {
    const source =
      '[**' +
      'repeated café 🌍 text repeated. '.repeat(2400).trimEnd() +
      '**](https://example.test/path)';
    await mount(Pair, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    await root(page).evaluate((el) => (el as Host).proof.seek(20000));
    const at = backward ? 17952 : 22048;
    await root(page).evaluate((el) => {
      const h = el as Host & { release: () => void };
      h.proof.delayFetch = () =>
        new Promise((resolve) => {
          h.release = resolve;
        });
    });
    const time = Date.UTC(2026, 9, 1, 12);
    for (const side of ['native', 'bounded']) {
      await page.clock.setFixedTime(time);
      await select(page, side, at, 3);
      await page.keyboard.press(backward ? 'Backspace' : 'Delete');
      await page.clock.setFixedTime(time + 1000);
      await page.keyboard.press('Enter');
      await settled(page);
    }
    const waiting = await root(page).evaluate((el) => (el as Host).proof.snapshot());
    expect(waiting.pendingInputs).toBe(2);
    await root(page).evaluate((el) => {
      const h = el as Host & { release: () => void };
      h.proof.delayFetch = undefined;
      h.release();
    });
    await expect
      .poll(() => root(page).evaluate((el) => (el as Host).proof.service.pendingInputs))
      .toBe(0);
    const from = at - Number(backward);
    const deleted = source.slice(0, from) + source.slice(from + 1);
    const split =
      source.slice(0, from) + '**](https://example.test/path)\n\n[**' + source.slice(from + 1);
    await sameCanonical(page, split);
    expect(await root(page).evaluate((el) => (el as Host).proof.service.depth)).toBe(2);
    for (const [key, expected] of [
      ['Control+z', deleted],
      ['Control+z', source],
      ['Control+Shift+z', deleted],
      ['Control+Shift+z', split],
    ]) {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(key);
        await settled(page);
      }
      await sameCanonical(page, expected);
    }
    await info.attach('inline-deferred.json', {
      body: JSON.stringify(
        { waiting, after: await root(page).evaluate((el) => (el as Host).proof.snapshot()) },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });

test('delimiter crop boundaries match real native text and marks', async ({
  mount,
  page,
}, info) => {
  const text = 'word '.repeat(16000).trimEnd();
  const source = 'x'.repeat(2049) + '[**' + text + '**](https://example.test/path) tail';
  await mount(Pair, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  const evidence = await root(page).evaluate(async (el) => {
    const h = el as Host,
      p = h.proof,
      source = p.service.region(0);
    const native = (document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host)
      .native;
    const closeFrom = source.indexOf('**]'),
      closeTo = source.indexOf(') tail') + 1;
    const visible = (at: number) =>
      at <= 2049
        ? at
        : at < 2052
          ? 2049
          : at <= closeFrom
            ? at - 3
            : at < closeTo
              ? closeFrom - 3
              : at - 3 - (closeTo - closeFrom);
    const results = [];
    for (const at of [4098, 4099, 4100, closeFrom - 2047, closeFrom - 2044]) {
      await p.seek(at);
      const from = p.projection!.start,
        to = from + p.projection!.source.length;
      const wanted = native.state.doc
        .slice(visible(from) + 1, visible(to) + 1, true)
        .content.toJSON();
      results.push({
        at,
        from,
        to,
        equal: JSON.stringify(p.editor!.state.doc.content.toJSON()) === JSON.stringify(wanted),
        snapshot: p.snapshot(),
      });
    }
    return results;
  });
  await info.attach('crop-boundaries.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
  expect(evidence.map((r) => r.equal)).toEqual([true, true, true, true, true]);
});

for (const [kind, open, close] of [
  ['bold', '**', '**'],
  ['link', '[', '](https://example.test/path)'],
  ['combined', '[**', '**](https://example.test/path)'],
]) {
  const source =
    'x'.repeat(6141) +
    open +
    'repeated café 🌍 text repeated. '.repeat(2600).trimEnd() +
    close +
    ' tail';
  const at = 6141 + open.length - 2048;
  test(`empty ${kind} crop-end display agrees with native at and beside the opener`, async ({
    mount,
    page,
  }, info) => {
    await mount(Pair, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    const results = await root(page).evaluate(
      async (el, { at, open }) => {
        const h = el as Host,
          p = h.proof;
        const native = (
          document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host
        ).native;
        const canonical = (await h.parseSource(p.service.region(0))).doc;
        const rows = [];
        for (const delta of [-2, -1, 0, 1, 2]) {
          await p.seek(at + delta);
          const from = p.projection!.start,
            to = from + p.projection!.source.length;
          const visibleEnd = Math.min(to, 6141) + Math.max(0, to - 6141 - open.length);
          const expected = native.state.doc.slice(from + 1, visibleEnd + 1, true).content.toJSON();
          rows.push({
            delta,
            from,
            to,
            equal:
              JSON.stringify(p.editor!.state.doc.content.toJSON()) === JSON.stringify(expected),
            snapshot: p.snapshot(),
          });
        }
        return {
          nativeCanonicalEqual: JSON.stringify(native.getJSON()) === JSON.stringify(canonical),
          rows,
        };
      },
      { at, open },
    );
    await info.attach('empty-edge-display.json', {
      body: JSON.stringify({ kind, ...results }, null, 2),
      contentType: 'application/json',
    });
    expect(results.nativeCanonicalEqual).toBe(true);
    expect(results.rows.map((r) => r.equal)).toEqual([true, true, true, true, true]);
  });
  test(`native Z input beside an unloaded ${kind} opener survives save, eviction and undo`, async ({
    mount,
    page,
  }, info) => {
    await mount(Pair, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    await root(page).evaluate((el, at) => (el as Host).proof.seek(at), at);
    for (const side of ['native', 'bounded']) {
      await select(page, side, at, 0);
      await page.keyboard.insertText('Z');
      await settled(page);
    }
    const expected = source.slice(0, at) + 'Z' + source.slice(at);
    await sameCanonical(page, expected);
    const edited = await root(page).evaluate((el) => (el as Host).proof.snapshot());
    expect(edited.selection.head).toBe(at + 1);
    expect(edited.journalEvents).toBe(1);
    const eviction = await root(page).evaluate(async (el, at) => {
      const p = (el as Host).proof,
        old = p.editor;
      for (const destination of [65000, 35000, at]) await p.seek(destination);
      return { destroyed: old!.isDestroyed, snapshot: p.snapshot() };
    }, at);
    expect(eviction.destroyed).toBe(true);
    expect(eviction.snapshot.created).toBe(edited.created + 3);
    await sameCanonical(page, expected);
    for (const [key, wanted] of [
      ['Control+z', source],
      ['Control+Shift+z', expected],
    ]) {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(key);
        await settled(page);
      }
      await sameCanonical(page, wanted);
    }
    await info.attach('empty-edge-input.json', {
      body: JSON.stringify(
        {
          kind,
          edited,
          eviction,
          final: await root(page).evaluate((el) => (el as Host).proof.snapshot()),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
}

for (const [kind, open, close] of [
  ['bold', '**', '**'],
  ['link', '[', '](https://example.test/path)'],
  ['combined', '[**', '**](https://example.test/path)'],
])
  test(`remote ${kind} opener preserves native display, typing and history at a closing crop edge`, async ({
    mount,
    page,
  }, info) => {
    const prefixLength = 24573;
    const source = 'x'.repeat(prefixLength) + close + 'y'.repeat(83000);
    const remote = open + source;
    const at = prefixLength + 2048;
    await mount(Pair, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
    const beforeEqual = await root(page).evaluate(async (el) => {
      const h = el as Host;
      const native = (
        document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host
      ).native;
      return (
        JSON.stringify(native.getJSON()) ===
        JSON.stringify((await h.parseSource(h.proof.service.region(0))).doc)
      );
    });
    expect(beforeEqual).toBe(true);
    await root(page).evaluate((el, at) => (el as Host).proof.seek(at), at);
    for (const side of ['native', 'bounded']) await select(page, side, at, 0);
    await root(page).evaluate(
      (el, open) => (el as Host).proof.remote({ from: 0, to: 0, insert: open }),
      open,
    );
    await root(page, 'native').evaluate(
      (el, { prefixLength, close, kind }) => {
        const e = (el as Host).native;
        // Before the opener arrives the bare URL is auto-linked; remote parsing removes it.
        const tr = e.state.tr
          .removeMark(1, e.state.doc.content.size, e.schema.marks.link)
          .delete(prefixLength + 1, prefixLength + close.length + 1);
        if (kind !== 'link') tr.addMark(1, prefixLength + 1, e.schema.marks.bold.create());
        if (kind !== 'bold')
          tr.addMark(
            1,
            prefixLength + 1,
            e.schema.marks.link.create({ href: 'https://example.test/path' }),
          );
        e.view.dispatch(tr.setMeta('addToHistory', false));
      },
      { prefixLength, close, kind },
    );
    await settled(page);
    await sameCanonical(page, remote);
    const display = await root(page).evaluate((el, delimiters) => {
      const p = (el as Host).proof;
      const native = (
        document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host
      ).native;
      const from = p.projection!.start - delimiters;
      const to = from + p.projection!.source.length;
      return {
        text: p.editor!.getText().slice(0, 8),
        nativeEqual:
          JSON.stringify(p.editor!.state.doc.content.toJSON()) ===
          JSON.stringify(native.state.doc.slice(from + 1, to + 1, true).content.toJSON()),
        context: p.projection!.context,
        snapshot: p.snapshot(),
      };
    }, open.length + close.length);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.insertText('Z');
      await settled(page);
    }
    const position = at + open.length;
    const changed = remote.slice(0, position) + 'Z' + remote.slice(position);
    await sameCanonical(page, changed);
    expect(display.text).toBe('yyyyyyyy');
    expect(display.nativeEqual).toBe(true);
    const edited = await root(page).evaluate((el) => (el as Host).proof.snapshot());
    expect(edited.journalEvents).toBe(1);
    const eviction = await root(page).evaluate(async (el, position) => {
      const p = (el as Host).proof;
      p.save();
      const editor = p.editor!;
      for (const at of [60000, 80000, position]) await p.seek(at);
      return { destroyed: editor.isDestroyed, snapshot: p.snapshot() };
    }, position);
    expect(eviction.destroyed).toBe(true);
    for (const [key, expected] of [
      ['Control+z', remote],
      ['Control+Shift+z', changed],
    ]) {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(key);
        await settled(page);
      }
      await sameCanonical(page, expected);
    }
    expect(edited.maxSourceRead).toBeLessThanOrEqual(4096);
    expect(edited.activeBytes).toBeLessThanOrEqual(16384);
    await info.attach('remote-edge-history.json', {
      body: JSON.stringify({ kind, display, edited, eviction }),
      contentType: 'application/json',
    });
  });
