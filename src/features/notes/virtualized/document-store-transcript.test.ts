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
function replay(raw: unknown) {
  const t = raw as Transcript;
  const identity = t.calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing source');
  const requests: NotePageRequest[] = [];
  const reader = new NotePageReader(async (_, params) => {
    const q = params.page as NotePageRequest;
    requests.push(q);
    const found = t.calls.find(
      ({ request: r }) =>
        r.kind === q.kind &&
        r.cursor === q.cursor &&
        ('contextRef' in q
          ? r.contextRef === q.contextRef
          : 'ref' in q
            ? r.ref === q.ref
            : q.kind === 'source' && r.at === q.at),
    );
    if (!found) throw new Error('Uncaptured Store request: ' + JSON.stringify(q));
    if (q.kind === 'source' && q.maxSourceBytes !== 4096)
      throw new Error('Uncaptured source budget');
    return found.response;
  });
  return {
    t,
    requests,
    read: () =>
      readNoteWindow((q) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q), {
        ...identity,
        at: t.at,
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
