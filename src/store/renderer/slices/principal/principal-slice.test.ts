import { describe, expect, it } from 'vitest';
import { parsePrincipalSnapshot } from '$shared/types/principal';
import { backendReconnected } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { setLabsMultiplayerEnabled } from '../user-preferences/user-preferences-slice';
import {
  hostMembershipChanged,
  initialState,
  principalContextChanged,
  principalIdentityChanged,
  principalReadFailed,
  principalReadStarted,
  principalReceived,
  principalReducer,
} from './principal-slice';

const read = { context: 'connection-a', invalidation: 0, presentationVersion: 0 };
const snapshot = parsePrincipalSnapshot(
  { server: { capabilities: { hostMembership: 1 } } },
  {
    id: 'person',
    login: null,
    displayName: null,
    avatarUrl: null,
    isAdministrator: false,
    hostRole: 'member',
    hostMembershipRevision: 4,
  },
)!;
const loading = principalReducer(initialState, principalContextChanged(read.context));
const ready = principalReducer(loading, principalReceived(read, snapshot));

describe('principal state transitions', () => {
  it('starts without authority and cannot accept another connection response', () => {
    expect(initialState.snapshot).toBe(null);
    expect(principalReducer(initialState, principalReceived(read, snapshot))).toEqual(initialState);
    expect(principalReducer(loading, principalReadStarted()).status).toBe('loading');
    expect(ready.status).toBe('ready');
    expect(principalReducer(ready, principalContextChanged(null)).snapshot).toBe(null);
  });
  it('fences old successes and errors after invalidation or reconnect', () => {
    const reconnect = principalReducer(ready, backendReconnected());
    expect(reconnect.snapshot).toBe(null);
    expect(principalReducer(reconnect, principalReceived(read, snapshot))).toEqual(reconnect);
    expect(principalReducer(reconnect, principalReadFailed(read, 'unavailable'))).toEqual(
      reconnect,
    );
    expect(principalReducer(ready, principalReadFailed(read, 'unavailable')).status).toBe('error');
  });
  it('rejects a principal switch on one admitted connection and a decreasing durable revision', () => {
    for (const principal of [
      { ...snapshot.principal, id: 'different' },
      { ...snapshot.principal, hostMembershipRevision: 3 },
    ]) {
      const next = principalReducer(ready, principalReceived(read, { ...snapshot, principal }));
      expect(next.snapshot).toBe(null);
      expect(next.error).toBe('incompatible-response');
    }
  });
  it('invalidates only the bound identity and newer membership revisions', () => {
    expect(principalReducer(ready, principalIdentityChanged('other'))).toEqual(ready);
    const changed = principalReducer(ready, principalIdentityChanged('person'));
    expect(changed.snapshot).toBe(null);
    expect(
      principalReducer(
        ready,
        hostMembershipChanged({
          revision: 3,
          action: 'added',
          hostRole: 'member',
          principalId: 'another',
        }),
      ),
    ).toEqual(ready);
    const removed = principalReducer(
      ready,
      hostMembershipChanged({
        revision: 5,
        action: 'removed',
        hostRole: 'guest',
        principalId: 'person',
      }),
    );
    expect(removed.status).toBe('revoked');
    expect(
      principalReducer(removed, principalReceived({ ...read, invalidation: 1 }, snapshot)),
    ).toEqual(removed);
  });
  it('invalidates presentation on lab changes without rewriting authority', () => {
    const next = principalReducer(ready, setLabsMultiplayerEnabled(true));
    expect(next.snapshot).toEqual(snapshot);
    expect(next.presentationVersion).toBe(1);
    expect(next.refreshedPresentationVersion).toBe(0);
  });
});
