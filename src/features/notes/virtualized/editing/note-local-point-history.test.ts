/** @vitest-environment jsdom */
import { Editor, type JSONContent } from '@tiptap/core';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { DOMSerializer } from '@tiptap/pm/model';
import { afterEach, expect, it, vi } from 'vitest';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import { readNoteWindow } from '../note-window-reader';
import { projectNoteWindow } from '../note-window-projection';
import {
  noteLocalPointLimits,
  prepareLocalPointInsertion,
  replayLocalPoint,
  validateLocalPoint,
  validateLocalPointOutput,
  type NoteLocalPointInput,
} from './note-local-point-history';
import {
  createNoteParagraphEditAuthority,
  noteParagraphEditContextSteps,
} from './note-paragraph-edit-authority';
import { createNoteDocumentSession } from './note-document-edit-session';
import { SourceProjection } from '../projection/source-projection';
import plainOne from './__fixtures__/note-paragraph/plain-paragraph-one.json';

const id = '00000000-0000-4000-8000-000000000001';
const literal = `<!--anchor:${id}:point-->`;

async function fixture(source = 'ab') {
  const config = createEditorConfig({
    element: document.createElement('div'),
    content: '',
    editable: true,
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
  editor.commands.setTextSelection(2);
  return editor;
}
function insert(editor: Editor) {
  const transactions: Transaction[] = [];
  const record = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged) transactions.push(transaction);
  };
  editor.on('transaction', record);
  try {
    // Actual configured commands create the atom. No raw-source parse/replacement
    // manufactures a native atom, and no domain history group ID is invented.
    expect(editor.chain().insertContent('X').insertPointAnchor(id).run()).toBe(true);
  } finally {
    editor.off('transaction', record);
  }
  return transactions;
}

const editors: Editor[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const e of editors.splice(0)) e.destroy();
});

it('exposes the initial candidate at its true original generation', async () => {
  const { input } = await admitted();
  const { recipe, proof } = prepareLocalPointInsertion(input);
  const candidate = replayLocalPoint(
    proof,
    recipe,
    'redo',
    current(input, input.beforeState.doc, 'abc', 0),
  );
  expect(candidate.doc.eq(input.candidateTransaction.doc)).toBe(true);
  expect(candidate.projection.source).toBe(`aX${literal}bc`);
  proof.release();
});

it.each(['false owner', 'expired'])('preflights %s before native inverse work', async (kind) => {
  const { input } = await admitted();
  const invert = vi.spyOn(ReplaceStep.prototype, 'invert');
  const bad =
    kind === 'expired'
      ? { ...input, now: () => Date.parse(input.identity.expiresAt) }
      : { ...input, admission: { ...input.admission, current: () => false } };
  expect(() => prepareLocalPointInsertion(bad)).toThrow();
  expect(invert).not.toHaveBeenCalled();
});

it('refuses final eq callback mutation rather than returning stale proof', async () => {
  const { input } = await admitted();
  const { recipe, proof } = prepareLocalPointInsertion(input);
  const doc = input.candidateTransaction.doc,
    original = doc.eq;
  let calls = 0;
  doc.eq = function (other) {
    const result = original.call(this, other);
    if (++calls === 2) Reflect.set(doc.nodeAt(3)?.attrs ?? {}, 'commentId', 'other');
    return result;
  };
  expect(() => replayLocalPoint(proof, recipe, 'undo', current(input))).toThrow();
  proof.release();
});

it('refuses last map lookup mutating an earlier checked boundary', async () => {
  const { input } = await admitted();
  let calls = 0;
  const bad = {
    ...input,
    admission: {
      ...input.admission,
      current: () => {
        if (++calls === 3) {
          const positions = input.base.positions;
          positions.get = function (key) {
            const value = Map.prototype.get.call(this, key);
            if (key === 4) Map.prototype.set.call(this, 1, 777);
            return value;
          };
        }
        return true;
      },
    },
  };
  expect(() => prepareLocalPointInsertion(bad)).toThrow();
});

