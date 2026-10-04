import halfopenMarks from './__tests__/fixtures/store-markdown-html-marks-halfopen-windows.json';
import halfopenLF from './__tests__/fixtures/store-markdown-html-lf-halfopen-windows.json';
import halfopenCRLF from './__tests__/fixtures/store-markdown-html-crlf-halfopen-windows.json';
import markdownCRLF from './__tests__/fixtures/store-markdown-html-crlf-compacted-windows.json';
import markdownLF from './__tests__/fixtures/store-markdown-html-lf-compacted-windows.json';
import markdownMARKS from './__tests__/fixtures/store-markdown-html-marks-compacted-windows.json';
import stableMarkdownBackticks from './__tests__/fixtures/store-entry-backtick-markdown-stable-parent.json';
import headingClosure from './__tests__/fixtures/store-entry-mixed-entry-heading-first.json';
import anchorClosure from './__tests__/fixtures/store-entry-mixed-entry-anchor-first.json';
import htmlBackticks from './__tests__/fixtures/store-entry-backtick-html.json';
import markdownBackticks from './__tests__/fixtures/store-entry-backtick-markdown.json';
import { expect, it } from 'vitest';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { nativeFixtureEditor } from './__tests__/canonical-table-fixture';
import corrected from './__tests__/fixtures/store-document-tail.json';
import baseline from './__tests__/fixtures/store-document-tail-baseline.json';
import heading from './__tests__/fixtures/store-document-heading.json';
import anchor from './__tests__/fixtures/store-document-anchor.json';
import { readNoteWindow } from './note-window-reader';
import { projectNoteWindow } from './note-window-projection';

type Transcript = {
  source: string;
  at: number;
  calls: Array<{ request: Record<string, unknown>; response: NoteReadPage }>;
};
// Frozen actual Store responses, including original expiry. Replay is not a live
// authenticated lease and never fabricates missing dependencies or smaller reads.
function replay(raw: unknown, terminalReply = false) {
  const t = raw as Transcript;
  const identity = t.calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing source');
  const requests: NotePageRequest[] = [];
  const reader = new NotePageReader(async (_, params) => {
    const q = params.page as NotePageRequest;
    requests.push(q);
    const found = t.calls.find(
      ({ request: r, response }) =>
        r.kind === q.kind &&
        r.cursor === q.cursor &&
        ('contextRef' in q
          ? r.contextRef === q.contextRef
          : 'ref' in q
            ? r.ref === q.ref
            : q.kind === 'source' &&
              r.at === q.at &&
              (r.maxSourceBytes === q.maxSourceBytes ||
                (terminalReply &&
                  response.kind === 'noteSourcePage' &&
                  response.nextCursor === null &&
                  response.range.end === response.sourceLength &&
                  q.maxSourceBytes === 4096))),
    );
    if (!found) throw new Error('Uncaptured Store request: ' + JSON.stringify(q));
    return found.response;
  });
  return {
    t,
    requests,
    read: (at = t.at) =>
      readNoteWindow((q) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q), {
        ...identity,
        at,
      }),
  };
}

it('replays corrected HTML document resources into the unchanged native literal tail', async () => {
  const fixture = replay(corrected);
  const w = await fixture.read();
  const projection = projectNoteWindow(w);
  const expected = nativeFixtureEditor(
    await processMarkdownToHTML(fixture.t.source, { workspaceId: 'ws-a', preserveAnchors: true }),
  );
  const actual = nativeFixtureEditor(projection.content);
  try {
    expect(actual.getJSON().content).toEqual([expected.getJSON().content?.at(-1)]);
    expect(actual.state.doc.textContent).toBe(' **After**');
    expect(w.text).toBe('**After**');
    expect(w.context).toContainEqual(
      expect.objectContaining({ kind: 'boundary', construct: 'htmlDocument' }),
    );
    expect(fixture.requests.filter((q) => q.kind === 'source')).toHaveLength(1);
    expect(w.cost.sourceBytes).toBe(9);
    expect(w.cost.canonicalBytes).toBeLessThanOrEqual(8192);
    expect(w.cost.requests).toBe(20);
    expect(projection.sourceAt(2)).toBe(fixture.t.at);
    expect(projection.sourceAt(11)).toBe(fixture.t.source.length);
    console.info('Actual Store document tail costs', w.cost);
  } finally {
    expected.destroy();
    actual.destroy();
  }
});

