/** @vitest-environment jsdom */
import { Editor } from '@tiptap/core';
import { expect, it, vi } from 'vitest';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { SourceProjection } from '../projection/source-projection';
import {
  captureNoteMarker,
  isNoteMarkerCapture,
  type NoteMarkerCaptureInput,
} from './note-marker-capture';

const marker = (id = 'legacy-id', type = 'point') => `<!--anchor:${id}:${type}-->`;
async function fixture(source = `a${marker()}b`, at = 65538) {
  const config = createEditorConfig({
    element: document.createElement('div'),
    content: '',
    editable: false,
    useMarkdown: true,
    workspace: { id: 'w' },
    enableNotePrimitives: true,
    enableMentions: true,
    enableComments: false,
    onUpdate: () => {},
  });
  const editor = new Editor({
    ...config,
    extensions: [...(config.extensions ?? []), CommentAnchor],
    content: await processMarkdownToHTML(source, { workspaceId: 'w', preserveAnchors: true }),
  });
  const projection = new SourceProjection(source, at);
  const occurrences: number[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'commentAnchor') occurrences.push(position);
  });
  // Original projection is real. Identity/current are controlled owner evidence,
  // NOT a Store snapshot, live DATA reservation or canonical comment provenance.
  const input: NoteMarkerCaptureInput = {
    projection,
    position: occurrences[0],
    identity: {
      scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
      sourceRevision: 'r',
      snapshotId: 's',
      documentGeneration: 0,
      liveGeneration: 1,
      selectionGeneration: 2,
      expiresAt: '2099-01-01T00:00:00Z',
    },
    current: () => true,
  };
  return { editor, projection, input, occurrences };
}

it.each(['start', 'end', 'point'])(
  'captures actual configured %s atom and individual literal',
  async (type) => {
    const raw = marker('legacy-id', type),
      source = `😀pre ${raw} tail`;
    const f = await fixture(source);
    try {
      const result = captureNoteMarker(f.editor.view, f.input);
      expect(result.literal).toBe(raw);
      expect(result.canonicalId).toBe('legacy-id');
      expect(result.attributes).toEqual({ id: `legacy-id:${type}`, type, commentId: 'legacy-id' });
      expect(result.sourceRange).toEqual({ start: 65544, end: 65544 + raw.length });
      expect(result.nativeRange).toEqual({ from: 7, to: 8 });
      expect(result.parent.sourceRange).toEqual({ start: 65538, end: 65538 + source.length });
      expect(result.provenance).toBe('native-correspondence-only');
      expect(isNoteMarkerCapture(result)).toBe(true);
      expect(isNoteMarkerCapture({ ...result })).toBe(false);
      expect(Object.isFrozen(result.attributes)).toBe(true);
      expect(Object.isFrozen(result.identity.scope)).toBe(true);
    } finally {
      f.editor.destroy();
    }
  },
);

it('keeps duplicate canonical IDs while capturing distinct real ranges and native atoms', async () => {
  const raw = marker('same', 'start');
  const f = await fixture(`x${raw}one${raw}two${marker('same', 'end')}`);
  try {
    const a = captureNoteMarker(f.editor.view, f.input);
    const b = captureNoteMarker(f.editor.view, { ...f.input, position: f.occurrences[1] });
    expect(a.canonicalId).toBe(b.canonicalId);
    expect(a.attributes.id).toBe(b.attributes.id);
    expect(a.sourceRange).not.toEqual(b.sourceRange);
    expect(a.nativeRange).not.toEqual(b.nativeRange);
    expect(a.sourceRange.end - a.sourceRange.start).toBe(raw.length);
    expect(b.sourceRange.start).toBe(a.sourceRange.end + 3);
  } finally {
    f.editor.destroy();
  }
});