it('refuses nodeAt mutating maps after their proof', async () => {
  const { input } = await admitted();
  const nodeAt = input.candidateTransaction.doc.nodeAt;
  let calls = 0;
  const bad = {
    ...input,
    admission: {
      ...input.admission,
      current: () => {
        if (++calls === 3)
          input.candidateTransaction.doc.nodeAt = function (at) {
            const result = nodeAt.call(this, at);
            Map.prototype.set.call(input.base.positions, 1, 777);
            return result;
          };
        return true;
      },
    },
  };
  expect(() => prepareLocalPointInsertion(bad)).toThrow();
});

it('refuses output projection dispatch drift in the final replay callback', async () => {
  const { input } = await admitted();
  let armed = false,
    calls = 0;
  const bad = {
    ...input,
    admission: {
      ...input.admission,
      current: () => {
        if (armed && ++calls === 2)
          vi.spyOn(SourceProjection.prototype, 'sourceAt').mockReturnValue(999);
        return true;
      },
    },
  };
  const { recipe, proof } = prepareLocalPointInsertion(bad);
  armed = true;
  expect(() => replayLocalPoint(proof, recipe, 'undo', current(input))).toThrow();
  proof.release();
});

it.each(['text', 'point attrs'])(
  'refuses retained output JSON %s mutation after schema callback',
  async (kind) => {
    const { input } = await admitted();
    let armed = false,
      calls = 0,
      retained: JSONContent | undefined;
    const bad = {
      ...input,
      admission: {
        ...input.admission,
        current: () => {
          if (armed && ++calls === 2) {
            expect(retained?.type).toBe('doc');
            const children = retained?.content?.[0]?.content;
            expect(children).toHaveLength(3);
            if (kind === 'text') Reflect.set(children?.[0] ?? {}, 'text', 'changed');
            else Reflect.set(children?.[1]?.attrs ?? {}, 'type', 'end');
          }
          return true;
        },
      },
    };
    const { recipe, proof } = prepareLocalPointInsertion(bad);
    const parse = input.beforeState.schema.nodeFromJSON;
    vi.spyOn(input.beforeState.schema, 'nodeFromJSON').mockImplementation((json: JSONContent) => {
      if (json.type === 'doc') retained = json;
      return parse(json);
    });
    armed = true;
    expect(() =>
      replayLocalPoint(proof, recipe, 'redo', current(input, input.beforeState.doc, 'abc', 0)),
    ).toThrow();
    expect(retained?.type).toBe('doc');
    const children = retained?.content?.[0]?.content;
    expect(kind === 'text' ? children?.[0]?.text : children?.[1]?.attrs?.type).toBe(
      kind === 'text' ? 'changed' : 'end',
    );
    proof.release();
  },
);
// Unchanged actual Store abc page/context/detail closure. The abc authority
// proves B3/C60 here; the separate ab Services fixture is not this transcript.
async function admitted() {
  const calls = plainOne.calls as unknown as Array<{
    request: NotePageRequest;
    response: NoteReadPage;
  }>;
  const identity = calls[0].response;
  if (identity.kind !== 'noteSourcePage') throw new Error('Missing source capture');
  const reader = new NotePageReader(async (_method, params) => {
    const q = params.page as NotePageRequest;
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
    // The captured initial request predates these explicit identity fields.
    // Their values must match its unchanged original response header.
    if (q.kind === 'source') {
      expect(q.sourceRevision).toBe(identity.sourceRevision);
      expect(q.noteInstanceId).toBe(identity.scope.noteInstanceId);
      expect(q.snapshotId).toBe(identity.snapshotId);
    }
    if (!found) throw new Error('Uncaptured request ' + JSON.stringify(q));
    return found.response;
  });
  const read = (q: NotePageRequest) =>
    reader.read(identity.scope.workspaceId, identity.scope.noteId, q);
  const window = await readNoteWindow(read, { ...identity, at: plainOne.at });
  const projection = projectNoteWindow(window);
  const editor = await fixture(window.text);
  let claimed = false;
  const steps = noteParagraphEditContextSteps(
    window,
    identity,
    () => true,
    {
      window,
      identity,
      allowance: { retainedBytes: 8192, requests: 96, descriptors: 128, wireBytes: 8192 },
      claim: () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
      current: () => true,
    },
    () => Date.parse(identity.expiresAt) - 1,
  );
  {
    let next = steps.next();
    while (!next.done) next = steps.next(await read(next.value));
    const authority = createNoteParagraphEditAuthority(
      window,
      projection,
      next.value,
      editor.state.doc,
    );
    editors.push(editor);
    const origin = createNoteDocumentSession(
      identity.scope,
      identity.sourceRevision,
      window.sourceLength,
    );
    const beforeState = editor.state;
    const [candidateTransaction] = insert(editor);
    let allowed = true;
    const input: NoteLocalPointInput = {
      origin,
      base: authority,
      beforeState,
      candidateTransaction,
      identity: { ...identity, documentGeneration: 0, liveGeneration: 1, selectionGeneration: 1 },
      selection: { anchor: 1, head: 1, anchorAffinity: 1, headAffinity: 1 },
      admission: {
        allowance: {
          recipeBytes: noteLocalPointLimits.recipeBytes,
          sourceBytes: noteLocalPointLimits.sourceBytes,
          nativeNodes: noteLocalPointLimits.nativeNodes,
          mappingEntries: noteLocalPointLimits.mappingEntries,
        },
        current: () => allowed,
      },
      now: () => Date.parse(identity.expiresAt) - 1,
    };
    return {
      input,
      editor,
      lose: () => {
        allowed = false;
      },
      revive: () => {
        allowed = true;
      },
    };
  }
}

