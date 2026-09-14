/**
 * @vitest-environment jsdom
 *
 * Editor ↔ presence binding: the local selection is published in daemon-text
 * (markdown) coordinates at the editor's base rev, and peers' wire carets are
 * projected onto the rendered document as remote cursor decorations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import { remoteCursorsPluginKey } from '$lib/components/tiptap/RemoteCursorDecorations';
import type {
  NotePresenceListener,
  NotePresenceSession,
  RemoteNoteViewer,
} from '$features/notes/note-presence/note-presence-service';
import { bindRemoteCursors } from '../remote-cursors-binding';

const MARKDOWN = '# Title\n\nBody **bold** tail';

function fakeSession() {
  const listeners = new Set<NotePresenceListener>();
  let viewers: RemoteNoteViewer[] = [];
  const session: NotePresenceSession & { emit: (v: RemoteNoteViewer[]) => void } = {
    getViewers: () => viewers,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publishCursor: vi.fn(),
    release: vi.fn(),
    emit: (next) => {
      viewers = next;
      for (const listener of listeners) listener(next);
    },
  };
  return session;
}

function peer(cursor: RemoteNoteViewer['cursor']): RemoteNoteViewer {
  return {
    principalId: 'p-b',
    login: 'bea',
    displayName: 'Bea',
    avatarUrl: null,
    cursor,
    cursorSeenAt: cursor ? Date.now() : null,
  };
}

async function nextFrame() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

describe('bindRemoteCursors', () => {
  let element: HTMLElement;
  let editor: Editor;
  let unbind: (() => void) | undefined;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [StarterKit],
      content: '<h1>Title</h1><p>Body <strong>bold</strong> tail</p>',
    });
  });

  afterEach(() => {
    unbind?.();
    editor.destroy();
    element.remove();
  });

  it('publishes the selection as markdown offsets at the base rev', async () => {
    const session = fakeSession();
    unbind = bindRemoteCursors({
      editor,
      session,
      getBaseText: () => MARKDOWN,
      getBaseRev: () => 12,
    });

    // Select "bold" in the rendered document.
    const from = editor.state.doc.textContent.indexOf('bold');
    const doc = editor.state.doc;
    let boldFrom = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'bold') boldFrom = pos;
    });
    expect(boldFrom).toBeGreaterThan(from);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, boldFrom, boldFrom + 4)),
    );
    await nextFrame();

    const published = vi.mocked(session.publishCursor).mock.lastCall?.[0];
    expect(published?.rev).toBe(12);
    // The selection start sits on the `**bold` boundary: the markup is not
    // part of the rendered text, so the anchor lands at the marker edge.
    expect(MARKDOWN.slice(published!.anchor).replace(/^\*+/, '').startsWith('bold')).toBe(true);
    expect(MARKDOWN.slice(published!.head - 4, published!.head)).toBe('bold');
  });

  it('projects a peer caret from markdown offsets onto the document and clears it when it expires', async () => {
    const session = fakeSession();
    unbind = bindRemoteCursors({
      editor,
      session,
      getBaseText: () => MARKDOWN,
      getBaseRev: () => 12,
    });

    const markdownCaret = MARKDOWN.indexOf('tail');
    session.emit([peer({ rev: 12, anchor: markdownCaret, head: markdownCaret })]);
    await nextFrame();

    const [widget] = remoteCursorsPluginKey.getState(editor.state)!.find();
    expect(editor.state.doc.textBetween(widget.from, widget.from + 4)).toBe('tail');
    expect(element.querySelector('.remote-cursor')?.textContent).toBe('Bea');

    session.emit([peer(null)]);
    await nextFrame();
    expect(element.querySelector('.remote-cursor')).toBeNull();
  });

  it('removes the plugin and its decorations on unbind', async () => {
    const session = fakeSession();
    unbind = bindRemoteCursors({
      editor,
      session,
      getBaseText: () => MARKDOWN,
      getBaseRev: () => 12,
    });
    session.emit([peer({ rev: 12, anchor: 0, head: 0 })]);
    await nextFrame();
    expect(element.querySelector('.remote-cursor')).not.toBeNull();

    unbind();
    unbind = undefined;
    expect(element.querySelector('.remote-cursor')).toBeNull();
    expect(remoteCursorsPluginKey.getState(editor.state)).toBeUndefined();
  });
});
