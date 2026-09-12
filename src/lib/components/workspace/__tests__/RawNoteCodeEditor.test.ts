import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

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
    updateNoteContent: vi.fn(),
  };
});

vi.mock('$lib/components/editor/CodeEditor.svelte', async () => ({
  default: (await import('$features/layout/tab-types/__tests__/mocks/MockCodeEditor.svelte'))
    .default,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mockState.dispatch,
  });
});
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: { select: mockState.noteSelect },
}));
vi.mock('$features/notes/notes-write-service', () => ({
  updateNoteContent: mockState.updateNoteContent,
}));
vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectLineWrapping: () => mockState.lineWrapping,
}));

import RawNoteCodeEditor from '../RawNoteCodeEditor.svelte';

describe('RawNoteCodeEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockState.dispatch.mockClear();
    mockState.updateNoteContent.mockClear();
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

    expect(mockState.updateNoteContent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockState.noteSelect).toHaveBeenCalledWith({}, 'ws-1', 'note-1');
    expect(mockState.updateNoteContent).toHaveBeenCalledWith('ws-1', 'note-1', '# Updated', {
      immediate: false,
    });
  });

  // The draft is saved against the rev of the text it was typed on. A
  // note:updated refetch during the 1 s debounce advances the store; without
  // the base rev the write-service would send the refetched rev and the daemon
  // would treat the draft as an exact write over the agent's change.
  it('saves a draft against the rev it was typed on, not a rev refetched during the debounce', async () => {
    const { rerender } = render(RawNoteCodeEditor, {
      props: { workspaceId: 'ws-1', noteId: 'note-1', content: '# Heading', rev: 4 },
    });

    await fireEvent.input(screen.getByTestId('code-editor'), {
      target: { value: '# Heading local' },
    });
    await rerender({
      workspaceId: 'ws-1',
      noteId: 'note-1',
      content: '# AGENT\n# Heading',
      rev: 5,
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockState.updateNoteContent).toHaveBeenCalledWith('ws-1', 'note-1', '# Heading local', {
      immediate: false,
      baseRev: 4,
    });
  });

  it('bases the next draft on the rev of an external update it synced to', async () => {
    const { rerender } = render(RawNoteCodeEditor, {
      props: { workspaceId: 'ws-1', noteId: 'note-1', content: '# Heading', rev: 4 },
    });

    await rerender({
      workspaceId: 'ws-1',
      noteId: 'note-1',
      content: '# AGENT\n# Heading',
      rev: 5,
    });
    await fireEvent.input(screen.getByTestId('code-editor'), {
      target: { value: '# AGENT\n# Heading local' },
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockState.updateNoteContent).toHaveBeenCalledWith(
      'ws-1',
      'note-1',
      '# AGENT\n# Heading local',
      { immediate: false, baseRev: 5 },
    );
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

    expect(mockState.updateNoteContent).toHaveBeenCalledWith(
      'ws-1',
      'note-1',
      '# Updated Before Toggle',
      { immediate: true },
    );
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
    expect(mockState.updateNoteContent).toHaveBeenCalledWith('ws-1', 'note-1', '# Note 1 Draft', {
      immediate: false,
    });
    expect(mockState.updateNoteContent).not.toHaveBeenCalledWith(
      'ws-1',
      'note-2',
      '# Note 1 Draft',
      expect.anything(),
    );

    mockState.updateNoteContent.mockClear();
    unmount();

    expect(mockState.updateNoteContent).not.toHaveBeenCalledWith(
      'ws-1',
      'note-2',
      '# Note 1 Draft',
      expect.anything(),
    );
  });
});
