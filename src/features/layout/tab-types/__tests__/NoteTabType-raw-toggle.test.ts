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
    contentLength: undefined as number | undefined,
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
    loadContent: vi.fn(async () => true),
    pageSession: store<{ status: string } | undefined>(undefined),
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

vi.mock('$features/notes/virtualized/NoteReadingView.svelte', async () => ({
  default: (await import('./mocks/MockNoteReadingView.svelte')).default,
}));
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
vi.mock('$features/notes/notes-read-service', () => ({
  ensureNoteContentLoaded: mockState.loadContent,
}));
vi.mock('$store/renderer/slices/note-pages/note-pages-selectors', () => ({
  selectNotePageSession: () => mockState.pageSession,
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
    mockState.loadContent.mockClear();
    mockState.pageSession.set(undefined);
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
    const viewMenu = screen.getByRole('menuitem', { name: /Note view/ });
    viewMenu.focus();
    await fireEvent.keyDown(viewMenu, { key: 'ArrowRight' });

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

    mockState.noteViewMode.set('raw');
    await waitFor(() =>
      expect(
        screen.getByRole('menuitemradio', { name: 'Editor' }).getAttribute('aria-checked'),
      ).toBe('false'),
    );
    await fireEvent.click(screen.getByRole('menuitemradio', { name: 'Editor' }));
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'transientUi/setNoteViewMode',
      payload: ['ws-1', 'note-1', 'editor'],
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

  it('changes font in a submenu and keeps spellcheck independently toggleable', async () => {
    render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    const fontMenu = screen.getByRole('menuitem', { name: /^Font/ });
    fontMenu.focus();
    await fireEvent.keyDown(fontMenu, { key: 'ArrowRight' });

    expect(
      screen.getByRole('menuitemradio', { name: /Sans-serif/ }).getAttribute('aria-checked'),
    ).toBe('true');
    await fireEvent.click(await screen.findByRole('menuitemradio', { name: /Serif/ }));
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'fontSettings/setNoteFontStyle',
      payload: ['serif'],
    });
    await fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Serif' }), {
      key: 'ArrowLeft',
    });

    const spellcheck = screen.getByRole('menuitemcheckbox', { name: 'Spellcheck' });
    expect(spellcheck.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(spellcheck);
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'userPreferences/toggleSpellcheck',
    });
  });

  it('does not toggle spellcheck from a read-only preview and explains why', async () => {
    mockState.noteViewMode.set('preview');
    render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } },
    });
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    const spellcheck = screen.getByRole('menuitemcheckbox', { name: 'Spellcheck' });
    expect(spellcheck.getAttribute('aria-disabled')).toBe('true');
    const explanation = document.getElementById(spellcheck.getAttribute('aria-describedby')!);
    expect(explanation?.textContent?.length).toBeGreaterThan(0);
    await fireEvent.click(spellcheck);
    expect(mockState.dispatch).not.toHaveBeenCalledWith({
      type: 'userPreferences/toggleSpellcheck',
    });
  });

  it('preserves spec protection while exposing deletion only for ordinary notes', async () => {
    const { rerender } = render(NoteTabTypeHeaderHarness, {
      props: { tab: { id: 'tab-1', type: 'note', title: 'Spec', noteId: 'spec' } },
    });
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Delete note' })).toBeNull();
    await rerender({ tab: { id: 'tab-1', type: 'note', title: 'Note', noteId: 'note-1' } });
    const deletion = await screen.findByRole('menuitem', { name: 'Delete note' });
    await fireEvent.click(deletion);
    const { deleteNote } = await import('$features/notes/notes-write-service');
    expect(deleteNote).toHaveBeenCalledExactlyOnceWith('ws-1', 'note-1');
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

  it('an explicitly supplied paged surface never fetches a complete slim-note body', async () => {
    mockState.note.set({ ...mockState.defaultNote, content: '', contentLength: 3_000_000 });
    const surface = {
      resourceLimits: {
        payloadBytes: 262144,
        stringUnits: 786432,
        objectNodes: 262144,
        domNodes: 0,
        physicalReads: 4,
        assemblies: 0,
      },
      copyDocument: vi.fn(async () => {}),
      selectionChanged: vi.fn(),
      fullOperation: vi.fn(),
    };
    render(NoteTabTypeHeaderHarness, {
      tab: { id: 'tab-paged', type: 'note', noteId: 'note-1' },
      readingSurface: surface,
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(mockState.loadContent).not.toHaveBeenCalled();
    const actionTypes = mockState.dispatch.mock.calls.map(([action]) => action.type);
    expect(actionTypes.indexOf('notePages/resourceLimitsConfigured')).toBeGreaterThanOrEqual(0);
    expect(actionTypes.indexOf('notePages/resourceLimitsConfigured')).toBeLessThan(
      actionTypes.indexOf('notePages/panelOpened'),
    );
    const clipboard = { writeText: vi.fn(async () => {}) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy full note' }));
    await waitFor(() => expect(surface.copyDocument).toHaveBeenCalledTimes(1));
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
  it('retires an actual staged copy owner on tab unmount while its sink is held', async () => {
    const a = await import('$store/renderer/slices/note-pages/note-pages-slice');
    const { createNoteDocumentSession } =
      await import('$features/notes/virtualized/editing/note-document-edit-session');
    const { createNoteSourceCopyOwner } =
      await import('$features/notes/virtualized/editing/note-source-copy');
    const scope = {
      backendId: 'backend',
      workspaceId: 'ws-1',
      noteId: 'note-1',
      noteInstanceId: 'incarnation',
    };
    let state = a.notePagesReducer(undefined, a.pagePanelOpened('ws-1', 'note-1', 'tab-copy'));
    state = {
      ...state,
      byWorkspaceId: {
        'ws-1': {
          notes: {
            'note-1': {
              ...state.byWorkspaceId['ws-1'].notes['note-1'],
              status: 'ready',
              document: createNoteDocumentSession(scope, 'r1', 3),
              state: {
                kind: 'notePageState',
                scope,
                sourceRevision: 'r1',
                stateGeneration: '1',
                commentRevision: '1',
                attributionGeneration: '1',
                attributionState: 'ready',
                deleted: false,
                invalidation: 'all',
              },
            },
          },
        },
      },
    };
    const limits = {
      payloadBytes: 10000000,
      stringUnits: 10000000,
      objectNodes: 100000,
      domNodes: 0,
      physicalReads: 1,
      assemblies: 1,
    };
    state = a.notePagesReducer(state, a.pageResourceLimitsConfigured(limits));
    const listeners = new Set<() => void>();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const sink = {
      write: vi.fn(async () => {
        await held;
      }),
      commit: vi.fn(),
      abort: vi.fn(async () => {}),
    };
    const stage = {
      begin: vi.fn(async () => {}),
      append: vi.fn(async () => {}),
      seal: vi.fn(async () => 3),
      read: vi.fn(async (consume: (text: string) => Promise<void>) => {
        await consume('abc');
        return true;
      }),
      cancel: vi.fn(async () => {}),
    };
    const owner = createNoteSourceCopyOwner({
      workspaceId: 'ws-1',
      noteId: 'note-1',
      editorSessionId: 'editor',
      selectionGeneration: () => 3,
      current: () => true,
      client: { createSourceOperation: () => stage },
      openSink: async () => sink,
      port: {
        read: () => state,
        dispatch(action) {
          state = a.notePagesReducer(state, action);
          listeners.forEach((fn) => fn());
        },
        subscribe(fn) {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
      },
    });
    const surface = {
      ...owner,
      resourceLimits: limits,
      selectionChanged: vi.fn(),
      fullOperation: vi.fn(),
    };
    mockState.note.set({ ...mockState.defaultNote, content: '', contentLength: 3000000 });
    const clipboard = { writeText: vi.fn(async () => {}) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    const { unmount } = render(NoteTabTypeHeaderHarness, {
      tab: { id: 'tab-copy', type: 'note', noteId: 'note-1' },
      readingSurface: surface,
    });
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy full note' }));
    await waitFor(() => expect(sink.write).toHaveBeenCalledWith('abc'));
    unmount();
    expect(state.resourceLedger.used.physicalReads).toBe(1);
    finish();
    await waitFor(() => expect(sink.abort).toHaveBeenCalledOnce());
    expect(sink.commit).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(mockState.loadContent).not.toHaveBeenCalled();
    expect(state.resourceLedger.used.physicalReads).toBe(0);
    expect(listeners.size).toBe(0);
  });

  it('explicit legacy capability restores complete-note loading instead of a partial editor', async () => {
    mockState.pageSession.set({ status: 'legacy' });
    mockState.note.set({ ...mockState.defaultNote, content: '', contentLength: 3_000_000 });
    const surface = {
      resourceLimits: {
        payloadBytes: 262144,
        stringUnits: 786432,
        objectNodes: 262144,
        domNodes: 0,
        physicalReads: 4,
        assemblies: 0,
      },
      copyDocument: vi.fn(async () => {}),
      selectionChanged: vi.fn(),
      fullOperation: vi.fn(),
    };
    render(NoteTabTypeHeaderHarness, {
      tab: { id: 'tab-legacy', type: 'note', noteId: 'note-1' },
      readingSurface: surface,
    });
    await waitFor(() => expect(mockState.loadContent).toHaveBeenCalledWith('ws-1', 'note-1'));
  });
  it('keeps the page session owned while a prepared tab uses legacy compatibility', async () => {
    const { pagePanelOpened, pagePanelClosed } =
      await import('$store/renderer/slices/note-pages/note-pages-slice');
    mockState.pageSession.set({ status: 'legacy' });
    const surface = {
      resourceLimits: {
        payloadBytes: 262144,
        stringUnits: 786432,
        objectNodes: 262144,
        domNodes: 0,
        physicalReads: 4,
        assemblies: 0,
      },
      copyDocument: vi.fn(async () => {}),
      selectionChanged: vi.fn(),
      fullOperation: vi.fn(),
    };
    const { unmount } = render(NoteTabTypeHeaderHarness, {
      tab: { id: 'tab-legacy-owner', type: 'note', noteId: 'note-1' },
      readingSurface: surface,
    });
    await waitFor(() =>
      expect(mockState.dispatch).toHaveBeenCalledWith(
        pagePanelOpened('ws-1', 'note-1', 'tab-legacy-owner'),
      ),
    );
    mockState.dispatch.mockClear();
    mockState.pageSession.set({ status: 'connecting' });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(mockState.dispatch).not.toHaveBeenCalledWith(
      pagePanelClosed('ws-1', 'note-1', 'tab-legacy-owner'),
    );
    unmount();
    expect(mockState.dispatch).toHaveBeenCalledWith(
      pagePanelClosed('ws-1', 'note-1', 'tab-legacy-owner'),
    );
  });
});

describe('paged selection copy callback', () => {
  it.each(['copied', 'noCopy', 'failure'] as const)(
    'routes selection copy without a source fallback (%s)',
    async (result) => {
      const surface = {
        resourceLimits: {
          payloadBytes: 1,
          stringUnits: 1,
          objectNodes: 1,
          domNodes: 0,
          physicalReads: 1,
          assemblies: 1,
        },
        copyDocument: vi.fn(async () => {}),
        copySelection: vi.fn(async () => {
          if (result === 'failure') throw new Error('Unsupported');
          return result;
        }),
        cancelSelectionCopy: vi.fn(),
        cancelRenderedSearch: vi.fn(),
        cancelMarkerSource: vi.fn(),
        selectionChanged: vi.fn(),
        fullOperation: vi.fn(),
      };
      const { unmount } = render(NoteTabTypeHeaderHarness, {
        tab: { id: 'selection-tab', type: 'note', noteId: 'note-1' },
        readingSurface: surface,
      });
      await fireEvent.click(await screen.findByRole('button', { name: 'Copy selected note text' }));
      await waitFor(() => expect(surface.copySelection).toHaveBeenCalledOnce());
      expect(surface.copyDocument).not.toHaveBeenCalled();
      expect(surface.fullOperation).not.toHaveBeenCalled();
      unmount();
      expect(surface.cancelSelectionCopy).toHaveBeenCalledOnce();
      expect(surface.cancelRenderedSearch).toHaveBeenCalledOnce();
      expect(surface.cancelMarkerSource).toHaveBeenCalledOnce();
    },
  );
  it('preserves explicit full-operation handling when selection adapter is absent', async () => {
    const surface = {
      resourceLimits: {
        payloadBytes: 1,
        stringUnits: 1,
        objectNodes: 1,
        domNodes: 0,
        physicalReads: 1,
        assemblies: 1,
      },
      copyDocument: vi.fn(async () => {}),
      selectionChanged: vi.fn(),
      fullOperation: vi.fn(),
    };
    render(NoteTabTypeHeaderHarness, {
      tab: { id: 'selection-unsupported', type: 'note', noteId: 'note-1' },
      readingSurface: surface,
    });
    await fireEvent.click(await screen.findByRole('button', { name: 'Copy selected note text' }));
    expect(surface.fullOperation).toHaveBeenCalledWith('copy', {
      anchor: 1,
      head: 2,
      anchorAffinity: 1,
      headAffinity: -1,
    });
    expect(surface.copyDocument).not.toHaveBeenCalled();
  });
});
