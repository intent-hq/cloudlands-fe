import { all, call, delay, put, takeEvery, takeLatest, takeLeading } from 'typed-redux-saga';

import { invoke } from '$lib/electron-bridge';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import { addTerminal, openTerminalOverlay } from '../../terminals/terminals-slice';
import { selectHostRequirementsHasCheckedOnce } from '../host-requirements-selectors';
import {
  checkHostRequirementsComplete,
  checkHostRequirementsRequested,
  checkHostRequirementsStarted,
  ensureHostRequirementsChecked,
  ghRequirementResolved,
  gitRequirementResolved,
  nodeRequirementResolved,
  checkRtkRequested,
  initializeRtkSettings,
  installRtkRequested,
  rtkCheckStarted,
  rtkRequirementResolved,
  rtkSettingLoaded,
  rtkSettingLoadFailed,
  rtkUpdateFailed,
  rtkUpdateStarted,
  rtkUpdateSucceeded,
  updateRtkEnabledRequested,
} from '../host-requirements-slice';

const logger = createLogger('HostRequirementsSaga');

interface CheckGitResponse {
  success: boolean;
  // `available:'unknown'` = transport failure (RPC timeout / daemon
  // unreachable); treated the same as unavailable by this gate.
  data?: { available: boolean | 'unknown'; version?: string };
}

interface CheckNodeResponse {
  success: boolean;
  data?: { available: boolean; versionOk: boolean; version?: string };
}

interface CheckGhResponse {
  success: boolean;
  data?: { available: boolean; version?: string };
}

interface CheckRtkResponse {
  success: boolean;
  data?: { available: boolean };
}

const RTK_SETTING_PATH = 'rtk.enabled';
const RTK_INSTALL_COMMAND = 'brew install rtk';
const RTK_POLL_INTERVAL_MS = 10_000;
const RTK_POLL_ATTEMPTS = 3;

async function showRtkInstallError(): Promise<void> {
  const { toast } = await import('$lib/components/ui/toast');
  toast.error(m.terminal_adapter_openFailed_error());
}

function* probeRtk() {
  let available = false;
  try {
    const result: CheckRtkResponse = yield* call(
      invoke<CheckRtkResponse>,
      IPC_CHANNELS.SYSTEM.CHECK_RTK,
    );
    available = result.success && result.data?.available === true;
  } catch (error) {
    logger.error('RTK requirement check failed', { error });
  }
  yield* put(rtkRequirementResolved(available));
  return available;
}

function* loadRtkSetting() {
  try {
    const entry = yield* call([appClient.settings, appClient.settings.get], RTK_SETTING_PATH);
    if (entry === null) {
      yield* put(rtkSettingLoadFailed(m.settings_rtk_loadError()));
      return;
    }
    yield* put(rtkSettingLoaded(typeof entry.value === 'boolean' ? entry.value : false));
  } catch (error) {
    logger.error('Failed to load RTK setting', { error });
    yield* put(rtkSettingLoadFailed(m.settings_rtk_loadError()));
  }
}

function* initializeRtkWorker(_action: ReturnType<typeof initializeRtkSettings>) {
  yield* all([call(loadRtkSetting), call(probeRtk)]);
}

function* checkRtkWorker(_action: ReturnType<typeof checkRtkRequested>) {
  yield* put(rtkCheckStarted());
  yield* call(probeRtk);
}

function* updateRtkWorker(action: ReturnType<typeof updateRtkEnabledRequested>) {
  yield* put(rtkUpdateStarted());
  try {
    const enabled = action.payload[0];
    yield* call(
      [appClient.settings, appClient.settings.update],
      [{ path: RTK_SETTING_PATH, value: enabled }],
    );
    yield* put(rtkUpdateSucceeded(enabled));
  } catch (error) {
    logger.error('Failed to update RTK setting', { error });
    yield* put(rtkUpdateFailed(m.settings_rtk_saveError()));
  }
}

function* installRtkWorker(_action: ReturnType<typeof installRtkRequested>) {
  try {
    const result = yield* call([appClient.terminals, appClient.terminals.create], {
      workspaceId: ROOT_WORKSPACE_ID,
      cols: 80,
      rows: 24,
      command: RTK_INSTALL_COMMAND,
    });
    if (!result.success || !result.id) {
      yield* call(showRtkInstallError);
      return;
    }
    yield* put(addTerminal(ROOT_WORKSPACE_ID, result.id, m.settings_rtk_installTerminalTitle()));
    yield* put(openTerminalOverlay(ROOT_WORKSPACE_ID, result.id));
    for (let attempt = 0; attempt < RTK_POLL_ATTEMPTS; attempt += 1) {
      yield* delay(RTK_POLL_INTERVAL_MS);
      if (yield* call(probeRtk)) return;
    }
  } catch (error) {
    logger.error('Failed to create RTK install terminal', { error });
    yield* call(showRtkInstallError);
  }
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

function* ensureHostRequirementsWorker(_action: ReturnType<typeof ensureHostRequirementsChecked>) {
  const hasCheckedOnce = yield* selectHostRequirementsHasCheckedOnce.effect();
  if (!hasCheckedOnce) yield* put(checkHostRequirementsRequested());
}

function* checkHostRequirementsWorker(_action: ReturnType<typeof checkHostRequirementsRequested>) {
  yield* call(runHostRequirementsCheck);
}

export function* hostRequirementsSaga() {
  yield* takeEvery(ensureHostRequirementsChecked, ensureHostRequirementsWorker);
  yield* takeLeading(checkHostRequirementsRequested, checkHostRequirementsWorker);
  yield* takeLatest(initializeRtkSettings, initializeRtkWorker);
  yield* takeLeading(checkRtkRequested, checkRtkWorker);
  yield* takeLeading(updateRtkEnabledRequested, updateRtkWorker);
  yield* takeLatest(installRtkRequested, installRtkWorker);
}