function current(
  input: NoteLocalPointInput,
  doc = input.candidateTransaction.doc,
  source = `aX${literal}bc`,
  generation = 1,
) {
  return {
    origin: input.origin,
    doc,
    source,
    scope: input.identity.scope,
    sourceRevision: input.identity.sourceRevision,
    snapshotId: input.identity.snapshotId,
    generation,
  };
}

it('prepares a serializable recipe from the genuine Store authority and actual configured command', async () => {
  const { input } = await admitted();
  const { recipe, proof } = prepareLocalPointInsertion(input);
  expect(recipe.forward).toEqual([{ start: 1, end: 1, text: `X${literal}` }]);
  expect(recipe.inverse).toEqual([{ start: 1, end: 58, text: '' }]);
  expect([recipe.baseLength, recipe.beforeLength, recipe.afterLength]).toEqual([3, 3, 60]);
  expect(recipe.insertion.point).toEqual({
    literal,
    attributes: { id: `${id}:point`, type: 'point', commentId: id },
    sourceRange: { start: 2, end: 58 },
    nativeRange: { from: 3, to: 4 },
  });
  expect(recipe.before).toEqual(input.selection);
  expect(recipe.after).toEqual({ anchor: 58, head: 58, anchorAffinity: 1, headAffinity: 1 });
  expect(JSON.parse(JSON.stringify(recipe))).toEqual(recipe);
  expect(Object.isFrozen(recipe.insertion.point.attributes)).toBe(true);
  expect('groupId' in recipe).toBe(false);
  expect(validateLocalPoint(proof, recipe, input.origin)).toBe(true);
  // Preparation publishes neither session nor native state; commands above are
  // observed test inputs, not an accepted domain group or Redux CAS proof.
  expect(input.beforeState.doc.textContent).toBe('abc');
  proof.release();
});

