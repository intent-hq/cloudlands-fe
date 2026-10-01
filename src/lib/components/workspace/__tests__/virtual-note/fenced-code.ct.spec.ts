import { test, expect } from '../../../../../test/ct-test';
import Harness from './ParagraphProofHarness.svelte';
import type { Host } from './paragraph-browser';

const line = '\tconst café = "**literal** [link](url) `code` \\escape 🌍";  \n';
test('unloaded fences preserve native code structure and literal source', async ({
  mount,
  page,
}) => {
  const source = '````typescript extra-info\n' + line.repeat(1600) + '````\n\nAfter prose';
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
  const result = await page
    .getByTestId('bounded')
    .getByTestId('proof')
    .evaluate(async (el, source) => {
      const h = el as Host;
      await h.proof.seek(30000);
      const canonical = await h.parseSource(source);
      const native = (
        document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host
      ).native;
      return {
        node: h.proof.editor!.state.doc.firstChild!.type.name,
        literal: h.proof.editor!.state.doc.textContent === h.proof.projection!.source,
        nativeCanonical: JSON.stringify(native.getJSON()) === JSON.stringify(canonical.doc),
      };
    }, source);
  expect(result).toEqual({ node: 'codeBlock', literal: true, nativeCanonical: true });
});

import type { Page } from '@playwright/test';
import { focus, settled } from './paragraph-browser';
const opening = '````typescript extra-info\n';
const makeSource = (repeats = 1600, header = opening) =>
  header + line.repeat(repeats) + '````\n\nAfter prose';
async function selectCode(page: Page, side: string, source: string, anchor: number, head = anchor) {
  await focus(page, side);
  await page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate(
      (el, { bodyFrom, anchor, head }) => {
        const h = el as Host,
          e = h.proof?.editor ?? h.native;
        const position = (at: number) =>
          h.proof ? h.proof.projection!.pmAt(at) : at - bodyFrom + 1;
        e.commands.setTextSelection({ from: position(anchor), to: position(head) });
      },
      { bodyFrom: source.indexOf('\n') + 1, anchor, head },
    );
  await settled(page);
}
async function sameCode(page: Page, expected: string, compareSelection = true) {
  await settled(page);
  const result = await page.evaluate(
    async ({ expected, compareSelection }) => {
      const h = document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host;
      const n = (document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host)
        .native;
      const p = h.proof,
        projection = p.projection!;
      const bodyFrom = expected.indexOf('\n') + 1;
      const bodyTo = expected.indexOf('\n````', bodyFrom);
      const actual = p.editor!.state.doc.firstChild!;
      const full = (await h.parseSource(expected)).doc;
      const nativeSelection = {
        anchor: n.state.selection.anchor + bodyFrom - 1,
        head: n.state.selection.head + bodyFrom - 1,
      };
      return {
        error: p.error,
        exact: p.service.region(0) === expected,
        parserNative: JSON.stringify(full) === JSON.stringify(n.getJSON()),
        type: actual.type.name,
        language: actual.attrs.language,
        literal:
          actual.textContent ===
          expected.slice(
            Math.max(bodyFrom, projection.start),
            Math.min(bodyTo, projection.start + projection.source.length),
          ),
        marks: actual.firstChild?.marks.length ?? 0,
        selection:
          !compareSelection ||
          (nativeSelection.anchor === p.selection.anchor &&
            nativeSelection.head === p.selection.head),
        stats: { ...p.snapshot(), source: undefined, calls: undefined },
      };
    },
    { expected, compareSelection },
  );
  expect(result.error).toBe('');
  expect(result.exact).toBe(true);
  expect(result.parserNative).toBe(true);
  expect(result.type).toBe('codeBlock');
  expect(result.literal).toBe(true);
  expect(result.marks).toBe(0);
  expect(result.selection).toBe(true);
  expect(result.stats.maxSourceRead).toBeLessThanOrEqual(4096);
  expect(result.stats.maxInlineContextBytes).toBeLessThanOrEqual(4096);
  expect(result.stats.maxParsedBytes).toBeLessThanOrEqual(16384);
  expect(result.stats.maxHighlightBytes).toBeLessThanOrEqual(16384);
  expect(result.stats.cachePages).toBeLessThanOrEqual(4);
  expect(result.stats.retainedEditorStates).toBe(0);
  return result.stats;
}

