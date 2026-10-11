// Svelte binding of the shared read owner; remove this facade when the Svelte renderer retires.
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { invoke } from '$lib/electron-bridge';
import { providerAuthStatusClient as authLifetime } from '$features/providers/provider-auth-status.client';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
import type { ProviderStatus } from '../agent-availability-types';
const readSingleProvider = (id: string) =>
  invoke<{ success: boolean; data?: ProviderStatus; error?: string }>(
    IPC_CHANNELS.PROVIDERS.CHECK_SINGLE,
    id,
  );
const readAvailability = () =>
  invoke<{ success: boolean; data?: ProviderAvailabilityResult; error?: string }>(
    IPC_CHANNELS.PROVIDERS.GET_AVAILABILITY,
  );
import {
  selectHasCheckedOnce,
  selectProviderCheckEpochMap,
  selectProviderLoadingMap,
  selectIsAnyProviderLoading,
  selectProviderDiscoveryRevision,
  selectProviderModelsRefreshPending,
  selectProviderModelsRefreshRevision,
} from '../agent-availability-selectors';
import { createProviderAvailabilitySaga } from './provider-availability-saga-factory';

export const { checkSingleProviderWorker, checkAllProvidersWorker, providerAvailabilityReadSaga } =
  createProviderAvailabilitySaga({
    selectPrincipalConnectionContext,
    selectHasCheckedOnce,
    selectProviderCheckEpochMap,
    selectIsAnyProviderLoading,
    selectProviderDiscoveryRevision,
    selectProviderModelsRefreshPending,
    selectProviderModelsRefreshRevision,
    readSingleProvider,
    readAvailability,
    authLifetime,
  });

import { call, cancelled, delay, put, takeEvery, takeLatest } from 'typed-redux-saga';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import { closeTerminalOverlay, openTerminalOverlay } from '../../terminals/terminals-slice';
import { selectWorkspaceTerminalState } from '../../terminals/terminals-selectors';
import { claudeLoginRequested, claudeLoginStarted } from '../agent-availability-slice';
export function* openClaudeLoginWorker(action: ReturnType<typeof claudeLoginRequested>) {
  try {
    const result = yield* call(
      invoke<{ ok: boolean; terminalId?: string; error?: string }>,
      IPC_CHANNELS.TERMINAL.CREATE_WITH_COMMAND,
      { workspaceId: ROOT_WORKSPACE_ID, command: 'claude auth login', interactive: true },
    );
    if (!result.ok || !result.terminalId) {
      throw new Error(result.error || m.terminal_adapter_openFailed_error());
    }
    yield* put(openTerminalOverlay(ROOT_WORKSPACE_ID, result.terminalId));
    yield* put(claudeLoginStarted(result.terminalId));
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

function* coalesceClaudeLoginRequests(
  launch: { pending?: ReturnType<typeof claudeLoginRequested> },
  action: ReturnType<typeof claudeLoginRequested>,
) {
  if (!launch.pending) {
    launch.pending = action;
    try {
      yield* call(openClaudeLoginWorker, action);
    } finally {
      launch.pending = undefined;
    }
    return;
  }
  const pending = launch.pending;
  try {
    yield* call(() => pending.promise);
    yield* put(action.success(undefined));
  } catch (cause) {
    yield* put(action.failure(cause instanceof Error ? cause : new Error(String(cause))));
  } finally {
    if (yield* cancelled()) {
      yield* put(action.failure(new Error(m.terminal_adapter_openFailed_error())));
    }
  }
}

function* dismissClaudeLoginOnSuccess(action: ReturnType<typeof claudeLoginStarted>) {
  const [terminalId] = action.payload;
  while (true) {
    yield* delay(2000);
    const before = yield* selectWorkspaceTerminalState.effect(ROOT_WORKSPACE_ID);
    if (!before.isOpen || before.activeTerminalId !== terminalId || before.selectedScriptId) return;
    if ((yield* selectProviderLoadingMap.effect())['claude-code']) continue;
    const status = yield* call(checkSingleProviderWorker, 'claude-code');
    if (status?.available && status.authenticated === true) {
      const current = yield* selectWorkspaceTerminalState.effect(ROOT_WORKSPACE_ID);
      if (current.isOpen && current.activeTerminalId === terminalId && !current.selectedScriptId) {
        yield* put(closeTerminalOverlay(ROOT_WORKSPACE_ID));
      }
      return;
    }
  }
}

/** Source-only terminal workflows compose the shared read owner. */
export function* providerAvailabilitySaga() {
  yield* takeEvery(claudeLoginRequested, coalesceClaudeLoginRequests, {});
  yield* takeLatest(claudeLoginStarted, dismissClaudeLoginOnSuccess);
  yield* call(providerAvailabilityReadSaga);
}
