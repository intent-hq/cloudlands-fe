/**
 * Regression: the FE-generated optimistic comment id must ride `comment.add`.
 *
 * Root cause A of the clobber/ghosting race: `addComment` inserts editor
 * anchors and an optimistic store entry under a generated UUID, but the wire
 * params carried no `commentId`, so the daemon minted a DIFFERENT id for the
 * row/threadId/markers. The post-add refetch then replaced the optimistic
 * store entry with the daemon id, orphaning the editor anchors (and the
 * daemon-side markers never matched the editor's). intentd#514 (PROTOCOL
 * §5.3) makes the daemon honor a supplied `commentId`; this suite pins the FE
 * side: one id flows through anchors → wire params → post-refetch store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const storeControl = vi.hoisted(() => ({ reset: () => {} }));

vi.mock('$store/renderer/store', async () => {
  const { createStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  const { commentsReducer, initialState } = await vi.importActual<
    typeof import('$store/renderer/slices/comments/comments-slice')
  >('$store/renderer/slices/comments/comments-slice');
  let state = { comments: initialState };
  storeControl.reset = () => {
    state = { comments: initialState };
  };
  const readable = <T>(getter: () => T) => ({
    subscribe: (listener: (value: T) => void) => {
      listener(getter());
      return () => {};
    },
  });
  const mockStore = {
    dispatch: (action: unknown) => {
      state = { comments: commentsReducer(state.comments, action as never) };
      return action;
    },
    get state() {
      return state;
    },
    createSelector: (selectorFunc: (state: any, ...args: any[]) => any) =>
      Object.assign(
        (...args: any[]) => readable(() => selectorFunc(mockStore.state, ...args)),
        {
          select: selectorFunc,
          effect: (...args: any[]) => selectorFunc(mockStore.state, ...args),
          withStore:
            (storeSource: { state?: unknown }) =>
            (...args: any[]) =>
              readable(() => selectorFunc(storeSource.state ?? mockStore.state, ...args)),
        },
      ),
  };
  return createStoreMockModule(mockStore);
});

vi.mock('../comment-loader', () => ({
  loadComments: vi.fn(async () => []),
  resolveComment: vi.fn(async () => true),
}));

// FAKE seam: appClient.comments.add is stubbed so no mutation reaches a
// daemon; the REAL comments-write-service runs so the optimistic dispatch,
// param passthrough, and rollback are the genuine code paths.
vi.mock('$lib/client', () => ({
  appClient: {
    comments: {
      add: vi.fn(async () => ({ success: true })),
      respond: vi.fn(async () => ({ success: true })),
      delete: vi.fn(async () => ({ success: true })),
    },
  },
}));

// Passthrough for the note-rev mutation queue: rev bookkeeping is exercised by
// comments-write-service.test.ts and is out of scope here.
vi.mock('../../notes/notes-write-service', () => ({
  enqueueRevBumpingNoteMutation: vi.fn(
    async (_workspaceId: string, _noteId: string, fn: () => Promise<unknown>) => fn(),
  ),
}));

// FAKE the toast seam so the failure path runs without svelte-sonner.
vi.mock('svelte-sonner', () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { Editor } from '@tiptap/core';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { CommentManagerV2 } from '../comment-manager-v2';
import { appClient } from '$lib/client';
import type { CommentAddParams } from '$lib/client';
import type { CommentV2 } from '../comment-types-v2';
import { store as appStore } from '$store/renderer/store';
import { loadCommentsAction } from '$store/renderer/slices/comments/comments-slice';
import { selectComments } from '$store/renderer/slices/comments/comments-selectors';

const addMock = vi.mocked(appClient.comments.add);

function createEditor(html: string): { editor: Editor; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = new Editor(
    createEditorConfig({
      element: container,
      content: html,
      editable: true,
      onUpdate: () => {},
      useMarkdown: true,
      enableComments: true,
      useNewCommentSystem: true,
      workspace: { id: 'comment-add' },
    }),
  );
  return { editor, container };
}

/** Collect every commentAnchor node's `{ id, commentId }` attrs from the doc. */
function collectAnchors(editor: Editor): { id: string; commentId: string }[] {
  const anchors: { id: string; commentId: string }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'commentAnchor') {
      anchors.push({ id: String(node.attrs.id), commentId: String(node.attrs.commentId) });
    }
    return true;
  });
  return anchors;
}

