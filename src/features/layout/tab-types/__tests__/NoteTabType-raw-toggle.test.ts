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
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';

const mockState = vi.hoisted(() => {
  type Subscriber<T> = (value: T) => void;
  function store<T>(initial: T) {
    let value = initial;
    const subscribers = new Set<Subscriber<T>>();
    return {
      get: () => value,
      set: (next: T) => {
        value = next;
        subscribers.forEach((run) => run(value));
      },
      subscribe: (run: Subscriber<T>) => {
        run(value);
        subscribers.add(run);
        return () => subscribers.delete(run);
      },
    };
  }

  return {
    dispatch: vi.fn(),
    rawViewEnabled: store(false),
    spellcheckEnabled: store(true),
    scrollPosition: store(0),
    initialSpecWriteInProgress: store(false),
    workspace: store({ id: 'ws-1', path: '/tmp/ws-1', branchName: 'main' }),
    note: store({
      id: 'note-1',
      workspaceId: 'ws-1',
      title: 'Note 1',
      content: 'Note content',
      contentType: 'markdown',
      tags: [],
      isPinned: false,
      isArchived: false,
      visibility: 'private',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    }),
  };
});

vi.mock('$lib/components/workspace/NoteWithComments.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));
vi.mock('$lib/components/workspace/NoteVersionHistory.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));
vi.mock('$lib/components/workspace/SpecWritingOnboarding.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));
vi.mock('$lib/components/ui/OpenComboButton.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));
vi.mock('$lib/components/notes/NoteFontStyleButton.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faCheck: { iconName: 'check' },
  faCode: { iconName: 'code' },
  faCopy: { iconName: 'copy' },
  faSpellCheck: { iconName: 'spell-check' },
  faTrash: { iconName: 'trash' },
}));
vi.mock('$lib/icons/faNote', () => ({ faNote: { iconName: 'note' } }));
vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn(async () => '/tmp/ws-1') }));
vi.mock('$lib/services/analytics', () => ({ track: vi.fn() }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('$lib/store/utils/svelte-context', () => ({ getDispatch: () => mockState.dispatch }));
vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({ getState: () => ({}), dispatch: mockState.dispatch }),
}));
vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () => mockState.workspace,
}));
vi.mock('$lib/store/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: Object.assign(() => mockState.note, { select: () => mockState.note.get() }),
}));
vi.mock('$lib/store/slices/workspace-notes/workspace-notes-slice', () => ({
  createNote: () => ({ type: 'workspaceNotes/createNote' }),
  deleteNote: () => ({ type: 'workspaceNotes/deleteNote' }),
}));
vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectIsInitialSpecWriteInProgress: () => mockState.initialSpecWriteInProgress,
  selectInitialAgentId: { select: () => null },
  selectAgentSession: { select: () => null },
}));
vi.mock('$lib/store/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: { select: () => null },
}));
vi.mock('$lib/store/slices/user-preferences/user-preferences-selectors', () => ({
  selectSpellcheckEnabled: () => mockState.spellcheckEnabled,
}));
vi.mock('$lib/store/slices/user-preferences/user-preferences-slice', () => ({
  toggleSpellcheck: () => ({ type: 'userPreferences/toggleSpellcheck' }),
}));
vi.mock('$lib/store/slices/tab-state/tab-state-selectors', () => ({
  selectScrollPosition: () => mockState.scrollPosition,
}));
vi.mock('$lib/store/slices/tab-state/tab-state-slice', () => ({
  saveScrollPosition: () => ({ type: 'tabState/saveScrollPosition' }),
}));
vi.mock('$lib/store/slices/panel-layout/panel-layout-slice', () => ({
  closeTab: () => ({ type: 'panelLayout/closeTab' }),
}));
vi.mock('$lib/store/slices/transient-ui/transient-ui-selectors', () => ({
  selectIsRawNoteViewEnabled: () => mockState.rawViewEnabled,
}));
vi.mock('$lib/store/slices/transient-ui/transient-ui-slice', () => ({
  toggleRawNoteView: (workspaceId: string, noteId: string) => ({
    type: 'transientUi/toggleRawNoteView',
    payload: [workspaceId, noteId],
  }),
}));

import NoteTabTypeHeaderHarness from './mocks/NoteTabTypeHeaderHarness.svelte';

describe('NoteTabType raw note view toggle', () => {
  beforeEach(() => {
    mockState.dispatch.mockClear();
    mockState.rawViewEnabled.set(false);
  });

  afterEach(() => {
    cleanup();
  });

  it('registers an accessible header toggle that dispatches raw view toggle', async () => {
    render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });

    const toggle = await screen.findByRole('button', { name: 'Show raw markdown note view' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.className).toContain('text-subtle');
    expect(toggle.className).not.toContain('text-primary');

    await fireEvent.click(toggle);
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'transientUi/toggleRawNoteView',
      payload: ['ws-1', 'note-1'],
    });

    mockState.rawViewEnabled.set(true);
    await waitFor(() => {
      const enabledToggle = screen.getByRole('button', { name: 'Show rich note view' });
      expect(enabledToggle.getAttribute('aria-pressed')).toBe('true');
      expect(enabledToggle.className).toContain('text-foreground');
      expect(enabledToggle.className).toContain('bg-sidebar');
      expect(enabledToggle.className).not.toContain('text-primary');
    });
  });
});
