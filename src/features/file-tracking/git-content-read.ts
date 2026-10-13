import { runSaga } from 'redux-saga';
import type { GitReadRequest, GitReadResult } from '$store/renderer/slices/git/git-types';
import { readTrackedDiff } from '$store/renderer/slices/git/sagas/git-tracked-diff-read';
import { normalizeCommitDetails, toDiffChunks } from '$lib/client/live/live-git-client';
import {
  dedupedGitNumstat,
  dedupedShowFile,
  type GitReadTransport,
} from './components/diff/diff-ipc-batcher';

/** Same request identity and mappings for initial demand and fenced recovery. */
export async function readGitContent(
  workspaceId: string,
  request: GitReadRequest,
  transport: GitReadTransport,
  signal: AbortSignal,
  canRead: () => boolean,
): Promise<GitReadResult> {
  const { kind, ...params } = request;
  switch (kind) {
    case 'showFile': {
      if (request.kind !== kind) throw new Error('Invalid Git read');
      const result = await dedupedShowFile(workspaceId, request.ref, request.filePath, {
        gitRootId: request.gitRootId,
        transport,
      });
      if (!result.success) throw new Error(result.error);
      return { kind, content: result.data ?? '' };
    }
    case 'numstat':
      return { kind, entries: await dedupedGitNumstat(workspaceId, { ...params, transport }) };
    case 'diffs':
      return {
        kind,
        chunks: toDiffChunks(await transport.request('git.diffs', { workspaceId, ...params })),
      };
    case 'commitDetails': {
      if (request.kind !== kind) throw new Error('Invalid Git read');
      const raw = await transport.request<Record<string, unknown>>('git.commitDetails', {
        workspaceId,
        ...params,
      });
      return { kind, details: normalizeCommitDetails(raw, request.commitHash) };
    }
    case 'trackedDiff': {
      if (request.kind !== kind) throw new Error('Invalid Git read');
      return runSaga(
        {},
        readTrackedDiff,
        workspaceId,
        request,
        signal,
        canRead,
        transport,
      ).toPromise();
    }
    case 'autoCommitStatus':
      throw new Error('Auto-commit reads use the operation owner');
  }
}