/** Daemon-shaped `comment.list` row: honors the wire `commentId` per §5.3. */
function makeDaemonComment(id: string): CommentV2 {
  const now = '2026-07-25T00:00:00.000Z';
  return {
    id,
    threadId: id,
    noteId: 'spec',
    content: 'needs follow-up',
    author: 'User',
    authorType: 'user',
    status: 'open',
    anchor: { type: 'range', startId: `${id}:start`, endId: `${id}:end` },
    type: 'comment',
    createdAt: now,
    updatedAt: now,
  } as CommentV2;
}

describe('comment.add carries the optimistic comment id (clobber/ghosting root cause A)', () => {
  let editor: Editor;
  let container: HTMLElement;
  let manager: CommentManagerV2;

  beforeEach(async () => {
    vi.clearAllMocks();
    addMock.mockResolvedValue({ success: true });
    storeControl.reset();
    const html = await processMarkdownToHTML('The quick brown fox jumps over the lazy dog.');
    ({ editor, container } = createEditor(html));
    manager = new CommentManagerV2('comment-add', 'spec');
    await manager.initialize(editor);
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  it('sends the optimistic id as commentId in the write-service params, matching the editor anchors', async () => {
    editor.commands.setTextSelection({ from: 5, to: 10 });

    const added = await manager.addComment('needs follow-up');
    expect(added).not.toBeNull();

    expect(addMock).toHaveBeenCalledTimes(1);
    const [noteId, params] = addMock.mock.calls[0] as [string, CommentAddParams];
    expect(noteId).toBe('spec');
    expect(params.commentId).toBe(added!.id);

    // The anchors already inserted in the doc carry the SAME id the daemon
    // will persist under — start/end node ids are `${commentId}:start|end`.
    const anchors = collectAnchors(editor);
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(anchor.commentId).toBe(added!.id);
      expect(anchor.id.startsWith(`${added!.id}:`)).toBe(true);
    }
  });

  it('post-refetch store comment id equals the editor anchor id', async () => {
    editor.commands.setTextSelection({ from: 5, to: 10 });

    const added = await manager.addComment('needs follow-up');
    expect(added).not.toBeNull();
    const params = addMock.mock.calls[0][1] as CommentAddParams;
    expect(params.commentId).toBeDefined();

    // The daemon persists the row under the wire `commentId` when supplied
    // (§5.3); without one it mints its own UUID — the pre-#514 ghosting bug.
    // Simulate the subscribe→refetch loop's bulk reload with that row.
    const daemonId = params.commentId ?? '11111111-2222-4333-8444-555555555555';
    appStore.dispatch(loadCommentsAction([makeDaemonComment(daemonId)]));

    const storedIds = selectComments.select(appStore.state).map((c: CommentV2) => c.id);
    const anchorCommentIds = [...new Set(collectAnchors(editor).map((a) => a.commentId))];
    expect(anchorCommentIds).toEqual([added!.id]);
    expect(storedIds).toEqual([added!.id]);
  });

  it('rollback on a failed add removes the store entry and anchors by the same id', async () => {
    addMock.mockResolvedValueOnce({ success: false, error: 'boom' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    editor.commands.setTextSelection({ from: 5, to: 10 });

    const added = await manager.addComment('needs follow-up');
    expect(added).toBeNull();

    expect(selectComments.select(appStore.state)).toHaveLength(0);
    expect(collectAnchors(editor)).toHaveLength(0);
    errorSpy.mockRestore();
  });
});
