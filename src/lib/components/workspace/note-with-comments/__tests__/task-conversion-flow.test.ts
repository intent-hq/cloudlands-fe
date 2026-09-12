/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Note } from '$shared/types';
import { ContentType, NoteVisibility } from '$shared/types';
import {
  flushNoteContent,
  hasPendingNoteContent,
  updateNoteContent,
} from '$features/notes/notes-write-service';

const {
  mockInvoke,
  mockLogger,
  constantReadable,
  currentNoteReadable,
  notesVersionReadable,
  resetNotes,
  replaceNotes,
  selectCurrentNote,
  getNoteById,
  mockSelectorStore,
  mockProcessMarkdownToHTML,
  mockApplyExternalUpdateHtml,
  mockMaybeCreateCommentManagerV2,
  deferMarkdownConversion,
  takeDeferredMarkdownConversion,
  resetDeferredMarkdownConversions,
  editorWorkspaceIds,
} = vi.hoisted(() => {
  const mockDispatch = vi.fn();
  const mockInvoke = vi.fn();
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const mockProcessMarkdownToHTML = vi.fn();
  const mockApplyExternalUpdateHtml = vi.fn();
  const mockMaybeCreateCommentManagerV2 = vi.fn(async () => null);
  const deferredMarkdownConversions = new Map<
    string,
    Array<{ promise: Promise<string>; resolve: (html: string) => void }>
  >();
  const editorWorkspaceIds: string[] = [];

  const deferMarkdownConversion = (markdown: string) => {
    let resolve!: (html: string) => void;
    const promise = new Promise<string>((resolvePromise) => {
      resolve = resolvePromise;
    });
    const pending = { promise, resolve };
    const queue = deferredMarkdownConversions.get(markdown) ?? [];
    queue.push(pending);
    deferredMarkdownConversions.set(markdown, queue);
    return pending;
  };

  const takeDeferredMarkdownConversion = (markdown: string) => {
    const queue = deferredMarkdownConversions.get(markdown);
    const pending = queue?.shift();
    if (queue?.length === 0) deferredMarkdownConversions.delete(markdown);
    return pending;
  };

  const state = {
    currentNoteId: 'spec',
    notesVersion: 0,
    notesById: {} as Record<string, any>,
  };

  const currentNoteSubscribers = new Set<(value: any) => void>();
  const notesVersionSubscribers = new Set<(value: number) => void>();

  const emitCurrentNote = () => {
    const note = state.notesById[state.currentNoteId];
    currentNoteSubscribers.forEach((subscriber) => subscriber(note));
  };

  const emitNotesVersion = () => {
    notesVersionSubscribers.forEach((subscriber) => subscriber(state.notesVersion));
  };

  const currentNoteReadable = {
    subscribe(subscriber: (value: any) => void) {
      currentNoteSubscribers.add(subscriber);
      subscriber(state.notesById[state.currentNoteId]);
      return () => currentNoteSubscribers.delete(subscriber);
    },
  };

  const notesVersionReadable = {
    subscribe(subscriber: (value: number) => void) {
      notesVersionSubscribers.add(subscriber);
      subscriber(state.notesVersion);
      return () => notesVersionSubscribers.delete(subscriber);
    },
  };

  const constantReadable = (value: any) => ({
    subscribe(subscriber: (currentValue: any) => void) {
      subscriber(value);
      return () => {};
    },
  });

  const mockSelectorStore = {
    createSelector: (selectorFunc: (...args: any[]) => any) => {
      const readableSelector = Object.assign(() => constantReadable(undefined), {
        select: (state: any, ...args: any[]) => selectorFunc(state, ...args),
        effect: (...args: any[]) => selectorFunc({}, ...args),
        withStore: () => constantReadable(undefined),
      });
      return readableSelector;
    },
    dispatch: mockDispatch,
    state: {},
  };

  return {
    mockDispatch,
    mockInvoke,
    mockLogger,
    constantReadable,
    currentNoteReadable,
    notesVersionReadable,
    resetNotes() {
      state.currentNoteId = 'spec';
      state.notesById = {};
      state.notesVersion = 0;
      emitCurrentNote();
      emitNotesVersion();
    },
    replaceNotes(notes: any[]) {
      state.notesById = Object.fromEntries(notes.map((note) => [note.id, note]));
      state.notesVersion += 1;
      emitCurrentNote();
      emitNotesVersion();
    },
    selectCurrentNote(noteId: string) {
      state.currentNoteId = noteId;
      emitCurrentNote();
    },
    getNoteById(noteId: string) {
      return state.notesById[noteId];
    },
    mockSelectorStore,
    mockProcessMarkdownToHTML,
    mockApplyExternalUpdateHtml,
    mockMaybeCreateCommentManagerV2,
    deferMarkdownConversion,
    takeDeferredMarkdownConversion,
    resetDeferredMarkdownConversions() {
      deferredMarkdownConversions.clear();
    },
    editorWorkspaceIds,
  };
});

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faSearch: { iconName: 'search' },
  faTimes: { iconName: 'times' },
  faChevronUp: { iconName: 'chevron-up' },
  faChevronDown: { iconName: 'chevron-down' },
  faPlay: { iconName: 'play' },
  faLinkSlash: { iconName: 'link-slash' },
  faListCheck: { iconName: 'list-check' },
}));

