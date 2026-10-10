/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import { serializeSelectionToMarkdown } from '$lib/utils/selected-note-markdown-copy';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
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
  captureNoteSelectionMarkdown,
  prepareNoteSelectionMarkdownCapture,
  isNoteSelectionMarkdownCapture,
  type NoteSelectionMarkdownInput,
} from './note-selection-markdown-capture';
import plainOne from './__fixtures__/note-paragraph/plain-paragraph-one.json';
import plainFar from './__fixtures__/note-paragraph/plain-paragraph-far.json';
import plainTwo from './__fixtures__/note-paragraph/plain-paragraph-two.json';

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

function inputFor(a: NoteEditAuthority, anchor: number, head = anchor): NoteSelectionMarkdownInput {
  return {
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
    selection: { anchor, head, anchorAffinity: 1, headAffinity: -1 },
    current: () => true,
  };
}

it.each([plainOne, plainFar])(
  'captures authentic Store paragraphs at $at using the configured native serializer',
  async (raw) => {
    const f = await realPlain(raw);
    try {
      f.editor.commands.setTextSelection({ from: 3, to: 1 });
      const input = inputFor(f.authority, raw.at + 2, raw.at);
      const original = {
        ...input,
        identity: { ...input.identity, expiresAt: f.identity.expiresAt },
        now: () => Date.parse(f.identity.expiresAt) - 1,
      };
      const receipt = captureNoteSelectionMarkdown(f.editor.view, original);
      expect(receipt.markdown).toBe('ab');
      expect(receipt.markdown).toBe(serializeSelectionToMarkdown(f.editor.view));
      expect(receipt.direction).toBe('backward');
      expect(receipt.selection).toEqual(input.selection);
      expect(receipt.sourceRange).toEqual({ start: raw.at, end: raw.at + 2 });
      expect(receipt.paragraph.sourceRange).toEqual({ start: raw.at, end: raw.at + 3 });
      expect(receipt.paragraph.nativeRange).toEqual({ from: 0, to: 5 });
      expect(receipt.slice).toEqual({ openStart: 1, openEnd: 1 });
      expect(receipt.identity.expiresAt).toBe(f.identity.expiresAt);
      expect(isNoteSelectionMarkdownCapture(receipt)).toBe(true);
      expect(isNoteSelectionMarkdownCapture({ ...receipt })).toBe(false);
      expect(
        f.requests.filter((q) => q.kind === 'source').map((q) => q.kind === 'source' && q.at),
      ).toEqual([raw.at]);
      expect(Object.isFrozen(receipt.paragraph.attributes)).toBe(true);
      expect(receipt.paragraph.attributes).toEqual({});
      expect(receipt.inline.attributes).toEqual({});
      expect(Object.isFrozen(receipt.inline.attributes)).toBe(true);
      console.info('native-selection-capture', JSON.stringify({ at: raw.at, capture: receipt }));
    } finally {
      f.editor.destroy();
    }
  },
);

