import { all, call, fork, put, take } from 'typed-redux-saga';

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { selectHostRequirementsHasCheckedOnce } from '../host-requirements-selectors';
import {
  checkHostRequirementsComplete,
  checkHostRequirementsRequested,
  checkHostRequirementsStarted,
  ensureHostRequirementsChecked,
  ghRequirementResolved,
  gitRequirementResolved,
  nodeRequirementResolved,
} from '../host-requirements-slice';

const logger = createLogger('HostRequirementsSaga');

interface CheckGitResponse {
  success: boolean;
  data?: { available: boolean; version?: string };
}

interface CheckNodeResponse {
  success: boolean;
  data?: { available: boolean; versionOk: boolean; version?: string };
}

interface CheckGhResponse {
  success: boolean;
  data?: { available: boolean; version?: string };
}

function* checkGitRequirement() {
  try {
    const result: CheckGitResponse = yield* call(
      invoke<CheckGitResponse>,
      IPC_CHANNELS.SYSTEM.CHECK_GIT,
    );
    const data = result.success ? result.data : undefined;
    yield* put(gitRequirementResolved(data?.available === true, data?.version));
  } catch (error) {
    logger.error('Git requirement check failed', { error });
    yield* put(gitRequirementResolved(false));
  }
}

function* checkNodeRequirement() {
  try {
    const result: CheckNodeResponse = yield* call(
      invoke<CheckNodeResponse>,
      IPC_CHANNELS.SYSTEM.CHECK_NODE,
    );
    const data = result.success ? result.data : undefined;
    yield* put(nodeRequirementResolved(data?.versionOk === true, data?.version));
  } catch (error) {
    logger.error('Node requirement check failed', { error });
    yield* put(nodeRequirementResolved(false));
  }
}

function* checkGhRequirement() {
  try {
    const result: CheckGhResponse = yield* call(
      invoke<CheckGhResponse>,
      IPC_CHANNELS.SYSTEM.CHECK_GH,
    );
    const data = result.success ? result.data : undefined;
    yield* put(ghRequirementResolved(data?.available === true, data?.version));
  } catch (error) {
    logger.error('gh requirement check failed', { error });
    yield* put(ghRequirementResolved(false));
  }
}

function* runHostRequirementsCheck() {
  yield* put(checkHostRequirementsStarted());
  try {
    yield* all([call(checkGitRequirement), call(checkNodeRequirement), call(checkGhRequirement)]);
  } finally {
    yield* put(checkHostRequirementsComplete());
  }
}

export function* hostRequirementsSaga() {
  let running = false;
  try {
    while (true) {
      const action: ReturnType<
        typeof ensureHostRequirementsChecked | typeof checkHostRequirementsRequested
      > = yield* take([ensureHostRequirementsChecked, checkHostRequirementsRequested]);

      if (running) continue;
      if (action.type === ensureHostRequirementsChecked.type) {
        const hasCheckedOnce = yield* selectHostRequirementsHasCheckedOnce.effect();
        if (hasCheckedOnce) continue;
      }

      running = true;
      yield* fork(function* () {
        try {
          yield* call(runHostRequirementsCheck);
        } finally {
          running = false;
        }
      });
    }
  } finally {
    running = false;
  }
}
