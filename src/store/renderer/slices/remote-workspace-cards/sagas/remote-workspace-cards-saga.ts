/**
 * Remote workspace cards saga: reads the workspaces an Assistant card names on
 * another machine, and opens one there (main adds the machine to this window's
 * rail when needed, else opens that machine's own window).
 */
import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { normalizeWorkspace } from '$lib/client/live/live-workspaces-client';
import { notify } from '$lib/components/patterns/notify';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { m } from '$shared/paraglide/messages.js';
import type {
  OpenBackendWorkspaceParams,
  OpenBackendWorkspaceResult,
  WorkspaceCardsParams,
  WorkspaceCardsResult,
} from '$shared/types/connections';
import { selectRemoteWorkspaceCardEntries } from '../remote-workspace-cards-selectors';
import {
  remoteWorkspaceCardKey,
  remoteWorkspaceCardsReceived,
  remoteWorkspaceCardsRequested,
  remoteWorkspaceCardsStarted,
  remoteWorkspaceOpenRequested,
  type RemoteWorkspaceCardEntry,
  type RemoteWorkspaceCardsOutcome,
} from '../remote-workspace-cards-slice';

const logger = createLogger('RemoteWorkspaceCardsSaga');
const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;

/** A card read this recently is not read again when it shows again. */
const REMOTE_WORKSPACE_CARD_FRESH_MS = 60_000;

function getApi(): Window['electronAPI'] | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

const requests = {
  readCards: async (params: WorkspaceCardsParams): Promise<WorkspaceCardsResult> => {
    const api = getApi();
    if (!api) return { status: 'unknown-backend' };
    return (await api.invoke(CONNECTIONS.WORKSPACE_CARDS, params)) as WorkspaceCardsResult;
  },
  openWorkspace: async (
    params: OpenBackendWorkspaceParams,
  ): Promise<OpenBackendWorkspaceResult> => {
    const api = getApi();
    if (!api) return { status: 'unknown-backend' };
    return (await api.invoke(CONNECTIONS.OPEN_WORKSPACE, params)) as OpenBackendWorkspaceResult;
  },
};

function needsRead(entry: RemoteWorkspaceCardEntry | undefined, now: number): boolean {
  if (!entry) return true;
  if (entry.status === 'loading') return false;
  return now - entry.loadedAt >= REMOTE_WORKSPACE_CARD_FRESH_MS;
}

function toOutcome(result: WorkspaceCardsResult): RemoteWorkspaceCardsOutcome {
  if (result.status !== 'ok') return result;
  return {
    status: 'ok',
    machineName: result.machineName,
    workspaces: result.workspaces.map((row) => normalizeWorkspace(row)),
  };
}

function* readCards(action: ReturnType<typeof remoteWorkspaceCardsRequested>): SagaGenerator<void> {
  const { backendId } = action.payload;
  const entries = yield* selectRemoteWorkspaceCardEntries.effect();
  const now = Date.now();
  const workspaceIds = [...new Set(action.payload.workspaceIds)].filter((workspaceId) =>
    needsRead(entries[remoteWorkspaceCardKey(backendId, workspaceId)], now),
  );
  if (workspaceIds.length === 0) return;
  yield* put(remoteWorkspaceCardsStarted(backendId, workspaceIds));
  let outcome: RemoteWorkspaceCardsOutcome;
  try {
    outcome = toOutcome(yield* call(requests.readCards, { backendId, workspaceIds }));
  } catch (error) {
    logger.warn('Could not read workspaces on another machine', {
      backendId,
      error: error instanceof Error ? error.message : String(error),
    });
    outcome = { status: 'unreachable', machineName: '' };
  }
  yield* put(remoteWorkspaceCardsReceived(backendId, workspaceIds, outcome, Date.now()));
}

function* openWorkspace(
  action: ReturnType<typeof remoteWorkspaceOpenRequested>,
): SagaGenerator<void> {
  try {
    const result = yield* call(requests.openWorkspace, action.payload);
    if (result.status === 'unknown-backend') {
      notify.error(m.chat_chatWorkspaceCard_openUnknownMachine_toast());
    } else if (result.status !== 'opened') {
      notify.error(m.chat_chatWorkspaceCard_openFailed_toast());
    }
  } catch (error) {
    logger.warn('Could not open a workspace on another machine', {
      backendId: action.payload.backendId,
      error: error instanceof Error ? error.message : String(error),
    });
    notify.error(m.chat_chatWorkspaceCard_openFailed_toast());
  }
}

export function* remoteWorkspaceCardsSaga(): SagaGenerator<void> {
  yield* takeEvery(remoteWorkspaceCardsRequested, readCards);
  yield* takeEvery(remoteWorkspaceOpenRequested, openWorkspace);
}
