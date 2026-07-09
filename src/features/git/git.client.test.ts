/**
 * Wire-contract tests for the daemon-backed GitClient methods (4C-3).
 *
 * FAKE transport only: `backendRequest` is mocked so no request ever reaches
 * a real daemon. Each test asserts the JSON-RPC method + params the client
 * emits (PROTOCOL.md §5.6) and how the daemon result / error folds into the
 * historical `Result<T, string>` contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { gitClient } from './git.client';
import type { WorkspaceId } from '../../shared/types';

const mockedRequest = vi.mocked(backendRequest);
const wsId = 'ws-1' as WorkspaceId;

describe('GitClient daemon-backed wire contract (fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('getStatus forwards git.status and returns the daemon GitStatus verbatim', async () => {
    const daemonStatus = {
      branch: 'main',
      ahead: 1,
      behind: 0,
      diverged: false,
      files: [{ path: 'a.ts', status: 'modified', staged: true }],
      hasUncommittedChanges: true,
      hasUntrackedFiles: false,
    };
    mockedRequest.mockResolvedValueOnce(daemonStatus);

    const result = await gitClient.getStatus(wsId);

    expect(mockedRequest).toHaveBeenCalledWith('git.status', { workspaceId: wsId });
    expect(result).toEqual({ ok: true, data: daemonStatus });
  });

  it('getStatus folds transport/daemon errors into { ok: false, error }', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('daemon unavailable'));

    const result = await gitClient.getStatus(wsId);

    expect(result).toEqual({ ok: false, error: 'daemon unavailable' });
  });

  it('stageFiles forwards git.stage with explicit paths', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, paths: ['a.ts', 'b.ts'] });

    const result = await gitClient.stageFiles(wsId, ['a.ts', 'b.ts']);

    expect(mockedRequest).toHaveBeenCalledWith('git.stage', {
      workspaceId: wsId,
      paths: ['a.ts', 'b.ts'],
    });
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('unstageFiles forwards git.unstage and folds rejections', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('Staging all files is not allowed'));

    const result = await gitClient.unstageFiles(wsId, ['a.ts']);

    expect(mockedRequest).toHaveBeenCalledWith('git.unstage', {
      workspaceId: wsId,
      paths: ['a.ts'],
    });
    expect(result).toEqual({ ok: false, error: 'Staging all files is not allowed' });
  });

  it('commit forwards git.agentCommit with userRequested: true and maps the hash', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, hash: 'abc1234', files: [], fileCount: 0 });

    const result = await gitClient.commit(wsId, 'fix: thing');

    expect(mockedRequest).toHaveBeenCalledWith('git.agentCommit', {
      workspaceId: wsId,
      message: 'fix: thing',
      userRequested: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.hash).toBe('abc1234');
  });

  it('getHistory forwards git.commits with limit and unwraps the items page', async () => {
    const items = [
      {
        hash: 'aaaa111',
        sha: 'aaaa111',
        author: 'Dev',
        email: 'dev@example.com',
        date: '2026-07-01T00:00:00Z',
        message: 'feat: one',
        files: ['a.ts'],
      },
    ];
    mockedRequest.mockResolvedValueOnce({ items, nextToken: null });

    const result = await gitClient.getHistory(wsId, 5);

    expect(mockedRequest).toHaveBeenCalledWith('git.commits', { workspaceId: wsId, limit: 5 });
    expect(result).toEqual({ ok: true, data: items });
  });

  it('getHistory omits limit when not provided and folds errors', async () => {
    mockedRequest.mockResolvedValueOnce({ items: [], nextToken: null });
    await gitClient.getHistory(wsId);
    expect(mockedRequest).toHaveBeenCalledWith('git.commits', { workspaceId: wsId });

    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const failed = await gitClient.getHistory(wsId);
    expect(failed).toEqual({ ok: false, error: 'boom' });
  });

  it('showFile forwards git.showFile and unwraps { content }', async () => {
    mockedRequest.mockResolvedValueOnce({ content: 'file body at ref' });

    const result = await gitClient.showFile(wsId, 'src/a.ts', ':0');

    expect(mockedRequest).toHaveBeenCalledWith('git.showFile', {
      workspaceId: wsId,
      filePath: 'src/a.ts',
      ref: ':0',
    });
    expect(result).toEqual({ ok: true, data: 'file body at ref' });
  });

  it('showFile folds a malformed payload to empty content and folds errors', async () => {
    mockedRequest.mockResolvedValueOnce({});
    await expect(gitClient.showFile(wsId, 'a.ts', 'HEAD')).resolves.toEqual({
      ok: true,
      data: '',
    });

    mockedRequest.mockRejectedValueOnce(new Error('unresolvable ref'));
    await expect(gitClient.showFile(wsId, 'a.ts', 'nope')).resolves.toEqual({
      ok: false,
      error: 'unresolvable ref',
    });
  });

  it('getCommitDetails forwards git.commitDetails and maps the wire envelope', async () => {
    mockedRequest.mockResolvedValueOnce({
      commitHash: 'abc1234',
      author: 'Dev',
      authorEmail: 'dev@example.com',
      date: '2026-07-01T00:00:00Z',
      message: 'feat: one',
      files: ['a.ts'],
      fileDetails: [{ path: 'a.ts', additions: 3, deletions: 1 }],
    });

    const details = await gitClient.getCommitDetails(wsId, 'abc1234');

    expect(mockedRequest).toHaveBeenCalledWith('git.commitDetails', {
      workspaceId: wsId,
      commitHash: 'abc1234',
    });
    expect(details).toEqual({
      hash: 'abc1234',
      author: 'Dev',
      email: 'dev@example.com',
      date: '2026-07-01T00:00:00Z',
      message: 'feat: one',
      files: ['a.ts'],
      fileDetails: [{ path: 'a.ts', additions: 3, deletions: 1 }],
    });
  });

  it('getCommitDetails keeps its historical throwing contract on errors', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('unknown hash'));
    await expect(gitClient.getCommitDetails(wsId, 'dead')).rejects.toThrow('unknown hash');
  });
});
