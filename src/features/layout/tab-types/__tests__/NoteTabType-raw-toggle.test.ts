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

  const defaultNote = {
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
    workspace: store({ id: 'ws-1', path: '/tmp/ws-1', branchName: 'main' }),
    defaultNote,
    note: store<typeof defaultNote | undefined>(defaultNote),
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
vi.mock('@fortawesome/free-solid-svg-icons', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  faCheck: { iconName: 'check' },
  faCode: { iconName: 'code' },
  faCopy: { iconName: 'copy' },
  faFont: { iconName: 'font' },
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
  selectWorkspaceNotesState: () => mockState.notesState,
}));
vi.mock('$features/notes/notes-write-service', () => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  updateNoteContent: vi.fn(),
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
  selectAllScrollPositions: () => mockState.scrollPositions,
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-slice', () => ({
  saveScrollPosition: (tabId: string, scrollTop: number) => ({
    type: 'tabState/saveScrollPosition',
    payload: [tabId, scrollTop],
  }),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-slice', () => ({
  closeTab: () => ({ type: 'panelLayout/closeTab' }),
}));
vi.mock('$store/renderer/slices/transient-ui/transient-ui-selectors', () => ({
  selectNoteViewMode: () => mockState.noteViewMode,
}));
vi.mock('$store/renderer/slices/transient-ui/transient-ui-slice', () => ({
  setNoteViewMode: (workspaceId: string, noteId: string, mode: string) => ({
    type: 'transientUi/setNoteViewMode',
    payload: [workspaceId, noteId, mode],
  }),
}));

import NoteTabTypeHeaderHarness from './mocks/NoteTabTypeHeaderHarness.svelte';

