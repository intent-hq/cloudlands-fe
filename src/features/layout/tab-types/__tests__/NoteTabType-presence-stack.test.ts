/**
 * Header presence avatar stack: mounted (and the note-presence lease taken)
 * only in a shared workspace (AC 6); renders the roster the session emits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';

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
  const note = {
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
  };
  type Listener = (viewers: unknown[]) => void;
  const listeners = new Set<Listener>();
  return {
    dispatch: vi.fn(),
    noteViewMode: store<'editor' | 'raw' | 'preview'>('editor'),
    spellcheckEnabled: store(true),
    noteFontStyle: store('sans'),
    scrollPositions: store<Record<string, number>>({}),
    initialSpecWriteInProgress: store(false),
    notesState: store({ loading: false, initialized: true }),
    workspace: store<Record<string, unknown>>({
      id: 'ws-1',
      path: '/tmp/ws-1',
      branchName: 'main',
    }),
    note: store(note),
    listeners,
    release: vi.fn(),
    joinNotePresence: vi.fn(() => ({
      getViewers: () => [],
      subscribe: (listener: Listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publishCursor: vi.fn(),
      release: mockState.release,
    })),
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
vi.mock('$features/external-editors/components/OpenComboButton.svelte', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$lib/icons/faNote', () => ({ faNote: { iconName: 'note' } }));
vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn(async () => '/tmp/ws-1') }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mockState.dispatch });
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () => mockState.workspace,
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: Object.assign(() => mockState.note, { select: () => mockState.note.get() }),
  selectWorkspaceNotesState: () => mockState.notesState,
}));
vi.mock('$features/notes/notes-write-service', () => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectIsInitialSpecWriteInProgress: () => mockState.initialSpecWriteInProgress,
  selectInitialAgentId: { select: () => null },
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: { select: () => null },
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectNoteFontStyle: () => mockState.noteFontStyle,
  selectSpellcheckEnabled: () => mockState.spellcheckEnabled,
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectAllScrollPositions: () => mockState.scrollPositions,
}));
vi.mock('$store/renderer/slices/transient-ui/transient-ui-selectors', () => ({
  selectNoteViewMode: () => mockState.noteViewMode,
}));
vi.mock('$features/notes/note-presence/note-presence-service', () => ({
  joinNotePresence: mockState.joinNotePresence,
}));

import NoteTabTypeHeaderHarness from './mocks/NoteTabTypeHeaderHarness.svelte';

const tab = { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' };

describe('NoteTabType presence avatar stack', () => {
  beforeEach(() => {
    mockState.joinNotePresence.mockClear();
    mockState.release.mockClear();
    mockState.listeners.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not mount or take a presence lease when the viewer is alone (AC 6)', async () => {
    mockState.workspace.set({ id: 'ws-1', path: '/tmp/ws-1', branchName: 'main', memberCount: 1 });
    render(NoteTabTypeHeaderHarness, { props: { tab } });
    await screen.findByRole('button', { name: 'Panel actions' });

    expect(mockState.joinNotePresence).not.toHaveBeenCalled();
    expect(screen.queryByTestId('note-presence-avatar-stack')).toBeNull();
  });

  it('mounts in a shared workspace and renders the peers the session emits', async () => {
    mockState.workspace.set({ id: 'ws-1', path: '/tmp/ws-1', branchName: 'main', memberCount: 2 });
    const { unmount } = render(NoteTabTypeHeaderHarness, { props: { tab } });
    await waitFor(() => expect(mockState.joinNotePresence).toHaveBeenCalledWith('ws-1', 'note-1'));
    expect(screen.queryByTestId('note-presence-avatar-stack')).toBeNull();

    for (const listener of mockState.listeners) {
      listener([
        {
          principalId: 'p-b',
          login: 'bea',
          displayName: 'Bea',
          avatarUrl: null,
          cursor: null,
          cursorSeenAt: null,
        },
        {
          principalId: 'p-c',
          login: 'cy',
          displayName: null,
          avatarUrl: 'https://x/cy.png',
          cursor: null,
          cursorSeenAt: null,
        },
      ]);
    }
    const stack = await screen.findByRole('group', { name: /2/ });
    expect(stack.querySelectorAll('[data-principal-id]')).toHaveLength(2);
    expect(stack.querySelector('img')?.getAttribute('src')).toBe('https://x/cy.png');

    unmount();
    expect(mockState.release).toHaveBeenCalledTimes(1);
  });
});