it('replays local undo and redo with the original typed atom, including after view eviction', async () => {
  const { input, editor } = await admitted();
  const { recipe, proof } = prepareLocalPointInsertion(input);
  editor.destroy();
  const undone = replayLocalPoint(proof, recipe, 'undo', current(input));
  expect(undone.doc.eq(input.beforeState.doc)).toBe(true);
  expect(undone.projection.source).toBe('abc');
  expect(undone.selection).toEqual(recipe.before);
  const redone = replayLocalPoint(proof, recipe, 'redo', current(input, undone.doc, 'abc', 2));
  expect(redone.doc.eq(input.candidateTransaction.doc)).toBe(true);
  expect(redone.doc.nodeAt(3)?.type.name).toBe('commentAnchor');
  expect(redone.doc.nodeAt(3)?.nodeSize).toBe(1);
  expect(redone.projection.source).toBe(`aX${literal}bc`);
  expect(redone.splices).toBe(recipe.forward);
  expect(redone.selection).toEqual(recipe.after);
  proof.release();
});

it('refuses copied descriptors, foreign origin, missing proof and byte-identical native text', async () => {
  const { input } = await admitted();
  const { recipe, proof } = prepareLocalPointInsertion(input);
  expect(validateLocalPoint(proof, { ...recipe }, input.origin)).toBe(false);
  expect(validateLocalPoint(proof, recipe, {})).toBe(false);
  expect(validateLocalPoint({ ...proof }, recipe, input.origin)).toBe(false);
  const text = input.beforeState.schema.node(
    'doc',
    null,
    input.beforeState.schema.node(
      'paragraph',
      null,
      input.beforeState.schema.text(`aX${literal}bc`),
    ),
  );
  expect(() => replayLocalPoint(proof, recipe, 'undo', current(input, text))).toThrow();
  proof.release();
});

it('permanently loses proof on admission loss without clearing the caller session', async () => {
  const { input, lose, revive } = await admitted();
  const { recipe, proof } = prepareLocalPointInsertion(input);
  lose();
  expect(proof.current()).toBe(false);
  revive();
  expect(proof.current()).toBe(false);
  expect(() => replayLocalPoint(proof, recipe, 'undo', current(input))).toThrow();
  proof.release();
  proof.release();
  expect(input.origin).toBeDefined();
});

it.each(['recipeBytes', 'sourceBytes', 'nativeNodes', 'mappingEntries'] as const)(
  'refuses insufficient %s admission',
  async (key) => {
    const { input } = await admitted();
    const bad = {
      ...input,
      admission: { ...input.admission, allowance: { ...input.admission.allowance, [key]: 0 } },
    };
    expect(() => prepareLocalPointInsertion(bad)).toThrow();
  },
);

it.each(['extra-step', 'raw-text', 'wrong-order', 'wrong-point', 'selection'])(
  'refuses unsupported command %s',
  async (kind) => {
    const { input } = await admitted();
    const tr = input.beforeState.tr;
    if (kind === 'raw-text') tr.insertText(`X${literal}`, 2);
    else if (kind === 'wrong-order')
      tr.insert(
        2,
        input.beforeState.schema.nodes.commentAnchor.create({
          id: `${id}:point`,
          type: 'point',
          commentId: id,
        }),
      ).insertText('X', 2);
    else {
      tr.insertText('X', 2).insert(
        3,
        input.beforeState.schema.nodes.commentAnchor.create({
          id: `${id}:${kind === 'wrong-point' ? 'start' : 'point'}`,
          type: kind === 'wrong-point' ? 'start' : 'point',
          commentId: id,
        }),
      );
      if (kind === 'extra-step') tr.insertText('Y', 2);
      if (kind === 'selection') tr.setSelection(TextSelection.create(tr.doc, 2));
    }
    expect(() => prepareLocalPointInsertion({ ...input, candidateTransaction: tr })).toThrow();
  },
);

it.each(['generation', 'revision', 'snapshot', 'scope', 'source'])(
  'refuses replay %s drift',
  async (kind) => {
    const { input } = await admitted();
    const { recipe, proof } = prepareLocalPointInsertion(input);
    const c = current(input);
    if (kind === 'generation') c.generation = 0;
    if (kind === 'revision') c.sourceRevision += '-new';
    if (kind === 'snapshot') c.snapshotId += '-new';
    if (kind === 'scope') c.scope = { ...c.scope, noteInstanceId: 'other' };
    if (kind === 'source') c.source += '!';
    expect(() => replayLocalPoint(proof, recipe, 'undo', c)).toThrow();
    proof.release();
  },
);