vi.mock('$lib/components/ui/tooltip', async () => {
  const SlotOnly = (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default;
  return { Tooltip: SlotOnly };
});

vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const Button = (await import('$lib/components/ui/__tests__/mocks/button.svelte')).default;
  return { default: Button };
});

vi.mock('$lib/components/ui/skeleton', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { Skeleton: MockSimple };
});

vi.mock('$lib/components/tiptap/BubbleMenu.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/components/tiptap/CommentDialog.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/components/tiptap/CommentsSidebar.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/components/tiptap/LineAttributionGutter.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/components/tiptap/SuggestionTooltip.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/components/tiptap/TaskMenu.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/components/workspace/NoteVersionHistory.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/components/workspace/NoteMetadataBar.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/components/workspace/NoteCodeChangesCard.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/components/editor/CodeEditor.svelte', async () => ({
  default: (await import('$features/layout/tab-types/__tests__/mocks/MockCodeEditor.svelte'))
    .default,
}));

vi.mock('$lib/components/tiptap/TaskAgentStatus.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/components/tiptap/TaskNotePreview.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/components/tiptap/TaskStatusIcon.svelte', async () => {
  const MockSimple = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default;
  return { default: MockSimple };
});

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => mockLogger,
  logger: mockLogger,
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: mockInvoke,
}));

vi.mock('$store/renderer/store', async () => {
  const { createStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createStoreMockModule(mockSelectorStore);
});

vi.mock('$store/renderer/configured-store', () => ({
  store: mockSelectorStore,
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: Object.assign(() => currentNoteReadable, {
    select: (_state: any, _workspaceId: string, noteId: string) => getNoteById(noteId),
  }),
  selectNewlyCreatedNoteId: {
    select: () => null,
  },
  selectSelectedNoteId: Object.assign(() => constantReadable('spec'), {
    select: () => 'spec',
  }),
  selectNotesVersion: () => notesVersionReadable,
  selectWorkspaceNotesState: () => constantReadable({ initialized: true }),
}));

vi.mock('$store/renderer/slices/comments/comments-selectors', () => ({
  selectComments: Object.assign(() => constantReadable([]), {
    select: () => [],
  }),
  selectCommentById: {
    select: () => null,
  },
}));

vi.mock('$store/renderer/slices/comments/comments-slice', () => ({
  selectCommentAction: vi.fn((commentId: string) => ({
    type: 'comments/selectComment',
    payload: commentId,
  })),
  updateCommentAction: vi.fn((commentId: string, update: Record<string, unknown>) => ({
    type: 'comments/updateComment',
    payload: { commentId, update },
  })),
  clearCommentsAction: vi.fn(() => ({
    type: 'comments/clearComments',
  })),
}));

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectNoteFontStyle: () => constantReadable('sans'),
  selectSpellcheckEnabled: () => constantReadable(true),
}));

vi.mock('$store/renderer/slices/workspace-navigation/workspace-navigation-selectors', () => ({
  selectWorkspaceNavigationHistory: {
    select: () => ({ history: [], currentIndex: -1 }),
  },
}));

vi.mock('$features/notes/notes-write-service', () => ({
  updateNoteContent: vi.fn(),
  hasPendingNoteContent: vi.fn(() => false),
  flushNoteContent: vi.fn(async () => undefined),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-slice', () => ({
  restoreNoteVersion: vi.fn((workspaceId: string, noteId: string, versionId: string) => ({
    type: 'workspaceNotes/restoreNoteVersion',
    payload: { workspaceId, noteId, versionId },
  })),
  clearNewlyCreatedNoteId: vi.fn((workspaceId: string) => ({
    type: 'workspaceNotes/clearNewlyCreatedNoteId',
    payload: { workspaceId },
  })),
}));

vi.mock('$store/renderer/slices/transient-ui/transient-ui-selectors', () => ({
  selectIsRawNoteViewEnabled: () => constantReadable(false),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToNote: vi.fn(),
}));

vi.mock('$lib/utils/editor-listeners', () => ({
  setupEditorListeners: () => () => {},
}));

vi.mock('$lib/utils/markdown-processor', async () => {
  const actual = await vi.importActual<typeof import('$lib/utils/markdown-processor')>(
    '$lib/utils/markdown-processor',
  );
  mockProcessMarkdownToHTML.mockImplementation((markdown: string, options: any) => {
    return (
      takeDeferredMarkdownConversion(markdown)?.promise ??
      actual.processMarkdownToHTML(markdown, options)
    );
  });
  return { ...actual, processMarkdownToHTML: mockProcessMarkdownToHTML };
});

vi.mock('$lib/components/tiptap/CommentDecorations', () => ({
  updateCommentDecorations: vi.fn(),
}));

