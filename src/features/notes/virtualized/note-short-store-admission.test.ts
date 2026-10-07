import { expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import { readNoteWindow, NOTE_WINDOW_LIMITS } from './note-window-reader';
import { projectNoteWindow } from './note-window-projection';
import { noteAssemblyResources } from './note-assembly-reservation';
import plain from './__tests__/fixtures/store-short-plain-7b39.json';
import converted from './__tests__/fixtures/store-short-converted-7b39.json';

type Capture = {
  source: string;
  address: Parameters<typeof readNoteWindow>[1];
  calls: Array<{ request: NotePageRequest; response: NoteReadPage }>;
};
const key = (q: NotePageRequest) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(q)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
function descendants(node: JSONContent): JSONContent[] {
  return [node, ...(node.content ?? []).flatMap(descendants)];
}
for (const [name, input, calls, bytes] of [
  ['plain', plain, 37, 12795],
  ['converted', converted, 91, 27360],
] as const) {
  it(`renders the complete captured short ${name} note within the configured admission`, async () => {
    const capture = input as unknown as Capture;
    const seen: NotePageRequest[] = [];
    const transport = new NotePageReader(async (_method, params) => {
      const q = params.page as NotePageRequest;
      seen.push(q);
      const match = capture.calls.find((item) => key(item.request) === key(q));
      if (!match) throw new Error('Uncaptured source/context request: ' + key(q));
      return structuredClone(match.response);
    });
    const window = await readNoteWindow(
      (q) => transport.read(capture.address.scope.workspaceId, capture.address.scope.noteId, q),
      capture.address,
    );
    expect(window.text).toBe(capture.source);
    expect(window.range).toEqual({ start: 0, end: capture.source.length });
    expect(window.documentEnd).toBe(true);
    expect(window.cost.requests).toBe(calls);
    expect(window.cost.requests).toBeLessThanOrEqual(96);
    expect(window.cost.canonicalBytes).toBe(bytes);
    expect(window.cost.canonicalBytes).toBeLessThanOrEqual(NOTE_WINDOW_LIMITS.canonicalBytes);
    expect(seen.filter((q) => q.kind === 'source')).toHaveLength(1);
    expect(seen.every((q) => q.maxWireBytes === 8192)).toBe(true);
    const nodes = descendants(projectNoteWindow(window).content);
    const text = nodes
      .filter((n) => n.type === 'text')
      .map((n) => n.text)
      .join('\n');
    expect(text).toContain(name === 'plain' ? 'Blank Spec control' : 'Converted task control');
    expect(text).toContain('Unicode café 漢字 🙂 remains visible.');
    expect(text).toContain(name === 'plain' ? 'Second paragraph.' : 'Final paragraph.');
    if (name === 'converted') {
      expect(nodes.filter((n) => n.type === 'taskItem').map((n) => n.attrs)).toEqual([
        { checked: false, status: 'todo', delegatedAgentId: null },
        { checked: true, status: 'done', delegatedAgentId: null },
      ]);
      expect(
        nodes
          .filter((n) => n.type === 'text' && n.marks?.some((m) => m.type === 'link'))
          .map((n) => ({
            text: n.text,
            href: n.marks!.find((m) => m.type === 'link')!.attrs!.href,
          })),
      ).toEqual([
        { text: 'First task', href: 'intent://local/task/4e2383d8-9c83-4c86-9837-3dbef62e53fd' },
        { text: 'Second task', href: 'intent://local/task/a89cfc68-da2c-4aa2-aba3-c6f4fac9c395' },
      ]);
    }
  });
}
it('keeps aggregate DATA and noncanonical admission bounds unchanged', () => {
  expect(NOTE_WINDOW_LIMITS).toMatchObject({
    sourceBytes: 8192,
    contextBytes: 8192,
    sourcePages: 16,
    descriptors: 128,
    requests: 96,
    wireBytes: 8192,
    requestSourceBytes: 4096,
  });
  expect(
    noteAssemblyResources({ owner: 'test', data: 'data', control: 'control' })[0].cost,
  ).toEqual({
    payloadBytes: 6291456,
    stringUnits: 6291456,
    objectNodes: 6291456,
    domNodes: 0,
    physicalReads: 0,
    assemblies: 0,
  });
});

it('shrinks an oversized canonical closure without resetting the shared request budget', async () => {
  // Controlled negative derived from the response topology, NOT another daemon
  // capture: valid opaque canonical handles are lengthened consistently. Every
  // response is still paginated below the unchanged wire ceiling.
  const capture = converted as unknown as Capture;
  const handles = new Map<string, string>();
  for (const { response } of capture.calls) {
    if (response.kind !== 'noteContextPage') continue;
    for (const item of response.items) {
      if (item.kind === 'fragment' || !('profile' in item)) continue;
      for (const [field, value] of Object.entries(item)) {
        if (field.endsWith('Ref') && typeof value === 'string' && !handles.has(value))
          handles.set(value, String(handles.size).padStart(6, '0') + 'x'.repeat(250));
      }
    }
  }
  const remap = (value: unknown): unknown => {
    if (typeof value === 'string') return handles.get(value) ?? value;
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]));
    return value;
  };
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  const pages = new Map<string, NoteReadPage>();
  let pagination = 0;
  for (const call of capture.calls) {
    const request = remap(call.request) as NotePageRequest;
    const response = remap(call.response) as NoteReadPage;
    if (response.kind !== 'noteContextPage' && response.kind !== 'noteMetadataPage') {
      pages.set(key(request), response);
      continue;
    }
    expect(response.nextCursor).toBeNull();
    let index = 0,
      cursor: string | undefined;
    do {
      const items: typeof response.items = [];
      const next = `control-page:${pagination++}`;
      while (
        index < response.items.length &&
        bytes({ ...response, items: [...items, response.items[index]], nextCursor: next }) <= 8192
      )
        items.push(response.items[index++] as never);
      expect(items.length || !response.items.length).toBeTruthy();
      const more = index < response.items.length;
      pages.set(key({ ...request, ...(cursor ? { cursor } : {}) }), {
        ...response,
        items,
        nextCursor: more ? next : null,
      } as NoteReadPage);
      cursor = more ? next : undefined;
    } while (cursor);
  }
  const first = capture.calls[0].response;
  if (first.kind !== 'noteSourcePage') throw new Error('Missing captured source');
  const seen: NotePageRequest[] = [];
  let retrySource: typeof first | undefined;
  const reader = new NotePageReader(async (_method, params) => {
    const request = params.page as NotePageRequest;
    seen.push(request);
    if (request.kind === 'source' && request.maxSourceBytes !== 4096) {
      expect(request.maxSourceBytes).toBeLessThan(4096);
      let end = first.text.length;
      while (bytes(first.text.slice(0, end)) > request.maxSourceBytes!) end--;
      if (end && /[\uD800-\uDBFF]/.test(first.text[end - 1])) end--;
      retrySource = {
        ...first,
        text: first.text.slice(0, end),
        range: { start: 0, end },
        contextRef: 'retry-context',
        nextCursor: 'retry-source',
      };
      return retrySource;
    }
    if (request.kind === 'context' && request.contextRef === 'retry-context') {
      if (!retrySource) throw new Error('Missing retry source');
      const n = Number(request.cursor ?? 0);
      return {
        ...first,
        kind: 'noteContextPage',
        items: [
          {
            kind: 'boundary',
            id: `retry-${n}`,
            construct: 'paragraph',
            sourceRange: retrySource.range,
            continuationBefore: false,
            continuationAfter: true,
          },
        ],
        nextCursor: String(n + 1),
      };
    }
    const response = pages.get(key(request));
    if (!response) throw new Error('Unexpected controlled request ' + key(request));
    expect(bytes(response)).toBeLessThanOrEqual(8192);
    return structuredClone(response);
  });
  await expect(
    readNoteWindow(
      (q) => reader.read(capture.address.scope.workspaceId, capture.address.scope.noteId, q),
      capture.address,
    ),
  ).rejects.toThrow('Note context request budget exceeded');
  expect(seen).toHaveLength(96);
  expect(seen.filter((q) => q.kind === 'source')).toHaveLength(2);
  expect(retrySource).toBeDefined();
  expect(seen.findIndex((q) => q.kind === 'source' && q.maxSourceBytes !== 4096)).toBe(pages.size);
  expect(seen.at(-1)).toMatchObject({ kind: 'context', contextRef: 'retry-context' });
});
