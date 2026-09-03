/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Note } from '$shared/types';
import { ContentType, NoteVisibility } from '$shared/types';

const {
  mockInvoke,
  mockLogger,
  constantReadable,
  currentNoteReadable,
  notesVersionReadable,
  resetNotes,
  replaceNotes,
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
    // without any note-content-update CustomEvent being delivered.
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
    const IMAGE_MARKDOWN = '![Example](intent://local/file/ui-tweak-artifacts/example.png)';
    const TRAVERSAL_MARKDOWN = '![Escape](intent://local/file/../outside.png)';
    const RESOLVED_IMAGE_SRC = `workspace-file://${WORKSPACE_ID}/ui-tweak-artifacts/example.png`;

    function renderedImageSrcs(container: HTMLElement): string[] {
      return Array.from(container.querySelectorAll('.ProseMirror img')).map(
        (img) => img.getAttribute('src') ?? '',
      );
    }

    it('resolves short-form intent file images against the owner workspace on initial load', async () => {
      const view = await renderInitializedNote(
        'image-note',
        `${IMAGE_MARKDOWN}\n\n${TRAVERSAL_MARKDOWN}`,
      );

      await waitFor(() => {
        expect(renderedImageSrcs(view.container)).toContain(RESOLVED_IMAGE_SRC);
      });
      const srcs = renderedImageSrcs(view.container);
      expect(srcs.some((src) => src.startsWith('workspace-file://') && src.includes('..'))).toBe(
        false,
      );
    });

    it('resolves intent file images against the owner workspace after switching notes', async () => {
      const view = await renderInitializedNote();
      mockProcessMarkdownToHTML.mockClear();

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
      expect(mockProcessMarkdownToHTML).toHaveBeenCalledWith(
        IMAGE_MARKDOWN,
        expect.objectContaining({ workspaceId: WORKSPACE_ID }),
      );
    });

    it('resolves intent file images against the owner workspace on live external updates', async () => {
      const view = await renderInitializedNote(SPEC_NOTE_ID, 'Spec before image');
      mockProcessMarkdownToHTML.mockClear();

      replaceNotes([createNote(SPEC_NOTE_ID, 'Spec', IMAGE_MARKDOWN)]);

      await waitFor(
        () => {
          expect(renderedImageSrcs(view.container)).toContain(RESOLVED_IMAGE_SRC);
        },
        { timeout: 2500 },
      );
      expect(mockProcessMarkdownToHTML).toHaveBeenCalledWith(
        IMAGE_MARKDOWN,
        expect.objectContaining({ workspaceId: WORKSPACE_ID }),
      );
    });
  });
});
