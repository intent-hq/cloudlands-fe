import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteVersions: () => ({
    subscribe: (run: (value: unknown) => void) => {
      run({
        versions: [
          {
            versionId: 'v1',
            versionNumber: 1,
            content: 'First',
            createdAt: '2026-10-10T00:00:00Z',
          },
          {
            versionId: 'v2',
            versionNumber: 2,
            content: 'Second',
            createdAt: '2026-10-11T00:00:00Z',
          },
        ],
        loading: false,
        error: null,
      });
      return () => {};
    },
  }),
}));
vi.mock('$features/file-tracking/components/diff/DiffViewer.svelte', async () => ({
  default: (
    await import('$features/file-tracking/components/diff/__tests__/mocks/MockDiffViewer.svelte')
  ).default,
}));
import NoteVersionHistory from '../NoteVersionHistory.svelte';

afterEach(() => {
  cleanup();
  mocks.dispatch.mockClear();
});

it('does not mount a hidden full-note diff and shows the latest content when opened', async () => {
  const props = {
    workspace: { id: 'ws' },
    noteId: 'note',
    currentContent: 'initial',
    visible: false,
  };
  const view = render(NoteVersionHistory, { props });
  expect(screen.queryByTestId('new-content')).toBeNull();
  expect(mocks.dispatch).not.toHaveBeenCalled();
  await view.rerender({ ...props, currentContent: 'updated while hidden' });
  expect(screen.queryByTestId('new-content')).toBeNull();
  await view.rerender({ ...props, currentContent: 'updated while hidden', visible: true });
  expect(screen.getByTestId('new-content').textContent).toBe('updated while hidden\n');
  expect(screen.getByTestId('old-content').textContent).toBe('Second\n');
  expect(mocks.dispatch).toHaveBeenCalledTimes(1);
});

it('releases hidden diff rendering while preserving selection and restore behavior', async () => {
  const onRestore = vi.fn();
  const props = {
    workspace: { id: 'ws' },
    noteId: 'note',
    currentContent: 'current',
    visible: true,
    onRestore,
  };
  const view = render(NoteVersionHistory, { props });
  await fireEvent.click(screen.getByRole('button', { name: /V2/ }));
  expect(screen.getByTestId('new-content').textContent).toBe('Second\n');
  expect(screen.getByTestId('old-content').textContent).toBe('First\n');
  await view.rerender({ ...props, visible: false });
  expect(screen.queryByTestId('new-content')).toBeNull();
  await view.rerender({ ...props, currentContent: 'a newer draft' });
  expect(screen.getByTestId('new-content').textContent).toBe('Second\n');
  expect(screen.getByTestId('old-content').textContent).toBe('First\n');
  await fireEvent.click(screen.getByRole('button', { name: /Restore/i }));
  expect(onRestore).toHaveBeenCalledWith('v2');
});
