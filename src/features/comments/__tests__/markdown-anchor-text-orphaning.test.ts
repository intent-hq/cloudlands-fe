/**
 * Regression tests for monorepo#710: comments falsely marked orphaned on load.
 *
 * Two failure modes:
 * 1. Thread replies share the root comment's persistent markers (the daemon's
 *    comment.respond clones the root's anchor/anchorText), but the in-doc
 *    anchor nodes carry the ROOT's commentId — reconciliation must recognize
 *    the shared anchor ids instead of falling through to text search.
 * 2. The text-search fallback compared raw markdown anchorText (bold syntax,
 *    heading-split fragments like "oal\n\n**Status...") against the editor's
 *    plaintext projection via indexOf — it can never match; the matcher must
 *    normalize both sides to a plaintext projection first.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$store/renderer/store', async () => {
  const { createStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  const { commentsReducer, initialState } = await vi.importActual<typeof import('$store/renderer/slices/comments/comments-slice')>(
    '$store/renderer/slices/comments/comments-slice'
  );
  let state = { comments: initialState };
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
    createSelector: (selectorFunc: (state: any, ...args: any[]) => any) => Object.assign(
      (...args: any[]) => readable(() => selectorFunc(mockStore.state, ...args)),
      {
        select: selectorFunc,
        effect: (...args: any[]) => selectorFunc(mockStore.state, ...args),
        withStore: (storeSource: { state?: unknown }) =>
          (...args: any[]) => readable(() => selectorFunc(storeSource.state ?? mockStore.state, ...args)),
      },
    ),
  };
  return createStoreMockModule(mockStore);
});

import { Editor } from '@tiptap/core';
import { CommentManagerV2 } from '../comment-manager-v2';
import { store as appStore } from '$store/renderer/store';
import { loadCommentsAction } from '$store/renderer/slices/comments/comments-slice';
import { selectCommentById } from '$store/renderer/slices/comments/comments-selectors';
import { createTestEditor, clearCommentsStore } from './test-utils';
import { findCommentAnchors } from '$lib/components/tiptap/CommentAnchor';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import type { CommentV2 } from '../comment-types-v2';

const ROOT_ID = 'root-cmt-710';
const REPLY_ID = 'reply-cmt-710';

/** Markdown anchorText snapshot from the #710 logs: heading-split fragment + bold. */
const MARKDOWN_ANCHOR_TEXT =
  'oal\n\n**Status: COMPLETE (2026-07-24, round 5, verified).** The matcher was never';

function makeComment(overrides: Partial<CommentV2> & { id: string }): CommentV2 {
  const now = new Date().toISOString();
  return {
    threadId: ROOT_ID,
    content: 'test comment',
    author: 'User',
    authorType: 'user',
    type: 'comment',
    status: 'open',
    createdAt: now,
    updatedAt: now,
    noteId: 'test-note',
    anchor: { type: 'range', startId: `${ROOT_ID}:start`, endId: `${ROOT_ID}:end` },
    anchorText: MARKDOWN_ANCHOR_TEXT,
    ...overrides,
  } as CommentV2;
}

async function setMarkdownContent(editor: Editor, markdown: string): Promise<void> {
  const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });
  editor.commands.setContent(html);
}

describe('monorepo#710 — markdown anchorText false orphaning', () => {
  let editor: Editor;
  let manager: CommentManagerV2;

  beforeEach(async () => {
    editor = createTestEditor();
    manager = new CommentManagerV2('test-workspace', 'test-note');
    await manager.initialize(editor);
    clearCommentsStore();
  });

  const markedUpDoc =
    `## G<!--anchor:${ROOT_ID}:start-->oal\n\n` +
    `**Status: COMPLETE (2026-07-24, round 5, verified).** The matcher was never<!--anchor:${ROOT_ID}:end--> right.`;

  it('does not orphan a reply that shares the thread root persistent markers', async () => {
    await setMarkdownContent(editor, markedUpDoc);
    const root = makeComment({ id: ROOT_ID });
    const reply = makeComment({ id: REPLY_ID, parentId: ROOT_ID });
    appStore.dispatch(loadCommentsAction([root, reply]));

    await manager.reapplyAnchorsForCurrentComments({ reason: 'test' });

    expect(selectCommentById.select(appStore.state, ROOT_ID)?.isOrphaned).not.toBe(true);
    expect(selectCommentById.select(appStore.state, REPLY_ID)?.isOrphaned).not.toBe(true);
  });

  it('scanAnchorHealth treats a reply as healthy via shared thread anchors', async () => {
    await setMarkdownContent(editor, markedUpDoc);
    appStore.dispatch(loadCommentsAction([
      makeComment({ id: ROOT_ID }),
      makeComment({ id: REPLY_ID, parentId: ROOT_ID }),
    ]));

    await manager.scanAnchorHealth();

    expect(selectCommentById.select(appStore.state, ROOT_ID)?.isOrphaned).not.toBe(true);
    expect(selectCommentById.select(appStore.state, REPLY_ID)?.isOrphaned).not.toBe(true);
  });

  it('anchors markdown-flavored anchorText via plaintext projection fallback', async () => {
    await setMarkdownContent(
      editor,
      '## Goal\n\n**Status: COMPLETE (2026-07-24, round 5, verified).** The matcher was never right.',
    );
    const comment = makeComment({
      id: 'md-cmt-710',
      threadId: 'md-cmt-710',
      anchor: { type: 'range', startId: 'md-cmt-710:start', endId: 'md-cmt-710:end' },
    });
    appStore.dispatch(loadCommentsAction([comment]));

    await manager.reapplyAnchorsForCurrentComments({ reason: 'test' });

    expect(selectCommentById.select(appStore.state, 'md-cmt-710')?.isOrphaned).not.toBe(true);
    const anchors = findCommentAnchors(editor.state.doc, 'md-cmt-710');
    expect(anchors.start).toBeDefined();
    expect(anchors.end).toBeDefined();
  });

  it('still orphans a comment whose anchor text is genuinely gone', async () => {
    editor.commands.setContent('<p>Completely different content.</p>');
    const comment = makeComment({
      id: 'gone-cmt-710',
      threadId: 'gone-cmt-710',
      anchor: { type: 'range', startId: 'gone-cmt-710:start', endId: 'gone-cmt-710:end' },
      anchorText: '**text that no longer exists anywhere**',
    });
    appStore.dispatch(loadCommentsAction([comment]));

    await manager.reapplyAnchorsForCurrentComments({ reason: 'test' });

    expect(selectCommentById.select(appStore.state, 'gone-cmt-710')?.isOrphaned).toBe(true);
  });

  it('heals a stale isOrphaned flag when in-doc anchors already exist', async () => {
    await setMarkdownContent(editor, markedUpDoc);
    appStore.dispatch(loadCommentsAction([makeComment({ id: ROOT_ID, isOrphaned: true })]));

    await manager.reapplyAnchorsForCurrentComments({ reason: 'test' });

    expect(selectCommentById.select(appStore.state, ROOT_ID)?.isOrphaned).toBe(false);
  });
});