it.each(['atom', 'map', 'step', 'selection', 'identity'])(
  'rejects final callback %s mutation',
  async (kind) => {
    const { input } = await admitted();
    let calls = 0;
    const original = input.admission.current;
    const mutate = () => {
      if (++calls === 3) {
        if (kind === 'atom')
          Reflect.set(input.candidateTransaction.doc.nodeAt(3)?.attrs ?? {}, 'commentId', 'other');
        if (kind === 'map') Map.prototype.set.call(input.base.positions, 2, 0);
        if (kind === 'step') Reflect.set(input.candidateTransaction.steps[0], 'from', 1);
        if (kind === 'selection')
          input.candidateTransaction.setSelection(
            TextSelection.create(input.candidateTransaction.doc, 2),
          );
        if (kind === 'identity') Reflect.set(input.identity, 'snapshotId', 'other');
      }
      return original();
    };
    expect(() =>
      prepareLocalPointInsertion({ ...input, admission: { ...input.admission, current: mutate } }),
    ).toThrow();
    expect(calls).toBe(3);
  },
);

it('rejects retained atom mutation after preparation and permanently retires proof', async () => {
  const { input } = await admitted();
  const { recipe, proof } = prepareLocalPointInsertion(input);
  const attrs = input.candidateTransaction.doc.nodeAt(3)?.attrs ?? {};
  Reflect.set(attrs, 'type', 'end');
  expect(proof.current()).toBe(false);
  Reflect.set(attrs, 'type', 'point');
  expect(proof.current()).toBe(false);
  expect(validateLocalPoint(proof, recipe, input.origin)).toBe(false);
});

it('rejects expiry and release even after the clock or owner revives', async () => {
  const { input } = await admitted();
  let time = Date.parse(input.identity.expiresAt) - 1;
  const { proof } = prepareLocalPointInsertion({ ...input, now: () => time });
  time++;
  expect(proof.current()).toBe(false);
  time--;
  expect(proof.current()).toBe(false);
  const other = prepareLocalPointInsertion(input);
  other.proof.release();
  expect(other.proof.current()).toBe(false);
});

it.each(['content', 'map', 'native', 'snapshot'] as const)(
  'permanently refuses post-return %s mutation after an owner callback',
  async (kind) => {
    const { input } = await admitted();
    let mutate: (() => void) | undefined;
    const bound = {
      ...input,
      admission: {
        ...input.admission,
        current: () => {
          mutate?.();
          return true;
        },
      },
    };
    const { recipe, proof } = prepareLocalPointInsertion(bound);
    const snapshot = current(input, input.beforeState.doc, 'abc', 0);
    const output = replayLocalPoint(proof, recipe, 'redo', snapshot);
    expect(output.current()).toBe(true);
    const text = output.projection.content.content?.[0]?.content?.[0];
    const atom = output.doc.child(0).child(1);
    const original =
      kind === 'content'
        ? text?.text
        : kind === 'map'
          ? output.projection.positions.get(1)
          : kind === 'native'
            ? atom.attrs.type
            : snapshot.source;
    mutate = () => {
      if (kind === 'content') Reflect.set(text ?? {}, 'text', 'changed');
      else if (kind === 'map') Map.prototype.set.call(output.projection.positions, 1, 999);
      else if (kind === 'native') Reflect.set(atom.attrs, 'type', 'end');
      else Reflect.set(snapshot, 'source', 'changed');
    };
    expect(output.current()).toBe(false);
    mutate = undefined;
    if (kind === 'content') Reflect.set(text ?? {}, 'text', original);
    else if (kind === 'map') Map.prototype.set.call(output.projection.positions, 1, original);
    else if (kind === 'native') Reflect.set(atom.attrs, 'type', original);
    else Reflect.set(snapshot, 'source', original);
    expect(output.current()).toBe(false);
    proof.release();
  },
);
it.each(['release', 'loss'] as const)(
  'revokes returned output permanently on proof %s',
  async (kind) => {
    const { input, lose, revive } = await admitted();
    const { recipe, proof } = prepareLocalPointInsertion(input);
    const output = replayLocalPoint(
      proof,
      recipe,
      'redo',
      current(input, input.beforeState.doc, 'abc', 0),
    );
    expect(output.current()).toBe(true);
    if (kind === 'release') proof.release();
    else lose();
    expect(output.current()).toBe(false);
    revive();
    expect(output.current()).toBe(false);
    expect(proof.current()).toBe(false);
  },
);
it('bounds returned output retention while permitting old and pending endpoints', async () => {
  const { input } = await admitted();
  const { recipe, proof } = prepareLocalPointInsertion(input);
  const first = replayLocalPoint(
    proof,
    recipe,
    'redo',
    current(input, input.beforeState.doc, 'abc', 0),
  );
  const second = replayLocalPoint(proof, recipe, 'undo', current(input, first.doc));
  expect(first.current()).toBe(true);
  expect(second.current()).toBe(true);
  expect(() =>
    replayLocalPoint(proof, recipe, 'redo', current(input, second.doc, 'abc', 2)),
  ).toThrow();
  first.release();
  first.release();
  expect(first.current()).toBe(false);
  expect(second.current()).toBe(true);
  const third = replayLocalPoint(proof, recipe, 'redo', current(input, second.doc, 'abc', 2));
  expect(third.current()).toBe(true);
  second.release();
  proof.release();
  expect(third.current()).toBe(false);
});

