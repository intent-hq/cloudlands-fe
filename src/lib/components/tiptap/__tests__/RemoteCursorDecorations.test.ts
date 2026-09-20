/**
 * @vitest-environment jsdom
 *
 * Remote cursor decorations: a peer's caret and selection render as
 * decorations that ride local edits (AC 2) and clear on an empty set.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  createRemoteCursorDecorationsPlugin,
  remoteCursorColor,
  remoteCursorsPluginKey,
  setRemoteCursors,
  type RemoteCursor,
} from '../RemoteCursorDecorations';

function cursor(overrides: Partial<RemoteCursor> = {}): RemoteCursor {
  return {
    principalId: 'principal-b',
    label: 'Bea',
    avatarUrl: null,
    color: remoteCursorColor('principal-b'),
    anchor: 4,
    head: 4,
    ...overrides,
  };
}

function decorationPositions(editor: Editor) {
  const set = remoteCursorsPluginKey.getState(editor.state)!;
  return set.find().map((d) => ({ from: d.from, to: d.to, spec: d.spec }));
}

describe('RemoteCursorDecorations', () => {
  let element: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({ element, extensions: [StarterKit], content: '<p>hello world</p>' });
    editor.registerPlugin(createRemoteCursorDecorationsPlugin());
  });

  afterEach(() => {
    editor.destroy();
    element.remove();
  });

  it('renders a caret widget at the head and a highlight over the selection', () => {
    setRemoteCursors(editor.view, [cursor({ anchor: 2, head: 7 })]);

    const decorations = decorationPositions(editor);
    expect(decorations).toEqual([
      expect.objectContaining({ from: 2, to: 7, spec: { principalId: 'principal-b' } }),
      expect.objectContaining({ from: 7, to: 7 }),
    ]);
    const widget = element.querySelector<HTMLElement>('.remote-cursor[data-principal-id]');
    expect(widget?.dataset.principalId).toBe('principal-b');
    expect(widget?.textContent).toBe('Bea');
    expect(element.querySelector('.remote-selection')?.textContent).toBe(
      editor.state.doc.textBetween(2, 7),
    );
  });

  it('moves a remote caret through a local edit before it (AC 2)', () => {
    setRemoteCursors(editor.view, [cursor({ anchor: 7, head: 7 })]);

    editor.view.dispatch(editor.state.tr.insertText('XYZ', 1));

    expect(decorationPositions(editor)).toEqual([expect.objectContaining({ from: 10, to: 10 })]);
    expect(editor.state.doc.textBetween(0, 10)).toBe('XYZhello ');
  });

  it('leaves a remote caret alone through a local edit after it', () => {
    setRemoteCursors(editor.view, [cursor({ anchor: 3, head: 3 })]);

    editor.view.dispatch(editor.state.tr.insertText('!', 12));

    expect(decorationPositions(editor)).toEqual([expect.objectContaining({ from: 3, to: 3 })]);
  });

  it('replaces the whole set on a new push and clears on an empty one', () => {
    setRemoteCursors(editor.view, [
      cursor(),
      cursor({ principalId: 'principal-c', label: 'Cy', anchor: 9, head: 9 }),
    ]);
    expect(element.querySelectorAll('.remote-cursor')).toHaveLength(2);

    setRemoteCursors(editor.view, [cursor({ principalId: 'principal-c', label: 'Cy' })]);
    expect(element.querySelectorAll('.remote-cursor')).toHaveLength(1);
    expect(element.querySelector<HTMLElement>('.remote-cursor')?.dataset.principalId).toBe(
      'principal-c',
    );

    setRemoteCursors(editor.view, []);
    expect(element.querySelectorAll('.remote-cursor')).toHaveLength(0);
    expect(remoteCursorsPluginKey.getState(editor.state)!.find()).toHaveLength(0);
  });

  it('clamps positions past the document end', () => {
    setRemoteCursors(editor.view, [cursor({ anchor: 500, head: 500 })]);
    const [widget] = decorationPositions(editor);
    expect(widget.from).toBe(editor.state.doc.content.size);
  });

  it('does not record the cursor update in undo history', () => {
    editor.view.dispatch(editor.state.tr.insertText('A', 1));
    setRemoteCursors(editor.view, [cursor()]);
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe('hello world');
    expect(remoteCursorsPluginKey.getState(editor.state)!.find()).toHaveLength(1);
  });
});

describe('remoteCursorColor', () => {
  it('is stable per principal and differs between principals', () => {
    expect(remoteCursorColor('principal-a')).toBe(remoteCursorColor('principal-a'));
    expect(remoteCursorColor('principal-a')).not.toBe(remoteCursorColor('principal-b'));
    expect(remoteCursorColor('principal-a')).toMatch(/^hsl\(\d+ 70% 45%\)$/);
  });
});
