import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  foldUnsavedEditsIntoIncoming,
  runExternalContentUpdateEffect,
  shouldIgnoreLocalEditorUpdate,
  shouldRequeueExternalUpdateAfterTypingStops,
  shouldSafetyNetTrigger,
} from '../external-update-effect';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
});

function docOf(...paragraphs: string[]): PMNode {
  return schema.node(
    'doc',
    null,
    paragraphs.map((text) => schema.node('paragraph', null, text ? [schema.text(text)] : [])),
  );
}

function createMockEditor({
  initialHtml,
  selectionAnchor,
  docSize,
  doc: realDoc,
  nextDoc,
}: {
  initialHtml: string;
  selectionAnchor?: number;
  docSize?: number;
  /** Real ProseMirror documents: `doc` before the apply, `nextDoc` after `setContent`. */
  doc?: PMNode;
  nextDoc?: PMNode;
}) {
  const operations: Array<
    { type: 'command'; fn: (ctx: any) => any } | { type: 'setContent'; html: string }
  > = [];
  let setContentHtml: string | null = null;

  const tr = {
    setMeta: vi.fn(),
    setSelection: vi.fn(),
  };

  const doc = realDoc ?? {
    content: { size: docSize ?? 10 },
    resolve: vi.fn((pos: number) => ({ pos })),
  };

  const ctx = {
    tr,
    state: {
      doc,
    },
  };

  const chainObj: any = {
    command(fn: any) {
      operations.push({ type: 'command', fn });
      return chainObj;
    },
    setContent(html: string) {
      operations.push({ type: 'setContent', html });
      return chainObj;
    },
    run() {
      for (const op of operations) {
        if (op.type === 'command') op.fn(ctx);
        else {
          setContentHtml = op.html;
          if (nextDoc) ctx.state.doc = nextDoc;
        }
      }
    },
  };

  const editor = {
    isDestroyed: false,
    getHTML: vi.fn(() => initialHtml),
    state: {
      doc: realDoc,
      selection: {
        anchor: selectionAnchor,
        head: selectionAnchor,
      },
    },
    chain: vi.fn(() => chainObj),
  };

  return {
    editor,
    tr,
    getSetContentHtml: () => setContentHtml,
  };
}