it('does not treat live node-view filler as literal source or persisted marker text', async () => {
  const f = await fixture();
  try {
    const dom = f.editor.view.nodeDOM(f.input.position)!;
    expect(dom.textContent).toBe('\u2060');
    const result = captureNoteMarker(f.editor.view, f.input);
    expect(result.literal).toBe(marker());
    expect(result.literal).not.toContain('\u2060');
  } finally {
    f.editor.destroy();
  }
});

it.each([
  ['id', 'wrong'],
  ['type', 'unknown'],
  ['commentId', 'other'],
  ['id', null],
])('refuses malformed actual %s attributes without filling defaults', async (key, value) => {
  const f = await fixture();
  try {
    const node = f.editor.state.doc.nodeAt(f.input.position)!;
    f.editor.view.dispatch(
      f.editor.state.tr.setNodeMarkup(f.input.position, undefined, {
        ...node.attrs,
        [key as string]: value,
      }),
    );
    expect(() => captureNoteMarker(f.editor.view, f.input)).toThrow();
  } finally {
    f.editor.destroy();
  }
});

it('rejects plain text lookalikes without an actual atom', async () => {
  const f = await fixture();
  try {
    f.editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: f.projection.source }] }],
    });
    expect(() => captureNoteMarker(f.editor.view, { ...f.input, position: 2 })).toThrow();
  } finally {
    f.editor.destroy();
  }
});

it.each(['# x', '> x', '**x'])(
  'rejects unsupported parent or marked context %s',
  async (prefix) => {
    const f = await fixture(`${prefix}${marker()}${prefix === '**x' ? '**' : ''}`);
    try {
      expect(() => captureNoteMarker(f.editor.view, f.input)).toThrow();
    } finally {
      f.editor.destroy();
    }
  },
);

it.each([
  'forward',
  'intrinsic',
  'reverse',
  'token',
  'attrs',
  'parent',
  'projection',
  'identity',
  'state',
])('rejects final current callback changing %s', async (kind) => {
  const f = await fixture();
  let calls = 0;
  const input = {
    ...f.input,
    current: () => {
      if (++calls === 2) {
        if (kind === 'forward') f.projection.positions.set(f.input.position, 0);
        if (kind === 'intrinsic')
          Map.prototype.set.call(f.projection.positions, f.input.position, 0);
        if (kind === 'reverse') vi.spyOn(f.projection, 'pmAt').mockReturnValue(1);
        if (kind === 'token')
          f.projection.tokens.find((t) => t.pm === f.input.position)!.raw = 'bad';
        if (kind === 'attrs')
          Reflect.set(f.editor.state.doc.nodeAt(f.input.position)!.attrs, 'id', 'bad');
        if (kind === 'parent') Reflect.set(f.editor.state.doc.firstChild!.attrs, 'extra', 'bad');
        if (kind === 'projection')
          input.projection = new SourceProjection(f.projection.source, f.projection.start);
        if (kind === 'identity') input.identity = { ...input.identity, snapshotId: 'other' };
        if (kind === 'state')
          f.editor.view.dispatch(f.editor.state.tr.setSelection(f.editor.state.selection));
      }
      return true;
    },
  };
  try {
    expect(() => captureNoteMarker(f.editor.view, input)).toThrow();
  } finally {
    f.editor.destroy();
  }
});

it.each(['commentId', 'type'])(
  'rejects final fallback mapping callback changing %s',
  async (key) => {
    const f = await fixture();
    const original = f.projection.pmAt;
    let final = false;
    let calls = 0;
    const input = {
      ...f.input,
      current: () => {
        final = ++calls === 2;
        return true;
      },
    };
    vi.spyOn(f.projection, 'pmAt').mockImplementation((source, affinity) => {
      const result = original.call(f.projection, source, affinity);
      if (final && source === f.projection.start + f.projection.source.length && affinity === -1)
        Reflect.set(f.editor.state.doc.nodeAt(f.input.position)!.attrs, key, 'changed');
      return result;
    });
    try {
      expect(() => captureNoteMarker(f.editor.view, input)).toThrow();
    } finally {
      f.editor.destroy();
    }
  },
);