for (const backward of [false, true])
  test(`native fenced ${backward ? 'backward' : 'forward'} selection, typing and history through eviction`, async ({
    mount,
    page,
  }, info) => {
    const source = makeSource();
    await mount(Harness, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
    const root = page.getByTestId('bounded').getByTestId('proof');
    await root.evaluate((el) => (el as Host).proof.seek(30000));
    const at = backward ? 28000 : 31990;
    for (const side of ['native', 'bounded']) {
      await selectCode(page, side, source, at);
      for (let i = 0; i < 20; i++)
        await page.keyboard.press(backward ? 'Shift+ArrowLeft' : 'Shift+ArrowRight');
    }
    await sameCode(page, source);
    const selection = await root.evaluate((el) => ({ ...(el as Host).proof.selection }));
    const from = Math.min(selection.anchor, selection.head),
      to = Math.max(selection.anchor, selection.head);
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.insertText('**RAW** café 🌍');
    }
    const expected = source.slice(0, from) + '**RAW** café 🌍' + source.slice(to);
    const edited = await sameCode(page, expected);
    const evicted = await root.evaluate(async (el) => {
      const p = (el as Host).proof,
        old = p.editor!;
      p.save();
      for (const at of [10000, 40000, 60000, 80000, 30000]) await p.seek(at);
      return old.isDestroyed;
    });
    expect(evicted).toBe(true);
    for (const [key, text] of [
      ['Control+z', source],
      ['Control+Shift+z', expected],
    ]) {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(key);
      }
      await sameCode(page, text);
    }
    await info.attach('code-history.json', {
      body: JSON.stringify(edited),
      contentType: 'application/json',
    });
  });

for (const backward of [false, true])
  test(`delayed fenced ${backward ? 'Backspace' : 'Delete'} then Enter and literal typing applies once`, async ({
    mount,
    page,
  }, info) => {
    const time = Date.parse('2026-10-01T12:00:00Z');
    await page.clock.setFixedTime(time);
    const source = makeSource();
    await mount(Harness, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
    const root = page.getByTestId('bounded').getByTestId('proof');
    if (backward) await root.evaluate((el) => (el as Host).proof.seek(4096));
    await root.evaluate((el) => {
      const h = el as Host & { release: () => void };
      h.proof.delayFetch = () => new Promise((resolve) => (h.release = resolve));
    });
    const at = backward ? 2048 : 4096;
    for (const side of ['native', 'bounded']) {
      await page.clock.setFixedTime(time);
      await selectCode(page, side, source, at);
      await page.keyboard.press(backward ? 'Backspace' : 'Delete');
      await page.clock.setFixedTime(time + 1000);
      await page.keyboard.press('Enter');
      await page.keyboard.insertText('**NEW**');
      await settled(page);
    }
    const waiting = await root.evaluate((el) => (el as Host).proof.snapshot());
    expect(waiting.pendingInputs).toBeGreaterThanOrEqual(3);
    await root.evaluate((el) => {
      const h = el as Host & { release: () => void };
      h.proof.delayFetch = undefined;
      h.release();
    });
    await expect
      .poll(() => root.evaluate((el) => (el as Host).proof.service.pendingInputs))
      .toBe(0);
    const from = backward ? at - 1 : at;
    const deleted = source.slice(0, from) + source.slice(from + 1);
    const expected = deleted.slice(0, from) + '\n**NEW**' + deleted.slice(from);
    const after = await sameCode(page, expected);
    expect(after.journalEvents).toBe(2);
    for (const [key, text] of [
      ['Control+z', deleted],
      ['Control+z', source],
      ['Control+Shift+z', deleted],
      ['Control+Shift+z', expected],
    ]) {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(key);
      }
      await sameCode(page, text);
    }
    await info.attach('code-deferred.json', {
      body: JSON.stringify({ waiting, after }),
      contentType: 'application/json',
    });
  });

test('one-megabyte fenced code seeks middle and real closing edge with bounded highlighting', async ({
  mount,
  page,
}, info) => {
  const source = makeSource(20000, '````text metadata\n');
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
  const root = page.getByTestId('bounded').getByTestId('proof');
  const samples = [];
  for (const at of [30000, source.indexOf('\n````') - 20]) {
    await root.evaluate((el, at) => (el as Host).proof.seek(at), at);
    for (const side of ['native', 'bounded']) await selectCode(page, side, source, at);
    samples.push(await sameCode(page, source));
  }
  expect(Buffer.byteLength(source)).toBeGreaterThan(1048576);
  await info.attach('code-scaling.json', {
    body: JSON.stringify({ sourceBytes: Buffer.byteLength(source), samples }),
    contentType: 'application/json',
  });
});

