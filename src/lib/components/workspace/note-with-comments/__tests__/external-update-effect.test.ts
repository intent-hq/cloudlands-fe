import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

import {
  runExternalContentUpdateEffect,
  shouldIgnoreLocalEditorUpdate,
  shouldRequeueExternalUpdateAfterTypingStops,
  shouldSafetyNetTrigger,
} from '../external-update-effect';

function createMockEditor({
  initialHtml,
  selectionAnchor,
  docSize,
}: {
  initialHtml: string;
  selectionAnchor?: number;
  docSize?: number;
}) {
  const operations: Array<
    { type: 'command'; fn: (ctx: any) => any } | { type: 'setContent'; html: string }
  > = [];
  let setContentHtml: string | null = null;

  const tr = {
    setMeta: vi.fn(),
    setSelection: vi.fn(),
  };

  const doc = {
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
        else setContentHtml = op.html;
      }
    },
  };

  const editor = {
    isDestroyed: false,
    getHTML: vi.fn(() => initialHtml),
    state: {
      selection: {
        anchor: selectionAnchor,
      },
    },
    chain: vi.fn(() => chainObj),
  };

  return {
    editor,
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
      getWorkspaceId: () => undefined,
      getNoteId: () => 'note-1',
      getCommentManager: () => commentManager as any,
      processMarkdownToHTML: async () => '<p>new</p>',
      processHTMLToMarkdown: () => 'new-md',
      createTextSelection: vi.fn(() => ({ selection: true })),
      logger,
    });

    expect(result).toBeInstanceOf(Promise);

    // Advance past the debounce window (150ms) so the processing starts
    await vi.advanceTimersByTimeAsync(200);

    await result;

    // Update happens
    expect(getSetContentHtml()).toBe('<p>new</p>');
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

  it('rejects at apply time when the user types during the 150ms debounce window', async () => {
    // Timing regression guard: the entry-point isUserTyping check passes before the
    // debounce, but the unsaved-edits guard reads getHasUserEditedSinceLastSave()
    // and the editor content fresh at apply time. A keystroke landing inside the
    // debounce window must still block the external apply.
    vi.useFakeTimers();

    const { editor, getSetContentHtml } = createMockEditor({
      initialHtml: '<p>saved</p>',
    });

    let editorMarkdown = 'saved-md';
    let lastKnownContent = 'saved-md';
    let hasUserEditedSinceLastSave = false;

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
      setHasUserEditedSinceLastSave: vi.fn(),
      getIsUpdatingFromExternal: () => false,
      setIsUpdatingFromExternal: vi.fn(),
      getWorkspaceId: () => undefined,
      getNoteId: () => 'note-1',
      getCommentManager: () => null,
      processMarkdownToHTML: async () => '<p>server</p>',
      processHTMLToMarkdown: () => editorMarkdown,
      createTextSelection: vi.fn(),
      logger,
    });

    // Simulate a keystroke arriving inside the debounce window: the flag latches
    // and the editor now differs from both lastKnownContent and the incoming content.
    hasUserEditedSinceLastSave = true;
    editorMarkdown = 'saved-md plus unsaved typing';

    await vi.advanceTimersByTimeAsync(200);
    await result;

    expect(getSetContentHtml()).toBeNull();
    expect(lastKnownContent).toBe('saved-md');
    expect(logger.info).toHaveBeenCalledWith(
      '[NoteWithComments] Rejecting external update - user has unsaved edits',
      expect.objectContaining({ noteId: 'note-1', updateVersion: 4 }),
    );
  });

  it('defers at entry when a local save is unflushed (monorepo#533 flush-window revert)', () => {
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

  it('defers at apply time when a pending save appears during the debounce window (monorepo#533)', async () => {
    vi.useFakeTimers();

    const { editor, getSetContentHtml } = createMockEditor({ initialHtml: '<p>saved</p>' });

    let hasPending = false;
    const setLastKnownContent = vi.fn();

    const result = runExternalContentUpdateEffect({
      updateVersion: 6,
      getEditor: () => editor as any,
      getIsInitialized: () => true,
      getIsUserTyping: () => false,
      getHasPendingNoteContent: () => hasPending,
      getCurrentNoteContent: () => 'stale-refetched-md',
      getLastKnownContent: () => 'saved-md',
      setLastKnownContent,
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
      getIsUpdatingFromExternal: () => false,
      setIsUpdatingFromExternal: vi.fn(),
      getWorkspaceId: () => undefined,
      getNoteId: () => 'note-1',
      getCommentManager: () => null,
      processMarkdownToHTML: async () => '<p>stale</p>',
      processHTMLToMarkdown: () => 'saved-md',
      createTextSelection: vi.fn(),
      logger,
    });

    // A keystroke lands inside the 150ms debounce and schedules a save.
    hasPending = true;

    await vi.advanceTimersByTimeAsync(200);
    await result;

    expect(getSetContentHtml()).toBeNull();
    expect(setLastKnownContent).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[NoteWithComments] Deferring external apply - pending local save appeared during debounce',
      expect.objectContaining({ noteId: 'note-1', updateVersion: 6 }),
    );
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
    // protecting genuinely-unsaved edits is
    // shouldRejectExternalUpdateDueToUnsavedEdits' job.
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
      shouldSafetyNetTrigger({ ...baseArgs, reduxContent: 'old content', lastKnownContent: 'old content' }),
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
