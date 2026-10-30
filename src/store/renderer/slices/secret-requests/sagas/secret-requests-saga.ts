import { call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { channel, type Channel } from 'redux-saga';
import { appClient } from '$lib/client';
import { resolveBackendTransport } from '$lib/client/live/backend-transport-factory';
import { getRendererStore, type RendererStoreBridge } from '$store/renderer/renderer-store-bridge';
import { getPrincipalActionContext } from '../../principal/principal-context';
import {
  hostMembershipChanged,
  principalContextChanged,
  principalIdentityChanged,
  principalReadFailed,
  principalReceived,
} from '../../principal/principal-slice';
import { backendReconnected } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  setLabsMultiplayerEnabled,
  toggleLabsMultiplayer,
} from '../../user-preferences/user-preferences-slice';
import { takeSecretValue } from '$lib/components/chat/secrets/secret-value-handoff';
import {
  secretAnswerRequested,
  secretAnswerUpdated,
  secretListFailed,
  secretListLoaded,
  secretListRequested,
  secretRequestsReset,
} from '../secret-requests-slice';

interface SecretOwner {
  store: RendererStoreBridge;
  dispatch: RendererStoreBridge['dispatch'];
  transport: ReturnType<typeof resolveBackendTransport>;
  admission: string;
}

function captureOwner(): SecretOwner | null {
  try {
    const store = getRendererStore();
    const admission = getPrincipalActionContext(store.state);
    return admission
      ? { store, dispatch: store.dispatch, transport: resolveBackendTransport(), admission }
      : null;
  } catch {
    return null;
  }
}

function sameOwner(a: SecretOwner | null, b: SecretOwner | null): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.store === b.store &&
      a.dispatch === b.dispatch &&
      a.transport === b.transport &&
      a.admission === b.admission)
  );
}

/**
 * Secret requests (PROTOCOL §5.56). `secret.list` refreshes are single-flight
 * per agent and admitted caller with one trailing refresh; answers read the value from the
 * one-shot handoff, so it never passes through an action or the store.
 *
 * Each finished answer bumps an epoch. A listing records the epoch it started
 * at, so the reducer lets it replace only answers that finished before it (a
 * daemon restart then shows a provided-but-lost request as expired). A listing
 * whose store, transport or admission retired is dropped. Retired answer
 * completions never update the next caller or schedule a refresh for them.
 */
export function* secretRequestsSaga(): SagaGenerator<void> {
  let epoch = 0;
  let admissionEpoch = 0;
  let admitted = captureOwner();
  type Owner = SecretOwner & { epoch: number; revision: number };
  interface Flight {
    owner: Owner;
    workspaceId: string;
    agentId: string;
    requestIds: string[];
    trailing?: Set<string>;
  }
  const inFlight = new Map<string, Flight>();
  const done: Channel<Flight> = yield* call(channel<Flight>);

  function* admittedOwner(): SagaGenerator<Owner | null> {
    const next = captureOwner();
    let expectedEpoch = admissionEpoch;
    if (!sameOwner(admitted, next)) {
      admitted = next;
      admissionEpoch += 1;
      expectedEpoch = admissionEpoch;
      yield* put(secretRequestsReset());
    }
    return next && expectedEpoch === admissionEpoch && sameOwner(next, captureOwner())
      ? {
          ...next,
          epoch: admissionEpoch,
          revision: next.store.state.secretRequests?.admissionRevision ?? 0,
        }
      : null;
  }

  function isCurrent(owner: Owner): boolean {
    return (
      owner.epoch === admissionEpoch &&
      sameOwner(owner, captureOwner()) &&
      owner.revision === (owner.store.state.secretRequests?.admissionRevision ?? 0)
    );
  }

  yield* takeEvery(
    [
      principalContextChanged,
      principalReceived,
      principalReadFailed,
      principalIdentityChanged,
      hostMembershipChanged,
      backendReconnected,
      setLabsMultiplayerEnabled,
      toggleLabsMultiplayer,
    ],
    function* onAdmissionChanged(): SagaGenerator<void> {
      yield* call(admittedOwner);
    },
  );

  function* refresh(flight: Flight): SagaGenerator<void> {
    try {
      const answeredBefore = epoch;
      const { workspaceId, agentId, requestIds } = flight;
      if (!isCurrent(flight.owner) || inFlight.get(agentId) !== flight) return;
      const listing = yield* call([appClient.agents, appClient.agents.secretList], {
        workspaceId,
        agentId,
      });
      if (!isCurrent(flight.owner) || inFlight.get(agentId) !== flight) return;
      yield* put(
        listing
          ? secretListLoaded(agentId, listing, requestIds, answeredBefore)
          : secretListFailed(agentId),
      );
    } finally {
      yield* put(done, flight);
    }
  }

  yield* fork(function* trailingLoop(): SagaGenerator<void> {
    while (true) {
      const flight = yield* take(done);
      if (inFlight.get(flight.agentId) !== flight) continue;
      inFlight.delete(flight.agentId);
      if (flight.trailing && isCurrent(flight.owner)) {
        const next = { ...flight, requestIds: [...flight.trailing], trailing: undefined };
        inFlight.set(flight.agentId, next);
        yield* fork(refresh, next);
      }
    }
  });

  yield* takeEvery(
    secretListRequested,
    function* onList({ payload: [workspaceId, agentId, requestIds] }) {
      const owner = yield* call(admittedOwner);
      if (!owner) return;
      const current = inFlight.get(agentId);
      if (
        current &&
        current.workspaceId === workspaceId &&
        current.owner.epoch === owner.epoch &&
        current.owner.revision === owner.revision &&
        sameOwner(current.owner, owner)
      ) {
        // Coalesce: the trailing refresh covers every id asked for meanwhile.
        const pending = current.trailing ?? new Set<string>();
        for (const requestId of requestIds) pending.add(requestId);
        current.trailing = pending;
        return;
      }
      const flight = { owner, workspaceId, agentId, requestIds };
      inFlight.set(agentId, flight);
      yield* fork(refresh, flight);
    },
  );

  yield* takeEvery(secretAnswerRequested, function* onAnswer({ payload: [request] }) {
    const { workspaceId, agentId, requestId, outcome } = request;
    // Consume a provided value exactly once, including when its owner retired.
    const value = outcome === 'provided' ? takeSecretValue(requestId) : undefined;
    const owner = yield* call(admittedOwner);
    if (!owner) return;
    yield* put(secretAnswerUpdated(requestId, 'sending', epoch));
    if (!isCurrent(owner)) return;
    let result;
    if (outcome === 'provided') {
      if (value === undefined) {
        epoch += 1;
        yield* put(secretAnswerUpdated(requestId, 'failed', epoch));
        return;
      }
      result = yield* call([appClient.agents, appClient.agents.secretProvide], {
        workspaceId,
        requestId,
        value,
      });
    } else {
      result = yield* call([appClient.agents, appClient.agents.secretDismiss], {
        workspaceId,
        requestId,
      });
    }
    if (!isCurrent(owner)) return;
    epoch += 1;
    yield* put(
      secretAnswerUpdated(
        requestId,
        result.ok ? outcome : result.expired ? 'expired' : 'failed',
        epoch,
      ),
    );
    if (isCurrent(owner)) yield* put(secretListRequested(workspaceId, agentId, [requestId]));
  });
}
