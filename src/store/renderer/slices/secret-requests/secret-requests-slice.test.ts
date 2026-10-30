import { describe, expect, it } from 'vitest';
import { secretRequestCardState } from '$lib/components/chat/secrets/pending-secret-requests';
import type { SecretListing } from '$shared/types/secret-request-resource';
import {
  secretAnswerUpdated,
  secretListLoaded,
  secretRequestsReducer,
} from './secret-requests-slice';
import type { SecretRequestsState } from './secret-requests-types';

const empty: SecretListing = { secrets: [], pendingRequests: [], answeredRequests: [] };
const provided: SecretListing = {
  secrets: [{ name: 'KEY' }],
  pendingRequests: [],
  answeredRequests: [{ requestId: 'sec-1', name: 'KEY', outcome: 'provided' }],
};

function reduce(state: SecretRequestsState | undefined, ...actions: unknown[]) {
  return actions.reduce<SecretRequestsState>(
    (current, action) => secretRequestsReducer(current, action as never),
    state as SecretRequestsState,
  );
}

/** What the card shows: a local answer wins until a listing replaces it. */
function shown(state: SecretRequestsState, requestId: string) {
  const answer = state.answers[requestId]?.status;
  if (answer === 'provided' || answer === 'declined' || answer === 'expired') return answer;
  return secretRequestCardState(requestId, state.listings.a);
}

describe('secretRequestsReducer', () => {
  it('shows a provided request as expired once a later listing proves it was lost', () => {
    // Provide succeeds (epoch 1) while the agent is busy; a listing that
    // started before the answer (epoch 0) must not undo it.
    let state = reduce(
      undefined,
      secretListLoaded(
        'a',
        { ...empty, pendingRequests: [{ requestId: 'sec-1', name: 'KEY' }] },
        ['sec-1'],
        0,
      ),
      secretAnswerUpdated('sec-1', 'provided', 1),
      secretListLoaded('a', empty, ['sec-1'], 0),
    );
    expect(shown(state, 'sec-1')).toBe('provided');
    // The daemon restarts before the notice is persisted: the reconnect
    // listing (started at epoch 1) no longer knows the request.
    state = reduce(state, secretListLoaded('a', empty, ['sec-1'], 1));
    expect(state.answers['sec-1']).toBeUndefined();
    expect(shown(state, 'sec-1')).toBe('expired');
  });

  it('keeps showing provided when the later listing confirms it', () => {
    const state = reduce(
      undefined,
      secretAnswerUpdated('sec-1', 'provided', 1),
      secretListLoaded('a', provided, ['sec-1'], 1),
    );
    expect(shown(state, 'sec-1')).toBe('provided');
  });

  it('never lets a listing replace an answer still sending or a failed send', () => {
    const state = reduce(
      undefined,
      secretAnswerUpdated('sec-1', 'sending', 0),
      secretAnswerUpdated('sec-2', 'failed', 1),
      secretListLoaded('a', empty, ['sec-1', 'sec-2'], 5),
    );
    expect(state.answers['sec-1']?.status).toBe('sending');
    expect(state.answers['sec-2']?.status).toBe('failed');
  });
});
