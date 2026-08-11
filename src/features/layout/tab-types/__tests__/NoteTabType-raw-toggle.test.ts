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

  return {
    dispatch: vi.fn(),
    rawViewEnabled: store(false),
    spellcheckEnabled: store(true),
    noteFontStyle: store('sans'),
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
vi.mock('$features/external-editors/components/OpenComboButton.svelte', async () => ({
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
  faSliders: { iconName: 'sliders' },
  faSpellCheck: { iconName: 'spell-check' },
  faTrash: { iconName: 'trash' },
}));
vi.mock('$lib/icons/faNote', () => ({ faNote: { iconName: 'note' } }));
vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn(async () => '/tmp/ws-1') }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mockState.dispatch,
  });
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () => mockState.workspace,
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: Object.assign(() => mockState.note, { select: () => mockState.note.get() }),
}));
vi.mock('$features/notes/notes-write-service', () => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectIsInitialSpecWriteInProgress: () => mockState.initialSpecWriteInProgress,
  selectInitialAgentId: { select: () => null },
  selectAgentSession: { select: () => null },
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: { select: () => null },
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectNoteFontStyle: () => mockState.noteFontStyle,
  selectSpellcheckEnabled: () => mockState.spellcheckEnabled,
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-slice', () => ({
  setNoteFontStyle: (style: string) => ({
    type: 'fontSettings/setNoteFontStyle',
    payload: [style],
  }),
  toggleSpellcheck: () => ({ type: 'userPreferences/toggleSpellcheck' }),
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectScrollPosition: () => mockState.scrollPosition,
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-slice', () => ({
  saveScrollPosition: () => ({ type: 'tabState/saveScrollPosition' }),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-slice', () => ({
  closeTab: () => ({ type: 'panelLayout/closeTab' }),
}));
vi.mock('$store/renderer/slices/transient-ui/transient-ui-selectors', () => ({
  selectIsRawNoteViewEnabled: () => mockState.rawViewEnabled,
}));
vi.mock('$store/renderer/slices/transient-ui/transient-ui-slice', () => ({
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
    mockState.spellcheckEnabled.set(true);
    mockState.noteFontStyle.set('sans');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('groups the raw view toggle into an accessible view settings panel', async () => {
    render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });

    const trigger = await screen.findByRole('button', { name: 'View settings' });
    await fireEvent.click(trigger);

    const toggle = await screen.findByRole('menuitemcheckbox', {
      name: 'Raw Markdown',
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await fireEvent.click(toggle);
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'transientUi/toggleRawNoteView',
      payload: ['ws-1', 'note-1'],
    });

    mockState.rawViewEnabled.set(true);
    await waitFor(() => {
      const enabledToggle = screen.getByRole('menuitemcheckbox', { name: 'Raw Markdown' });
      expect(enabledToggle.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('offers font and spellcheck controls in the same panel', async () => {
    render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'View settings' }));

    expect(screen.getByRole('radio', { name: /Sans-serif/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await fireEvent.click(await screen.findByRole('radio', { name: /Serif/ }));
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'fontSettings/setNoteFontStyle',
      payload: ['serif'],
    });

    const spellcheck = screen.getByRole('menuitemcheckbox', { name: 'Spellcheck' });
    expect(spellcheck.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(spellcheck);
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'userPreferences/toggleSpellcheck',
    });
  });

  it('clears pending copy feedback timer when unmounted', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const { unmount } = render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Copy full note' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('Note content'));
    const callsBeforeUnmount = clearTimeoutSpy.mock.calls.length;

    unmount();

    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);
  });
});