// Controlled mapping seam for semantic refusal/parity controls only. Authentic
// mapping/lexical acquisition is exercised above through unchanged Store calls.
async function controlled(source: string, html?: string) {
  const editor = nativeFixtureEditor(
    html ?? (await processMarkdownToHTML(source, { workspaceId: 'w', preserveAnchors: true })),
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
  return { editor, authority };
}

it.each([
  ['one two', 1, 8, 'one two'],
  ['one two', 4, 8, 'two'],
  ['one two', 1, 5, 'one'],
  ['one two', 4, 5, null],
  ['one two', 3, 3, null],
  ['a😀b', 2, 4, '😀'],
])(
  'matches actual selected-copy edge behavior for %s [%s,%s]',
  async (source, from, to, expected) => {
    const f = await controlled(source as string);
    try {
      f.editor.commands.setTextSelection({ from: from as number, to: to as number });
      const input = inputFor(f.authority, 99 + (from as number), 99 + (to as number));
      const candidate = prepareNoteSelectionMarkdownCapture(f.editor.state, input);
      expect(isNoteSelectionMarkdownCapture(candidate)).toBe(false);
      const result = captureNoteSelectionMarkdown(f.editor.view, input);
      expect(result.markdown).toBe(expected);
      expect(result.markdown).toBe(serializeSelectionToMarkdown(f.editor.view));
      expect(result.empty).toBe(
        from === to ? 'collapsed' : expected === null ? 'whitespace' : null,
      );
    } finally {
      f.editor.destroy();
    }
  },
);

it.each([
  '<h2>abc</h2>',
  '<blockquote><p>abc</p></blockquote>',
  '<ul><li><p>abc</p></li></ul>',
  '<p><strong>abc</strong></p>',
  '<p><em>abc</em></p>',
  '<p><code>abc</code></p>',
  '<p>a<br>b</p>',
  '<p><a href="https://example.com">abc</a></p>',
])('refuses unsupported actual native structure %s', async (html) => {
  const f = await controlled('abc', html);
  try {
    let from = 1;
    f.editor.state.doc.descendants((node, pos) => {
      if (node.isText) {
        from = pos;
        return false;
      }
    });
    f.editor.commands.setTextSelection({ from, to: from + 1 });
    expect(() =>
      captureNoteSelectionMarkdown(f.editor.view, inputFor(f.authority, 100, 101)),
    ).toThrow();
  } finally {
    f.editor.destroy();
  }
});

it('refuses cross-paragraph and AllSelection instead of guessing wrappers', async () => {
  const f = await realPlain(plainTwo);
  try {
    f.editor.commands.setTextSelection({ from: 1, to: 7 });
    expect(() =>
      captureNoteSelectionMarkdown(f.editor.view, inputFor(f.authority, 0, 6)),
    ).toThrow();
    f.editor.view.dispatch(f.editor.state.tr.setSelection(new AllSelection(f.editor.state.doc)));
    expect(() =>
      captureNoteSelectionMarkdown(f.editor.view, inputFor(f.authority, 0, 8)),
    ).toThrow();
  } finally {
    f.editor.destroy();
  }
});

it('refuses native/source disagreement and surrogate splits', async () => {
  const f = await controlled('a😀b');
  try {
    f.editor.commands.setTextSelection({ from: 2, to: 3 });
    expect(() =>
      captureNoteSelectionMarkdown(f.editor.view, inputFor(f.authority, 101, 102)),
    ).toThrow();
    f.editor.commands.setTextSelection({ from: 1, to: 2 });
    expect(() =>
      captureNoteSelectionMarkdown(f.editor.view, inputFor(f.authority, 101, 102)),
    ).toThrow('selections differ');
  } finally {
    f.editor.destroy();
  }
});

it.each(['revoked', 'expired', 'generation', 'revision', 'scope', 'document'] as const)(
  'refuses stale %s capture',
  async (kind) => {
    const f = await realPlain(plainOne);
    try {
      f.editor.commands.setTextSelection({ from: 1, to: 2 });
      const input = inputFor(f.authority, 0, 1);
      const changed = { ...input, identity: { ...input.identity } };
      if (kind === 'revoked') changed.current = () => false;
      if (kind === 'expired') changed.identity.expiresAt = '2000-01-01T00:00:00Z';
      if (kind === 'generation') changed.identity.documentGeneration++;
      if (kind === 'revision') changed.identity.sourceRevision = 'other';
      if (kind === 'scope')
        changed.identity.scope = { ...input.identity.scope, noteInstanceId: 'other' };
      if (kind === 'document') f.editor.view.dispatch(f.editor.state.tr.insertText('x'));
      expect(() => captureNoteSelectionMarkdown(f.editor.view, changed)).toThrow(/Stale/);
    } finally {
      f.editor.destroy();
    }
  },
);

it('refuses configured DOM serializer divergence and reentrant selection changes', async () => {
  const f = await controlled('abc');
  const spec = f.editor.state.schema.nodes.paragraph.spec,
    original = spec.toDOM;
  try {
    f.editor.commands.setTextSelection({ from: 1, to: 3 });
    const input = inputFor(f.authority, 100, 102);
    spec.toDOM = () => ['h2', 0];
    expect(() => captureNoteSelectionMarkdown(f.editor.view, input)).toThrow('Unsupported');
    delete f.editor.state.schema.cached.domSerializer;
    spec.toDOM = () => {
      f.editor.view.dispatch(
        f.editor.state.tr.setSelection(TextSelection.create(f.editor.state.doc, 2)),
      );
      return ['p', 0];
    };
    expect(() => captureNoteSelectionMarkdown(f.editor.view, input)).toThrow('changed during');
  } finally {
    spec.toDOM = original;
    f.editor.destroy();
  }
});

it('checks paragraph budget before invoking the native serializer', async () => {
  const f = await controlled('a'.repeat(4097));
  const spec = f.editor.state.schema.nodes.paragraph.spec,
    original = spec.toDOM,
    renderer = vi.fn(() => ['p', 0] as const);
  try {
    spec.toDOM = renderer;
    f.editor.commands.setTextSelection({ from: 1, to: 2 });
    expect(() =>
      captureNoteSelectionMarkdown(f.editor.view, inputFor(f.authority, 100, 101)),
    ).toThrow();
    expect(renderer).not.toHaveBeenCalled();
  } finally {
    spec.toDOM = original;
    f.editor.destroy();
  }
});

it('requires full-parent native roundtrip coverage even outside the selected interval', async () => {
  const f = await realPlain(plainOne);
  try {
    f.editor.commands.setTextSelection({ from: 2, to: 3 });
    const original = f.authority.pmAt.bind(f.authority);
    vi.spyOn(f.authority, 'pmAt').mockImplementation((at, affinity) =>
      at === 0 ? 99 : original(at, affinity),
    );
    expect(() =>
      captureNoteSelectionMarkdown(f.editor.view, inputFor(f.authority, 1, 2)),
    ).toThrow();
  } finally {
    f.editor.destroy();
  }
});
it('binds original snapshot identity instead of accepting a replacement', async () => {
  const f = await realPlain(plainOne);
  try {
    f.editor.commands.setTextSelection({ from: 1, to: 2 });
    const input = inputFor(f.authority, 0, 1);
    const mismatched = { ...input, identity: { ...input.identity, snapshotId: 'other' } };
    expect(() => captureNoteSelectionMarkdown(f.editor.view, mismatched)).toThrow();
  } finally {
    f.editor.destroy();
  }
});

it('rejects identity changes caused by actual serializer callbacks', async () => {
  const f = await controlled('abc');
  const spec = f.editor.state.schema.nodes.paragraph.spec,
    original = spec.toDOM;
  try {
    f.editor.commands.setTextSelection({ from: 1, to: 2 });
    const originalInput = inputFor(f.authority, 100, 101),
      i = { ...originalInput.identity };
    const input = { ...originalInput, identity: i };
    spec.toDOM = () => {
      i.selectionGeneration++;
      return ['p', 0];
    };
    expect(() => captureNoteSelectionMarkdown(f.editor.view, input)).toThrow('identity changed');
  } finally {
    spec.toDOM = original;
    f.editor.destroy();
  }
});
it('rejects unsupported paragraph attributes without executing accessors', async () => {
  const f = await controlled('abc');
  try {
    f.editor.commands.setTextSelection({ from: 1, to: 2 });
    const paragraph = f.editor.state.doc.firstChild!,
      key = 'unsupportedCaptureAttribute';
    const getter = vi.fn(() => null);
    Object.defineProperty(paragraph.attrs, key, {
      get: getter,
      enumerable: true,
      configurable: true,
    });
    try {
      expect(() =>
        captureNoteSelectionMarkdown(f.editor.view, inputFor(f.authority, 100, 101)),
      ).toThrow();
      expect(getter).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(paragraph.attrs, key);
    }
  } finally {
    f.editor.destroy();
  }
});

it('rejects authority replacement by the configured serializer callback', async () => {
  const f = await controlled('abc');
  const spec = f.editor.state.schema.nodes.paragraph.spec,
    original = spec.toDOM;
  try {
    f.editor.commands.setTextSelection({ from: 1, to: 2 });
    const input = { ...inputFor(f.authority, 100, 101) };
    const replacement = Object.create(f.authority) as NoteEditAuthority;
    expect(replacement).not.toBe(f.authority);
    expect(replacement.doc).toBe(f.authority.doc);
    delete f.editor.state.schema.cached.domSerializer;
    spec.toDOM = () => {
      input.authority = replacement;
      return ['p', 0];
    };
    expect(() => captureNoteSelectionMarkdown(f.editor.view, input)).toThrow('changed during');
    expect(input.authority).toBe(replacement);
  } finally {
    spec.toDOM = original;
    delete f.editor.state.schema.cached.domSerializer;
    f.editor.destroy();
  }
});

it.each(['value', 'hidden', 'accessor', 'declared'] as const)(
  'refuses unrepresented text attributes: %s',
  async (kind) => {
    const f = await controlled('abc');
    const text = f.editor.state.doc.firstChild!.firstChild!,
      spec = text.type.spec,
      original = spec.attrs,
      getter = vi.fn(() => 'hidden');
    try {
      f.editor.commands.setTextSelection({ from: 1, to: 2 });
      if (kind === 'declared') spec.attrs = { selectionExtra: { default: null } };
      else
        Object.defineProperty(text.attrs, 'selectionExtra', {
          ...(kind === 'accessor' ? { get: getter } : { value: 'hidden' }),
          enumerable: kind !== 'hidden',
          configurable: true,
        });
      expect(() =>
        captureNoteSelectionMarkdown(f.editor.view, inputFor(f.authority, 100, 101)),
      ).toThrow();
      expect(getter).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) Reflect.deleteProperty(spec, 'attrs');
      else spec.attrs = original;
      Reflect.deleteProperty(text.attrs, 'selectionExtra');
      f.editor.destroy();
    }
  },
);