async function pointCode(page: Page, side: string, source: string, at: number) {
  return page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate(
      (el, { at, bodyFrom }) => {
        const h = el as Host,
          e = h.proof?.editor ?? h.native;
        const pos = h.proof ? h.proof.projection!.pmAt(at) : at - bodyFrom + 1;
        let rect = e.view.coordsAtPos(pos);
        const scroller = e.view.dom.parentElement!.parentElement!;
        const viewport = scroller.getBoundingClientRect();
        if (rect.top < viewport.top || rect.bottom > viewport.bottom) {
          scroller.scrollTop += rect.top - viewport.top - 200;
          rect = e.view.coordsAtPos(pos);
        }
        const pre = e.view.dom.querySelector('pre')!;
        const pr = pre.getBoundingClientRect();
        if (rect.left < pr.left || rect.right > pr.right) {
          pre.scrollLeft += rect.left - pr.left - 100;
          rect = e.view.coordsAtPos(pos);
        }
        return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
      },
      { at, bodyFrom: source.indexOf('\n') + 1 },
    );
}
for (const backward of [false, true])
  test(`fenced ${backward ? 'backward' : 'forward'} pointer drag and clipboard retain literal syntax`, async ({
    mount,
    page,
    context,
  }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const source = makeSource();
    await mount(Harness, { props: { sourceOverride: source } });
    await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
    const root = page.getByTestId('bounded').getByTestId('proof');
    if (backward) await root.evaluate((el) => (el as Host).proof.seek(4096));
    const start = backward ? 2650 : 3500,
      middle = backward ? 2540 : 3650,
      finish = backward ? 1984 : 4160;
    const copied = [];
    for (const side of ['native', 'bounded']) {
      await selectCode(page, side, source, start);
      const a = await pointCode(page, side, source, start),
        b = await pointCode(page, side, source, middle);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await settled(page);
      if (side === 'bounded')
        await expect
          .poll(() =>
            root.evaluate(
              (el, backward) =>
                backward
                  ? (el as Host).proof.projection!.start < 2048
                  : (el as Host).proof.snapshot().windowTo > 4096,
              backward,
            ),
          )
          .toBe(true);
      const c = await pointCode(page, side, source, finish);
      await page.mouse.move(c.x, c.y, { steps: 8 });
      await page.mouse.up();
      await settled(page);
      await page.keyboard.press('Control+c');
      copied.push(await page.evaluate(() => navigator.clipboard.readText()));
    }
    await sameCode(page, source);
    expect(copied[0]).toBe(source.slice(Math.min(start, finish), Math.max(start, finish)));
    expect(copied[1]).toBe(copied[0]);
    await page.clock.setFixedTime(Date.parse('2026-10-01T12:00:00Z'));
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+x');
    }
    const cut = source.slice(0, Math.min(start, finish)) + source.slice(Math.max(start, finish));
    await sameCode(page, cut);
    await page.clock.setFixedTime(Date.parse('2026-10-01T12:00:01Z'));
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press('Control+v');
    }
    const after = await sameCode(page, source);
    await root.evaluate(async (el) => {
      const p = (el as Host).proof;
      p.save();
      await p.seek(70000);
    });
    for (const [key, text] of [
      ['Control+z', cut],
      ['Control+z', source],
      ['Control+Shift+z', cut],
      ['Control+Shift+z', source],
    ]) {
      for (const side of ['native', 'bounded']) {
        await focus(page, side);
        await page.keyboard.press(key);
      }
      await sameCode(page, text);
    }
    await info.attach('code-clipboard.json', {
      body: JSON.stringify(after),
      contentType: 'application/json',
    });
  });

test('Enter at an artificial double-newline code edge waits instead of exiting the block', async ({
  mount,
  page,
}) => {
  const source =
    opening +
    line.repeat(100).slice(0, 4094 - opening.length) +
    '\n\n' +
    line.repeat(1600) +
    '\n````\n\nAfter prose';
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el) => {
    const h = el as Host & { release: () => void };
    h.proof.delayFetch = () => new Promise((resolve) => (h.release = resolve));
  });
  for (const side of ['native', 'bounded']) {
    await selectCode(page, side, source, 4096);
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Z');
  }
  expect(await root.evaluate((el) => (el as Host).proof.service.pendingInputs)).toBe(2);
  await root.evaluate((el) => {
    const h = el as Host & { release: () => void };
    h.proof.delayFetch = undefined;
    h.release();
  });
  await expect.poll(() => root.evaluate((el) => (el as Host).proof.service.pendingInputs)).toBe(0);
  await sameCode(page, source.slice(0, 4096) + '\nZ' + source.slice(4096));
});

