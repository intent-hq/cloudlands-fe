import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runExternalContentUpdateEffect } from '../external-update-effect';

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
