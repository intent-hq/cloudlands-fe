import { call, cancelled, put, takeEvery, takeLeading } from 'typed-redux-saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import {
  PROVIDER_CLI_UPDATE_COMMANDS,
  providerCliWarnings,
  type ProviderCliDiscovery,
} from '$features/providers/utils/provider-cli-warnings';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { m } from '$shared/paraglide/messages.js';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import { openTerminalOverlay } from '../../terminals/terminals-slice';
import { selectHostAdministrationContext } from '../../principal/principal-selectors';
import { selectDaemonHealth } from '../../daemon-health/daemon-health-selectors';
import {
  checkProviderCliRequirementsRequested,
  providerCliRequirementsResolved,
  providerCliUpdateRequested,
} from '../host-requirements-slice';

function* checkProviderCliRequirements() {
  const context = yield* selectHostAdministrationContext.effect();
  if (!context || (yield* selectDaemonHealth.effect()) !== 'healthy') return;
  try {
    const result = yield* call(
      backendRequest<{ providers: ProviderCliDiscovery[] }>,
      'host.providerDiscovery',
      {},
    );
    if (
      context !== (yield* selectHostAdministrationContext.effect()) ||
      (yield* selectDaemonHealth.effect()) !== 'healthy'
    )
      return;
    yield* put(providerCliRequirementsResolved(context, providerCliWarnings(result.providers)));
  } catch {
    // Discovery is advisory. Transport failure is not an outdated CLI.
  }
}

type UpdateAction = ReturnType<typeof providerCliUpdateRequested>;

/** Same root-terminal route as onboarding's Claude login (`openClaudeLoginWorker`). */
export function* openProviderCliUpdateWorker(action: UpdateAction) {
  try {
    const [providerId] = action.payload;
    // Only the renderer-owned allowlist is ever executed, never a caller string.
    const command = Object.hasOwn(PROVIDER_CLI_UPDATE_COMMANDS, providerId)
      ? PROVIDER_CLI_UPDATE_COMMANDS[providerId]
      : undefined;
    if (!command) throw new Error(m.terminal_adapter_openFailed_error());
    const result = yield* call(
      invoke<{ ok: boolean; terminalId?: string; error?: string }>,
      IPC_CHANNELS.TERMINAL.CREATE_WITH_COMMAND,
      { workspaceId: ROOT_WORKSPACE_ID, command, interactive: true },
    );
    if (!result.ok || !result.terminalId) {
      throw new Error(result.error || m.terminal_adapter_openFailed_error());
    }
    yield* put(openTerminalOverlay(ROOT_WORKSPACE_ID, result.terminalId));
    yield* put(action.success(undefined));
  } catch (cause) {
    yield* put(
      action.failure(
        cause instanceof Error ? cause : new Error(m.terminal_adapter_openFailed_error()),
      ),
    );
  } finally {
    if (yield* cancelled()) {
      yield* put(action.failure(new Error(m.terminal_adapter_openFailed_error())));
    }
  }
}

/** Repeat clicks for a provider share its in-flight launch instead of opening more terminals. */
function* coalesceProviderCliUpdates(pending: Map<string, UpdateAction>, action: UpdateAction) {
  const [providerId] = action.payload;
  const leader = pending.get(providerId);
  if (!leader) {
    pending.set(providerId, action);
    try {
      yield* call(openProviderCliUpdateWorker, action);
    } finally {
      pending.delete(providerId);
    }
    return;
  }
  try {
    yield* call(() => leader.promise);
    yield* put(action.success(undefined));
  } catch (cause) {
    yield* put(action.failure(cause instanceof Error ? cause : new Error(String(cause))));
  } finally {
    if (yield* cancelled()) {
      yield* put(action.failure(new Error(m.terminal_adapter_openFailed_error())));
    }
  }
}

/** Cancelled with the existing owner-services lifetime on connection/authority changes. */
export function* providerCliRequirementsSaga() {
  yield* takeLeading(checkProviderCliRequirementsRequested, checkProviderCliRequirements);
  yield* takeEvery(providerCliUpdateRequested, coalesceProviderCliUpdates, new Map());
}