vi.mock('../task-agent-status-mount-manager', () => ({
  createTaskAgentStatusMountManager: () => ({
    start: vi.fn(),
    destroy: vi.fn(),
  }),
}));

vi.mock('../task-menu-assign-agent-action', () => ({
  runAssignAgentTaskMenuAction: vi.fn(),
}));

vi.mock('../task-menu-task-breakdown-action', () => ({
  runTaskBreakdownTaskMenuAction: vi.fn(),
}));

vi.mock('../image-upload-handlers', () => ({
  createImagePasteHandler: () => vi.fn(),
  createImageDropHandler: () => vi.fn(),
}));

vi.mock('../task-menu-popover-discovery', () => ({
  discoverTaskMenuPopovers: () => [],
}));

vi.mock('../task-item-utils', () => ({
  getTaskAssociationKeysInEditor: vi.fn(() => []),
  getTaskTextsInEditor: vi.fn(() => []),
  removeAgentFromTasks: vi.fn(),
  restoreTaskAgentAssociations: vi.fn(),
}));

vi.mock('../note-scroll-handlers', () => ({
  createScrollToHeadingHandler: () => vi.fn(),
  createScrollToTaskHandler: () => vi.fn(),
}));

vi.mock('../comment-manager-lifecycle', () => ({
  maybeCreateCommentManagerV2: mockMaybeCreateCommentManagerV2,
  destroyAndClearCommentManagerV2: vi.fn(() => null),
}));

vi.mock('../external-update-editor', async () => {
  const actual = await vi.importActual<typeof import('../external-update-editor')>(
    '../external-update-editor',
  );
  mockApplyExternalUpdateHtml.mockImplementation(
    actual.applyExternalUpdateHtmlToEditorPreservingCursor,
  );
  return {
    ...actual,
    applyExternalUpdateHtmlToEditorPreservingCursor: mockApplyExternalUpdateHtml,
  };
});

vi.mock('../comment-manager-content-change-handlers', () => ({
  createOnCommentManagerContentChangedAfterAnchorInsertion: vi.fn(() => vi.fn()),
  createOnCommentManagerContentChangedUpdateLastKnownContent: vi.fn(() => vi.fn()),
}));

vi.mock('../comment-mark-click-handler', () => ({
  setupCommentMarkClickHandlerV2: vi.fn(() => null),
}));

vi.mock('$lib/utils/editor-config', async () => {
  const StarterKit = (await import('@tiptap/starter-kit')).default;
  const Image = (await import('@tiptap/extension-image')).default;
  const TaskList = (await import('@tiptap/extension-task-list')).default;
  const { CustomTaskItem } = await import('$lib/components/tiptap/CustomTaskItem');
  const { createWorkspacesLink } = await import('$lib/utils/tiptap-link-extension');

  return {
    createEditorConfig: ({ element, content, editable, onUpdate, workspace }: any) => {
      editorWorkspaceIds.push(workspace?.id ?? '');
      return {
        element,
        content,
        editable,
        extensions: [
          StarterKit.configure({
            link: false,
          }),
          createWorkspacesLink({ openOnClick: false }),
          Image,
          TaskList,
          CustomTaskItem.configure({
            nested: true,
            workspaceId: workspace?.id,
            taskListTypeName: 'taskList',
          }),
        ],
        onUpdate: ({ editor }: { editor: { getHTML: () => string } }) => {
          onUpdate(editor.getHTML());
        },
      };
    },
  };
});

import NoteWithComments from '../../NoteWithComments.svelte';

const WORKSPACE_ID = 'ws-1';
const SPEC_NOTE_ID = 'spec';
const TASK_NOTE_ID = 'task-note-123';

