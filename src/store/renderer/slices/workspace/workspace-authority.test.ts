import { afterEach, describe, expect, it } from 'vitest';
import { store } from '../../store';
import { connectionsListReceived } from '../connections/connections-slice';
import { guestSessionsListReceived } from '../guest-sessions/guest-sessions-slice';
import { replaceWorkspaceList, setWorkspaceHasLoaded } from './workspace-slice';
import {
  selectHidesOwnerWorkspaceActions,
  selectIsCollaboratorOnlyClient,
} from './workspace-selectors';

describe('connected host authority regressions', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => dispose?.());

  it('does not infer host administration from an empty workspace list and no saved invitations', () => {
    dispose = store.init();
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
    );
    store.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
    store.dispatch(replaceWorkspaceList([]));
    store.dispatch(setWorkspaceHasLoaded(true));
    expect(selectIsCollaboratorOnlyClient.select(store.state)).toBe(true);
  });

  it('withholds workspace management until the connected principal is known', () => {
    dispose = store.init();
    store.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
    expect(selectHidesOwnerWorkspaceActions.select(store.state, 'missing')).toBe(true);
  });
});