it('refuses unrepresented text attributes introduced by the serializer', async () => {
  const f = await controlled('abc');
  const spec = f.editor.state.schema.nodes.paragraph.spec,
    original = spec.toDOM,
    text = f.editor.state.doc.firstChild!.firstChild!;
  try {
    f.editor.commands.setTextSelection({ from: 1, to: 2 });
    delete f.editor.state.schema.cached.domSerializer;
    spec.toDOM = () => {
      Object.defineProperty(text.attrs, 'selectionExtra', { value: 1, configurable: true });
      return ['p', 0];
    };
    expect(() =>
      captureNoteSelectionMarkdown(f.editor.view, inputFor(f.authority, 100, 101)),
    ).toThrow();
  } finally {
    spec.toDOM = original;
    Reflect.deleteProperty(text.attrs, 'selectionExtra');
    delete f.editor.state.schema.cached.domSerializer;
    f.editor.destroy();
  }
});

it('refuses paragraph attribute mutation by the serializer', async () => {
  const f = await controlled('abc');
  const spec = f.editor.state.schema.nodes.paragraph.spec,
    originalDOM = spec.toDOM,
    originalAttrs = spec.attrs,
    paragraph = f.editor.state.doc.firstChild!;
  try {
    f.editor.commands.setTextSelection({ from: 1, to: 2 });
    delete f.editor.state.schema.cached.domSerializer;
    spec.toDOM = () => {
      spec.attrs = { selectionExtra: { default: null } };
      Object.defineProperty(paragraph.attrs, 'selectionExtra', {
        value: 'changed',
        enumerable: true,
        configurable: true,
      });
      return ['p', 0];
    };
    expect(() =>
      captureNoteSelectionMarkdown(f.editor.view, inputFor(f.authority, 100, 101)),
    ).toThrow();
  } finally {
    spec.toDOM = originalDOM;
    if (originalAttrs === undefined) Reflect.deleteProperty(spec, 'attrs');
    else spec.attrs = originalAttrs;
    Reflect.deleteProperty(paragraph.attrs, 'selectionExtra');
    delete f.editor.state.schema.cached.domSerializer;
    f.editor.destroy();
  }
});