function createNote(
  id: string,
  title: string,
  content: string,
  overrides: Partial<Note> = {},
): Note {
  return {
    id: id as Note['id'],
    workspaceId: WORKSPACE_ID as Note['workspaceId'],
    title,
    content,
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Private,
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('NoteWithComments task conversion regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNotes();
    resetDeferredMarkdownConversions();
    editorWorkspaceIds.length = 0;

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    resetNotes();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  async function renderInitializedNote(noteId = 'baseline', content = 'Baseline content') {
    const view = render(NoteWithComments, {
      props: {
        workspace: {
          id: WORKSPACE_ID,
          name: 'Workspace',
          path: '/tmp/workspace',
          createdAt: '2026-04-14T00:00:00.000Z',
        } as any,
        noteId,
        content,
        editable: true,
        showSuggestions: false,
        showComments: true,
      },
    });

    await waitFor(() => {
      expect(view.container.querySelector('.ProseMirror')).toBeTruthy();
    });

    return view;
  }

  async function flushConversionCompletion() {
    await Promise.resolve();
    await Promise.resolve();
    await tick();
  }

  it('keeps the newest note when conversions complete in reverse order', async () => {
    const view = await renderInitializedNote();
    const editorElement = view.container.querySelector('.ProseMirror') as HTMLElement;
    editorElement.focus();
    mockApplyExternalUpdateHtml.mockClear();
    mockMaybeCreateCommentManagerV2.mockClear();
    vi.useFakeTimers();

    const noteAConversion = deferMarkdownConversion('Note A content');
    const noteBConversion = deferMarkdownConversion('Note B content');

    await view.rerender({
      workspace: { id: WORKSPACE_ID } as any,
      noteId: 'note-a',
      content: 'Note A content',
      editable: true,
      showSuggestions: false,
      showComments: true,
    });
    await tick();

    await view.rerender({
      workspace: { id: WORKSPACE_ID } as any,
      noteId: 'note-b',
      content: 'Note B content',
      editable: true,
      showSuggestions: false,
      showComments: true,
    });
    await tick();

    noteBConversion.resolve('<p>Note B converted</p>');
    await flushConversionCompletion();
    expect(editorElement.innerHTML).toContain('Note B converted');
    expect(document.activeElement).toBe(editorElement);

    noteAConversion.resolve('<p>Note A converted</p>');
    await flushConversionCompletion();

    expect(editorElement.innerHTML).toContain('Note B converted');
    expect(editorElement.innerHTML).not.toContain('Note A converted');
    expect(document.activeElement).toBe(editorElement);
    expect(mockApplyExternalUpdateHtml).toHaveBeenCalledTimes(1);
    expect(mockMaybeCreateCommentManagerV2).toHaveBeenCalledTimes(1);
    expect(mockMaybeCreateCommentManagerV2).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: 'note-b' }),
    );
  });

  // Regression (verifier, production component + TipTap): an agent writing
  // twice in a row is a normal burst, and a keystroke typed between the two
  // applies was erased by the second one — the fold was gated on a flag that a
  // 200ms timer cleared after every apply. Input is recognised per transaction
  // now, so the keystroke is staged, flushed and merged whenever it lands.
  describe('keystrokes between two external applies', () => {
    async function renderAppliedNote() {
      replaceNotes([createNote('spec', 'Spec', 'base')]);
      const view = await renderInitializedNote('spec', 'base');
      const editor = (view.container.querySelector('.ProseMirror') as any).editor;
      await waitFor(() => expect(editor.getText()).toBe('base'));
      vi.useFakeTimers();
      // Past the initialisation tail and the typing/save debounces.
      await vi.advanceTimersByTimeAsync(1200);
      return editor;
    }

    async function applyExternal(text: string, rev: number) {
      replaceNotes([createNote('spec', 'Spec', text, { rev } as Partial<Note>)]);
      await tick();
    }

    // Write-service model: a staged draft is pending until flushed; the flush
    // returns the daemon's merge of the draft with the newer note.
    function modelWriteService() {
      let pending = false;
      let draft = '';
      const flushed: string[] = [];
      vi.mocked(updateNoteContent).mockImplementation((_ws, _id, text) => {
        pending = true;
        draft = text;
      });
      vi.mocked(hasPendingNoteContent).mockImplementation(() => pending);
      vi.mocked(flushNoteContent).mockImplementation(async () => {
        pending = false;
        flushed.push(draft);
        const merged = `${draft} second`;
        await applyExternal(merged, 7);
        return { content: merged, rev: 7 };
      });
      return { flushed };
    }

    it.each([10, 25, 49, 100, 199])(
      'keeps a keystroke typed %i ms after an apply when the next update arrives with it',
      async (delay) => {
        const editor = await renderAppliedNote();
        const { flushed } = modelWriteService();

        await applyExternal('agent base', 5);
        await vi.advanceTimersByTimeAsync(150);
        expect(editor.getText()).toBe('agent base');

        await vi.advanceTimersByTimeAsync(delay);
        editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' X');
        expect(editor.getText()).toBe('agent base X');
        await applyExternal('agent base second', 6);
        await vi.advanceTimersByTimeAsync(160);

        expect(editor.getText()).toBe('agent base X second');
        expect(flushed).toEqual(['agent base X']);
      },
    );

    it('keeps a keystroke typed 100 ms after an apply when a second update arrived at +25 ms', async () => {
      const editor = await renderAppliedNote();
      const { flushed } = modelWriteService();

      await applyExternal('agent base', 5);
      await vi.advanceTimersByTimeAsync(150);
      expect(editor.getText()).toBe('agent base');

      await vi.advanceTimersByTimeAsync(25);
      await applyExternal('agent base second', 6);
      await vi.advanceTimersByTimeAsync(75);
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' X');
      expect(editor.getText()).toBe('agent base X');
      await vi.advanceTimersByTimeAsync(75 + 1100);

      expect(editor.getText()).toBe('agent base X second');
      expect(flushed).toEqual(['agent base X']);
    });

    it('folds and re-saves a keystroke when staging it queued nothing in the write-service', async () => {
      const editor = await renderAppliedNote();
      vi.mocked(updateNoteContent).mockImplementation(() => undefined);
      vi.mocked(hasPendingNoteContent).mockReturnValue(false);

      await applyExternal('agent base', 5);
      await vi.advanceTimersByTimeAsync(150);
      expect(editor.getText()).toBe('agent base');

      await vi.advanceTimersByTimeAsync(25);
      await applyExternal('agent base second', 6);
      await vi.advanceTimersByTimeAsync(75);
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' X');
      vi.mocked(updateNoteContent).mockClear();
      await vi.advanceTimersByTimeAsync(75);

      expect(editor.getText()).toBe('agent base X second');

      await vi.advanceTimersByTimeAsync(1100);
      const saved = vi.mocked(updateNoteContent).mock.calls.map((call) => call[2]);
      expect(saved.at(-1)).toBe('agent base X second');
    });
  });

  // Regression (verified live on a real stack): the editor loaded rev 4, the
  // user typed continuously, an agent's note.add landed rev 5 in the store
  // through the refetch, and only then was the draft staged for the first
  // time. Staging claimed the store's rev 5 for text derived from rev 4, so
  // the daemon saw no staleness, wrote the draft verbatim and the agent's
  // block was gone from every later revision. The first staging must name
  // the rev the editor text was derived from.
  describe('draft base revision', () => {
    /**
     * Daemon model behind the mocked write-service (the service's own
     * contract — first staging fixes the chain's base, immediate or 800 ms
     * debounced flush — is modelled; the real service is covered in
     * notes-write-service.test.ts). `expectedVersion === rev` writes the draft
     * verbatim; a stale rev three-way merges it from that rev's text (results
     * per the production `three_way_merge` oracle).
     */
    function modelExactWriteDaemon(content: string, rev: number) {
      const daemon = { content, rev, history: new Map([[rev, content]]) };
      const staleRevMerge: Record<string, string> = {
        'base x1 x2': 'agent base x1 x2',
      };
      const sent: Array<{ text: string; expectedVersion?: number }> = [];
      let pending: { text: string; baseRev?: number } | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const flush = async () => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (!pending) return undefined;
        const { text, baseRev } = pending;
        pending = null;
        sent.push({ text, expectedVersion: baseRev });
        let merged = text;
        if (baseRev !== daemon.rev) {
          const staleMerge = staleRevMerge[text];
          if (staleMerge === undefined) {
            throw new Error(`no merge modelled for stale-rev write of ${JSON.stringify(text)}`);
          }
          merged = staleMerge;
        }
        daemon.rev += 1;
        daemon.content = merged;
        daemon.history.set(daemon.rev, merged);
        await applyExternal(merged, daemon.rev);
        return { content: merged, rev: daemon.rev };
      };

      vi.mocked(updateNoteContent).mockImplementation((_ws, _id, text, options) => {
        pending = pending
          ? { ...pending, text }
          : { text, baseRev: options?.baseRev ?? getNoteById('spec')?.rev };
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void flush(), options?.immediate ? 0 : 800);
      });
      vi.mocked(hasPendingNoteContent).mockImplementation(() => pending !== null);
      vi.mocked(flushNoteContent).mockImplementation(flush);

      const agentWrites = async (text: string) => {
        daemon.rev += 1;
        daemon.content = text;
        daemon.history.set(daemon.rev, text);
        await applyExternal(text, daemon.rev);
      };
      return { daemon, sent, agentWrites };
    }

    async function applyExternal(text: string, rev: number) {
      replaceNotes([createNote('spec', 'Spec', text, { rev } as Partial<Note>)]);
      await tick();
    }

    it('names the loaded rev, not the refetched rev, when typing is staged by an agent update', async () => {
      replaceNotes([createNote('spec', 'Spec', 'base', { rev: 4 } as Partial<Note>)]);
      const view = await renderInitializedNote('spec', 'base');
      const editor = (view.container.querySelector('.ProseMirror') as any).editor;
      await waitFor(() => expect(editor.getText()).toBe('base'));
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(1200);
      const { daemon, sent, agentWrites } = modelExactWriteDaemon('base', 4);
      vi.mocked(updateNoteContent).mockClear();

      // Continuous typing: two keystrokes 100 ms apart, both inside the
      // component's 1 s save debounce, so nothing has been staged yet.
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' x1');
      await vi.advanceTimersByTimeAsync(100);
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' x2');
      await vi.advanceTimersByTimeAsync(100);
      expect(updateNoteContent).not.toHaveBeenCalled();

      await agentWrites('agent base');
      await vi.advanceTimersByTimeAsync(0);

      expect(updateNoteContent).toHaveBeenCalledWith('ws-1', 'spec', 'base x1 x2', {
        immediate: false,
        baseRev: 4,
      });
      expect(sent).toEqual([{ text: 'base x1 x2', expectedVersion: 4 }]);
      expect(daemon.content).toBe('agent base x1 x2');
      expect(editor.getText()).toBe('agent base x1 x2');

      // The chain settled and the editor text is the daemon's rev 6: the next
      // keystroke names that rev and lands as an exact write.
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' x3');
      await vi.advanceTimersByTimeAsync(1000 + 800 + 1);

      expect(sent.at(-1)).toEqual({ text: 'agent base x1 x2 x3', expectedVersion: 6 });
      expect(daemon.content).toBe('agent base x1 x2 x3');
      expect(daemon.rev).toBe(7);
      expect(editor.getText()).toBe('agent base x1 x2 x3');
    });

    // Regression (PR #2404 review): a save whose echo equals the editor text
    // never goes through the external apply, so its rev went unrecorded; the
    // next chain staged after an agent refetch then named the rev before the
    // save and the daemon merge duplicated the first edit or swallowed an
    // undo. The settled echo's rev must become the baseline's rev.
    it.each(['typing', 'undo'])(
      'names the settled equal echo rev when the next chain starts after an agent refetch (%s)',
      async (mode) => {
        replaceNotes([createNote('spec', 'Spec', 'body', { rev: 4 })]);
        const view = await renderInitializedNote('spec', 'body');
        const editor = (view.container.querySelector('.ProseMirror') as any).editor;
        await waitFor(() => expect(editor.getText()).toBe('body'));
        vi.useFakeTimers();
        await vi.advanceTimersByTimeAsync(1200);

        let pending = false;
        vi.mocked(hasPendingNoteContent).mockImplementation(() => pending);
        vi.mocked(updateNoteContent).mockImplementation((_ws, _id, text) => {
          pending = true;
          replaceNotes([createNote('spec', 'Spec', text, { rev: 4 })]);
        });
        vi.mocked(flushNoteContent).mockImplementation(async () => undefined);
        vi.mocked(updateNoteContent).mockClear();

        editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' first');
        await vi.advanceTimersByTimeAsync(1000);
        expect(updateNoteContent).toHaveBeenLastCalledWith('ws-1', 'spec', 'body first', {
          immediate: false,
          baseRev: 4,
        });

        // The save settles with identical content at rev 5.
        pending = false;
        replaceNotes([createNote('spec', 'Spec', 'body first', { rev: 5 })]);
        await tick();
        await vi.advanceTimersByTimeAsync(3000);
        expect(editor.getText()).toBe('body first');

        vi.mocked(updateNoteContent).mockClear();
        if (mode === 'undo') editor.commands.deleteRange({ from: 5, to: 11 });
        else editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' plus typing');
        const expectedDraft = mode === 'undo' ? 'body' : 'body first plus typing';
        expect(editor.getText()).toBe(expectedDraft);

        // An agent refetch lands rev 6 before the draft is staged.
        replaceNotes([createNote('spec', 'Spec', 'AGENT body first', { rev: 6 })]);
        await tick();

        expect(updateNoteContent).toHaveBeenCalledWith('ws-1', 'spec', expectedDraft, {
          immediate: false,
          baseRev: 5,
        });
      },
    );
  });

  // Regression (PR #2404 review): a dirty-editor flush started for note A,
  // held across a switch to note B, resolved into the live editor — B's text
  // was replaced by A's echo and B's baseline took A's rev. The same held for
  // A's render still converting when the switch happened.
  describe('external apply held across a note switch', () => {
    async function holdFlushThenSwitchToB() {
      let noteA = createNote('spec', 'A', 'note A', { rev: 4 });
      const noteB = createNote('note-b', 'B', 'note B', { rev: 40 });
      replaceNotes([noteA, noteB]);
      const view = await renderInitializedNote('spec', 'note A');
      const editor = (view.container.querySelector('.ProseMirror') as any).editor;
      await waitFor(() => expect(editor.getText()).toBe('note A'));
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(1200);

      let pending = false;
      let resolveSave!: (value: { content: string; rev: number }) => void;
      const saved = new Promise<{ content: string; rev: number }>((resolve) => {
        resolveSave = resolve;
      });
      vi.mocked(hasPendingNoteContent).mockImplementation((_ws, id) => id === 'spec' && pending);
      vi.mocked(updateNoteContent).mockImplementation((_ws, id, text) => {
        if (id !== 'spec') return;
        pending = true;
        noteA = { ...noteA, content: text };
        replaceNotes([noteA, noteB]);
      });
      vi.mocked(flushNoteContent).mockImplementation((_ws, id) =>
        id === 'spec' ? saved : Promise.resolve(undefined),
      );
      vi.mocked(flushNoteContent).mockClear();

      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' local');
      noteA = { ...noteA, content: 'AGENT note A', rev: 5 };
      replaceNotes([noteA, noteB]);
      await tick();
      expect(flushNoteContent).toHaveBeenCalledWith('ws-1', 'spec');

      const switchToB = async () => {
        await view.rerender({
          workspace: { id: WORKSPACE_ID } as any,
          noteId: 'note-b',
          content: 'note B',
          editable: true,
        });
        selectCurrentNote('note-b');
        await vi.advanceTimersByTimeAsync(300);
        expect(editor.getText()).toBe('note B');
      };

      // `syncStore: false` resolves the save without the store echo, so no
      // safety-net re-run supersedes the apply generation under test.
      const resolveA = async ({ syncStore = true } = {}) => {
        pending = false;
        noteA = { ...noteA, content: 'AGENT note A local', rev: 6 };
        if (syncStore) replaceNotes([noteA, noteB]);
        resolveSave({ content: noteA.content, rev: 6 });
        await tick();
        await vi.advanceTimersByTimeAsync(0);
      };

      return { editor, switchToB, resolveA };
    }

    it('drops the A flush result when the editor now shows B', async () => {
      const { editor, switchToB, resolveA } = await holdFlushThenSwitchToB();
      await switchToB();
      mockApplyExternalUpdateHtml.mockClear();

      await resolveA();

      expect(editor.getText()).toBe('note B');
      expect(mockApplyExternalUpdateHtml).not.toHaveBeenCalled();
    });

    it('drops the A render still converting when the editor now shows B', async () => {
      const { editor, switchToB, resolveA } = await holdFlushThenSwitchToB();
      const renderA = deferMarkdownConversion('AGENT note A local');
      await resolveA({ syncStore: false });
      expect(editor.getText()).toBe('note A local');

      await switchToB();
      mockApplyExternalUpdateHtml.mockClear();

      renderA.resolve('<p>AGENT note A local</p>');
      await flushConversionCompletion();
      await vi.advanceTimersByTimeAsync(0);

      expect(editor.getText()).toBe('note B');
      expect(mockApplyExternalUpdateHtml).not.toHaveBeenCalled();
    });

    it('keeps applying the A flush result while the editor still shows A', async () => {
      const { editor, resolveA } = await holdFlushThenSwitchToB();

      await resolveA();

      expect(editor.getText()).toBe('AGENT note A local');
    });
  });

  it('does not apply a pending note conversion after unmount', async () => {
    const view = await renderInitializedNote();
    mockApplyExternalUpdateHtml.mockClear();
    mockMaybeCreateCommentManagerV2.mockClear();
    vi.useFakeTimers();

    const pendingConversion = deferMarkdownConversion('Unmounted note content');
    await view.rerender({
      workspace: { id: WORKSPACE_ID } as any,
      noteId: 'unmounted-note',
      content: 'Unmounted note content',
      editable: true,
      showSuggestions: false,
      showComments: true,
    });
    await tick();

    view.unmount();
    pendingConversion.resolve('<p>Must not be applied</p>');
    await flushConversionCompletion();

    expect(mockApplyExternalUpdateHtml).not.toHaveBeenCalled();
    expect(mockMaybeCreateCommentManagerV2).not.toHaveBeenCalled();
  });

  it('recreates the editor with a new owner when the workspace changes', async () => {
    const view = await renderInitializedNote();
    expect(editorWorkspaceIds.at(-1)).toBe(WORKSPACE_ID);
    expect(mockProcessMarkdownToHTML).toHaveBeenCalledWith(
      'Baseline content',
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
    );

    await view.rerender({
      workspace: { id: 'ws-2' } as any,
      noteId: 'baseline',
      content: 'Baseline content',
      editable: true,
      showSuggestions: false,
      showComments: true,
    });

    await waitFor(() => expect(editorWorkspaceIds.at(-1)).toBe('ws-2'));
    expect(mockProcessMarkdownToHTML).toHaveBeenCalledWith(
      'Baseline content',
      expect.objectContaining({ workspaceId: 'ws-2' }),
    );
  });

  it('passes the owner workspace to background conversion for large notes', async () => {
    const content = 'x'.repeat(5001);
    await renderInitializedNote('large-note', content);

    expect(mockProcessMarkdownToHTML).toHaveBeenCalledWith(
      content,
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
    );
  });

  it('does not retain the old owner when workspace changes during editor initialization', async () => {
    const pending = deferMarkdownConversion('Baseline content');
    const view = render(NoteWithComments, {
      props: {
        workspace: { id: WORKSPACE_ID } as any,
        noteId: 'baseline',
        content: 'Baseline content',
        editable: true,
        showSuggestions: false,
        showComments: true,
      },
    });

    await view.rerender({
      workspace: { id: 'ws-2' } as any,
      noteId: 'baseline',
      content: 'Baseline content',
      editable: true,
      showSuggestions: false,
      showComments: true,
    });
    await tick();
    pending.resolve('<p>Baseline content</p>');

    await waitFor(() => expect(editorWorkspaceIds.at(-1)).toBe('ws-2'));
    expect(editorWorkspaceIds).not.toContain(WORKSPACE_ID);
  });

  it('renders converted linked tasks when converted note content arrives after mount without the CustomEvent path', async () => {
    const rawTaskBlock = ['@@@task', '# Create linked task', 'Task description', '@@@'].join('\n');
    const convertedTitle = 'Create linked task';
    const convertedMarkdown = `- [ ] [${convertedTitle}](intent://local/task/${TASK_NOTE_ID})`;

    const convertedSpecNote = createNote(SPEC_NOTE_ID, 'Spec', convertedMarkdown);
    const linkedTaskNote = createNote(TASK_NOTE_ID, convertedTitle, 'Task description', {
      metadata: {
        task: {
          status: 'not_started',
          assignedAgentIds: [],
        },
      } as any,
    } as Partial<Note>);

    const { container } = render(NoteWithComments, {
      props: {
        workspace: {
          id: WORKSPACE_ID,
          name: 'Workspace',
          path: '/tmp/workspace',
          createdAt: '2026-04-14T00:00:00.000Z',
        } as any,
        noteId: SPEC_NOTE_ID,
        content: rawTaskBlock,
        editable: true,
        showSuggestions: false,
        showComments: false,
      },
    });

    // Simulate the race: the editor mounts from stale/raw content, then the
    // Redux-backed selector catches up with the already-converted note content
    // through the safety-net alone.
    replaceNotes([convertedSpecNote, linkedTaskNote]);

    await waitFor(
      () => {
        expect(container.querySelector('[data-type="taskItem"]')).toBeTruthy();
        expect(
          container.querySelector(`[data-linked-task-note-id="${TASK_NOTE_ID}"]`),
        ).toBeTruthy();
      },
      { timeout: 2500 },
    );

    await waitFor(() => {
      expect(container.textContent).toContain(convertedTitle);
      expect(container.textContent).not.toContain('@@@task');
    });

    expect(container.querySelector('.ProseMirror')?.innerHTML).toContain(
      `intent://local/task/${TASK_NOTE_ID}`,
    );
  });

  describe('workspace-relative images', () => {
    const IMAGE_PATH = 'ui-tweak-artifacts/example.png';
    const IMAGE_MARKDOWN = `![Example](intent://local/file/${IMAGE_PATH})`;
    const TRAVERSAL_SRC = 'intent://local/file/../outside.png';
    const TRAVERSAL_MARKDOWN = `![Escape](${TRAVERSAL_SRC})`;
    const RESOLVED_IMAGE_SRC = `workspace-file://${WORKSPACE_ID}/${IMAGE_PATH}`;

    // Rewritten workspace-file URLs carry a per-render `?v=` cache-busting token;
    // the stable contract under test is the `workspace-file://{ws}/{path}` part.
    function renderedImageSrcs(container: HTMLElement): string[] {
      return Array.from(container.querySelectorAll('.ProseMirror img')).map((img) =>
        (img.getAttribute('src') ?? '').replace(/\?.*$/, ''),
      );
    }

    function workspaceFileSrcs(container: HTMLElement): string[] {
      return renderedImageSrcs(container).filter((src) => src.startsWith('workspace-file://'));
    }

    it('resolves short-form intent file images against the owner workspace on initial load', async () => {
      const view = await renderInitializedNote(
        'image-note',
        `${IMAGE_MARKDOWN}\n\n${TRAVERSAL_MARKDOWN}`,
      );

      await waitFor(() => {
        expect(renderedImageSrcs(view.container)).toContain(RESOLVED_IMAGE_SRC);
      });
      expect(workspaceFileSrcs(view.container)).toEqual([RESOLVED_IMAGE_SRC]);
      expect(renderedImageSrcs(view.container)).toContain(TRAVERSAL_SRC);
    });

    it('resolves intent file images against the owner workspace on deferred large-note load', async () => {
      const content = `${IMAGE_MARKDOWN}\n\n${'x'.repeat(5001)}`;
      const view = await renderInitializedNote('large-image-note', content);

      await waitFor(() => {
        expect(renderedImageSrcs(view.container)).toContain(RESOLVED_IMAGE_SRC);
      });
    });

    it('resolves intent file images against the owner workspace after switching notes', async () => {
      const view = await renderInitializedNote();

      await view.rerender({
        workspace: { id: WORKSPACE_ID } as any,
        noteId: 'switched-image-note',
        content: IMAGE_MARKDOWN,
        editable: true,
        showSuggestions: false,
        showComments: true,
      });

      await waitFor(() => {
        expect(renderedImageSrcs(view.container)).toContain(RESOLVED_IMAGE_SRC);
      });
    });

    it('re-resolves intent file images against the new owner when the workspace changes', async () => {
      const view = await renderInitializedNote('image-note', IMAGE_MARKDOWN);
      await waitFor(() => {
        expect(renderedImageSrcs(view.container)).toContain(RESOLVED_IMAGE_SRC);
      });

      await view.rerender({
        workspace: { id: 'ws-2' } as any,
        noteId: 'image-note',
        content: IMAGE_MARKDOWN,
        editable: true,
        showSuggestions: false,
        showComments: true,
      });

      await waitFor(() => {
        expect(renderedImageSrcs(view.container)).toContain(`workspace-file://ws-2/${IMAGE_PATH}`);
      });
      expect(renderedImageSrcs(view.container)).not.toContain(RESOLVED_IMAGE_SRC);
    });

    it('resolves intent file images against the owner workspace on live external updates', async () => {
      const view = await renderInitializedNote(SPEC_NOTE_ID, 'Spec before image');

      replaceNotes([createNote(SPEC_NOTE_ID, 'Spec', IMAGE_MARKDOWN)]);

      await waitFor(
        () => {
          expect(renderedImageSrcs(view.container)).toContain(RESOLVED_IMAGE_SRC);
        },
        { timeout: 2500 },
      );
    });
  });
});
