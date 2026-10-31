import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ScreenReference } from '$lib/components/tiptap/ScreenReference';
import type { EditorScreenReference } from '$shared/dock-evidence';
import { plainTextToEditorHTML, serializeEditorText } from './editor-text-serialization';
import {
  hydrateScreenReferences,
  hydrateScreenTokens,
  insertScreenEvidence,
  screenReferenceEdit,
  synchronizeScreenReferences,
} from './screen-reference-editor';
import {
  addDockMark,
  applyDockCapture,
  applyDockReferenceEdit,
  emptyDockEvidence,
  screenReferences as evidenceReferences,
  type DockComposerEvidence,
  type DockReferenceEdit,
} from '$shared/dock-evidence';

const first: EditorScreenReference = { id: 'first', number: 1, label: 'Save & close' };
const second: EditorScreenReference = { id: 'second', number: 2, label: 'Menu' };
const editors: Editor[] = [];

function mountEditor(text: string, initial = [first, second]) {
  let references = initial;
  const host = document.createElement('div');
  document.body.append(host);
  const editor = new Editor({
    element: host,
    extensions: [StarterKit, ScreenReference.configure({ references: () => references })],
    content: hydrateScreenReferences(plainTextToEditorHTML(text), references),
  });
  editors.push(editor);
  return {
    editor,
    setReferences: (next: EditorScreenReference[]) => {
      references = next;
    },
  };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe('screen evidence references in the actual editor schema', () => {
  it('round-trips known references, Unicode and newlines while leaving unknown tokens literal', () => {
    const text = '前 [[mark:1]] & [[mark:9]]\n後 [[mark:2]]';
    const { editor } = mountEditor(text);
    expect(serializeEditorText(editor)).toBe(text);
    expect(editor.view.dom.querySelectorAll('[data-screen-reference]')).toHaveLength(2);
    expect(
      editor.view.dom.querySelector('[data-screen-reference="first"]')?.getAttribute('aria-label'),
    ).toContain('Save & close');
  });

  it('does not hydrate tokens inside attributes or existing noneditable chips', () => {
    const html =
      '<p title="[[mark:1]]"><span contenteditable="false">[[mark:1]]</span> [[mark:2]]</p>';
    const template = document.createElement('template');
    template.innerHTML = hydrateScreenReferences(html, [first, second]);
    expect(template.content.querySelector('p')?.title).toBe('[[mark:1]]');
    expect(template.content.querySelector('[contenteditable="false"]')?.textContent).toBe(
      '[[mark:1]]',
    );
    expect(template.content.querySelectorAll('[data-screen-reference]')).toHaveLength(1);
  });

  it('removes and renumbers by identity without changing focus', () => {
    const { editor, setReferences } = mountEditor('A [[mark:1]] B [[mark:2]] C');
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    const next = [{ ...second, number: 1 }];
    setReferences(next);
    expect(synchronizeScreenReferences(editor, next)).toBe(true);
    expect(serializeEditorText(editor)).toBe('A B [[mark:1]] C');
    expect(editor.view.dom.querySelector('[data-screen-reference="first"]')).toBeNull();
    expect(editor.view.dom.querySelector('[data-screen-reference="second"]')?.textContent).toBe(
      '1',
    );
    expect(document.activeElement).toBe(button);
    expect(synchronizeScreenReferences(editor, next)).toBe(false);
  });

  it('leaves one space between words and none at a line edge when a chip goes', () => {
    const cases: [text: string, expected: string][] = [
      ['this [[mark:1]] still', 'this still'],
      ['[[mark:1]] at start', 'at start'],
      ['at end [[mark:1]]', 'at end'],
      ['line one [[mark:1]]\n[[mark:2]] line two', 'line one\nline two'],
      ['tight[[mark:1]]word', 'tightword'],
    ];
    for (const [text, expected] of cases) {
      const { editor, setReferences } = mountEditor(text);
      setReferences([]);
      synchronizeScreenReferences(editor, []);
      expect(serializeEditorText(editor)).toBe(expected);
    }
    // Backspace on a chip between words collapses the same way.
    const { editor } = mountEditor('this [[mark:1]] still');
    editor.commands.setTextSelection(7);
    expect(editor.commands.keyboardShortcut('Backspace')).toBe(true);
    expect(serializeEditorText(editor)).toBe('this still');
  });

  it('deletes a reference as one unit with Backspace', () => {
    const { editor } = mountEditor('one[[mark:1]]two');
    editor.commands.setTextSelection(5);
    expect(editor.commands.keyboardShortcut('Backspace')).toBe(true);
    expect(serializeEditorText(editor)).toBe('onetwo');
  });

  it('inserts ordered speech/reference parts at the retained caret without focusing', () => {
    const { editor } = mountEditor('LeftRight');
    editor.commands.setTextSelection(5);
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    expect(
      insertScreenEvidence(
        editor,
        {
          id: 'speech-1',
          parts: [
            { kind: 'text', text: 'before ' },
            { kind: 'mark', markId: second.id },
            { kind: 'text', text: ' after\nnext' },
          ],
        },
        [first, second],
      ),
    ).toBe(true);
    expect(serializeEditorText(editor)).toBe('Leftbefore [[mark:2]] after\nnextRight');
    expect(document.activeElement).toBe(button);
  });

  it('rejects an unresolved mark without inserting part of the narration', () => {
    const { editor } = mountEditor('Keep');
    expect(
      insertScreenEvidence(
        editor,
        {
          id: 'unresolved',
          parts: [
            { kind: 'text', text: 'Never partly append' },
            { kind: 'mark', markId: 'missing' },
          ],
        },
        [first],
      ),
    ).toBe(false);
    expect(serializeEditorText(editor)).toBe('Keep');
  });

  it('reports user chip deletion and undo, and never its own reference sync', () => {
    // The real editor plus the real evidence model: marks follow their chips.
    let evidence: DockComposerEvidence = applyDockCapture(emptyDockEvidence('pair'), {
      id: 'img',
      contextItemId: 'item-img',
      width: 800,
      height: 600,
      displayScale: 1,
      capturedAt: '2026-10-29T18:12:04Z',
      source: 'capture',
    }).evidence;
    for (const id of ['m1', 'm2', 'm3'])
      evidence = addDockMark(evidence, {
        id,
        imageId: 'img',
        tool: 'pick',
        geometry: { kind: 'rect', x: 10, y: 10, w: 20, h: 20 },
        bounds: { x: 10, y: 10, w: 20, h: 20 },
        element: null,
        createdAt: 1,
      }).evidence;
    const labels = { pick: 'Pick', box: 'Box', pen: 'Pen', arrow: 'Arrow' };
    const references = () => evidenceReferences(evidence, labels);
    const { editor, setReferences } = mountEditor(
      'a [[mark:1]] b [[mark:2]] c [[mark:3]]',
      references(),
    );
    const edits: DockReferenceEdit[] = [];
    editor.on('transaction', ({ transaction }) => {
      const edit = screenReferenceEdit(transaction);
      if (edit) edits.push(edit);
    });
    const settle = () => {
      for (const edit of edits.splice(0)) evidence = applyDockReferenceEdit(evidence, edit);
      setReferences(references());
      synchronizeScreenReferences(editor, references());
    };
    let afterChip2 = 0;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'screenReference' && node.attrs.id === 'm2')
        afterChip2 = position + node.nodeSize;
    });
    editor.commands.setTextSelection(afterChip2);
    expect(editor.commands.keyboardShortcut('Backspace')).toBe(true);
    expect(edits).toEqual([{ removed: ['m2'], restored: [] }]);
    settle();
    expect(edits).toEqual([]);
    expect(serializeEditorText(editor)).toBe('a [[mark:1]] b c [[mark:2]]');
    expect(evidence.marks.map((row) => row.id)).toEqual(['m1', 'm3']);
    expect(editor.commands.undo()).toBe(true);
    expect(edits).toEqual([{ removed: [], restored: ['m2'] }]);
    settle();
    expect(serializeEditorText(editor)).toBe('a [[mark:1]] b [[mark:2]] c [[mark:3]]');
    expect(evidence.marks.map((row) => row.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('round-trips recording chips as [[clip:n]] tokens and removes them with their recording', () => {
    const start: EditorScreenReference = {
      id: 'clip-start:c1',
      number: 1,
      label: 'Recording 1',
      kind: 'clip-start',
    };
    const end: EditorScreenReference = {
      ...start,
      id: 'clip-end:c1',
      kind: 'clip-end',
      label: 'Recording 1 ends',
    };
    const text = 'look [[clip:1]] here [[mark:1]] done [[clip:1:end]]';
    const { editor, setReferences } = mountEditor(text, [first, start, end]);
    expect(serializeEditorText(editor)).toBe(text);
    const chip = editor.view.dom.querySelector('[data-screen-reference="clip-start:c1"]');
    expect(chip?.textContent).toBe('Recording 1');
    expect(chip?.getAttribute('aria-label')).toBe('Recording 1');
    // The recording is removed: both of its chips go, the mark and words stay.
    setReferences([first]);
    synchronizeScreenReferences(editor, [first]);
    expect(serializeEditorText(editor)).toBe('look here [[mark:1]] done');
  });

  it('lands dictated words at the speech point even when the caret jumped elsewhere', () => {
    const { editor } = mountEditor('I would like the past');
    const end = editor.state.doc.content.size - 1;
    // The window regained focus and the browser restored a stale caret mid-word.
    editor.commands.setTextSelection(12);
    expect(
      insertScreenEvidence(
        editor,
        { id: 'speech-2', parts: [{ kind: 'text', text: ' to animate nicely' }] },
        [],
        end,
      ),
    ).toBe(true);
    expect(serializeEditorText(editor)).toBe('I would like the past to animate nicely');
    // The caret follows the new words.
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });
});

describe('a restored draft whose text arrives before its references', () => {
  it('turns the raw tokens into chips once the references are known, text unchanged', () => {
    const text = 'these [[mark:1]] lines [[clip:1]] then [[clip:1:end]] and [[mark:9]]';
    const { editor, setReferences } = mountEditor(text, []);
    expect(editor.view.dom.querySelectorAll('[data-screen-reference]')).toHaveLength(0);
    const references: EditorScreenReference[] = [
      first,
      { id: 'rec-start', number: 1, label: 'Recording 1', kind: 'clip-start' },
      { id: 'rec-end', number: 1, label: 'Recording 1 ends', kind: 'clip-end' },
    ];
    setReferences(references);
    expect(hydrateScreenTokens(editor, references)).toBe(true);
    const chips = [...editor.view.dom.querySelectorAll('[data-screen-reference]')];
    expect(chips.map((chip) => chip.getAttribute('data-screen-reference'))).toEqual([
      'first',
      'rec-start',
      'rec-end',
    ]);
    // Unknown references stay literal; the draft text itself is unchanged.
    expect(serializeEditorText(editor)).toBe(text);
    expect(hydrateScreenTokens(editor, references)).toBe(false);
  });
});
