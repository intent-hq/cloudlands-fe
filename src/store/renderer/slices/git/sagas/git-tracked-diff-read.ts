import { call, type SagaGenerator } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { invoke } from '$lib/electron-bridge';
import {
  batchedGitBranchBaseDiff,
  batchedGitDiff,
  dedupedShowFile,
} from '$features/file-tracking/components/diff/diff-ipc-batcher';
import {
  gitlinkSidesFromHunks,
  gitlinkSidesFromShas,
  isGitlinkDiffChunk,
} from '$features/file-tracking/components/diff/gitlink';
import { m } from '$shared/paraglide/messages.js';
import type { FileReadResponse } from '../../files/files-types';
import type { GitReadResult, TrackedDiffReadRequest } from '../git-types';

const isRawDiff = (content: string) => /^(diff --git|---|@@)/.test(content);

export function* readTrackedDiff(
  workspaceId: string,
  request: TrackedDiffReadRequest,
  signal: AbortSignal,
  canRead: () => boolean,
): SagaGenerator<Extract<GitReadResult, { kind: 'trackedDiff' }>> {
  const { filePath, gitRootId, gitRootPath } = request;
  const result: Extract<GitReadResult, { kind: 'trackedDiff' }> = {
    kind: 'trackedDiff',
    oldContent: '',
    newContent: '',
    gitlink: Boolean(request.gitlink),
  };
  const old = request.providedOld ?? '';
  const next = request.providedNew ?? '';
  const hasProvided =
    request.providedOld !== undefined && request.providedNew !== undefined && Boolean(old || next);
  const validProvided = hasProvided && !isRawDiff(old) && !isRawDiff(next);
  const allowed = () => !signal.aborted && request.allowHeadReads && canRead();
  if (!allowed()) {
    if (!validProvided) throw new Error(m.chat_inlineDiffItem_transcriptUnavailable_label());
    return { ...result, oldContent: old, newContent: next };
  }
  if (
    !request.forceRefresh &&
    validProvided &&
    (request.useProvidedContent || request.stage === 'committed')
  ) {
    return { ...result, oldContent: old, newContent: next };
  }
  if (
    !request.forceRefresh &&
    !request.useProvidedContent &&
    !request.commitHash &&
    request.stage === 'committed' &&
    (request.baseRef || request.baseCommitSha)
  ) {
    const chunk = yield* call(
      batchedGitBranchBaseDiff,
      workspaceId,
      { baseRef: request.baseRef, baseCommitSha: request.baseCommitSha, signal, canRead: allowed },
      filePath,
    );
    return { ...result, oldContent: chunk?.oldContent ?? '', newContent: chunk?.newContent ?? '' };
  }
  if (request.stage === 'committed' && request.commitHash) {
    const chunks = yield* call([appClient.git, appClient.git.diffs], workspaceId, {
      commitHash: request.commitHash,
      path: filePath,
      ...(gitRootId ? { gitRootId } : {}),
    });
    return { ...result, chunk: chunks.find((chunk) => chunk.file === filePath) ?? chunks[0] };
  }
  for (const staged of [request.stage === 'staged', request.stage !== 'staged']) {
    if (!allowed()) return result;
    const chunk = yield* call(batchedGitDiff, workspaceId, staged, filePath, {
      signal,
      canRead: allowed,
      gitlink: request.gitlink,
      gitRootId,
      gitRootPath,
    });
    if (!allowed()) return result;
    if (!chunk) continue;
    if (isGitlinkDiffChunk(chunk))
      return { ...result, ...gitlinkSidesFromHunks(chunk.chunks ?? []), gitlink: true };
    if (request.gitlink) return { ...result, ...gitlinkSidesFromShas(request.gitlink) };
    if (chunk.oldContent && chunk.newContent)
      return { ...result, oldContent: chunk.oldContent, newContent: chunk.newContent };
    const options = gitRootId ? { gitRootId } : undefined;
    const before = yield* call(
      dedupedShowFile,
      workspaceId,
      staged ? 'HEAD' : ':0',
      filePath,
      options,
    );
    if (!allowed()) return result;
    result.oldContent = before.success ? (before.data ?? '') : '';
    if (staged) {
      const after = yield* call(dedupedShowFile, workspaceId, ':0', filePath, options);
      if (!allowed()) return result;
      result.newContent = after.success ? (after.data ?? '') : '';
    } else if (request.workspacePath || filePath.startsWith('/')) {
      try {
        const response = yield* call(invoke<FileReadResponse>, 'file:read', {
          workspaceId,
          path: filePath.startsWith('/') ? filePath : `${request.workspacePath}/${filePath}`,
        });
        if (!allowed()) return result;
        if (response.success !== false)
          result.newContent =
            typeof response.data === 'string' ? response.data : (response.data?.content ?? '');
      } catch {
        // Preserve the existing missing/unreadable working-tree fallback.
      }
    }
    return result;
  }
  if (request.gitlink) return { ...result, ...gitlinkSidesFromShas(request.gitlink) };
  return validProvided ? { ...result, oldContent: old, newContent: next } : result;
}