describe('external-update-effect', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no-ops when editor is missing (does not call markdown processor)', () => {
    const processMarkdownToHTML = vi.fn(async () => '<p>new</p>');

    runExternalContentUpdateEffect({
      updateVersion: 1,
      getEditor: () => null,
      getIsInitialized: () => true,
      getIsUserTyping: () => false,
      getCurrentNoteContent: () => 'new-md',
      getLastKnownContent: () => 'old-md',
      setLastKnownContent: vi.fn(),
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
      getIsUpdatingFromExternal: () => false,
      setIsUpdatingFromExternal: vi.fn(),
      getWorkspaceId: () => undefined,
      getNoteId: () => 'note-1',
      getCommentManager: () => null,
      processMarkdownToHTML,
      processHTMLToMarkdown: () => 'x',
      createTextSelection: vi.fn(),
      logger,
    });

    expect(processMarkdownToHTML).not.toHaveBeenCalled();
  });

  it('no-ops when content matches lastKnownContent', () => {
    const { editor } = createMockEditor({ initialHtml: '<p>same</p>' });
    const processMarkdownToHTML = vi.fn(async () => '<p>ignored</p>');

    runExternalContentUpdateEffect({
      updateVersion: 2,
      getEditor: () => editor as any,
      getIsInitialized: () => true,
      getIsUserTyping: () => false,
      getCurrentNoteContent: () => 'same-md',
      getLastKnownContent: () => 'same-md',
      setLastKnownContent: vi.fn(),
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
      getIsUpdatingFromExternal: () => false,
      setIsUpdatingFromExternal: vi.fn(),
      getWorkspaceId: () => undefined,
      getNoteId: () => 'note-1',
      getCommentManager: () => null,
      processMarkdownToHTML,
      processHTMLToMarkdown: () => 'x',
      createTextSelection: vi.fn(),
      logger,
    });

    expect(processMarkdownToHTML).not.toHaveBeenCalled();
  });

  it('applies update, flips the external flag, and updates tracking state', async () => {
    vi.useFakeTimers();

    const { editor, getSetContentHtml } = createMockEditor({
      initialHtml: '<p>old<span data-anchor-id="a"></span></p>',
      selectionAnchor: 2,
    });

    let lastKnownContent = 'old-md';
    let hasUserEditedSinceLastSave = true;
    let isUpdatingFromExternal = false;

    const commentManager = {
      reapplyAnchorsForCurrentComments: vi.fn(async () => {}),
    };
    const processMarkdownToHTML = vi.fn(async () => '<p>new</p>');

    const result = runExternalContentUpdateEffect({
      updateVersion: 3,
      getEditor: () => editor as any,
      getIsInitialized: () => true,
      getIsUserTyping: () => false,
      getCurrentNoteContent: () => 'new-md',
      getLastKnownContent: () => lastKnownContent,
      setLastKnownContent: (v) => {
        lastKnownContent = v;
      },
      getHasUserEditedSinceLastSave: () => hasUserEditedSinceLastSave,
      setHasUserEditedSinceLastSave: (v) => {
        hasUserEditedSinceLastSave = v;
      },
      getIsUpdatingFromExternal: () => isUpdatingFromExternal,
      setIsUpdatingFromExternal: (v) => {
        isUpdatingFromExternal = v;
      },
      getWorkspaceId: () => 'workspace-1',
      getNoteId: () => 'note-1',
      getCommentManager: () => commentManager as any,
      processMarkdownToHTML,
      processHTMLToMarkdown: () => 'new-md',
      createTextSelection: vi.fn(() => ({ selection: true })),
      logger,
      workspaceFileVersion: 'editor-1',
    });

    expect(result).toBeInstanceOf(Promise);

    // Advance past the debounce window (150ms) so the processing starts
    await vi.advanceTimersByTimeAsync(200);

    await result;

    // Update happens, reusing the editor's stable image cache-bust token.
    expect(getSetContentHtml()).toBe('<p>new</p>');
    expect(processMarkdownToHTML).toHaveBeenCalledWith('new-md', {
      preserveAnchors: true,
      workspaceId: 'workspace-1',
      workspaceFileVersion: 'editor-1',
    });
    expect(lastKnownContent).toBe('new-md');
    expect(hasUserEditedSinceLastSave).toBe(false);

    // Flag flips to true immediately, then resets after 200ms
    expect(isUpdatingFromExternal).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(isUpdatingFromExternal).toBe(false);

    // Anchors were present, so we attempt to reapply
    expect(commentManager.reapplyAnchorsForCurrentComments).toHaveBeenCalledWith({
      reason: 'external-update',
      updateVersion: 3,
    });
  });

  it('folds keystrokes typed during the 150ms debounce window into the applied text', async () => {
    // The entry-point isUserTyping check passes before the debounce, but a
    // keystroke landing inside the window leaves the editor ahead of
    // lastKnownContent with no save scheduled yet. Applying the incoming text
    // verbatim would drop it; rejecting would let the next save delete the
    // external change. The keystroke is replayed onto the incoming text.
    vi.useFakeTimers();

    const { editor, getSetContentHtml } = createMockEditor({
      initialHtml: '<p>saved</p>',
    });

    let editorMarkdown = 'saved-md';
    let lastKnownContent = 'saved-md';
    let hasUserEditedSinceLastSave = false;
    const processMarkdownToHTML = vi.fn(async () => '<p>server plus typing</p>');

    const result = runExternalContentUpdateEffect({
      updateVersion: 4,
      getEditor: () => editor as any,
      getIsInitialized: () => true,
      getIsUserTyping: () => false,
      getCurrentNoteContent: () => 'server-md',
      getLastKnownContent: () => lastKnownContent,
      setLastKnownContent: (v) => {
        lastKnownContent = v;
      },
      getHasUserEditedSinceLastSave: () => hasUserEditedSinceLastSave,
      setHasUserEditedSinceLastSave: (v) => {
        hasUserEditedSinceLastSave = v;
      },
      getIsUpdatingFromExternal: () => false,
      setIsUpdatingFromExternal: vi.fn(),
      getWorkspaceId: () => undefined,
      getNoteId: () => 'note-1',
      getCommentManager: () => null,
      processMarkdownToHTML,
      processHTMLToMarkdown: () => editorMarkdown,
      createTextSelection: vi.fn(),
      logger,
    });

    hasUserEditedSinceLastSave = true;
    editorMarkdown = 'saved-md plus unsaved typing';

    await vi.advanceTimersByTimeAsync(200);
    await result;

    expect(processMarkdownToHTML).toHaveBeenCalledWith(
      'server-md plus unsaved typing',
      expect.anything(),
    );
    expect(getSetContentHtml()).toBe('<p>server plus typing</p>');
    // The incoming text is the saved baseline; the folded keystroke stays unsaved.
    expect(lastKnownContent).toBe('server-md');
    expect(hasUserEditedSinceLastSave).toBe(true);
  });

  it('flushes the pending save synchronously when dirty and applies the merged text with the selection mapped through the diff', async () => {
    vi.useFakeTimers();

    // "hello world" with the caret after "hello w" (offset 7 → pos 8).
    const oldDoc = docOf('hello world');
    // The daemon merged an agent insertion of "big " before the caret.
    const mergedDoc = docOf('hello big world');
    const { editor, getSetContentHtml } = createMockEditor({
      initialHtml: '<p>hello world</p>',
      selectionAnchor: 8,
      doc: oldDoc,
      nextDoc: mergedDoc,
    });

    let lastKnownContent = 'hello world';
    const flushNoteContent = vi.fn(async () => ({ content: 'hello big world', rev: 4 }));
    const processMarkdownToHTML = vi.fn(async () => '<p>hello big world</p>');
    const createTextSelection = vi.fn(() => ({ selection: true }));

    const result = runExternalContentUpdateEffect({
      updateVersion: 8,
      getEditor: () => editor as any,
      getIsInitialized: () => true,
      getIsUserTyping: () => false,
      getHasPendingNoteContent: () => true,
      flushNoteContent,
      getCurrentNoteContent: () => 'hello world (refetched before the save landed)',
      getLastKnownContent: () => lastKnownContent,
      setLastKnownContent: (v) => {
        lastKnownContent = v;
      },
      getHasUserEditedSinceLastSave: () => true,
      setHasUserEditedSinceLastSave: vi.fn(),
      getIsUpdatingFromExternal: () => false,
      setIsUpdatingFromExternal: vi.fn(),
      getWorkspaceId: () => 'workspace-1',
      getNoteId: () => 'note-1',
      getCommentManager: () => null,
      processMarkdownToHTML,
      processHTMLToMarkdown: () => 'hello world',
      createTextSelection,
      logger,
    });

    // No debounce wait: the flush is issued before any timer fires.
    expect(flushNoteContent).toHaveBeenCalledTimes(1);
    expect(flushNoteContent).toHaveBeenCalledWith('workspace-1', 'note-1');

    await result;

    // The merged result is what lands in the editor — not the stale Redux refetch.
    expect(processMarkdownToHTML).toHaveBeenCalledWith(
      'hello big world',
      expect.objectContaining({ preserveAnchors: true, workspaceId: 'workspace-1' }),
    );
    expect(getSetContentHtml()).toBe('<p>hello big world</p>');
    expect(lastKnownContent).toBe('hello big world');
    // Caret offset 7 shifts by the 4 inserted characters → offset 11 → pos 12.
    expect(createTextSelection).toHaveBeenCalledWith(mergedDoc, 12, 12);
  });

  it('waits for the in-flight save when the flush resolves without content', async () => {
    // hasPendingNoteContent is also true while a save is in flight with nothing
    // debounced; flushNoteContent then resolves undefined. The apply waits for
    // the in-flight save via the recheck poll instead of applying stale Redux.
    vi.useFakeTimers();

    const { editor, getSetContentHtml } = createMockEditor({ initialHtml: '<p>saved</p>' });
    let hasPending = true;
    const onPendingSaveSettled = vi.fn();
    const flushNoteContent = vi.fn(async () => undefined);
    const processMarkdownToHTML = vi.fn(async () => '<p>stale</p>');

    const result = runExternalContentUpdateEffect({
      updateVersion: 9,
      getEditor: () => editor as any,
      getIsInitialized: () => true,
      getIsUserTyping: () => false,
      getHasPendingNoteContent: () => hasPending,
      flushNoteContent,
      onPendingSaveSettled,
      getCurrentNoteContent: () => 'stale-refetched-md',
      getLastKnownContent: () => 'saved-md',
      setLastKnownContent: vi.fn(),
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
      getIsUpdatingFromExternal: () => false,
      setIsUpdatingFromExternal: vi.fn(),
      getWorkspaceId: () => 'workspace-1',
      getNoteId: () => 'note-inflight',
      getCommentManager: () => null,
      processMarkdownToHTML,
      processHTMLToMarkdown: () => 'saved-md',
      createTextSelection: vi.fn(),
      logger,
    });

    await result;
    expect(flushNoteContent).toHaveBeenCalledWith('workspace-1', 'note-inflight');
    expect(processMarkdownToHTML).not.toHaveBeenCalled();
    expect(getSetContentHtml()).toBeNull();

    await vi.advanceTimersByTimeAsync(600);
    expect(onPendingSaveSettled).not.toHaveBeenCalled();

    hasPending = false;
    await vi.advanceTimersByTimeAsync(600);
    expect(onPendingSaveSettled).toHaveBeenCalledTimes(1);
  });

  it('defers at entry when a local save is unflushed and no flush binding is available (monorepo#533)', () => {
    // Regression: after saveEditorContent, the write-service holds the content
    // for 800ms before flushing. A note:updated refetch landing in that window
    // puts pre-save content in Redux; applying it would revert the editor.
    const { editor } = createMockEditor({ initialHtml: '<p>saved</p>' });
    const processMarkdownToHTML = vi.fn(async () => '<p>stale</p>');

    const result = runExternalContentUpdateEffect({
      updateVersion: 5,
      getEditor: () => editor as any,
      getIsInitialized: () => true,
      getIsUserTyping: () => false,
      getHasPendingNoteContent: () => true,
      getCurrentNoteContent: () => 'stale-refetched-md',
      getLastKnownContent: () => 'saved-md',
      setLastKnownContent: vi.fn(),
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
      getIsUpdatingFromExternal: () => false,
      setIsUpdatingFromExternal: vi.fn(),
      getWorkspaceId: () => undefined,
      getNoteId: () => 'note-1',
      getCommentManager: () => null,
      processMarkdownToHTML,
      processHTMLToMarkdown: () => 'saved-md',
      createTextSelection: vi.fn(),
      logger,
    });

    expect(result).toBeUndefined();
    expect(processMarkdownToHTML).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[NoteWithComments] Deferring external effect - pending local save unflushed',
      expect.objectContaining({ noteId: 'note-1', updateVersion: 5 }),
    );
  });

  it('re-queues via onPendingSaveSettled once the pending-save window closes (monorepo#533 dead-end guard)', async () => {
    // If the resolved save leaves the Redux snapshot unchanged, no reactive dep
    // changes and the safety-net dedupe blocks a re-fire — the deferred content
    // would never apply. The scheduled recheck must re-queue exactly once.
    vi.useFakeTimers();

    const { editor } = createMockEditor({ initialHtml: '<p>saved</p>' });

    let hasPending = true;
    const onPendingSaveSettled = vi.fn();

    runExternalContentUpdateEffect({
      updateVersion: 7,
      getEditor: () => editor as any,
      getIsInitialized: () => true,
      getIsUserTyping: () => false,
      getHasPendingNoteContent: () => hasPending,
      onPendingSaveSettled,
      getCurrentNoteContent: () => 'stale-refetched-md',
      getLastKnownContent: () => 'saved-md',
      setLastKnownContent: vi.fn(),
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
      getIsUpdatingFromExternal: () => false,
      setIsUpdatingFromExternal: vi.fn(),
      getWorkspaceId: () => undefined,
      getNoteId: () => 'note-recheck',
      getCommentManager: () => null,
      processMarkdownToHTML: async () => '<p>stale</p>',
      processHTMLToMarkdown: () => 'saved-md',
      createTextSelection: vi.fn(),
      logger,
    });

    // Still pending: the poll keeps waiting without settling.
    await vi.advanceTimersByTimeAsync(600);
    expect(onPendingSaveSettled).not.toHaveBeenCalled();

    // Save acked: the next poll tick fires the re-queue exactly once.
    hasPending = false;
    await vi.advanceTimersByTimeAsync(600);
    expect(onPendingSaveSettled).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onPendingSaveSettled).toHaveBeenCalledTimes(1);
  });

  it('flushes and applies the merged text when a pending save appears during the debounce window (monorepo#533)', async () => {
    vi.useFakeTimers();

    const { editor, getSetContentHtml } = createMockEditor({ initialHtml: '<p>saved</p>' });

    let hasPending = false;
    let lastKnownContent = 'saved-md';
    const flushNoteContent = vi.fn(async () => ({ content: 'merged-md' }));
    const processMarkdownToHTML = vi.fn(async () => '<p>merged</p>');

    const result = runExternalContentUpdateEffect({
      updateVersion: 6,
      getEditor: () => editor as any,
      getIsInitialized: () => true,
      getIsUserTyping: () => false,
      getHasPendingNoteContent: () => hasPending,
      flushNoteContent,
      getCurrentNoteContent: () => 'stale-refetched-md',
      getLastKnownContent: () => lastKnownContent,
      setLastKnownContent: (v) => {
        lastKnownContent = v;
      },
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
      getIsUpdatingFromExternal: () => false,
      setIsUpdatingFromExternal: vi.fn(),
      getWorkspaceId: () => 'workspace-1',
      getNoteId: () => 'note-1',
      getCommentManager: () => null,
      processMarkdownToHTML,
      processHTMLToMarkdown: () => 'saved-md',
      createTextSelection: vi.fn(),
      logger,
    });

    // A keystroke lands inside the 150ms debounce and schedules a save.
    hasPending = true;
    expect(flushNoteContent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    await result;

    expect(flushNoteContent).toHaveBeenCalledWith('workspace-1', 'note-1');
    expect(processMarkdownToHTML).toHaveBeenCalledWith('merged-md', expect.anything());
    expect(getSetContentHtml()).toBe('<p>merged</p>');
    expect(lastKnownContent).toBe('merged-md');
  });
});

