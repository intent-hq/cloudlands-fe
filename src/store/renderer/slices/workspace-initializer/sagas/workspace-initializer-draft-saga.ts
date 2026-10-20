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
import { hostExecutionConnectionChanged } from '../../host-execution/host-execution-slice';
import {
  workspaceInitializerDraftClearFinished,
  workspaceInitializerDraftClearRequested,
  workspaceInitializerDraftFlushRequested,
  workspaceInitializerDraftLegacyMigrationRequested,
  workspaceInitializerDraftOwnerReleased,
  workspaceInitializerDraftRestoreFinished,
  workspaceInitializerDraftRestoreRequested,
  workspaceInitializerDraftSaveCancelled,
  workspaceInitializerDraftSaveDebounceElapsed,
  workspaceInitializerDraftSaveScheduled,
} from '../workspace-initializer-slice';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import type { WorkspaceInitializerDraftPayload } from '../workspace-initializer-types';

const logger = createLogger('WorkspaceInitializerDraftSaga');
const DRAFT_DEBOUNCE_MS = 300;

type DraftAction =
  | ReturnType<typeof workspaceInitializerDraftRestoreRequested>
  | ReturnType<typeof workspaceInitializerDraftSaveScheduled>
  | ReturnType<typeof workspaceInitializerDraftLegacyMigrationRequested>
  | ReturnType<typeof workspaceInitializerDraftSaveDebounceElapsed>
  | ReturnType<typeof workspaceInitializerDraftFlushRequested>
  | ReturnType<typeof workspaceInitializerDraftSaveCancelled>
  | ReturnType<typeof workspaceInitializerDraftClearRequested>
  | ReturnType<typeof workspaceInitializerDraftOwnerReleased>
  | ReturnType<typeof hostExecutionConnectionChanged>;

type RestoreStatus = 'pending' | 'restored' | 'empty' | 'error';

/** A mounted restore owner, bound to the admission it was restored under. */
interface DraftOwner {
  requestId: string;
  admission: string;
  status: RestoreStatus;
  task?: Task;
}

type DraftOwners = Record<string, DraftOwner | undefined>;

interface PendingSave {
  payload: WorkspaceInitializerDraftPayload;
  version: number;
  ownerRequestId: string;
  admission: string;
}

// Daemon writes are serialized across saga lifetimes: a write issued by a
// cancelled root still gates the first write of its replacement.
let writeTail: Promise<void> = Promise.resolve();

function* serializedWrite(write: () => Promise<unknown>) {
  const prior = writeTail;
  let release!: () => void;
  writeTail = new Promise<void>((done) => {
    release = done;
  });
  let issued: Promise<unknown> | undefined;
  try {
    yield* call(() => prior);
    issued = write();
    yield* call(() => issued);
  } finally {
    if (issued) issued.then(release, release);
    else void prior.then(release);
  }
}

function* currentAdmission() {
  return (yield* selectPrincipalActionContext.effect()) ?? undefined;
}

/** Fail closed: an owner action needs its live request and unchanged, current admission. */
function* ownerAdmitted(
  owners: DraftOwners,
  id: string,
  requestId: string | undefined,
  admission: string | undefined,
) {
  const owner = owners[id];
  if (!owner || requestId === undefined || admission === undefined) return false;
  if (owner.requestId !== requestId || owner.admission !== admission) return false;
  return (yield* currentAdmission()) === admission;
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
    yield* call(serializedWrite, () =>
      appClient.drafts.set(
        NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
        NEW_WORKSPACE_DRAFT_AGENT_ID,
        payload.text,
        payload.attachments,
      ),
    );
  } catch (error) {
    logger.warn('drafts.set failed; draft kept in memory only', { error: String(error) });
  }
}

