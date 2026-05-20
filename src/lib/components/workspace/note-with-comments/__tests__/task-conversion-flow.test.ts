/**
 * @vitest-environment jsdom
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  cleanup,
  render,
  waitFor,
} from '@testing-library/svelte';
import type { Note } from '$shared/types';
import {
  ContentType,
  NoteVisibility,
} from '$shared/types';

const {
  mockDispatch,
  mockInvoke,
  mockTrack,
  mockLogger,
  constantReadable,
  currentNoteReadable,
  notesVersionReadable,
  resetNotes,
  replaceNotes,
  getNoteById,
  mockSelectorStore,
} = vi.hoisted(() => {
  const mockDispatch = vi.fn();
  const mockInvoke = vi.fn();
  const mockTrack = vi.fn();
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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
    mockTrack,
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

vi.mock('$lib/services/analytics', () => ({
  track: mockTrack,
}));

vi.mock('$lib/store/utils/svelte-context', () => ({
  getDispatch: () => mockDispatch,
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({
    getState: () => ({}),
  }),
  getReduxDispatch: () => mockDispatch,
  dispatch: mockDispatch,
}));

vi.mock('$lib/store/store', () => ({
  appStore: mockSelectorStore,
  store: mockSelectorStore,
}));

vi.mock('$lib/store/configured-store', () => ({
  store: mockSelectorStore,
}));

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: () => constantReadable('ws-1'),
}));

vi.mock('$lib/store/slices/workspace-notes/workspace-notes-selectors', () => ({
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
}));

vi.mock('$lib/store/slices/comments/comments-selectors', () => ({
  selectComments: Object.assign(() => constantReadable([]), {
    select: () => [],
  }),
  selectCommentById: {
    select: () => null,
  },
}));

vi.mock('$lib/store/slices/comments/comments-slice', () => ({
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

vi.mock('$lib/store/slices/user-preferences/user-preferences-selectors', () => ({
  selectNoteFontStyle: () => constantReadable('sans'),
  selectSpellcheckEnabled: () => constantReadable(true),
}));

vi.mock('$lib/store/slices/workspace-navigation/workspace-navigation-selectors', () => ({
  selectWorkspaceNavigationHistory: {
    select: () => ({ history: [], currentIndex: -1 }),
  },
}));

vi.mock('$lib/store/slices/workspace-notes/workspace-notes-slice', () => ({
  restoreNoteVersion: vi.fn((workspaceId: string, noteId: string, versionId: string) => ({
    type: 'workspaceNotes/restoreNoteVersion',
    payload: { workspaceId, noteId, versionId },
  })),
  updateNoteContent: vi.fn((workspaceId: string, noteId: string, content: string) => ({
    type: 'workspaceNotes/updateNoteContent',
    payload: { workspaceId, noteId, content },
  })),
  clearNewlyCreatedNoteId: vi.fn((workspaceId: string) => ({
    type: 'workspaceNotes/clearNewlyCreatedNoteId',
    payload: { workspaceId },
  })),
  reloadNotes: vi.fn((workspaceId: string) => ({
    type: 'workspaceNotes/reloadNotes',
    payload: { workspaceId },
  })),
  updateTaskStatus: vi.fn((workspaceId: string, noteId: string, status: string) => ({
    type: 'workspaceNotes/updateTaskStatus',
    payload: { workspaceId, noteId, status },
  })),
}));

vi.mock('$lib/store/slices/transient-ui/transient-ui-selectors', () => ({
  selectIsRawNoteViewEnabled: () => constantReadable(false),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToNote: vi.fn(),
}));

vi.mock('$lib/store/slices/workspace-notes/sagas/notes-ipc', () => ({
  notesIpc: vi.fn(),
}));

vi.mock('$lib/utils/editor-listeners', () => ({
  setupEditorListeners: () => () => {},
}));

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
  maybeCreateCommentManagerV2: vi.fn(async () => null),
  destroyAndClearCommentManagerV2: vi.fn(() => null),
}));

vi.mock('../comment-manager-content-change-handlers', () => ({
  createOnCommentManagerContentChangedAfterAnchorInsertion: vi.fn(() => vi.fn()),
  createOnCommentManagerContentChangedUpdateLastKnownContent: vi.fn(() => vi.fn()),
}));

vi.mock('../comment-mark-click-handler', () => ({
  setupCommentMarkClickHandlerV2: vi.fn(() => null),
}));

vi.mock('$lib/utils/editor-config', async () => {
  const StarterKit = (await import('@tiptap/starter-kit')).default;
  const TaskList = (await import('@tiptap/extension-task-list')).default;
  const { CustomTaskItem } = await import('$lib/components/tiptap/CustomTaskItem');
  const { createWorkspacesLink } = await import('$lib/utils/tiptap-link-extension');

  return {
    createEditorConfig: ({ element, content, editable, onUpdate }: any) => ({
      element,
      content,
      editable,
      extensions: [
        StarterKit.configure({
          link: false,
        }),
        createWorkspacesLink({ openOnClick: false }),
        TaskList,
        CustomTaskItem.configure({
          nested: true,
          taskListTypeName: 'taskList',
        }),
      ],
      onUpdate: ({ editor }: { editor: { getHTML: () => string } }) => {
        onUpdate(editor.getHTML());
      },
    }),
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
    document.body.innerHTML = '';
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
});