describe('foldUnsavedEditsIntoIncoming', () => {
  it('returns the incoming text when the editor matches the saved baseline', () => {
    expect(foldUnsavedEditsIntoIncoming({ base: 'a', incoming: 'ab', ours: 'a' })).toBe('ab');
  });

  it('returns the incoming text when the editor already holds it', () => {
    expect(foldUnsavedEditsIntoIncoming({ base: 'a', incoming: 'ab', ours: 'ab' })).toBe('ab');
  });

  it('replays unsaved keystrokes onto the incoming text', () => {
    expect(
      foldUnsavedEditsIntoIncoming({
        base: 'hello world',
        incoming: 'hello brave world',
        ours: 'hello world!',
      }),
    ).toBe('hello brave world!');
  });
});

describe('shouldRequeueExternalUpdateAfterTypingStops', () => {
  // Regression (monorepo#534): external updates skipped while isUserTyping
  // were never re-queued, and the debounced save then erased the divergence
  // from Redux while the daemon still held the external change.
  it('requeues when Redux content diverged from lastKnownContent', () => {
    expect(
      shouldRequeueExternalUpdateAfterTypingStops({
        reduxContent: 'server grew this',
        lastKnownContent: 'local snapshot',
      }),
    ).toBe(true);
  });

  it('does not requeue when content matches', () => {
    expect(
      shouldRequeueExternalUpdateAfterTypingStops({
        reduxContent: 'same',
        lastKnownContent: 'same',
      }),
    ).toBe(false);
  });

  it('does not requeue when Redux content is undefined (init race)', () => {
    expect(
      shouldRequeueExternalUpdateAfterTypingStops({
        reduxContent: undefined,
        lastKnownContent: '',
      }),
    ).toBe(false);
  });

  it('treats empty-string Redux content as a real divergence', () => {
    expect(
      shouldRequeueExternalUpdateAfterTypingStops({
        reduxContent: '',
        lastKnownContent: 'was not empty',
      }),
    ).toBe(true);
  });
});

