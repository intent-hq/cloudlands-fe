/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import { TextSelection, AllSelection } from '@tiptap/pm/state';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import { readNoteWindow } from '../note-window-reader';
import { projectNoteWindow } from '../note-window-projection';
import { nativeFixtureEditor } from '../__tests__/canonical-table-fixture';
import {
  createNoteParagraphEditAuthority,
  noteParagraphEditContextSteps,
  type NoteParagraphEditGrant,
} from './note-paragraph-edit-authority';
import { NoteEditAuthority } from './note-edit-authority';
import { SourceProjection } from '../projection/source-projection';
import {
  captureNoteRenderedSearch,
  isNoteRenderedSearchCapture,
} from './note-rendered-search-capture';
import plainOne from './__fixtures__/note-paragraph/plain-paragraph-one.json';
import plainFar from './__fixtures__/note-paragraph/plain-paragraph-far.json';
// Controlled DATA grant for immutable captured responses, not a live reservation.
function controlledGrant(
  window: NoteParagraphEditGrant['window'],
  identity: NoteParagraphEditGrant['identity'],
): NoteParagraphEditGrant {
  let claimed = false;
  return {
    window,
    identity,
    allowance: { retainedBytes: 8192, requests: 96, descriptors: 128, wireBytes: 8192 },
    current: () => true,
    claim: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
  };
}
async function capturedWindow(raw: { at: number; calls: unknown[] } = plainOne) {
  const calls = raw.calls as unknown as Array<{
    request: NotePageRequest;
    response: NoteReadPage;
  }>;
  const identity = calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing captured source');
  const requests: NotePageRequest[] = [];
  const reader = new NotePageReader(async (_method, params) => {
    const q = params.page as NotePageRequest;
    requests.push(q);
    const found = calls.find(
      ({ request: r }) =>
        r.kind === q.kind &&
        r.cursor === q.cursor &&
        r.maxWireBytes === q.maxWireBytes &&
        r.maxItems === q.maxItems &&
        ('contextRef' in q
          ? 'contextRef' in r && r.contextRef === q.contextRef
          : 'ref' in q
            ? 'ref' in r && r.ref === q.ref
            : q.kind === 'source' &&
              r.kind === 'source' &&
              r.at === q.at &&
              r.maxSourceBytes === q.maxSourceBytes),
    );
    if (!found) throw new Error('Uncaptured Store edit request: ' + JSON.stringify(q));
    return found.response;
  });
  const window = await readNoteWindow(
    (q) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q),
    { ...identity, at: raw.at },
  );
  expect(window.cost.requests).toBeLessThanOrEqual(96);
  expect(window.cost.canonicalBytes ?? 0).toBeLessThanOrEqual(8192);
  return {
    window,
    identity,
    requests,
    read: (q: NotePageRequest) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q),
  };
}

async function realPlain(raw: { at: number; calls: unknown[] }) {
  const f = await capturedWindow(raw);
  const projection = projectNoteWindow(f.window);
  const editor = nativeFixtureEditor(projection.content);
  const iterator = noteParagraphEditContextSteps(
    f.window,
    f.identity,
    () => true,
    controlledGrant(f.window, f.identity),
    () => Date.parse(f.identity.expiresAt) - 1,
  );
  try {
    let next = iterator.next();
    while (!next.done) next = iterator.next(await f.read(next.value));
    const authority = createNoteParagraphEditAuthority(
      f.window,
      projection,
      next.value,
      editor.state.doc,
    );
    return { ...f, authority, editor };
  } catch (error) {
    editor.destroy();
    throw error;
  } finally {
    iterator.return(undefined as never);
  }
}

function inputFor(a: NoteEditAuthority, anchor: number, head = anchor) {
  return {
    query: { text: 'ab', caseSensitive: false as const, mode: 'renderedText' as const },
    authority: a,
    identity: {
      scope: a.scope,
      sourceRevision: a.sourceRevision,
      snapshotId: a.snapshotId,
      documentGeneration: a.generation,
      liveGeneration: 7,
      selectionGeneration: 9,
      expiresAt: '2099-01-01T00:00:00Z',
    },
    selection: { anchor, head, anchorAffinity: 1 as const, headAffinity: -1 as const },
    current: () => true,
  };
}

