import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  runExternalContentUpdateEffect,
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
});

describe('shouldSafetyNetTrigger', () => {
  const baseArgs = {
    reduxContent: 'new content',
    lastKnownContent: 'old content',
    lastSafetyNetSyncedContent: undefined as string | undefined,
    isInitialized: true,
    isUserTyping: false,
    hasUserEditedSinceLastSave: false,
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

  it('returns false when user has edited since last save', () => {
    expect(shouldSafetyNetTrigger({ ...baseArgs, hasUserEditedSinceLastSave: true })).toBe(false);
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
