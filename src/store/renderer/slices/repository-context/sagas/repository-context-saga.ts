import { repositorySelectionSaga } from './repository-selection-saga';
import { buffers, eventChannel } from 'redux-saga';
import { actionChannel, call, fork, flush, put, race, take, takeEvery } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { appClient } from '$lib/client';
import type { RepositoryContextUpdate } from '$lib/client/app-client';
import type { RepositoryContextRequest } from '$shared/types/repository-context';
import { selectPrincipalAdmissionContext } from '../../principal/principal-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  repositoryContextBound,
  repositoryContextDemanded,
  repositoryContextDemandEnded,
  repositoryContextFailed,
  repositoryContextReceived,
  repositoryContextRetired,
  repositoryContextStarted,
} from '../repository-context-slice';

function updatesFor(request: RepositoryContextRequest) {
  return eventChannel<RepositoryContextUpdate>((emit) => {
    let stopped = false;
    let dispose: (() => void) | undefined;
    void appClient.workspaces
      .observeRepositoryContext(request, (update) => {
        if (!stopped) emit(update);
      })
      .then(
        (close) => {
          if (stopped) close();
          else dispose = close;
        },
        () => {
          if (!stopped) emit({ type: 'unavailable', request });
        },
      );
    return () => {
      stopped = true;
      dispose?.();
    };
  }, buffers.sliding(1));
}

function* observe(admission: string, request: RepositoryContextRequest) {
  const updates = updatesFor(request);
  try {
    while (true) {
      const update = yield* take(updates);
      if ((yield* selectPrincipalAdmissionContext.effect()) !== admission) return;
      if (update.type === 'received') {
        yield* put(repositoryContextReceived(update.response));
      } else if (update.type === 'unavailable') {
        yield* put(repositoryContextFailed(request));
        return 'unavailable' as const;
      } else return;
    }
  } finally {
    updates.close();
  }
}

/** One root owner, cancelled by original actor/admission changes without replay. */
export function* repositoryContextSaga() {
  yield* fork(repositorySelectionSaga);
  yield* takeLatestFromSelector(
    selectPrincipalAdmissionContext,
    function* ({ payload: admission }: SelectorChannelPayload<string | null>) {
      if (!admission) return;
      yield* takeEvery(
        repositoryContextDemanded,
        function* ({ payload: [workspaceId, demandId, capturedAdmission] }) {
          if (capturedAdmission !== undefined && capturedAdmission !== admission) return;
          if ((yield* selectPrincipalAdmissionContext.effect()) !== admission) return;
          // Register cancellation before the first read or state dispatch. The explicit
          // admission prevents an old component from ending a replacement host's demand.
          const ended = yield* actionChannel((action: { type: string; payload?: unknown }) => {
            if (!Array.isArray(action.payload) || action.payload[0] !== workspaceId) return false;
            if (action.type === workspaceUnmounted.type) return true;
            if (action.type === repositoryContextDemanded.type) {
              return action.payload[2] === undefined || action.payload[2] === admission;
            }
            return (
              action.type === repositoryContextDemandEnded.type &&
              action.payload[1] === demandId &&
              (capturedAdmission === undefined
                ? action.payload[2] === undefined
                : action.payload[2] === admission)
            );
          }, buffers.sliding(1));
          const requestId = crypto.randomUUID();
          const request: RepositoryContextRequest = {
            workspaceId,
            requestId,
            binding: JSON.stringify([admission, demandId, requestId]),
          };
          try {
            yield* put(
              repositoryContextBound(workspaceId, request.binding, {
                admission,
                demandId,
                request,
              }),
            );
            yield* put(repositoryContextStarted(request));
            // A state subscriber may synchronously close or replace this demand.
            if (
              (yield* flush(ended)).length > 0 ||
              (yield* selectPrincipalAdmissionContext.effect()) !== admission
            )
              return;
            const result = yield* race({
              read: call(observe, admission, request),
              ended: take(ended),
            });
            // Dispose the failed observation, but retain its cancellation owner while
            // unavailable is displayed. Only a fresh explicit demand may start a read.
            if (result.read === 'unavailable') yield* take(ended);
          } finally {
            ended.close();
            yield* put(repositoryContextRetired(workspaceId, request.binding, request.requestId));
          }
        },
      );
    },
  );
}
