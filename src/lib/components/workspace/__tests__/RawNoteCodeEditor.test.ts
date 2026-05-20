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
    lineWrapping: store(true),
    noteSelect: vi.fn(() => ({ id: 'note-1' })),
  };
});

vi.mock('$lib/components/editor/CodeEditor.svelte', async () => ({
  default: (await import('$features/layout/tab-types/__tests__/mocks/MockCodeEditor.svelte'))
    .default,
}));
vi.mock('$lib/store/utils/svelte-context', () => ({ getDispatch: () => mockState.dispatch }));
vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mockState.dispatch,
  });
});
vi.mock('$lib/store/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: { select: mockState.noteSelect },
}));
vi.mock('$lib/store/slices/workspace-notes/workspace-notes-slice', () => ({
  updateNoteContent: (workspaceId: string, noteId: string, content: string) => ({
    type: 'workspaceNotes/updateNoteContent',
    payload: [workspaceId, noteId, content],
  }),
}));
vi.mock('$lib/store/slices/ui-layout/ui-layout-selectors', () => ({
  selectLineWrapping: () => mockState.lineWrapping,
}));

import RawNoteCodeEditor from '../RawNoteCodeEditor.svelte';

describe('RawNoteCodeEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockState.dispatch.mockClear();
    mockState.noteSelect.mockClear();
    mockState.noteSelect.mockReturnValue({ id: 'note-1' });
    mockState.lineWrapping.set(true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the raw note with Markdown CodeEditor settings', () => {
    render(RawNoteCodeEditor, {
      props: {
        workspaceId: 'ws-1',
        noteId: 'note-1',
        content: '# Heading',
        isPanelFocused: true,
      },
    });

    const editor = screen.getByTestId('code-editor');
    expect(screen.getByTestId('raw-note-view')).toBeTruthy();
    expect(editor.getAttribute('data-initial-value')).toBe('# Heading');
    expect((editor as HTMLTextAreaElement).value).toBe('# Heading');
    expect(editor.getAttribute('data-language')).toBe('markdown');
    expect(editor.getAttribute('data-file-name')).toBe('.workspace/notes/note-1.md');
    expect(editor.getAttribute('data-file-path')).toBe('.workspace/notes/note-1.md');
    expect(editor.getAttribute('data-line-wrapping')).toBe('true');
    expect(editor.getAttribute('data-panel-focused')).toBe('true');
  });

  it('debounces editable raw note updates through the note update action', async () => {
    render(RawNoteCodeEditor, {
      props: { workspaceId: 'ws-1', noteId: 'note-1', content: '# Heading' },
    });

    await fireEvent.input(screen.getByTestId('code-editor'), {
      target: { value: '# Updated' },
    });

    expect(mockState.dispatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockState.noteSelect).toHaveBeenCalledWith({}, 'ws-1', 'note-1');
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'workspaceNotes/updateNoteContent',
      payload: ['ws-1', 'note-1', '# Updated'],
    });
  });

  it('updates editor content when the note content prop changes externally', async () => {
    const { rerender } = render(RawNoteCodeEditor, {
      props: { workspaceId: 'ws-1', noteId: 'note-1', content: '# Heading' },
    });

    await rerender({ workspaceId: 'ws-1', noteId: 'note-1', content: '# External Update' });

    expect((screen.getByTestId('code-editor') as HTMLTextAreaElement).value).toBe(
      '# External Update',
    );
  });

  it('does not overwrite active user edits with external content changes', async () => {
    const { rerender } = render(RawNoteCodeEditor, {
      props: { workspaceId: 'ws-1', noteId: 'note-1', content: '# Heading' },
    });

    await fireEvent.input(screen.getByTestId('code-editor'), {
      target: { value: '# Local Draft' },
    });
    await rerender({ workspaceId: 'ws-1', noteId: 'note-1', content: '# External Update' });

    expect((screen.getByTestId('code-editor') as HTMLTextAreaElement).value).toBe('# Local Draft');
  });

  it('flushes pending raw note updates on unmount', async () => {
    const { unmount } = render(RawNoteCodeEditor, {
      props: { workspaceId: 'ws-1', noteId: 'note-1', content: '# Heading' },
    });

    await fireEvent.input(screen.getByTestId('code-editor'), {
      target: { value: '# Updated Before Toggle' },
    });
    unmount();

    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'workspaceNotes/updateNoteContent',
      payload: ['ws-1', 'note-1', '# Updated Before Toggle'],
    });
  });

  it('keeps the original note target for pending debounced saves after props change', async () => {
    const { rerender, unmount } = render(RawNoteCodeEditor, {
      props: { workspaceId: 'ws-1', noteId: 'note-1', content: '# Note 1' },
    });

    await fireEvent.input(screen.getByTestId('code-editor'), {
      target: { value: '# Note 1 Draft' },
    });
    await rerender({ workspaceId: 'ws-1', noteId: 'note-2', content: '# Note 2' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockState.noteSelect).toHaveBeenCalledWith({}, 'ws-1', 'note-1');
    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'workspaceNotes/updateNoteContent',
      payload: ['ws-1', 'note-1', '# Note 1 Draft'],
    });
    expect(mockState.dispatch).not.toHaveBeenCalledWith({
      type: 'workspaceNotes/updateNoteContent',
      payload: ['ws-1', 'note-2', '# Note 1 Draft'],
    });

    mockState.dispatch.mockClear();
    unmount();

    expect(mockState.dispatch).not.toHaveBeenCalledWith({
      type: 'workspaceNotes/updateNoteContent',
      payload: ['ws-1', 'note-2', '# Note 1 Draft'],
    });
  });
});
