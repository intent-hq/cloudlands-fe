import { buffers } from 'redux-saga';
import { actionChannel, call, flush, put, take } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import {
  IncompatiblePrincipalResponse,
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
    let previous: PrincipalRead | null = null;
    while (true) {
      const { invalidation, presentationVersion, status } = yield* selectPrincipalState.effect();
      const read = { context, invalidation, presentationVersion };
      if (
        status !== 'revoked' &&
        (!previous ||
          previous.invalidation !== invalidation ||
          previous.presentationVersion !== presentationVersion)
      ) {
        previous = read;
        yield* put(principalReadStarted());
        try {
          const snapshot = yield* call(readConnectedPrincipal);
          yield* put(principalReceived(read, snapshot));
          const accepted = (yield* selectPrincipalState.effect()).snapshot === snapshot;
          if (accepted && invalidation > 0) {
            yield* put(loadWorkspacesRequested());
          }
        } catch (error) {
          yield* put(
            principalReadFailed(
              read,
              error instanceof IncompatiblePrincipalResponse
                ? 'incompatible-response'
                : 'unavailable',
            ),
          );
        }
        const pending = yield* flush(triggers);
        if (pending.length) continue;
      }
      yield* take(triggers);
    }
  } finally {
    triggers.close();
  }
}

export function* principalSaga() {
  yield* takeLatestFromSelector(selectPrincipalConnectionContext, hydrateConnection);
}
