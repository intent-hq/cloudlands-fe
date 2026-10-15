import { call, fork, join, put, race, take, type SagaGenerator } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { invoke } from '$lib/electron-bridge';
import {
  dedupedGitNumstat,
  dedupedShowFile,
} from '$features/file-tracking/components/diff/diff-ipc-batcher';
import {
  getGitMutationVersion,
  isGitMutationPending,
  waitForGitMutations,
} from '../../../utils/worktree-mutation-queue';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  openGitCommitFileRequested,
  openGitPRFileRequested,
  openGitXcodeRequested,
} from '../git-slice';
import type { AutoCommitReadStatus, GitReadRequest, GitReadResult } from '../git-types';
import { createGitConsumerReadSaga } from './git-consumer-read-saga-factory';
import { readTrackedDiff } from './git-tracked-diff-read';
import { takeLatestInContext } from '../../../utils/context-saga-effects';
import { openWorkspaceDiff } from '../../workspace-navigation/workspace-navigation-slice';
import { ChangeStage } from '$features/file-tracking/types';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';

function* read(
  workspaceId: string,
  request: GitReadRequest,
  signal: AbortSignal,
  canRead: () => boolean,
): SagaGenerator<GitReadResult> {
  switch (request.kind) {
    case 'commitDetails':
      return {
        kind: request.kind,
        details: yield* call(
          [appClient.git, appClient.git.commitDetails],
          workspaceId,
          request.commitHash,
          request.gitRootId ? { gitRootId: request.gitRootId } : undefined,
        ),
      };
    case 'diffs': {
      const { kind, ...options } = request;
      return {
        kind,
        chunks: yield* call([appClient.git, appClient.git.diffs], workspaceId, options),
      };
    }
    case 'showFile': {
      const response = yield* call(
        dedupedShowFile,
        workspaceId,
        request.ref,
        request.filePath,
        request.gitRootId ? { gitRootId: request.gitRootId } : undefined,
      );
      if (!response.success) throw new Error(response.error);
      return { kind: request.kind, content: response.data ?? '' };
    }
    case 'numstat': {
      const { kind, ...options } = request;
      return { kind, entries: yield* call(dedupedGitNumstat, workspaceId, options) };
    }
    case 'autoCommitStatus': {
      const response = yield* call(
        invoke<{ success: boolean; data?: AutoCommitReadStatus[] }>,
        'git:get-auto-commit-status',
        { agentId: request.agentId },
      );
      return { kind: request.kind, statuses: response?.success ? (response.data ?? []) : [] };
    }
    case 'trackedDiff':
      return yield* readTrackedDiff(workspaceId, request, signal, canRead);
  }
}

function* openCommitFile(
  action: ReturnType<typeof openGitCommitFileRequested>,
): SagaGenerator<void> {
  const [workspaceId, commitHash, filePath, additions = 0, deletions = 0, gitRootId] =
    action.payload;
  const options = gitRootId ? { gitRootId } : undefined;
  const after = yield* call(dedupedShowFile, workspaceId, commitHash, filePath, options);
  const before = yield* call(dedupedShowFile, workspaceId, `${commitHash}^`, filePath, options);
  const change = {
    id: `commit-${commitHash}-${filePath}`,
    file: filePath,
    relativePath: filePath,
    status: 'modified' as const,
    stage: ChangeStage.Committed,
    commitHash,
    stats: { additions, deletions },
    content: {
      oldContent: before.success ? (before.data ?? '') : '',
      newContent: after.success ? (after.data ?? '') : '',
      diff: '',
    },
    attribution: { timestamp: Date.now() },
  };
  yield* put(
    openWorkspaceDiff(workspaceId, change, {
      changeId: change.id,
      filePath,
      ...(gitRootId ? { gitRootId } : {}),
    }),
  );
}

