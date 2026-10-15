import {
  takeLatestFromSelector,
  type SelectorChannelSelector,
  type SelectorChannelPayload,
} from '@themislib/themis/saga';
import { call, put } from 'typed-redux-saga';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { workspaceInitializerGitCheckResolved } from '../workspace-initializer-slice';

interface GitCheckResponse {
  success: boolean;
  data?: { available: boolean | 'unknown' };
}

export function createWorkspaceInitializerGitSaga<State>({
  invoke,
  selectWorkspaceInitializerGitCheckContext,
}: {
  invoke: (channel: typeof IPC_CHANNELS.SYSTEM.CHECK_GIT) => Promise<GitCheckResponse>;
  selectWorkspaceInitializerGitCheckContext: SelectorChannelSelector<string | null, [], State>;
}) {
  function* checkGit({ payload: context }: SelectorChannelPayload<string | null>) {
    if (!context) return;
    let available: boolean | 'unknown' = 'unknown';
    try {
      const result = yield* call(invoke, IPC_CHANNELS.SYSTEM.CHECK_GIT);
      if (result?.success && typeof result.data?.available === 'boolean') {
        available = result.data.available;
      }
    } catch {
      // Failure to verify is distinct from a daemon-confirmed missing binary.
    }
    if (context === (yield* selectWorkspaceInitializerGitCheckContext.effect())) {
      yield* put(workspaceInitializerGitCheckResolved(context, available));
    }
  }

  function* workspaceInitializerGitSaga() {
    yield* takeLatestFromSelector(selectWorkspaceInitializerGitCheckContext, checkGit);
  }

  return workspaceInitializerGitSaga;
}