it.each(['content', 'map'] as const)(
  'validates returned %s after callbacks without invoking owner or clock',
  async (kind) => {
    const { input } = await admitted();
    const owner = vi.fn(input.admission.current),
      now = vi.fn(input.now);
    const bound = { ...input, now, admission: { ...input.admission, current: owner } };
    const { recipe, proof } = prepareLocalPointInsertion(bound);
    const output = replayLocalPoint(
      proof,
      recipe,
      'redo',
      current(input, input.beforeState.doc, 'abc', 0),
    );
    expect(output.current()).toBe(true);
    owner.mockClear();
    now.mockClear();
    expect(output.validate()).toBe(true);
    const text = output.projection.content.content?.[0]?.content?.[0];
    const original = kind === 'content' ? text?.text : output.projection.positions.get(1);
    if (kind === 'content') Reflect.set(text ?? {}, 'text', 'changed');
    else Map.prototype.set.call(output.projection.positions, 1, 999);
    expect(output.validate()).toBe(false);
    if (kind === 'content') Reflect.set(text ?? {}, 'text', original);
    else Map.prototype.set.call(output.projection.positions, 1, original);
    expect(output.validate()).toBe(false);
    expect(owner).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(output.current()).toBe(false);
  },
);
it('refuses returned output when its final owner callback releases the proof', async () => {
  const { input } = await admitted();
  let release: (() => void) | undefined;
  const bound = {
    ...input,
    admission: {
      ...input.admission,
      current: () => {
        release?.();
        return true;
      },
    },
  };
  const { recipe, proof } = prepareLocalPointInsertion(bound);
  const output = replayLocalPoint(
    proof,
    recipe,
    'redo',
    current(input, input.beforeState.doc, 'abc', 0),
  );
  release = () => proof.release();
  expect(output.current()).toBe(false);
  release = undefined;
  expect(output.validate()).toBe(false);
  expect(output.current()).toBe(false);
});

