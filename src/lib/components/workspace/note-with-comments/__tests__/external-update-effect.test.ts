import { Editor } from '@tiptap/core';
import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
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
      getCurrentNoteContent: () => 'new-md',
      getLastKnownContent: () => 'old-md',
      setLastKnownContent: vi.fn(),
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
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
      getCurrentNoteContent: () => 'same-md',
      getLastKnownContent: () => 'same-md',
      setLastKnownContent: vi.fn(),
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
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

    const commentManager = {
      reapplyAnchorsForCurrentComments: vi.fn(async () => {}),
    };
    const processMarkdownToHTML = vi.fn(async () => '<p>new</p>');

    const result = runExternalContentUpdateEffect({
      updateVersion: 3,
      getEditor: () => editor as any,
      getIsInitialized: () => true,
      getCurrentNoteContent: () => 'new-md',
      getLastKnownContent: () => lastKnownContent,
      setLastKnownContent: (v) => {
        lastKnownContent = v;
      },
      getHasUserEditedSinceLastSave: () => hasUserEditedSinceLastSave,
      setHasUserEditedSinceLastSave: (v) => {
        hasUserEditedSinceLastSave = v;
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
      getCurrentNoteContent: () => 'server-md',
      getLastKnownContent: () => lastKnownContent,
      setLastKnownContent: (v) => {
        lastKnownContent = v;
      },
      getHasUserEditedSinceLastSave: () => hasUserEditedSinceLastSave,
      setHasUserEditedSinceLastSave: (v) => {
        hasUserEditedSinceLastSave = v;
      },
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
      getHasPendingNoteContent: () => true,
      flushNoteContent,
      getCurrentNoteContent: () => 'hello world (refetched before the save landed)',
      getLastKnownContent: () => lastKnownContent,
      setLastKnownContent: (v) => {
        lastKnownContent = v;
      },
      getHasUserEditedSinceLastSave: () => true,
      setHasUserEditedSinceLastSave: vi.fn(),
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
      getHasPendingNoteContent: () => hasPending,
      flushNoteContent,
      onPendingSaveSettled,
      getCurrentNoteContent: () => 'stale-refetched-md',
      getLastKnownContent: () => 'saved-md',
      setLastKnownContent: vi.fn(),
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
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
      getHasPendingNoteContent: () => true,
      getCurrentNoteContent: () => 'stale-refetched-md',
      getLastKnownContent: () => 'saved-md',
      setLastKnownContent: vi.fn(),
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
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
      getHasPendingNoteContent: () => hasPending,
      onPendingSaveSettled,
      getCurrentNoteContent: () => 'stale-refetched-md',
      getLastKnownContent: () => 'saved-md',
      setLastKnownContent: vi.fn(),
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
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
      getHasPendingNoteContent: () => hasPending,
      flushNoteContent,
      getCurrentNoteContent: () => 'stale-refetched-md',
      getLastKnownContent: () => lastKnownContent,
      setLastKnownContent: (v) => {
        lastKnownContent = v;
      },
      getHasUserEditedSinceLastSave: () => false,
      setHasUserEditedSinceLastSave: vi.fn(),
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

// Real TipTap editor, production selection wiring (no createTextSelection
// injected): these cover what the mock-editor suites above stub away.
describe('external-update-effect with a real editor', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const editors: Editor[] = [];
  let serial = 0;

  const html = (text: string) => `<p>${text}</p>`;

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  function typeAtEnd(editor: Editor, text: string) {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, text);
  }

  function setup({ ours, incoming, merged }: { ours: string; incoming: string; merged?: string }) {
    const editor = new Editor({ extensions: [StarterKit], content: html(ours) });
    editors.push(editor);
    const state = { last: ours, current: incoming, edited: true, restorePending: false };
    // Mirrors editor-config's onUpdate → debounceUpdate: every transaction not
    // marked as an external apply is user input and sets the edited flag.
    editor.on('update', ({ transaction }) => {
      if (!transaction.getMeta('external-update')) state.edited = true;
    });
    const args = {
      updateVersion: ++serial,
      getEditor: () => editor,
      getIsInitialized: () => true,
      getHasPendingNoteContent: () => merged !== undefined,
      flushNoteContent: vi.fn(async () =>
        merged === undefined ? undefined : { content: merged, rev: 6 },
      ),
      getCurrentNoteContent: () => state.current,
      getLastKnownContent: () => state.last,
      setLastKnownContent: (v: string) => {
        state.last = v;
      },
      getHasUserEditedSinceLastSave: () => state.edited,
      setHasUserEditedSinceLastSave: (v: boolean) => {
        state.edited = v;
      },
      getIsRestorePending: () => state.restorePending,
      setIsRestorePending: (v: boolean) => {
        state.restorePending = v;
      },
      getWorkspaceId: () => 'workspace-1',
      getNoteId: () => `note-${serial}`,
      getCommentManager: () => null,
      processMarkdownToHTML: vi.fn(async (text: string) => html(text)),
      processHTMLToMarkdown: () => editor.getText(),
      logger,
    };
    return { editor, args, state };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('flushes the dirty editor without a debounce wait and maps the caret through the merge with the production selection wiring', async () => {
    const { editor, args, state } = setup({
      ours: 'base one',
      incoming: 'agent base',
      merged: 'agent base one',
    });
    // Caret after "base on" (offset 7 → pos 8).
    editor.commands.setTextSelection(8);

    const completion = runExternalContentUpdateEffect(args);
    expect(args.flushNoteContent).toHaveBeenCalledTimes(1);
    expect(args.processMarkdownToHTML).not.toHaveBeenCalled();
    await completion;

    expect(editor.getText()).toBe('agent base one');
    expect(state.last).toBe('agent base one');
    // Regression: an unbound TextSelection.create threw "this is not a
    // constructor" inside the apply and the caret fell to the end (pos 15).
    expect(logger.debug).not.toHaveBeenCalledWith(
      '[NoteWithComments] Could not restore cursor position',
      expect.anything(),
    );
    expect(editor.state.selection.anchor).toBe(14);
    expect(state.edited).toBe(false);
  });

  it('stages keystrokes still on the component save debounce before flushing', async () => {
    const { args } = setup({ ours: 'base one', incoming: 'agent base', merged: 'agent base one' });
    const order: string[] = [];
    const stageUnsavedEdits = vi.fn(() => order.push('stage'));
    args.flushNoteContent.mockImplementation(async () => {
      order.push('flush');
      return { content: 'agent base one', rev: 6 };
    });

    await runExternalContentUpdateEffect({ ...args, stageUnsavedEdits });

    expect(order).toEqual(['stage', 'flush']);
  });

  it('does not stage while a whole-document replacement (restore) is pending', async () => {
    const { args, state } = setup({ ours: 'base one unsaved', incoming: 'restored' });
    state.restorePending = true;
    const stageUnsavedEdits = vi.fn();

    const completion = runExternalContentUpdateEffect({ ...args, stageUnsavedEdits });
    await vi.advanceTimersByTimeAsync(150);
    await completion;

    expect(stageUnsavedEdits).not.toHaveBeenCalled();
    expect(args.flushNoteContent).not.toHaveBeenCalled();
  });

  it('keeps a keystroke typed while the merged markdown is being rendered', async () => {
    const { editor, args } = setup({
      ours: 'base one',
      incoming: 'agent base',
      merged: 'agent base one',
    });
    const firstRender = deferred<string>();
    args.processMarkdownToHTML.mockImplementation(async (text: string) =>
      text === 'agent base one' ? firstRender.promise : html(text),
    );

    const completion = runExternalContentUpdateEffect(args);
    await Promise.resolve();
    await Promise.resolve();
    expect(args.processMarkdownToHTML).toHaveBeenCalledTimes(1);

    typeAtEnd(editor, ' two');
    firstRender.resolve(html('agent base one'));
    await completion;

    // The stale HTML was not applied over the keystroke: the fold re-ran and
    // the folded text was rendered.
    expect(args.processMarkdownToHTML).toHaveBeenLastCalledWith(
      'agent base one two',
      expect.anything(),
    );
    expect(editor.getText()).toBe('agent base one two');
  });

  it('drops an older render that resolves after a newer external update was applied', async () => {
    const { editor, args, state } = setup({ ours: 'base', incoming: 'first base' });
    const firstRender = deferred<string>();
    args.processMarkdownToHTML.mockImplementation(async (text: string) =>
      text === 'first base' ? firstRender.promise : html(text),
    );

    const olderApply = runExternalContentUpdateEffect(args);
    await vi.advanceTimersByTimeAsync(150);

    state.current = 'newest base';
    const newerApply = runExternalContentUpdateEffect({
      ...args,
      updateVersion: args.updateVersion + 1,
    });
    await vi.advanceTimersByTimeAsync(150);
    await newerApply;
    expect(editor.getText()).toBe('newest base');

    firstRender.resolve(html('first base'));
    await olderApply;

    expect(editor.getText()).toBe('newest base');
    expect(state.last).toBe('newest base');
  });

  it('applies an explicit restore as a whole-document replacement with a valid cursor and clears the pending restore', async () => {
    const { editor, args, state } = setup({ ours: 'base one unsaved', incoming: 'restored' });
    state.restorePending = true;
    editor.commands.setTextSelection(10);

    const completion = runExternalContentUpdateEffect(args);
    await vi.advanceTimersByTimeAsync(150);
    await completion;

    expect(editor.getText()).toBe('restored');
    expect(editor.state.doc.resolve(editor.state.selection.anchor).parent.inlineContent).toBe(true);
    // Consumed by the apply itself, not by a timer.
    expect(state.restorePending).toBe(false);
  });

  // Regression (verifier, production component + TipTap): an agent writing
  // twice in a row is a normal burst, and a keystroke landing between the two
  // applies was erased by the second one — the fold was gated on a flag that
  // a 200ms timer cleared after every apply, so input in that tail was
  // treated as part of the apply. Input is now recognised per transaction
  // (unmarked = user), so the keystroke is staged, flushed and merged no
  // matter when it lands relative to an apply.
  it.each([10, 100])(
    'keeps a keystroke typed %i ms after an apply when a second external update arrived at +25 ms',
    async (keystrokeAtMs) => {
      const { editor, args, state } = setup({ ours: 'base', incoming: 'agent base' });
      state.edited = false;
      let pending = false;
      let staged = '';
      const flushedDrafts: string[] = [];
      const bindings = {
        ...args,
        getHasPendingNoteContent: () => pending,
        // Component's stageUnsavedEdits → saveEditorContent: the editor text
        // becomes lastKnownContent and a save is queued in the write-service.
        stageUnsavedEdits: () => {
          staged = editor.getText();
          state.last = staged;
          pending = true;
        },
        // The daemon merges the flushed draft with the second update.
        flushNoteContent: vi.fn(async () => {
          pending = false;
          flushedDrafts.push(staged);
          return { content: 'agentX base second', rev: 7 };
        }),
      };

      const firstApply = runExternalContentUpdateEffect(bindings);
      await vi.advanceTimersByTimeAsync(150);
      await firstApply;
      expect(editor.getText()).toBe('agent base');
      expect(state.edited).toBe(false);

      let secondApply: Promise<void> | void;
      const events: Array<[number, () => void]> = [
        [
          25,
          () => {
            state.current = 'agent base second';
            secondApply = runExternalContentUpdateEffect({
              ...bindings,
              updateVersion: args.updateVersion + 1,
            });
          },
        ],
        // Caret after "agent" (offset 5 → pos 6).
        [keystrokeAtMs, () => editor.commands.insertContentAt(6, 'X')],
      ];
      events.sort((a, b) => a[0] - b[0]);
      let now = 0;
      for (const [at, run] of events) {
        await vi.advanceTimersByTimeAsync(at - now);
        now = at;
        run();
      }
      expect(editor.getText()).toBe('agentX base');

      await vi.advanceTimersByTimeAsync(200);
      await secondApply;

      expect(editor.getText()).toBe('agentX base second');
      expect(flushedDrafts).toEqual(['agentX base']);
      expect(state.last).toBe('agentX base second');
      expect(state.edited).toBe(false);
    },
  );
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

  it('does not accept isUserTyping as an input (a dirty editor is flushed, not waited on)', () => {
    // Gating on typing let active typing hold off the flush indefinitely: the
    // pipeline flushes the dirty editor now and folds keystrokes into the apply.
    expect(
      shouldSafetyNetTrigger({
        ...baseArgs,
        isUserTyping: true,
      } as Parameters<typeof shouldSafetyNetTrigger>[0]),
    ).toBe(true);
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

  it('does not accept isUpdatingFromExternal as an input (a divergence during an apply is still queued)', () => {
    // The timer-cleared flag left a wall-clock window in which a second
    // external update was never re-queued; superseded updates are handled by
    // the pipeline's debounce and apply generation instead.
    expect(
      shouldSafetyNetTrigger({
        ...baseArgs,
        isUpdatingFromExternal: true,
      } as Parameters<typeof shouldSafetyNetTrigger>[0]),
    ).toBe(true);
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
