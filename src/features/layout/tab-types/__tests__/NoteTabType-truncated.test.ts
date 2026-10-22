/**
 * Truncated note reads (§5.2 "Truncated note reads", intent-hq/intent#7515):
 * a note served with `contentTruncated` renders only the Markdown renderer and
 * a banner — no editor, comments, presence, attribution or content actions —
 * and returns to the normal view when a live update brings it under the limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

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
    note: store<Record<string, unknown>>(note),
    baseNote: note,
    noteContentView: store<unknown>(undefined),
    noteWorkspaceRoot: store<unknown>(undefined),
    notePresenceView: store<{ viewers: unknown[] } | undefined>(undefined),
    windowVisible: store(true),
    currentWorkspace: store('ws-1'),
    principalConnectionContext: store('test-connection'),
  };
});

vi.mock('$lib/components/workspace/NoteWithComments.svelte', async () => ({
  default: (await import('./mocks/MockNoteWithComments.svelte')).default,
}));
vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./mocks/MockMarkdownViewer.svelte')).default,
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
  selectNoteContentView: () => mockState.noteContentView,
  selectNoteWorkspaceRoot: () => mockState.noteWorkspaceRoot,
  selectNotePresenceView: () => mockState.notePresenceView,
  selectWorkspaceNotesState: () => mockState.notesState,
  selectNoteWindowVisible: () => mockState.windowVisible,
}));
vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectPrincipalConnectionContext: () => mockState.principalConnectionContext,
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
  selectCurrentWorkspaceTabId: () => mockState.currentWorkspace,
}));
vi.mock('$store/renderer/slices/transient-ui/transient-ui-selectors', () => ({
  selectNoteViewMode: () => mockState.noteViewMode,
}));
import NoteTabTypeHeaderHarness from './mocks/NoteTabTypeHeaderHarness.svelte';
import {
  noteAttributionViewRequested,
  notePresenceViewRequested,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { formatTruncatedNoteSize } from '../TruncatedNoteView.svelte';

const tab = { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' };

function dispatchedTypes(): string[] {
  return mockState.dispatch.mock.calls.map(([action]) => (action as { type: string }).type);
}

function truncatedNote() {
  return {
    ...mockState.baseNote,
    content: '# Large note\n\nFirst part only\n',
    contentTruncated: true,
    contentBytes: 4_700_000,
  };
}

describe('NoteTabType truncated note view', () => {
  beforeEach(() => {
    mockState.dispatch.mockClear();
    mockState.noteViewMode.set('editor');
    mockState.notePresenceView.set(undefined);
    mockState.workspace.set({ id: 'ws-1', path: '/tmp/ws-1', branchName: 'main', memberCount: 3 });
  });

  afterEach(() => {
    cleanup();
    mockState.note.set(mockState.baseNote);
  });

  it('renders the truncated prefix with a banner and no editor', async () => {
    mockState.note.set(truncatedNote());
    render(NoteTabTypeHeaderHarness, { props: { tab } });

    const banner = await screen.findByTestId('truncated-note-banner');
    expect(banner.textContent).toContain(
      'This note is too large to edit, comment on, or collaborate on in the app. Showing the first 500 KB of 4.7 MB. Agents can still read and edit the whole note.',
    );
    expect(screen.getByTestId('markdown-viewer').textContent).toContain('First part only');
    expect(screen.queryByTestId('note-with-comments')).toBeNull();
  });

  it.each(['editor', 'raw', 'preview'] as const)('stays render-only in %s mode', async (mode) => {
    mockState.noteViewMode.set(mode);
    mockState.note.set(truncatedNote());
    render(NoteTabTypeHeaderHarness, { props: { tab } });
    expect(await screen.findByTestId('truncated-note-view')).not.toBeNull();
    expect(screen.queryByTestId('note-with-comments')).toBeNull();
  });

  it('requests no presence, attribution or comments, and registers no content actions', async () => {
    mockState.note.set(truncatedNote());
    render(NoteTabTypeHeaderHarness, { props: { tab } });
    await screen.findByTestId('truncated-note-view');

    const types = dispatchedTypes();
    expect(types).not.toContain(notePresenceViewRequested.type);
    expect(types).not.toContain(noteAttributionViewRequested.type);
    expect(types.filter((type) => /comment/i.test(type))).toEqual([]);

    // Header menu: no view settings, copy, open-in-editor or delete actions.
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    expect(screen.queryByRole('menuitem', { name: /copy/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull();
    expect(screen.queryByTestId('mock-component')).toBeNull();
  });

  it('switches back to the normal view when the note shrinks under the limit', async () => {
    mockState.note.set(truncatedNote());
    render(NoteTabTypeHeaderHarness, { props: { tab } });
    await screen.findByTestId('truncated-note-view');
    expect(dispatchedTypes()).not.toContain(notePresenceViewRequested.type);

    mockState.note.set({ ...mockState.baseNote, content: 'Small again' });

    expect(await screen.findByTestId('note-with-comments')).not.toBeNull();
    expect(screen.queryByTestId('truncated-note-banner')).toBeNull();
    await waitFor(() => expect(dispatchedTypes()).toContain(notePresenceViewRequested.type));
  });

  it('keeps a normal note on the editor path, unchanged', async () => {
    render(NoteTabTypeHeaderHarness, { props: { tab } });
    expect(await screen.findByTestId('note-with-comments')).not.toBeNull();
    expect(screen.queryByTestId('truncated-note-view')).toBeNull();
    await waitFor(() => expect(dispatchedTypes()).toContain(notePresenceViewRequested.type));
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    expect(await screen.findByRole('menuitem', { name: /copy/i })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /delete/i })).not.toBeNull();
  });
});

describe('formatTruncatedNoteSize', () => {
  it('formats decimal KB and MB labels', () => {
    expect(formatTruncatedNoteSize(500_000)).toBe('500 KB');
    expect(formatTruncatedNoteSize(4_700_000)).toBe('4.7 MB');
    expect(formatTruncatedNoteSize(1_000_000)).toBe('1 MB');
    expect(formatTruncatedNoteSize(10)).toBe('1 KB');
  });
});