describe('shouldIgnoreLocalEditorUpdate', () => {
  // Regression (monorepo#535): debounceUpdate previously early-returned while
  // isUpdatingFromExternal was true — including the fixed 200ms post-apply
  // reset tail — so a real keystroke in that window set neither the edited
  // flag nor a save timer and was lost. Programmatic applies are filtered
  // upstream via the external-update transaction meta, so the only remaining
  // suppression input is initialization.
  it('ignores updates while initializing', () => {
    expect(shouldIgnoreLocalEditorUpdate({ isInitializing: true })).toBe(true);
  });

  it('accepts updates once initialized', () => {
    expect(shouldIgnoreLocalEditorUpdate({ isInitializing: false })).toBe(false);
  });

  it('does not accept isUpdatingFromExternal as an input (keystrokes during the reset tail must not be dropped)', () => {
    expect(
      shouldIgnoreLocalEditorUpdate({
        isInitializing: false,
        isUpdatingFromExternal: true,
      } as Parameters<typeof shouldIgnoreLocalEditorUpdate>[0]),
    ).toBe(false);
  });
});

describe('shouldSafetyNetTrigger', () => {
  const baseArgs = {
    reduxContent: 'new content',
    lastKnownContent: 'old content',
    lastSafetyNetSyncedContent: undefined as string | undefined,
    isInitialized: true,
    isUserTyping: false,
    isUpdatingFromExternal: false,
  };

  it('returns true when Redux content diverges from lastKnownContent (missed CustomEvent path)', () => {
    // Regression: If the CustomEvent never fires but Redux content changed,
    // the safety-net should trigger an update.
    expect(shouldSafetyNetTrigger(baseArgs)).toBe(true);
  });

  it('returns false when reduxContent is undefined (init race)', () => {
    expect(shouldSafetyNetTrigger({ ...baseArgs, reduxContent: undefined })).toBe(false);
  });

  it('returns false when not initialized', () => {
    expect(shouldSafetyNetTrigger({ ...baseArgs, isInitialized: false })).toBe(false);
  });

  it('returns false when user is typing', () => {
    expect(shouldSafetyNetTrigger({ ...baseArgs, isUserTyping: true })).toBe(false);
  });

  it('does not accept hasUserEditedSinceLastSave as an input (guard decides downstream)', () => {
    // Regression (stale-editor incident): hasUserEditedSinceLastSave latches on the
    // first local edit and nothing clears it on save, so gating the safety-net on it
    // permanently disconnected open editors from server-side note growth. The
    // safety-net must still queue the pipeline regardless of local edit history;
    // unsaved edits are flushed and folded into the applied text downstream.
    expect(
      shouldSafetyNetTrigger({
        ...baseArgs,
        hasUserEditedSinceLastSave: true,
      } as Parameters<typeof shouldSafetyNetTrigger>[0]),
    ).toBe(true);
  });

  it('returns false when an external update is in progress', () => {
    expect(shouldSafetyNetTrigger({ ...baseArgs, isUpdatingFromExternal: true })).toBe(false);
  });

  it('returns false when content matches lastKnownContent (no divergence)', () => {
    expect(
      shouldSafetyNetTrigger({
        ...baseArgs,
        reduxContent: 'old content',
        lastKnownContent: 'old content',
      }),
    ).toBe(false);
  });

  it('does not loop when the same content snapshot was already synced (dedupe guard)', () => {
    // Regression: After the safety-net increments externalUpdateVersion for content "X",
    // lastSafetyNetSyncedContent becomes "X". The effect re-runs (because externalUpdateVersion
    // changed), but should NOT trigger again for the same content.
    expect(
      shouldSafetyNetTrigger({
        ...baseArgs,
        reduxContent: 'new content',
        lastSafetyNetSyncedContent: 'new content',
      }),
    ).toBe(false);
  });

  it('treats empty-string content as a real update', () => {
    // Empty string is valid content — the safety-net must not ignore it.
    expect(
      shouldSafetyNetTrigger({
        ...baseArgs,
        reduxContent: '',
        lastKnownContent: 'old content',
        lastSafetyNetSyncedContent: undefined,
      }),
    ).toBe(true);
  });

  it('treats empty-string to empty-string as no divergence', () => {
    expect(
      shouldSafetyNetTrigger({
        ...baseArgs,
        reduxContent: '',
        lastKnownContent: '',
      }),
    ).toBe(false);
  });
});
