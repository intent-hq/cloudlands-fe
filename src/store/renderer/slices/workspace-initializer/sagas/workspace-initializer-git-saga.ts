import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { call, put } from 'typed-redux-saga';
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { selectWorkspaceInitializerGitCheckContext } from '../workspace-initializer-selectors';
import { workspaceInitializerGitCheckResolved } from '../workspace-initializer-slice';

interface GitCheckResponse {
  success: boolean;
  data?: { available: boolean | 'unknown' };
}

function* checkGit({ payload: context }: SelectorChannelPayload<string | null>) {
  if (!context) return;
  let available: boolean | 'unknown' = 'unknown';
  try {
    const result = yield* call(invoke<GitCheckResponse>, IPC_CHANNELS.SYSTEM.CHECK_GIT);
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

export function* workspaceInitializerGitSaga() {
  yield* takeLatestFromSelector(selectWorkspaceInitializerGitCheckContext, checkGit);
}