test('native real-end Enter exits to prose and Backspace joins it back into code', async ({
  mount,
  page,
}, info) => {
  const source = '````text metadata\n' + line.repeat(1600) + '\n\n````\n\nAfter prose';
  const at = source.indexOf('\n````');
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el, at) => (el as Host).proof.seek(at), at);
  await page.clock.setFixedTime(Date.parse('2026-10-01T12:00:00Z'));
  for (const side of ['native', 'bounded']) {
    await selectCode(page, side, source, at);
    await page.keyboard.press('Enter');
    await page.keyboard.type('EXIT');
  }
  const expected =
    source.slice(0, at - 2) +
    source.slice(at, source.indexOf('After prose')) +
    'EXIT\n\nAfter prose';
  const after = await sameCode(page, expected, false);
  await page.clock.setFixedTime(Date.parse('2026-10-01T12:00:01Z'));
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowLeft');
      await settled(page);
    }
    await page.keyboard.press('Backspace');
  }
  const joined = source.slice(0, at - 2) + 'EXIT' + source.slice(at);
  await sameCode(page, joined);
  await root.evaluate(async (el) => {
    const p = (el as Host).proof;
    p.save();
    await p.seek(10000);
    await p.seek(50000);
  });
  for (const [key, text] of [
    ['Control+z', expected],
    ['Control+z', source],
    ['Control+Shift+z', expected],
    ['Control+Shift+z', joined],
  ]) {
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press(key);
    }
    await sameCode(page, text, false);
  }
  await info.attach('code-exit.json', {
    body: JSON.stringify(after),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('fenced-code.png') });
});

test('remote unloaded fence language preserves native draft, save and undo', async ({
  mount,
  page,
}, info) => {
  const source = makeSource();
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el) => (el as Host).proof.seek(30000));
  for (const side of ['native', 'bounded']) {
    await selectCode(page, side, source, 30000);
    await page.keyboard.type('A');
  }
  await root.evaluate((el) => (el as Host).proof.remote({ from: 4, to: 14, insert: 'text' }));
  await page
    .getByTestId('native')
    .getByTestId('proof')
    .evaluate((el) => {
      const e = (el as Host).native;
      e.view.dispatch(
        e.state.tr.setNodeMarkup(0, undefined, { language: 'text' }).setMeta('addToHistory', false),
      );
    });
  const remote = source.slice(0, 4) + 'text' + source.slice(14);
  const expected = remote.slice(0, 29994) + 'A' + remote.slice(29994);
  const after = await sameCode(page, expected);
  await root.evaluate(async (el) => {
    const p = (el as Host).proof;
    p.save();
    for (const at of [10000, 40000, 60000, 80000]) await p.seek(at);
  });
  for (const [key, text] of [
    ['Control+z', remote],
    ['Control+Shift+z', expected],
  ]) {
    for (const side of ['native', 'bounded']) {
      await focus(page, side);
      await page.keyboard.press(key);
    }
    await sameCode(page, text);
  }
  await info.attach('code-remote.json', {
    body: JSON.stringify(after),
    contentType: 'application/json',
  });
});

test('real document end retains native trailing prose without saving phantom bytes', async ({
  mount,
  page,
}, info) => {
  const source = '````text metadata\n' + line.repeat(1600) + '````';
  const at = source.lastIndexOf('\n````');
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
  const root = page.getByTestId('bounded').getByTestId('proof');
  await root.evaluate((el, at) => (el as Host).proof.seek(at), at);
  for (const side of ['native', 'bounded']) {
    await selectCode(page, side, source, at);
    await page.keyboard.type('Z');
  }
  const expected = source.slice(0, at) + 'Z' + source.slice(at);
  const result = await page.evaluate(async (expected) => {
    const h = document.querySelector('[data-testid="bounded"] [data-testid="proof"]') as Host;
    const n = (document.querySelector('[data-testid="native"] [data-testid="proof"]') as Host)
      .native;
    const parsed = (await h.parseSource(expected)).doc;
    return {
      error: h.proof.error,
      exact: h.proof.service.region(0) === expected,
      nativeCode:
        JSON.stringify(parsed.content![0]) === JSON.stringify(n.state.doc.firstChild!.toJSON()),
      live: h.proof.editor!.state.doc.content.childCount,
      native: n.state.doc.childCount,
      trailing: h.proof.editor!.state.doc.lastChild!.toJSON(),
      stats: h.proof.snapshot(),
    };
  }, expected);
  expect(result.error).toBe('');
  expect(result.exact).toBe(true);
  expect(result.nativeCode).toBe(true);
  expect(result.live).toBe(result.native);
  expect(result.trailing.type).toBe('paragraph');
  expect(result.trailing.content ?? []).toHaveLength(0);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+End');
    await page.keyboard.type('AFTER');
  }
  const prose = expected + '\n\nAFTER';
  await sameCode(page, prose, false);
  await info.attach('code-terminal.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
});

test('real opening fence Enter and formatting shortcut preserve literal code and info', async ({
  mount,
  page,
}) => {
  const source = makeSource(),
    at = opening.length;
  await mount(Harness, { props: { sourceOverride: source } });
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1, { timeout: 15000 });
  for (const side of ['native', 'bounded']) {
    await selectCode(page, side, source, at);
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('[**literal**](url)');
  }
  const expected = source.slice(0, at) + '\n[**literal**](url)' + source.slice(at);
  await sameCode(page, expected);
  for (const side of ['native', 'bounded']) {
    await focus(page, side);
    await page.keyboard.press('Control+z');
  }
  await sameCode(page, source);
});