describe('NoteTabType note view modes', () => {
  beforeEach(() => {
    mockState.dispatch.mockClear();
    mockState.noteViewMode.set('editor');
    mockState.spellcheckEnabled.set(true);
    mockState.noteFontStyle.set('sans');
    mockState.scrollPositions.set({});
    mockState.notesState.set({ loading: false, initialized: true });
    mockState.note.set({ ...mockState.defaultNote });
    mockState.initialSpecWriteInProgress.set(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('switches mutually exclusive note view modes from the panel action menu', async () => {
    render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });

    const trigger = await screen.findByRole('button', { name: 'Panel actions' });
    await fireEvent.click(trigger);

    expect(
      (await screen.findByRole('menuitemradio', { name: 'Editor' })).getAttribute('aria-checked'),
    ).toBe('true');

    await fireEvent.click(screen.getByRole('menuitemradio', { name: 'Rendered preview' }));
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'transientUi/setNoteViewMode',
      payload: ['ws-1', 'note-1', 'preview'],
    });

    mockState.noteViewMode.set('preview');
    await waitFor(() => {
      expect(
        screen
          .getByRole('menuitemradio', { name: 'Rendered preview' })
          .getAttribute('aria-checked'),
      ).toBe('true');
    });

    await fireEvent.click(screen.getByRole('menuitemradio', { name: 'Raw Markdown' }));
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'transientUi/setNoteViewMode',
      payload: ['ws-1', 'note-1', 'raw'],
    });
  });

  it('renders the actual note source as a read-only math preview without persisting it', async () => {
    const source =
      String.raw`Inline $x^2$ and display math:

$$\frac{1}{2}$$

- [ ] Read-only task` +
      '\n\nCode stays literal: `$not-math$`. Costs $5 and $10. Unfinished \\(x + 1';
    mockState.note.set({ ...mockState.defaultNote, content: source });
    mockState.noteViewMode.set('preview');

    const { container } = render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });

    const preview = await screen.findByRole('document', { name: 'Rendered note preview' });
    await waitFor(() => expect(preview.querySelectorAll('math')).toHaveLength(2));
    expect(container.querySelector('[data-note-content-state="read-only"]')).toBeTruthy();
    expect(container.querySelector('.ProseMirror')).toBeNull();
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(preview.textContent).toContain('$not-math$');
    expect(preview.textContent).toContain('Costs $5 and $10');
    expect(preview.textContent).toContain(String.raw`Unfinished \(x + 1`);
    expect(preview.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    expect(mockState.note.get()?.content).toBe(source);
    expect(mockState.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringMatching(/save|update/i) }),
    );

    mockState.note.set({
      ...mockState.defaultNote,
      content: String.raw`External update \[\sqrt{x}\]`,
    });
    await waitFor(() => expect(preview.querySelector('math')).toBeTruthy());
    expect(preview.textContent).toContain('External update');

    mockState.noteViewMode.set('editor');
    await waitFor(() => expect(screen.queryByTestId('rendered-note-preview')).toBeNull());
    expect(screen.getByTestId('mock-component')).toBeTruthy();
  });

  it('saves preview scroll position to the owning tab when returning to the editor', async () => {
    mockState.noteViewMode.set('preview');
    render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });

    const preview = await screen.findByTestId('rendered-note-preview');
    preview.scrollTop = 240;
    mockState.noteViewMode.set('editor');

    await waitFor(() =>
      expect(mockState.dispatch).toHaveBeenCalledWith({
        type: 'tabState/saveScrollPosition',
        payload: ['tab-1', 240],
      }),
    );
  });

  it('keeps a pending restore through delayed preview layout and isolates note navigation', async () => {
    mockState.noteViewMode.set('preview');
    mockState.scrollPositions.set({ 'tab-1': 310 });
    render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });
    await screen.findByTestId('rendered-note-preview');

    window.dispatchEvent(
      new CustomEvent('note:restore-scroll-position', {
        detail: { noteId: 'note-2', scrollPosition: 600 },
      }),
    );
    mockState.noteViewMode.set('editor');

    await waitFor(() =>
      expect(mockState.dispatch).toHaveBeenCalledWith({
        type: 'tabState/saveScrollPosition',
        payload: ['tab-1', 310],
      }),
    );
    expect(mockState.dispatch).not.toHaveBeenCalledWith({
      type: 'tabState/saveScrollPosition',
      payload: ['tab-1', 600],
    });
  });

  it('uses a matching navigation restore without leaving listeners after unmount', async () => {
    mockState.noteViewMode.set('preview');
    const view = render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });
    await screen.findByTestId('rendered-note-preview');

    window.dispatchEvent(
      new CustomEvent('note:restore-scroll-position', {
        detail: { noteId: 'note-1', scrollPosition: 275 },
      }),
    );
    view.unmount();
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'tabState/saveScrollPosition',
      payload: ['tab-1', 275],
    });

    const callback = vi.fn();
    window.dispatchEvent(new CustomEvent('note:save-scroll-position', { detail: { callback } }));
    expect(callback).not.toHaveBeenCalled();
  });

  it('saves and restores independently when a mounted preview retargets across tabs', async () => {
    mockState.noteViewMode.set('preview');
    mockState.scrollPositions.set({ 'tab-a': 0, 'tab-b': 320 });
    const view = render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-a', type: 'note', title: 'Note A', noteId: 'note-a' } },
    });

    const previewA = await screen.findByTestId('rendered-note-preview');
    previewA.scrollTop = 145;
    await fireEvent.scroll(previewA);
    await view.rerender({
      tab: { id: 'tab-b', type: 'note', title: 'Note B', noteId: 'note-b' },
    });

    await waitFor(() =>
      expect(mockState.dispatch).toHaveBeenCalledWith({
        type: 'tabState/saveScrollPosition',
        payload: ['tab-a', 145],
      }),
    );
    const pendingBSave = vi.fn();
    window.dispatchEvent(
      new CustomEvent('note:save-scroll-position', { detail: { callback: pendingBSave } }),
    );
    await waitFor(() => expect(pendingBSave).toHaveBeenCalledWith(320));

    const previewB = screen.getByTestId('rendered-note-preview');
    previewB.scrollTop = 80;
    await fireEvent.scroll(previewB);
    mockState.scrollPositions.set({ 'tab-a': 145, 'tab-b': 500 });
    mockState.note.set({ ...mockState.defaultNote, id: 'note-short', content: 'Short note' });
    await view.rerender({
      tab: { id: 'tab-short', type: 'note', title: 'Short', noteId: 'note-short' },
    });

    await waitFor(() =>
      expect(mockState.dispatch).toHaveBeenCalledWith({
        type: 'tabState/saveScrollPosition',
        payload: ['tab-b', 80],
      }),
    );
    expect(mockState.dispatch).not.toHaveBeenCalledWith({
      type: 'tabState/saveScrollPosition',
      payload: ['tab-b', 500],
    });
    const shortSave = vi.fn();
    window.dispatchEvent(
      new CustomEvent('note:save-scroll-position', { detail: { callback: shortSave } }),
    );
    expect(shortSave).toHaveBeenCalledWith(0);
  });

  it.each([
    { state: 'editor', note: { ...mockState.defaultNote }, loading: false, initialized: true },
    {
      state: 'empty',
      note: { ...mockState.defaultNote, content: '' },
      loading: false,
      initialized: true,
    },
    { state: 'loading', note: undefined, loading: true, initialized: false },
    { state: 'missing', note: undefined, loading: false, initialized: true },
  ])('labels the $state note content surface', async ({ state, note, loading, initialized }) => {
    mockState.note.set(note);
    mockState.notesState.set({ loading, initialized });
    const { container } = render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });

    await waitFor(() =>
      expect(
        container
          .querySelector('[data-note-content-surface]')
          ?.getAttribute('data-note-content-state'),
      ).toBe(state),
    );
  });

  it('labels the initial Spec writing view as read-only', async () => {
    mockState.note.set({ ...mockState.defaultNote, id: 'spec', content: '' });
    mockState.initialSpecWriteInProgress.set(true);
    mockState.noteViewMode.set('preview');
    const { container } = render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Spec', noteId: 'spec' } },
    });

    await waitFor(() =>
      expect(
        container
          .querySelector('[data-note-content-surface]')
          ?.getAttribute('data-note-content-state'),
      ).toBe('read-only'),
    );
    expect(screen.queryByTestId('rendered-note-preview')).toBeNull();
  });

  it('offers font and spellcheck controls in the Display section', async () => {
    render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    expect(screen.getByRole('group', { name: /Font Style/i })).toBeTruthy();

    expect(
      screen.getByRole('menuitemradio', { name: /Sans-serif/ }).getAttribute('aria-checked'),
    ).toBe('true');
    await fireEvent.click(await screen.findByRole('menuitemradio', { name: /Serif/ }));
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

    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy full note' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('Note content'));
    const callsBeforeUnmount = clearTimeoutSpy.mock.calls.length;

    unmount();

    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);
  });
});