function* openPRFile(action: ReturnType<typeof openGitPRFileRequested>): SagaGenerator<void> {
  const [workspaceId, filePath, baseRef, additions = 0, deletions = 0] = action.payload;
  for (;;) {
    if (isGitMutationPending(workspaceId)) yield* call(waitForGitMutations, workspaceId);
    const epoch = getGitMutationVersion(workspaceId);
    const after = yield* call(dedupedShowFile, workspaceId, 'HEAD', filePath);
    const before = yield* call(dedupedShowFile, workspaceId, baseRef, filePath);
    if (epoch !== getGitMutationVersion(workspaceId)) continue;
    const change = {
      id: `pr-file:${filePath}`,
      file: filePath,
      relativePath: filePath,
      status: 'modified' as const,
      stage: ChangeStage.Committed,
      stats: { additions, deletions },
      content: {
        oldContent: before.success ? (before.data ?? '') : '',
        newContent: after.success ? (after.data ?? '') : '',
        diff: '',
      },
      attribution: { timestamp: Date.now() },
    };
    yield* put(openWorkspaceDiff(workspaceId, change, { changeId: change.id, filePath }));
    return;
  }
}

function* openFile(
  action: ReturnType<typeof openGitCommitFileRequested> | ReturnType<typeof openGitPRFileRequested>,
): SagaGenerator<void> {
  if (action.type === openGitCommitFileRequested.type)
    yield* openCommitFile(action as ReturnType<typeof openGitCommitFileRequested>);
  else yield* openPRFile(action as ReturnType<typeof openGitPRFileRequested>);
}

type NavigationAction =
  | ReturnType<typeof openGitCommitFileRequested>
  | ReturnType<typeof openGitPRFileRequested>
  | ReturnType<typeof openGitXcodeRequested>;

function* openXcode(action: ReturnType<typeof openGitXcodeRequested>): SagaGenerator<void> {
  const [workspaceId, folder, file] = action.payload;
  let changedFiles: string[] = [];
  try {
    const status = yield* call([appClient.git, appClient.git.status], workspaceId);
    changedFiles = status?.files.map((entry) => entry.path) ?? [];
  } catch {
    // Changed paths are a best-effort project-selection hint.
  }
  try {
    yield* call(invoke, 'xcode:open', {
      folder,
      ...(file ? { file } : {}),
      changedFiles: changedFiles.length ? changedFiles : undefined,
    });
  } catch {
    yield* call([notify, notify.error], m.ui_workspaceActions_openFailed_error({ name: 'Xcode' }));
  }
}

function* waitForWorkspaceUnmount(workspaceId: string): SagaGenerator<void> {
  for (;;) {
    const action = yield* take(workspaceUnmounted);
    if (action.payload[0] === workspaceId) return;
  }
}

function* withWorkspaceLifetime<A extends NavigationAction>(
  worker: (action: A) => SagaGenerator<void>,
  action: A,
): SagaGenerator<void> {
  yield* race({
    done: call(worker, action),
    unmounted: call(waitForWorkspaceUnmount, action.payload[0]),
  });
}

const readOwner = createGitConsumerReadSaga({
  read,
  getMutationVersion: getGitMutationVersion,
  isMutationPending: isGitMutationPending,
  waitForMutations: waitForGitMutations,
  *bindAutoCommitEvents(invalidateAgent) {
    function* autoCommitChanged(event: { agentId: string }): SagaGenerator<void> {
      yield* invalidateAgent(event.agentId);
    }
    yield* takeEveryFromElectronChannel('git:auto-commit-started', autoCommitChanged);
    yield* takeEveryFromElectronChannel('git:auto-commit-succeeded', autoCommitChanged);
    yield* takeEveryFromElectronChannel('git:auto-commit-hook-failure', autoCommitChanged);
  },
});

export function* gitConsumerReadSaga(): SagaGenerator<void> {
  const owner = yield* fork(readOwner);
  yield* takeLatestInContext(
    [openGitCommitFileRequested, openGitPRFileRequested],
    (action) => action.payload[0],
    withWorkspaceLifetime,
    openFile,
  );
  yield* takeLatestInContext(
    openGitXcodeRequested,
    (action) => action.payload[0],
    withWorkspaceLifetime,
    openXcode,
  );
  yield* join(owner);
}