function* restoreDraft(
  owners: DraftOwners,
  id: string,
  requestId: string,
  legacyKey: string,
  restoreEpoch: number,
  mutationEpoch: { value: number },
  admission: string,
) {
  try {
    const draft = yield* call(
      [appClient.drafts, appClient.drafts.get],
      NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
      NEW_WORKSPACE_DRAFT_AGENT_ID,
    );
    // A reply read under a replaced authority must not publish or touch legacy data.
    if (!(yield* ownerAdmitted(owners, id, requestId, admission))) {
      yield* put(workspaceInitializerDraftRestoreFinished(id, requestId, 'error', '', []));
      return 'error' as const;
    }
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
    if (mutationEpoch.value === restoreEpoch) {
      yield* put(
        workspaceInitializerDraftLegacyMigrationRequested(id, requestId, admission, restoreEpoch, {
          text: legacyPrompt,
        }),
      );
    }
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
  owners: DraftOwners,
  id: string,
  requestId: string,
  legacyKey: string,
  restoreEpoch: number,
  mutationEpoch: { value: number },
  admission: string,
) {
  const status = yield* call(
    restoreDraft,
    owners,
    id,
    requestId,
    legacyKey,
    restoreEpoch,
    mutationEpoch,
    admission,
  );
  const owner = owners[id];
  if (owner?.requestId === requestId) owner.status = status;
}

/** Empty saves before a settled read could erase a draft that was never seen. */
function canPersist(owner: DraftOwner | undefined, payload: WorkspaceInitializerDraftPayload) {
  return (
    !!payload.text ||
    !!payload.attachments?.length ||
    owner?.status === 'restored' ||
    owner?.status === 'empty'
  );
}

export function* workspaceInitializerDraftSaga() {
  const channel = yield* actionChannel(
    [
      workspaceInitializerDraftRestoreRequested,
      workspaceInitializerDraftSaveScheduled,
      workspaceInitializerDraftLegacyMigrationRequested,
      workspaceInitializerDraftSaveDebounceElapsed,
      workspaceInitializerDraftFlushRequested,
      workspaceInitializerDraftSaveCancelled,
      workspaceInitializerDraftClearRequested,
      workspaceInitializerDraftOwnerReleased,
      hostExecutionConnectionChanged,
    ],
    buffers.expanding(),
  );
  let pending: Record<string, PendingSave | undefined> = {};
  const owners: DraftOwners = {};
  let version = 0;
  const mutationEpoch = { value: 0 };

  function* dropOwner(id: string) {
    const owner = owners[id];
    if (owner?.task) yield* cancel(owner.task);
    delete owners[id];
    delete pending[id];
  }

  function* flushPending(id: string) {
    const save = pending[id];
    if (!save) return;
    delete pending[id];
    if (!(yield* ownerAdmitted(owners, id, save.ownerRequestId, save.admission))) return;
    if (!canPersist(owners[id], save.payload)) return;
    yield* call(persistDraft, save.payload);
  }

  try {
    while (true) {
      const action = (yield* take(channel)) as DraftAction;
      if (action.type === hostExecutionConnectionChanged.type) {
        for (const id of Object.keys(owners)) yield* call(dropOwner, id);
        pending = {};
        mutationEpoch.value++;
        continue;
      }

      if (action.type === workspaceInitializerDraftRestoreRequested.type) {
        const [id, requestId, legacyKey, admission] = (
          action as ReturnType<typeof workspaceInitializerDraftRestoreRequested>
        ).payload;
        if (admission === undefined || (yield* currentAdmission()) !== admission) {
          yield* put(workspaceInitializerDraftRestoreFinished(id, requestId, 'error', '', []));
          continue;
        }
        yield* call(dropOwner, id);
        const owner: DraftOwner = { requestId, admission, status: 'pending' };
        owners[id] = owner;
        owner.task = yield* fork(
          restoreDraftInBackground,
          owners,
          id,
          requestId,
          legacyKey,
          mutationEpoch.value,
          mutationEpoch,
          admission,
        );
        continue;
      }

      if (action.type === workspaceInitializerDraftLegacyMigrationRequested.type) {
        const [id, requestId, admission, restoreEpoch, payload] = (
          action as ReturnType<typeof workspaceInitializerDraftLegacyMigrationRequested>
        ).payload;
        if (
          mutationEpoch.value !== restoreEpoch ||
          !(yield* ownerAdmitted(owners, id, requestId, admission))
        )
          continue;
        mutationEpoch.value++;
        yield* call(persistDraft, payload);
        continue;
      }

      if (action.type === workspaceInitializerDraftSaveScheduled.type) {
        const [id, payload, ownerRequestId, admission] = (
          action as ReturnType<typeof workspaceInitializerDraftSaveScheduled>
        ).payload;
        if (
          ownerRequestId === undefined ||
          admission === undefined ||
          !(yield* ownerAdmitted(owners, id, ownerRequestId, admission))
        )
          continue;
        mutationEpoch.value++;
        const nextVersion = ++version;
        pending[id] = { payload, version: nextVersion, ownerRequestId, admission };
        yield* fork(draftDebounceTimer, id, nextVersion);
        continue;
      }

      if (action.type === workspaceInitializerDraftSaveDebounceElapsed.type) {
        const [id, elapsedVersion] = (
          action as ReturnType<typeof workspaceInitializerDraftSaveDebounceElapsed>
        ).payload;
        if (pending[id]?.version !== elapsedVersion) continue;
        yield* call(flushPending, id);
        continue;
      }

      if (action.type === workspaceInitializerDraftFlushRequested.type) {
        const [id, ownerRequestId, admission] = (
          action as ReturnType<typeof workspaceInitializerDraftFlushRequested>
        ).payload;
        if (!(yield* ownerAdmitted(owners, id, ownerRequestId, admission))) {
          if (pending[id] && owners[id]?.requestId !== pending[id]?.ownerRequestId)
            delete pending[id];
          continue;
        }
        yield* call(flushPending, id);
        continue;
      }

      if (action.type === workspaceInitializerDraftSaveCancelled.type) {
        const [id, ownerRequestId] = (
          action as ReturnType<typeof workspaceInitializerDraftSaveCancelled>
        ).payload;
        // Dropping a queued write never needs authority; it only needs the owner.
        if (ownerRequestId !== undefined && owners[id]?.requestId === ownerRequestId)
          delete pending[id];
        continue;
      }

      if (action.type === workspaceInitializerDraftClearRequested.type) {
        const [id, requestId, ownerRequestId, admission] = (
          action as ReturnType<typeof workspaceInitializerDraftClearRequested>
        ).payload;
        const current = yield* currentAdmission();
        // An ownerless clear is the root reset; it acts under the current admission.
        const clearAdmission = ownerRequestId === undefined ? (admission ?? current) : admission;
        const admitted =
          ownerRequestId === undefined
            ? current !== undefined && clearAdmission === current
            : yield* ownerAdmitted(owners, id, ownerRequestId, admission);
        if (!admitted || clearAdmission === undefined) {
          yield* put(workspaceInitializerDraftClearFinished(id, requestId, 'failure'));
          continue;
        }
        mutationEpoch.value++;
        pending = {};
        yield* call(dropOwner, id);
        const others: [string, string][] = [];
        for (const [ownerId, owner] of Object.entries(owners)) {
          if (!owner) continue;
          if (owner.task) yield* cancel(owner.task);
          owner.task = undefined;
          owner.status = 'pending';
          others.push([ownerId, owner.requestId]);
        }
        let cleared = false;
        try {
          yield* call(serializedWrite, () =>
            appClient.drafts.clear(NEW_WORKSPACE_DRAFT_WORKSPACE_ID, NEW_WORKSPACE_DRAFT_AGENT_ID),
          );
          cleared = (yield* currentAdmission()) === clearAdmission;
        } catch (error) {
          logger.warn('drafts.clear failed', { error: String(error) });
        }
        // Legacy prompts are removed only after a confirmed clear under unchanged authority.
        if (cleared) yield* call(removeAllLegacyPrompts);
        for (const [ownerId, restoreRequestId] of others) {
          const owner = owners[ownerId];
          if (owner?.requestId !== restoreRequestId) continue;
          const status = cleared && owner.admission === clearAdmission ? 'empty' : 'error';
          owner.status = status;
          yield* put(
            workspaceInitializerDraftRestoreFinished(ownerId, restoreRequestId, status, '', []),
          );
        }
        yield* put(
          workspaceInitializerDraftClearFinished(id, requestId, cleared ? 'success' : 'failure'),
        );
        continue;
      }

      const [id, restoreRequestId] = (
        action as ReturnType<typeof workspaceInitializerDraftOwnerReleased>
      ).payload;
      if (owners[id]?.requestId !== restoreRequestId) continue;
      yield* call(dropOwner, id);
    }
  } finally {
    channel.close();
  }
}
