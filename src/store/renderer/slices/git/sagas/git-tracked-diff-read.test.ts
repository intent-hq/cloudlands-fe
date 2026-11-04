/**
 * Committed-stage tracked diffs read `git.diffs` with `commitHash`. When the
 * bounded read (PROTOCOL §5.6) serves the file without hunks, the diff is
 * rendered from the commit's two sides read with `git.showFile`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runSaga } from 'redux-saga';

const diffs = vi.hoisted(() => vi.fn());
vi.mock('$lib/client', () => ({ appClient: { git: { diffs } } }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
vi.mock(
  '$lib/electron-bridge',
  async () => await import('$store/renderer/utils/test-helpers/electron-bridge-mock'),
);
vi.mock('$store/renderer/store', () => ({ store: { state: {} } }));

import { backendRequest } from '$lib/client/live/backend-transport';
import { readTrackedDiff } from './git-tracked-diff-read';
import type { TrackedDiffReadRequest } from '../git-types';

const mockedRequest = vi.mocked(backendRequest);

const request: TrackedDiffReadRequest = {
  kind: 'trackedDiff',
  filePath: 'big.ts',
  workspacePath: '/ws',
  stage: 'committed',
  commitHash: 'abc',
  useProvidedContent: false,
  forceRefresh: false,
  allowHeadReads: true,
};

async function read() {
  return runSaga(
    {},
    readTrackedDiff,
    'ws-1',
    request,
    new AbortController().signal,
    () => true,
  ).toPromise();
}

describe('readTrackedDiff committed stage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the hunk chunk when the commit diff fits', async () => {
    const chunk = { file: 'big.ts', chunks: [{ lines: [] }] };
    diffs.mockResolvedValueOnce([chunk]);
    const result = await read();
    expect(result.chunk).toEqual(chunk);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('reads both commit sides when the file is too large for git.diffs', async () => {
    diffs.mockResolvedValueOnce([{ file: 'big.ts', chunks: [], truncatedReason: 'fileTooLarge' }]);
    mockedRequest.mockImplementation(async (_method: string, params?: unknown) => {
      const p = params as { ref: string; filePath: string };
      return { content: `${p.ref}:${p.filePath}` };
    });
    const result = await read();
    expect(result.chunk).toBeUndefined();
    expect(result.oldContent).toBe('abc^:big.ts');
    expect(result.newContent).toBe('abc:big.ts');
    expect(mockedRequest).toHaveBeenCalledWith('git.showFile', {
      workspaceId: 'ws-1',
      filePath: 'big.ts',
      ref: 'abc^',
      maxBytes: 480_000,
    });
  });
});
