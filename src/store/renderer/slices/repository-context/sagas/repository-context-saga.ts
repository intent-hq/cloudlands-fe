import { buffers, eventChannel } from 'redux-saga';
import { actionChannel, call, put, race, take, takeEvery } from 'typed-redux-saga';
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

function* observe(admission: string, workspaceId: string, demandId: string) {
  const requestId = crypto.randomUUID();
  const request: RepositoryContextRequest = {
    workspaceId,
    requestId,
    binding: JSON.stringify([admission, demandId, requestId]),
  };
  yield* put(repositoryContextBound(workspaceId, request.binding));
  yield* put(repositoryContextStarted(request));
  const updates = updatesFor(request);
  let keepFailure = false;
  try {
    while (true) {
      const update = yield* take(updates);
      if ((yield* selectPrincipalAdmissionContext.effect()) !== admission) return;
      if (update.type === 'received') {
        yield* put(repositoryContextReceived(update.response));
      } else if (update.type === 'unavailable') {
        keepFailure = true;
        yield* put(repositoryContextFailed(request));
        return;
      } else return;
    }
  } finally {
    updates.close();
    if (!keepFailure) yield* put(repositoryContextRetired(workspaceId, request.binding));
  }
}

/** One root owner, cancelled by original actor/admission changes without replay. */
export function* repositoryContextSaga() {
  yield* takeLatestFromSelector(
    selectPrincipalAdmissionContext,
    function* ({ payload: admission }: SelectorChannelPayload<string | null>) {
      if (!admission) return;
      yield* takeEvery(repositoryContextDemanded, function* ({ payload: [workspaceId, demandId] }) {
        // Register cancellation before the first read or state dispatch. Redux-saga
        // owns task lifetime; a later demand for this workspace supersedes this one.
        const ended = yield* actionChannel((action: { type: string; payload?: unknown }) => {
          if (!Array.isArray(action.payload) || action.payload[0] !== workspaceId) return false;
          return (
            action.type === workspaceUnmounted.type ||
            action.type === repositoryContextDemanded.type ||
            (action.type === repositoryContextDemandEnded.type && action.payload[1] === demandId)
          );
        }, buffers.sliding(1));
        try {
          yield* race({
            read: call(observe, admission, workspaceId, demandId),
            ended: take(ended),
          });
        } finally {
          ended.close();
        }
      });
    },
  );
}
