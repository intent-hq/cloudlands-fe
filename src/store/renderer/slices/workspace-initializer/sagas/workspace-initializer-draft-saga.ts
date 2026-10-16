import { buffers, type Task } from 'redux-saga';
import { actionChannel, call, cancel, delay, fork, put, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import {
  LEGACY_ONBOARDING_PROMPT_SESSION_KEY,
  LEGACY_PROMPT_SESSION_KEY,
  NEW_WORKSPACE_DRAFT_AGENT_ID,
  NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
} from '$lib/components/workspace/initializer/new-workspace-draft';
import {
  workspaceInitializerDraftClearFinished,
  workspaceInitializerDraftClearRequested,
  workspaceInitializerDraftFlushRequested,
  workspaceInitializerDraftOwnerReleased,
  workspaceInitializerDraftRestoreFinished,
  workspaceInitializerDraftRestoreRequested,
  workspaceInitializerDraftSaveCancelled,
  workspaceInitializerDraftSaveDebounceElapsed,
  workspaceInitializerDraftSaveScheduled,
} from '../workspace-initializer-slice';
import type { WorkspaceInitializerDraftPayload } from '../workspace-initializer-types';

const logger = createLogger('WorkspaceInitializerDraftSaga');
const DRAFT_DEBOUNCE_MS = 300;

type DraftAction =
  | ReturnType<typeof workspaceInitializerDraftRestoreRequested>
  | ReturnType<typeof workspaceInitializerDraftSaveScheduled>
  | ReturnType<typeof workspaceInitializerDraftSaveDebounceElapsed>
  | ReturnType<typeof workspaceInitializerDraftFlushRequested>
  | ReturnType<typeof workspaceInitializerDraftSaveCancelled>
  | ReturnType<typeof workspaceInitializerDraftClearRequested>
  | ReturnType<typeof workspaceInitializerDraftOwnerReleased>;

interface PendingSave {
  payload: WorkspaceInitializerDraftPayload;
  version: number;
}

function removeLegacyKey(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Draft persistence remains non-fatal when session storage is unavailable.
  }
}

function readAndRemoveLegacyPrompt(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key);
    if (value !== null) sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

function removeAllLegacyPrompts(): void {
  removeLegacyKey(LEGACY_PROMPT_SESSION_KEY);
  removeLegacyKey(LEGACY_ONBOARDING_PROMPT_SESSION_KEY);
}

function* draftDebounceTimer(id: string, version: number) {
  yield* delay(DRAFT_DEBOUNCE_MS);
  yield* put(workspaceInitializerDraftSaveDebounceElapsed(id, version));
}

function* persistDraft(payload: WorkspaceInitializerDraftPayload) {
  try {
    yield* call(
      [appClient.drafts, appClient.drafts.set],
      NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
      NEW_WORKSPACE_DRAFT_AGENT_ID,
      payload.text,
      payload.attachments,
    );
  } catch (error) {
    logger.warn('drafts.set failed; draft kept in memory only', { error: String(error) });
  }
}

function* restoreDraft(
  id: string,
  requestId: string,
  legacyKey: string,
  restoreEpoch: number,
  mutationEpoch: { value: number },
) {
  try {
    const draft = yield* call(
      [appClient.drafts, appClient.drafts.get],
      NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
      NEW_WORKSPACE_DRAFT_AGENT_ID,
    );
    if (draft) {
      yield* call(removeLegacyKey, legacyKey);
      yield* put(
        workspaceInitializerDraftRestoreFinished(
          id,
          requestId,
          'restored',
          draft.text ?? '',
          draft.attachments ?? [],
        ),
      );
      return 'restored' as const;
    }

    const legacyPrompt = yield* call(readAndRemoveLegacyPrompt, legacyKey);
    if (!legacyPrompt) {
      yield* put(workspaceInitializerDraftRestoreFinished(id, requestId, 'empty', '', []));
      return 'empty' as const;
    }

    // Persist the one-time migration only if no newer save/clear was admitted
    // while the daemon read was pending. The in-memory legacy prompt still
    // restores when migration loses that race or persistence fails.
    if (mutationEpoch.value === restoreEpoch) yield* call(persistDraft, { text: legacyPrompt });
    yield* put(
      workspaceInitializerDraftRestoreFinished(id, requestId, 'restored', legacyPrompt, []),
    );
    return 'restored' as const;
  } catch (error) {
    logger.warn('drafts.get failed; continuing without a persisted draft', {
      error: String(error),
    });
    yield* put(workspaceInitializerDraftRestoreFinished(id, requestId, 'error', '', []));
    return 'error' as const;
  }
}

function* restoreDraftInBackground(
  id: string,
  requestId: string,
  legacyKey: string,
  activeRestoreRequestIds: Record<string, string | undefined>,
  restoreStatuses: Record<string, 'pending' | 'restored' | 'empty' | 'error' | undefined>,
  restoreEpoch: number,
  mutationEpoch: { value: number },
) {
  const status = yield* call(restoreDraft, id, requestId, legacyKey, restoreEpoch, mutationEpoch);
  if (activeRestoreRequestIds[id] === requestId) restoreStatuses[id] = status;
}