it.each(['raw', 'from', 'to', 'text', 'marks'])(
  'rejects first fallback mapping callback changing later token %s',
  async (key) => {
    const f = await fixture();
    const original = f.projection.pmAt;
    let final = false;
    let calls = 0;
    let mutated = false;
    const input = {
      ...f.input,
      current: () => {
        final = ++calls === 2;
        return true;
      },
    };
    vi.spyOn(f.projection, 'pmAt').mockImplementation((source, affinity) => {
      const result = original.call(f.projection, source, affinity);
      if (final && !mutated) {
        mutated = true;
        const token = f.projection.tokens.at(-1)!;
        if (key === 'marks') token.marks = [{ type: 'bold' }];
        else if (key === 'from' || key === 'to') token[key]++;
        else if (key === 'raw' || key === 'text') token[key] = 'changed';
      }
      return result;
    });
    try {
      expect(() => captureNoteMarker(f.editor.view, input)).toThrow();
      expect(mutated).toBe(true);
    } finally {
      f.editor.destroy();
    }
  },
);

it('retains valid delegating scalar mapping at the original boundary sites', async () => {
  const f = await fixture();
  const original = f.projection.pmAt;
  const inverse = vi
    .spyOn(f.projection, 'pmAt')
    .mockImplementation((source, affinity) => original.call(f.projection, source, affinity));
  try {
    const capture = captureNoteMarker(f.editor.view, f.input);
    expect(capture.canonicalId).toBe('legacy-id');
    expect(inverse).toHaveBeenCalled();
  } finally {
    f.editor.destroy();
  }
});

it('rechecks endpoint mapping after executable clock callback', async () => {
  const f = await fixture();
  let calls = 0;
  try {
    expect(() =>
      captureNoteMarker(f.editor.view, {
        ...f.input,
        now: () => {
          if (++calls === 2) f.projection.ends.set(f.input.position + 1, 0);
          return 0;
        },
      }),
    ).toThrow();
  } finally {
    f.editor.destroy();
  }
});

it.each(['expired', 'lost', 'budget', 'duplicate-token', 'uncovered', 'partial-text'])(
  'refuses %s context',
  async (kind) => {
    const f = await fixture();
    try {
      const input = { ...f.input };
      if (kind === 'expired') input.now = () => Date.parse(input.identity.expiresAt);
      if (kind === 'lost') input.current = () => false;
      if (kind === 'budget') f.projection.tokens.length = 32769;
      if (kind === 'duplicate-token') f.projection.tokens.push(f.projection.tokens[0]);
      if (kind === 'uncovered') f.projection.tokens.splice(1, 1);
      if (kind === 'partial-text') f.projection.tokens[0].raw = '\\a';
      expect(() => captureNoteMarker(f.editor.view, input)).toThrow();
    } finally {
      f.editor.destroy();
    }
  },
);

it('refuses accessor and hidden actual marker attrs without invoking their getters', async () => {
  const f = await fixture();
  let calls = 0;
  try {
    const attrs = f.editor.state.doc.nodeAt(f.input.position)!.attrs;
    Object.defineProperty(attrs, 'commentId', {
      configurable: true,
      enumerable: false,
      get: () => {
        calls++;
        return 'legacy-id';
      },
    });
    expect(() => captureNoteMarker(f.editor.view, f.input)).toThrow();
    expect(calls).toBe(0);
  } finally {
    f.editor.destroy();
  }
});

it.each(['backendId', 'workspaceId', 'noteId', 'noteInstanceId'])(
  'rejects missing original scope %s',
  async (key) => {
    const f = await fixture();
    try {
      Reflect.deleteProperty(f.input.identity.scope, key);
      expect(() => captureNoteMarker(f.editor.view, f.input)).toThrow();
    } finally {
      f.editor.destroy();
    }
  },
);