it('preserves the original missing-mapping Store capture as a native parity counterexample', async () => {
  const fixture = replay(baseline);
  const w = await fixture.read();
  expect(w.native).toBeUndefined();
  const projected = projectNoteWindow(w);
  expect(projected.content.content).not.toEqual([
    { type: 'paragraph', content: [{ type: 'text', text: ' **After**' }] },
  ]);
  expect(projected.content.content?.[0].content?.[0]).toMatchObject({
    type: 'text',
    text: 'After',
    marks: [{ type: 'bold' }],
  });
});

for (const [name, raw] of [
  ['heading', heading],
  ['anchor', anchor],
] as const) {
  it(`validates actual ${name}-prefix Store pages without inventing HTML-native owners`, async () => {
    const t = raw as unknown as Transcript;
    expect(t.calls).toHaveLength(2);
    for (const c of t.calls) {
      const reader = new NotePageReader(async () => c.response);
      const page = await reader.read(
        c.response.scope.workspaceId,
        c.response.scope.noteId,
        c.request as NotePageRequest,
      );
      if (page.kind === 'noteContextPage') {
        expect(
          page.items.some((item) => item.kind === 'boundary' && item.construct === 'htmlDocument'),
        ).toBe(false);
        expect(page.items.some((item) => item.kind === 'span' && item.role === 'literal')).toBe(
          true,
        );
      }
    }
    // These captures do not contain the dependency closure for a reader replay.
  });
}

for (const [name, capture, partialLiteral] of [
  ['HTML-backticks', htmlBackticks, false],
  ['Markdown-backticks', stableMarkdownBackticks, false],
] as const) {
  it(`replays complete ${name} Store closure with native entry semantics`, async () => {
    // Historical tiny terminal captures requested32; their complete terminal
    // response is valid under4096 too. This is response replay, not an exact
    // request transcript. New admission captures always match exact budgets.
    const fixture = replay(capture, true);
    const w = await fixture.read();
    const projection = projectNoteWindow(w);
    const expected = nativeFixtureEditor(
      await processMarkdownToHTML(fixture.t.source, { workspaceId: 'w', preserveAnchors: true }),
    );
    const actual = nativeFixtureEditor(projection.content);
    try {
      const native = expected.getJSON().content!;
      const visible = structuredClone(native.slice(partialLiteral ? -2 : -1));
      if (partialLiteral) {
        // The capture starts inside the single plain-text HTML paragraph. Trim
        // only its invisible prefix; retain every native mark/block after it.
        const text = visible[0].content![0];
        text.text = text.text!.slice(fixture.t.at - fixture.t.source.indexOf('<table>'));
      }
      expect(actual.getJSON().content).toEqual(visible);
      expect(fixture.requests.filter((q) => q.kind === 'source')).toHaveLength(1);
      expect(w.cost.sourceBytes).toBeLessThan(64);
      expect(w.cost.contextBytes).toBeLessThanOrEqual(8192);
      expect(w.cost.requests).toBeLessThanOrEqual(96);
      console.info('Actual Store complete entry costs', name, w.cost);
    } finally {
      expected.destroy();
      actual.destroy();
    }
  });
}

// Retained invalid/unsupported captures must fail closed. These assertions do not
// claim native parity for the missing Markdown-entry canonical source owner.
for (const [name, capture] of [
  ['heading-prefix', headingClosure],
  ['anchor-prefix', anchorClosure],
] as const) {
  it(`rejects unindexed ${name} HTML before producing an incorrect native paragraph`, async () => {
    const w = await replay(capture).read();
    expect(() => projectNoteWindow(w)).toThrow(/Unsupported.*htmlBlock/);
  });
}