async function controlled(source: string, html?: string) {
  const editor = nativeFixtureEditor(
    html ?? {
      type: 'doc',
      content: [{ type: 'paragraph', content: source ? [{ type: 'text', text: source }] : [] }],
    },
  );
  const projection = new SourceProjection(source, 100);
  const forward = new Map<number, number>(),
    backward = new Map<number, number>();
  for (let p = 1; p <= source.length + 1; p++) {
    forward.set(p, 99 + p);
    backward.set(p, 99 + p);
  }
  const authority = new NoteEditAuthority(
    { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    'r',
    's',
    0,
    source,
    100,
    editor.state.doc,
    [],
    { forward, backward, original: projection, changes: [] },
    100 + source.length,
  );
  // Controlled identity map for configured-native semantic tests. The actual
  // Store controls above acquire their unchanged production authority instead.
  vi.spyOn(authority, 'pmAt').mockImplementation((offset) => offset - 99);
  return { editor, authority };
}

it.each([plainOne, plainFar])(
  'captures actual Store leaf at $at with independent range and native DOM parity',
  async (raw) => {
    const f = await realPlain(raw);
    try {
      f.editor.commands.setTextSelection({ from: 3, to: 1 });
      const input = {
        ...inputFor(f.authority, raw.at + 2, raw.at),
        identity: { ...inputFor(f.authority, raw.at).identity, expiresAt: f.identity.expiresAt },
        now: () => Date.parse(f.identity.expiresAt) - 1,
      };
      const result = captureNoteRenderedSearch(f.editor.view, input);
      expect(result.rendered).toEqual({ text: 'abc', length: 3, utf8Bytes: 3 });
      expect(result.rendered.text).toBe(f.editor.state.doc.firstChild!.firstChild!.text);
      const walker = document.createTreeWalker(f.editor.view.dom, NodeFilter.SHOW_TEXT);
      expect(walker.nextNode()!.textContent).toBe(result.rendered.text);
      expect(walker.nextNode()).toBeNull();
      expect(result.sourceRange).toEqual({ start: raw.at, end: raw.at + 2 });
      expect(result.inline.sourceRange).toEqual({ start: raw.at, end: raw.at + 3 });
      expect(result.inline.nativeRange).toEqual({ from: 1, to: 4 });
      expect(result.paragraph.nativeRange).toEqual({ from: 0, to: 5 });
      expect(result.paragraph.version).toBe(1);
      expect(result.inline.version).toBe(2);
      expect(result.direction).toBe('backward');
      expect(result.selectionMode).toBe('ranges');
      expect(result.inline.attributes).toEqual({});
      expect(result.paragraph.attributes).toEqual({});
      expect(Object.isFrozen(result.rendered)).toBe(true);
      expect(isNoteRenderedSearchCapture(result)).toBe(true);
      expect(isNoteRenderedSearchCapture({ ...result })).toBe(false);
      expect(
        f.requests.filter((q) => q.kind === 'source').map((q) => q.kind === 'source' && q.at),
      ).toEqual([raw.at]);
    } finally {
      f.editor.destroy();
    }
  },
);
it.each(['  abc  ', 'a  b', 'Straße', 'Σςσ', 'İ', 'e\u0301', 'a😀b'])(
  'preserves exact native text %s without Markdown trimming or folding',
  async (text) => {
    const f = await controlled(text);
    try {
      f.editor.commands.setTextSelection({ from: 1, to: text.length + 1 });
      const input = inputFor(f.authority, 100, 100 + text.length);
      input.query = { text: ' ', caseSensitive: false, mode: 'renderedText' };
      const r = captureNoteRenderedSearch(f.editor.view, input);
      expect(r.rendered.text).toBe(text);
      expect(r.query.text).toBe(' ');
      expect(r.rendered.utf8Bytes).toBe(new TextEncoder().encode(text).length);
    } finally {
      f.editor.destroy();
    }
  },
);
it('captures collapsed search as an empty domain with a real nonempty leaf', async () => {
  const f = await controlled('abc');
  try {
    f.editor.commands.setTextSelection(2);
    const r = captureNoteRenderedSearch(f.editor.view, inputFor(f.authority, 101));
    expect(r.sourceRange).toEqual({ start: 101, end: 101 });
    expect(r.rendered.text).toBe('abc');
  } finally {
    f.editor.destroy();
  }
});
it.each(['', 'x'.repeat(1025), '\0', '\ud800', '😀'.repeat(257)])(
  'rejects invalid query before native DOM work: %j',
  async (query) => {
    const f = await controlled('abc');
    try {
      const input = {
        ...inputFor(f.authority, 100),
        query: { text: query, caseSensitive: false as const, mode: 'renderedText' as const },
      };
      const spy = vi.spyOn(f.editor.view, 'nodeDOM');
      expect(() => captureNoteRenderedSearch(f.editor.view, input)).toThrow();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      f.editor.destroy();
    }
  },
);
it.each([
  '<h2>abc</h2>',
  '<blockquote><p>abc</p></blockquote>',
  '<p><strong>abc</strong></p>',
  '<p><em>abc</em></p>',
  '<p><code>abc</code></p>',
  '<p>a<br>b</p>',
  '<p><a href="https://example.com">abc</a></p>',
])('refuses unsupported native wrappers/marks/atoms: %s', async (html) => {
  const f = await controlled('abc', html);
  try {
    let from = 1;
    f.editor.state.doc.descendants((node, pos) => {
      if (node.isText) from = pos;
    });
    f.editor.commands.setTextSelection({ from, to: from + 1 });
    expect(() =>
      captureNoteRenderedSearch(f.editor.view, inputFor(f.authority, 100, 101)),
    ).toThrow();
  } finally {
    f.editor.destroy();
  }
});
it('refuses nontext selection and empty native paragraph', async () => {
  const f = await controlled('abc'),
    empty = await controlled('');
  try {
    f.editor.view.dispatch(f.editor.state.tr.setSelection(new AllSelection(f.editor.state.doc)));
    expect(() =>
      captureNoteRenderedSearch(f.editor.view, inputFor(f.authority, 100, 103)),
    ).toThrow();
    expect(() =>
      captureNoteRenderedSearch(empty.editor.view, inputFor(empty.authority, 100)),
    ).toThrow();
  } finally {
    f.editor.destroy();
    empty.editor.destroy();
  }
});
it('rejects scalar splits and nonidentity mapping rather than rounding', async () => {
  const f = await controlled('a😀b');
  try {
    f.editor.view.dispatch(
      f.editor.state.tr.setSelection(TextSelection.create(f.editor.state.doc, 3)),
    );
    expect(() => captureNoteRenderedSearch(f.editor.view, inputFor(f.authority, 102))).toThrow();
    f.editor.commands.setTextSelection(1);
    vi.spyOn(f.authority, 'pmAt').mockReturnValue(1);
    expect(() => captureNoteRenderedSearch(f.editor.view, inputFor(f.authority, 100))).toThrow();
  } finally {
    f.editor.destroy();
  }
});
it.each(['extra', 'split', 'changed', 'attribute'])(
  'refuses unsupported real DOM change %s',
  async (change) => {
    const f = await controlled('abc');
    try {
      const p = f.editor.view.dom.firstChild!;
      if (change === 'extra') {
        const span = document.createElement('span');
        span.textContent = 'hidden';
        p.appendChild(span);
      }
      if (change === 'split') (p.firstChild as Text).splitText(1);
      if (change === 'changed') (p.firstChild as Text).data = 'xyz';
      if (change === 'attribute') (p as Element).setAttribute('hidden', '');
      expect(() => captureNoteRenderedSearch(f.editor.view, inputFor(f.authority, 100))).toThrow();
    } finally {
      f.editor.destroy();
    }
  },
);
it('rejects stale identities and expired capture', async () => {
  const f = await controlled('abc');
  try {
    const input = inputFor(f.authority, 100);
    input.identity = { ...input.identity, expiresAt: '2000-01-01T00:00:00Z' };
    expect(() => captureNoteRenderedSearch(f.editor.view, input)).toThrow();
    expect(() =>
      captureNoteRenderedSearch(f.editor.view, {
        ...inputFor(f.authority, 100),
        current: () => false,
      }),
    ).toThrow();
  } finally {
    f.editor.destroy();
  }
});
it.each(['authority', 'state', 'query', 'attributes'])(
  'refuses callback replacement/mutation of %s before branding',
  async (change) => {
    const f = await controlled('abc');
    try {
      const input = inputFor(f.authority, 100);
      let calls = 0;
      const other = await controlled('abc');
      input.current = () => {
        if (++calls === 2) {
          if (change === 'authority')
            input.authority = Object.assign(
              Object.create(Object.getPrototypeOf(f.authority)),
              f.authority,
            );
          if (change === 'state')
            f.editor.view.updateState(
              f.editor.state.apply(
                f.editor.state.tr.setSelection(TextSelection.create(f.editor.state.doc, 2)),
              ),
            );
          if (change === 'query') input.query = { ...input.query, text: 'other' };
          if (change === 'attributes')
            Object.defineProperty(f.editor.state.doc.firstChild!.attrs, 'hidden', {
              value: true,
              enumerable: false,
              configurable: true,
            });
        }
        return true;
      };
      try {
        expect(() => captureNoteRenderedSearch(f.editor.view, input)).toThrow();
      } finally {
        Reflect.deleteProperty(f.editor.state.doc.firstChild!.attrs, 'hidden');
        other.editor.destroy();
      }
    } finally {
      f.editor.destroy();
    }
  },
);
it('rejects paragraph budget before DOM traversal', async () => {
  const f = await controlled('x'.repeat(4097));
  try {
    const spy = vi.spyOn(f.editor.view, 'nodeDOM');
    expect(() => captureNoteRenderedSearch(f.editor.view, inputFor(f.authority, 100))).toThrow();
    expect(spy).not.toHaveBeenCalled();
  } finally {
    f.editor.destroy();
  }
});

it.each(['reverse-method', 'forward-map', 'backward-map', 'dom-method'])(
  'rejects final ownership callback changing %s correspondence',
  async (change) => {
    const f = await controlled('abc');
    try {
      const input = inputFor(f.authority, 100);
      let calls = 0;
      input.current = () => {
        if (++calls === 2) {
          if (change === 'reverse-method')
            vi.spyOn(f.authority, 'pmAt').mockImplementation(() => 1);
          if (change === 'forward-map') f.authority.positions.set(2, 999);
          if (change === 'backward-map') f.authority.ends.set(2, 999);
          if (change === 'dom-method') vi.spyOn(f.editor.view, 'posAtDOM').mockReturnValue(1);
        }
        return true;
      };
      expect(() => captureNoteRenderedSearch(f.editor.view, input)).toThrow();
    } finally {
      f.editor.destroy();
    }
  },
);
