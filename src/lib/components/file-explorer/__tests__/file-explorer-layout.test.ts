import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { filesReadSaga } from '$store/renderer/slices/files/sagas/files-read-saga';
import { filesWriteSaga } from '$store/renderer/slices/files/sagas/files-write-saga';
import { selectFileContentEntry } from '$store/renderer/slices/files/files-selectors';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import FileExplorerLayout from '../file-explorer-layout.svelte';

vi.mock('../file-explorer-sidebar.svelte', async () => ({
  default: (await import('../../chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/editor/CodeEditor.svelte', async () => ({
  default: (await import('$features/layout/tab-types/__tests__/mocks/MockCodeEditor.svelte'))
    .default,
}));
vi.mock('$store/renderer/slices/file-explorer/file-explorer-selectors', () => ({
  selectEffectiveFileExplorerWorkspacePath: () => ({
    subscribe: (run: (value: string) => void) => {
      run('/repo');
      return () => {};
    },
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('standalone file explorer uses canonical file operations', () => {
  let stopRead: () => void;
  let stopWrite: () => void;
  beforeEach(() => {
    appStore.init();
    stopRead = appStore.runSaga(filesReadSaga);
    stopWrite = appStore.runSaga(filesWriteSaga);
  });
  afterEach(() => {
    cleanup();
    stopRead();
    stopWrite();
    appStore.dispatch(workspaceUnmounted('ws-1'));
    appStore.dispatch(workspaceUnmounted('ws-2'));
    vi.restoreAllMocks();
  });

  it('does not apply a late selection read to the current editor and saves only on explicit intent', async () => {
    const old = deferred<Awaited<ReturnType<typeof appClient.files.read>>>();
    const read = vi
      .spyOn(appClient.files, 'read')
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ originalContent: 'current', localContent: 'current' });
    const write = vi.spyOn(appClient.files, 'write').mockResolvedValue({ success: true });
    const view = render(FileExplorerLayout, { workspaceId: 'ws-1', initialFile: '/repo/old.ts' });
    await waitFor(() => expect(read).toHaveBeenCalledWith('ws-1', 'old.ts'));
    await view.rerender({ workspaceId: 'ws-1', initialFile: '/repo/current.ts' });
    const editor = (await screen.findByTestId('code-editor')) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toBe('current'));
    old.resolve({ originalContent: 'late old', localContent: 'late old' });
    await waitFor(() =>
      expect(selectFileContentEntry.select(appStore.state, 'ws-1', 'old.ts')?.originalContent).toBe(
        'late old',
      ),
    );
    expect(editor.value).toBe('current');
    await fireEvent.input(editor, { target: { value: 'explicit draft' } });
    expect(selectFileContentEntry.select(appStore.state, 'ws-1', 'current.ts')?.localContent).toBe(
      'explicit draft',
    );
    expect(write).not.toHaveBeenCalled();
    await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(write).toHaveBeenCalledWith('ws-1', 'current.ts', 'explicit draft'));
    expect(
      selectFileContentEntry.select(appStore.state, 'ws-1', 'current.ts')?.originalContent,
    ).toBe('explicit draft');
  });

  it('isolates the same path across workspaces and does not flush manual drafts on teardown', async () => {
    vi.spyOn(appClient.files, 'read').mockImplementation(async (workspaceId) => ({
      originalContent: workspaceId,
      localContent: workspaceId,
    }));
    const write = vi.spyOn(appClient.files, 'write').mockResolvedValue({ success: true });
    const view = render(FileExplorerLayout, { workspaceId: 'ws-1', initialFile: '/repo/a.ts' });
    await waitFor(() =>
      expect((screen.getByTestId('code-editor') as HTMLTextAreaElement).value).toBe('ws-1'),
    );
    await fireEvent.input(screen.getByTestId('code-editor'), { target: { value: 'first draft' } });
    await view.rerender({ workspaceId: 'ws-2', initialFile: '/repo/a.ts' });
    await waitFor(() =>
      expect((screen.getByTestId('code-editor') as HTMLTextAreaElement).value).toBe('ws-2'),
    );
    expect(selectFileContentEntry.select(appStore.state, 'ws-1', 'a.ts')?.localContent).toBe(
      'first draft',
    );
    view.unmount();
    expect(write).not.toHaveBeenCalled();
  });
});