it('rejects the original Store code owner whose parent changes on direct resolution', async () => {
  await expect(replay(markdownBackticks, true).read()).rejects.toThrow(
    /Conflicting canonical identity/,
  );
});

for (const [name, capture] of [
  ['marks', markdownMARKS],
  ['LF', markdownLF],
  ['CRLF', markdownCRLF],
] as const) {
  it(`replays actual Store Markdown paragraph ${name} into the unchanged native paragraph`, async () => {
    const f = replay(capture);
    const w = await f.read();
    const projected = projectNoteWindow(w);
    const expected = nativeFixtureEditor(
      await processMarkdownToHTML(f.t.source, { workspaceId: 'w', preserveAnchors: true }),
    );
    const actual = nativeFixtureEditor(projected.content);
    try {
      const paragraph = expected.state.doc.lastChild!;
      // The marked 36-byte source closure retries at16 and admits exactly the
      // first11 native text units: <div>, bold, space, and the first code letter.
      expect(actual.getJSON().content).toEqual([
        name === 'marks' ? paragraph.cut(0, 11).toJSON() : paragraph.toJSON(),
      ]);
      if (name === 'marks') {
        expect(w.range).toEqual({ start: 11, end: 27 });
        expect(w.text).toBe('<div>**bold** `c');
      }
      expect(w.canonicalOwners).toContainEqual(
        expect.objectContaining({ construct: 'markdownBlock' }),
      );
      expect(f.requests.filter((q) => q.kind === 'source').map((q) => q.maxSourceBytes)).toEqual(
        name === 'marks' ? [4096, 16] : [4096],
      );
      expect(w.cost.sourceBytes).toBeLessThan(128);
      expect(w.cost.canonicalBytes).toBeLessThanOrEqual(8192);
      expect(w.cost.requests).toBeLessThanOrEqual(96);
      console.info('Actual Store Markdown block costs', name, w.cost);
    } finally {
      expected.destroy();
      actual.destroy();
    }
  });
}

// All ordinary reads start at4096 using actual captured requests at these starts.
// The marked first window may shrink; no fixture response is synthesized.
for (const [name, capture, at, nativeStart, nativeEnd] of [
  ['marks-first', halfopenMarks, 11, 0, 11],
  ['marks-middle', halfopenMarks, 27, 11, undefined],
  ['marks-tail', halfopenMarks, 43, 21, undefined],
  ['LF-first', halfopenLF, 11, 0, undefined],
  ['LF-tail', halfopenLF, 27, 16, undefined],
  ['CRLF-first', halfopenCRLF, 13, 0, undefined],
  ['CRLF-tail', halfopenCRLF, 29, 15, undefined],
] as const) {
  it(`replays strict Store ordinary navigation ${name}`, async () => {
    const fixture = replay(capture);
    const window = await fixture.read(at);
    const expected = nativeFixtureEditor(
      await processMarkdownToHTML(fixture.t.source, {
        workspaceId: 'w',
        preserveAnchors: true,
      }),
    );
    const projection = projectNoteWindow(window);
    const actual = nativeFixtureEditor(projection.content);
    try {
      expect(actual.getJSON().content).toEqual([
        expected.state.doc.lastChild!.cut(nativeStart, nativeEnd).toJSON(),
      ]);
      expect(window.range.start).toBe(at);
      expect(window.text).toBe(fixture.t.source.slice(at, window.range.end));
      expect(fixture.requests[0]).toMatchObject({ kind: 'source', at, maxSourceBytes: 4096 });
      expect(window.cost.requests).toBe(fixture.requests.length);
      expect(window.cost.requests).toBeLessThanOrEqual(96);
      expect(window.cost.canonicalBytes).toBeLessThanOrEqual(8192);
      console.info('Strict actual navigation costs', name, window.range, window.cost);
    } finally {
      expected.destroy();
      actual.destroy();
    }
  });
}
