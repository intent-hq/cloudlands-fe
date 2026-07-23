/**
 * Regression: comment.add params must include mention-chip text.
 *
 * Real-world failing case (2026-07-23, workspace "comment-add", note "spec"):
 * the user selected the spec status paragraph, which the markdown pipeline
 * renders with `@KNOWN_ISSUES.md` as a mention atom node. Raw
 * `doc.textBetween` yields an EMPTY string for atom leaf nodes (TipTap
 * `renderText` maps to `schema.toText`, not ProseMirror `spec.leafText`), so
 * the searchContext/commentTarget sent to the daemon had a hole where the
 * mention text belonged and anchoring failed with "Could not find the search
 * context in the document."
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

vi.mock('../comments-write-service', () => ({
  addComment: vi.fn(async () => true),
  respondToComment: vi.fn(async () => true),
  deleteComment: vi.fn(async () => ({ existed: true, success: true })),
}));

import { Editor } from '@tiptap/core';
import { createEditorConfig, mentionRenderText } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { CommentManagerV2 } from '../comment-manager-v2';
import * as commentsWrite from '../comments-write-service';

// Verbatim excerpt of the failing paragraph from spec note version 16:
// markdown links rendered as plain `#359`-style text plus the bare filename
// `@KNOWN_ISSUES.md` that becomes a mention chip.
const SPEC_V16_EXCERPT =
  'Round 2:  The dogfood failure was root-caused to a *stale editor doc* ' +
  '(note advanced server-side after load), not a matcher gap — fixed by a ' +
  'stale-context target rescue in intentd [#359](https://github.com/intent-hq/intentd/pull/359) ' +
  '(monorepo bump [#489](https://github.com/intent-hq/monorepo/pull/489), issue ' +
  '[#490](https://github.com/intent-hq/monorepo/issues/490) filed+closed; ' +
  '@KNOWN_ISSUES.md was retired on main in favor of GitHub issues).';

// Build the editor from the production config (markdown + mentions + comments
// branch) so the regression guard covers the real wiring — including the
// `renderText` this PR adds to the Mention configuration — not a test-local
// extension set.
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
      enableMentions: true,
    }),
  );
  return { editor, container };
}

describe('comment.add params with mention chips in the selection', () => {
  let editor: Editor;
  let container: HTMLElement;
  let manager: CommentManagerV2;

  beforeEach(async () => {
    vi.clearAllMocks();
    storeControl.reset();
    const html = await processMarkdownToHTML(SPEC_V16_EXCERPT);
    ({ editor, container } = createEditor(html));
    manager = new CommentManagerV2('comment-add', 'spec');
    await manager.initialize(editor);
  });

  afterEach(() => {
    editor.destroy();
    container.remove();
  });

  it('production editor config wires mention renderText in both branches', () => {
    const mention = editor.extensionManager.extensions.find((e) => e.name === 'mention');
    expect(mention?.options.renderText).toBe(mentionRenderText);
  });

  it('renders the excerpt with a mention atom for @KNOWN_ISSUES.md', () => {
    let mentionCount = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'mention') mentionCount += 1;
      return true;
    });
    expect(mentionCount).toBeGreaterThan(0);
    // The raw textContent drops the mention — this is the hole that broke
    // anchoring and why addComment must use serializer-aware extraction.
    expect(editor.state.doc.textContent).not.toContain('KNOWN_ISSUES.md');
  });

  it('sends searchContext/commentTarget that include the mention text', async () => {
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });

    const added = await manager.addComment('needs follow-up');
    expect(added).not.toBeNull();

    const addMock = vi.mocked(commentsWrite.addComment);
    expect(addMock).toHaveBeenCalledTimes(1);
    const [noteId, , params] = addMock.mock.calls[0];
    expect(noteId).toBe('spec');
    expect(params.commentTarget).toContain('@KNOWN_ISSUES.md');
    expect(params.searchContext).toContain('@KNOWN_ISSUES.md');
    expect(params.searchContext).toContain(params.commentTarget);
    // Link text must survive extraction so the daemon's plaintext projection
    // (which keeps link text, drops the URL) can match.
    expect(params.commentTarget).toContain('#359');
  });

  it('on persist failure: logs one bounded [CommentDiag] line, scrubs anchors, returns null', async () => {
    vi.mocked(commentsWrite.addComment).mockResolvedValueOnce(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });

    const added = await manager.addComment('needs follow-up');
    expect(added).toBeNull();

    // One single-string console.error line (the main-process forwarder relays
    // message text only), carrying bounded snippets — never full note text.
    const diagCalls = errorSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].startsWith('[CommentDiag]'),
    );
    expect(diagCalls).toHaveLength(1);
    expect(diagCalls[0]).toHaveLength(1);
    const diag = JSON.parse((diagCalls[0][0] as string).replace('[CommentDiag] comment.add failed ', ''));
    expect(diag.noteId).toBe('spec');
    expect(diag.searchContextHead.length).toBeLessThanOrEqual(24);
    expect(diag.searchContextTail.length).toBeLessThanOrEqual(24);
    expect(diag.commentTargetLength).toBeGreaterThan(0);

    // The just-inserted invisible anchors were rolled back with the store.
    let anchorCount = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'commentAnchor') anchorCount += 1;
      return true;
    });
    expect(anchorCount).toBe(0);
    errorSpy.mockRestore();
  });
});
