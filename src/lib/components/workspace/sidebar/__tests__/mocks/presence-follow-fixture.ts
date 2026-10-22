import { store } from '$store/renderer/store';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  principalContextChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';
import { selectPresenceContext } from '$store/renderer/slices/presence/presence-selectors';
import {
  presenceContextReceived,
  presenceWorkspacesReceived,
  presenceMembersReceived,
  presenceRosterReceived,
} from '$store/renderer/slices/presence/presence-slice';
import { presenceFollowSaga } from '$store/renderer/slices/presence-follow/sagas/presence-follow-saga';
import { installMockElectronBridge } from '../../../../../../test/ct-mock-electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { HostRole } from '$shared/types/principal';
import { WorkspaceStatus, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';

export function initializePresenceFollowFixture(hidden: boolean, role: HostRole): () => void {
  const originalBridge = window.electronAPI;
  const listeners = new Map<string, (event: unknown) => void>();
  let serial = 0;
  installMockElectronBridge({
    'presence.focus.subscribe': (params) => {
      const { workspaceId, principalId } = params as { workspaceId: string; principalId: string };
      const subscriptionId = `fixture-${++serial}`;
      for (const fn of listeners.values())
        fn({
          method: 'subscription.push',
          params: {
            subscriptionId,
            seq: 0,
            kind: 'snapshot',
            snapshot: {
              workspaceId,
              principalId,
              target: hidden ? null : { workspaceId: 'destination', noteId: 'project-plan' },
            },
          },
        });
      return { subscriptionId };
    },
    'presence.focus.unsubscribe': () => ({ success: true }),
  });
  window.electronAPI!.on = (channel, handler) => {
    const id = crypto.randomUUID();
    if (channel === IPC_CHANNELS.BACKEND.NOTIFICATION) listeners.set(id, handler);
    return id;
  };
  window.electronAPI!.offById = (id) => {
    listeners.delete(id);
  };
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(daemonEventsSubscribed());
  store.dispatch(setLabsMultiplayerEnabled(true));
  const timestamp = '2026-10-03T00:00:00Z';
  store.dispatch(
    replaceWorkspaceList([
      {
        id: WorkspaceId('source'),
        title: 'Planning',
        branch: 'main',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        memberCount: 2,
        myRole: 'collaborator',
        status: WorkspaceStatus.Active,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: WorkspaceId('destination'),
        title: 'Shared destination',
        branch: 'main',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        memberCount: 2,
        myRole: 'collaborator',
        status: WorkspaceStatus.Active,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ] satisfies Workspace[]),
  );
  store.dispatch(openWorkspaceTab('source'));
  const context = selectPrincipalConnectionContext.select(store.state)!;
  store.dispatch(principalContextChanged(context));
  const p = store.state.principal;
  store.dispatch(
    principalReceived(
      { context, invalidation: p.invalidation, presentationVersion: p.presentationVersion },
      {
        principal: {
          id: 'viewer',
          hostRole: role,
          hostMembershipRevision: 1,
          isAdministrator: role === 'owner',
          login: null,
          displayName: null,
          avatarUrl: null,
        },
        capabilities: {
          hostMembership: true,
          collaborationIdentity: true,
          personalPairing: true,
          authenticatedDevices: true,
        },
      },
    ),
  );
  store.dispatch(presenceContextReceived(selectPresenceContext.select(store.state)!, 'viewer'));
  store.dispatch(presenceWorkspacesReceived(['source']));
  const person = {
    principalId: 'person',
    role: 'collaborator' as const,
    hostRole: 'member' as const,
    login: 'alex',
    displayName: 'Alex Chen',
    avatarUrl: null,
    addedAt: timestamp,
  };
  store.dispatch(presenceMembersReceived('source', [person]));
  store.dispatch(
    presenceRosterReceived({
      workspaceId: 'source',
      members: [{ ...person, focus: [], typing: [] }],
    }),
  );
  const cancel = store.runSaga(presenceFollowSaga);

  return () => {
    cancel();
    window.electronAPI = originalBridge;
  };
}