export function* workspaceInitializerDraftSaga() {
  const channel = yield* actionChannel(
    [
      workspaceInitializerDraftRestoreRequested,
      workspaceInitializerDraftSaveScheduled,
      workspaceInitializerDraftSaveDebounceElapsed,
      workspaceInitializerDraftFlushRequested,
      workspaceInitializerDraftSaveCancelled,
      workspaceInitializerDraftClearRequested,
      workspaceInitializerDraftOwnerReleased,
    ],
    buffers.expanding(),
  );
  let pending: Record<string, PendingSave | undefined> = {};
  const restoreStatuses: Record<string, 'pending' | 'restored' | 'empty' | 'error' | undefined> =
    {};
  const restoreTasks: Record<string, Task | undefined> = {};
  const activeRestoreRequestIds: Record<string, string | undefined> = {};
  const stoppedOwners = new Set<string>();
  let version = 0;
  const mutationEpoch = { value: 0 };

  try {
    while (true) {
      const action = (yield* take(channel)) as DraftAction;
      if (action.type === workspaceInitializerDraftRestoreRequested.type) {
        const [id, requestId, legacyKey] = (
          action as ReturnType<typeof workspaceInitializerDraftRestoreRequested>
        ).payload;
        const previousRestore = restoreTasks[id];
        if (previousRestore) yield* cancel(previousRestore);
        stoppedOwners.delete(id);
        activeRestoreRequestIds[id] = requestId;
        restoreStatuses[id] = 'pending';
        restoreTasks[id] = yield* fork(
          restoreDraftInBackground,
          id,
          requestId,
          legacyKey,
          activeRestoreRequestIds,
          restoreStatuses,
          mutationEpoch.value,
          mutationEpoch,
        );
        continue;
      }

      if (action.type === workspaceInitializerDraftSaveScheduled.type) {
        const [id, payload] = (action as ReturnType<typeof workspaceInitializerDraftSaveScheduled>)
          .payload;
        if (stoppedOwners.has(id)) continue;
        mutationEpoch.value++;
        const nextVersion = ++version;
        pending[id] = {
          payload,
          version: nextVersion,
        };
        yield* fork(draftDebounceTimer, id, nextVersion);
        continue;
      }

      if (action.type === workspaceInitializerDraftSaveDebounceElapsed.type) {
        const [id, elapsedVersion] = (
          action as ReturnType<typeof workspaceInitializerDraftSaveDebounceElapsed>
        ).payload;
        const save = pending[id];
        if (!save || save.version !== elapsedVersion || stoppedOwners.has(id)) continue;
        delete pending[id];
        const status = restoreStatuses[id];
        if (
          !save.payload.text &&
          !save.payload.attachments?.length &&
          status !== 'restored' &&
          status !== 'empty'
        )
          continue;
        yield* call(persistDraft, save.payload);
        continue;
      }

      if (action.type === workspaceInitializerDraftFlushRequested.type) {
        const [id] = (action as ReturnType<typeof workspaceInitializerDraftFlushRequested>).payload;
        const save = pending[id];
        if (!save || stoppedOwners.has(id)) continue;
        delete pending[id];
        const status = restoreStatuses[id];
        if (
          !save.payload.text &&
          !save.payload.attachments?.length &&
          status !== 'restored' &&
          status !== 'empty'
        )
          continue;
        yield* call(persistDraft, save.payload);
        continue;
      }

      if (action.type === workspaceInitializerDraftSaveCancelled.type) {
        const [id] = (action as ReturnType<typeof workspaceInitializerDraftSaveCancelled>).payload;
        delete pending[id];
        continue;
      }

      if (action.type === workspaceInitializerDraftClearRequested.type) {
        const [id, requestId] = (
          action as ReturnType<typeof workspaceInitializerDraftClearRequested>
        ).payload;
        stoppedOwners.add(id);
        mutationEpoch.value++;
        pending = {};
        for (const task of Object.values(restoreTasks)) {
          if (task) yield* cancel(task);
        }
        for (const ownerId of Object.keys(restoreTasks)) {
          delete restoreTasks[ownerId];
          delete activeRestoreRequestIds[ownerId];
          delete restoreStatuses[ownerId];
        }
        yield* call(removeAllLegacyPrompts);
        try {
          yield* call(
            [appClient.drafts, appClient.drafts.clear],
            NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
            NEW_WORKSPACE_DRAFT_AGENT_ID,
          );
          yield* put(workspaceInitializerDraftClearFinished(id, requestId, 'success'));
        } catch (error) {
          logger.warn('drafts.clear failed', { error: String(error) });
          yield* put(workspaceInitializerDraftClearFinished(id, requestId, 'failure'));
        }
        continue;
      }

      const [id, restoreRequestId] = (
        action as ReturnType<typeof workspaceInitializerDraftOwnerReleased>
      ).payload;
      if (activeRestoreRequestIds[id] !== restoreRequestId) continue;
      const restoreTask = restoreTasks[id];
      if (restoreTask) yield* cancel(restoreTask);
      delete pending[id];
      delete restoreStatuses[id];
      delete restoreTasks[id];
      delete activeRestoreRequestIds[id];
      stoppedOwners.delete(id);
    }
  } finally {
    channel.close();
  }
}
