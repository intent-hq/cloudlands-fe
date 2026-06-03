import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { invoke } from '$lib/electron-bridge';
import { batchedGitDiff } from '../diff-ipc-batcher';

vi.mock('$lib/electron-bridge', async () =>
  await import('$store/renderer/utils/test-helpers/electron-bridge-mock'),
);

describe('diff-ipc-batcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries missing paths when a mixed batch only returns a synthesized new-file chunk', async () => {
    const newChunk = { file: 'new-file.ts', oldContent: '', newContent: 'new file' };
    const modifiedChunk = {
      file: 'modified-file.ts',
      oldContent: 'old content',
      newContent: 'new content',
    };

    vi.mocked(invoke)
      .mockResolvedValueOnce({ success: true, data: [newChunk] })
      .mockResolvedValueOnce({ success: true, data: [modifiedChunk] });

    const newFilePromise = batchedGitDiff('workspace-1', false, 'new-file.ts');
    const modifiedFilePromise = batchedGitDiff('workspace-1', false, 'modified-file.ts');

    await vi.runAllTimersAsync();

    await expect(Promise.all([newFilePromise, modifiedFilePromise])).resolves.toEqual([
      newChunk,
      modifiedChunk,
    ]);
    expect(invoke).toHaveBeenNthCalledWith(1, 'git:diff', {
      workspaceId: 'workspace-1',
      staged: false,
      paths: ['new-file.ts', 'modified-file.ts'],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'git:diff', {
      workspaceId: 'workspace-1',
      staged: false,
      paths: ['modified-file.ts'],
    });
  });

  it('does not retry when the batch returns chunks for all requested paths', async () => {
    const firstChunk = { file: 'first.ts', oldContent: 'a', newContent: 'b' };
    const secondChunk = { file: 'second.ts', oldContent: 'c', newContent: 'd' };

    vi.mocked(invoke).mockResolvedValueOnce({ success: true, data: [firstChunk, secondChunk] });

    const firstPromise = batchedGitDiff('workspace-1', false, 'first.ts');
    const secondPromise = batchedGitDiff('workspace-1', false, 'second.ts');

    await vi.runAllTimersAsync();

    await expect(Promise.all([firstPromise, secondPromise])).resolves.toEqual([
      firstChunk,
      secondChunk,
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});