it.each(['content', 'source', 'start'] as const)(
  'refuses returned projection %s accessor without executing it',
  async (key) => {
    const { input } = await admitted();
    const { recipe, proof } = prepareLocalPointInsertion(input);
    const output = replayLocalPoint(
      proof,
      recipe,
      'redo',
      current(input, input.beforeState.doc, 'abc', 0),
    );
    const descriptor = Object.getOwnPropertyDescriptor(output.projection, key);
    expect(descriptor && 'value' in descriptor).toBe(true);
    const get = vi.fn(() => {
      if (key === 'content') Map.prototype.set.call(output.projection.positions, 1, 999);
      else Reflect.set(output.doc.child(0).child(1).attrs, 'type', 'end');
      return descriptor?.value;
    });
    Object.defineProperty(output.projection, key, {
      configurable: true,
      enumerable: descriptor?.enumerable,
      get,
    });
    expect(output.validate()).toBe(false);
    expect(get).not.toHaveBeenCalled();
    if (descriptor) Object.defineProperty(output.projection, key, descriptor);
    expect(output.current()).toBe(false);
    proof.release();
  },
);

it('authenticates returned output identity, candidate references and original command without callbacks', async () => {
  const { input } = await admitted();
  const owner = vi.fn(input.admission.current),
    now = vi.fn(input.now);
  const { recipe, proof } = prepareLocalPointInsertion({
    ...input,
    now,
    admission: { ...input.admission, current: owner },
  });
  const output = replayLocalPoint(
    proof,
    recipe,
    'redo',
    current(input, input.beforeState.doc, 'abc', 0),
  );
  expect(output.current()).toBe(true);
  owner.mockClear();
  now.mockClear();
  const forged = { ...output, validate: vi.fn(() => true) };
  expect(validateLocalPointOutput(forged, output, input.candidateTransaction)).toBe(false);
  expect(forged.validate).not.toHaveBeenCalled();
  expect(
    validateLocalPointOutput(output, { doc: input.beforeState.doc, projection: output.projection }),
  ).toBe(false);
  expect(
    validateLocalPointOutput(output, {
      doc: output.doc,
      projection: new SourceProjection(output.projection.source, 0),
    }),
  ).toBe(false);
  expect(validateLocalPointOutput(output, output, input.beforeState.tr)).toBe(false);
  expect(validateLocalPointOutput(output, output, input.candidateTransaction)).toBe(true);
  const get = vi.fn(() => output.doc);
  expect(
    validateLocalPointOutput(output, {
      get doc() {
        return get();
      },
      projection: output.projection,
    }),
  ).toBe(false);
  expect(get).not.toHaveBeenCalled();
  expect(owner).not.toHaveBeenCalled();
  expect(now).not.toHaveBeenCalled();
  output.release();
  expect(validateLocalPointOutput(output, output, input.candidateTransaction)).toBe(false);
  proof.release();
});

it('rejects a distinct same-document two-step root despite equal configured source serialization', async () => {
  const { input } = await admitted();
  const original = input.candidateTransaction;
  const other = input.beforeState.tr.step(original.steps[0]).step(original.steps[1]);
  other.setSelection(
    TextSelection.create(other.doc, original.selection.anchor, original.selection.head),
  );
  expect(other).not.toBe(original);
  expect(other.before).toBe(original.before);
  expect(other.steps).toHaveLength(2);
  expect(other.doc.eq(original.doc)).toBe(true);
  expect(other.selection.eq(original.selection)).toBe(true);
  const serialize = (transaction: Transaction) => {
    const element = document.createElement('div');
    element.append(
      DOMSerializer.fromSchema(transaction.doc.type.schema).serializeFragment(
        transaction.doc.content,
      ),
    );
    return processHTMLToMarkdown(element.innerHTML, { workspaceId: 'w', preserveAnchors: true });
  };
  const expected = `aX${literal}bc`;
  expect(await serialize(original)).toBe(expected);
  expect(await serialize(other)).toBe(expected);
  const { recipe, proof } = prepareLocalPointInsertion(input);
  const output = replayLocalPoint(
    proof,
    recipe,
    'redo',
    current(input, input.beforeState.doc, 'abc', 0),
  );
  expect(output.current()).toBe(true);
  expect(output.projection.source).toBe(expected);
  // Same native result and caller bytes do not identify the admitted command.
  expect(validateLocalPointOutput(output, output, other)).toBe(false);
  expect(validateLocalPointOutput(output, output, original)).toBe(true);
  output.release();
  proof.release();
});
