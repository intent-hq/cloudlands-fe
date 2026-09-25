import { buffers } from 'redux-saga';
import { actionChannel, call, delay, put, race, take } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import {
  IncompatiblePrincipalResponse,
  isRetryablePrincipalError,
  readConnectedPrincipal,
} from '$lib/client/live/live-principal-client';
import {
  setLabsMultiplayerEnabled,
  toggleLabsMultiplayer,
} from '../../user-preferences/user-preferences-slice';
import { loadWorkspacesRequested } from '../../workspace/workspace-slice';
import {
  hostMembershipChanged,
  principalContextChanged,
  principalIdentityChanged,
  principalReadFailed,
  principalReadStarted,
  principalReceived,
} from '../principal-slice';
import { selectPrincipalConnectionContext, selectPrincipalState } from '../principal-selectors';
import type { PrincipalRead } from '../principal-types';

export const PRINCIPAL_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const;

/** One flight per connection; bursts invalidate immediately and produce one trailing read. */
function* hydrateConnection({ payload: context }: SelectorChannelPayload<string | null>) {
  yield* put(principalContextChanged(context));
  if (!context) return;
  const triggers = yield* actionChannel(
    [
      hostMembershipChanged,
      principalIdentityChanged,
      setLabsMultiplayerEnabled,
      toggleLabsMultiplayer,
    ],
    buffers.sliding(1),
  );
  try {
    let retries = 0;
    while (true) {
      const { invalidation, presentationVersion, status } = yield* selectPrincipalState.effect();
      if (status === 'revoked') {
        yield* take(triggers);
        continue;
      }
      const read: PrincipalRead = { context, invalidation, presentationVersion };
      let retryDelay: number | undefined;
      yield* put(principalReadStarted());
      try {
        const snapshot = yield* call(readConnectedPrincipal);
        yield* put(principalReceived(read, snapshot));
        retries = 0;
        const accepted = (yield* selectPrincipalState.effect()).snapshot === snapshot;
        if (accepted && invalidation > 0) yield* put(loadWorkspacesRequested());
      } catch (error) {
        yield* put(
          principalReadFailed(
            read,
            error instanceof IncompatiblePrincipalResponse
              ? 'incompatible-response'
              : 'unavailable',
          ),
        );
        if (isRetryablePrincipalError(error)) retryDelay = PRINCIPAL_RETRY_DELAYS_MS[retries++];
      }
      // Buffered invalidations cause one immediate trailing read. Unrelated
      // events do not create flights; transient failures get a bounded backoff.
      // Cancelling this connection worker also cancels its retry timer.
      while (true) {
        const current = yield* selectPrincipalState.effect();
        if (
          current.status === 'revoked' ||
          current.invalidation !== invalidation ||
          current.presentationVersion !== presentationVersion
        ) {
          retries = 0;
          break;
        }
        if (retryDelay === undefined) yield* take(triggers);
        else {
          const { elapsed } = yield* race({ elapsed: delay(retryDelay), trigger: take(triggers) });
          if (elapsed) break;
        }
      }
    }
  } finally {
    triggers.close();
  }
}

export function* principalSaga() {
  yield* takeLatestFromSelector(selectPrincipalConnectionContext, hydrateConnection);
}
