import { appClient } from '$lib/client';
import { hostUserPresenceSaga } from '$store/renderer/slices/host-membership/sagas/host-user-presence-saga';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
import {
  principalContextChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  guestSessionsListReceived,
  hostedRosterReceived,
} from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { hostMembershipClient } from '$features/host-membership/host-membership.client';
import { hostMembershipSaga } from '$store/renderer/slices/host-membership/sagas/host-membership-saga';
import type { HostRole } from '$shared/types/principal';
import type { HostMember, HostInvite } from '$features/host-membership/types';
import type { Workspace } from '$shared/types';

export function setupCollaborationSettingsPreview(
  role: HostRole | null,
  populated = false,
  enabled = true,
  remote = false,
  status: 'ready' | 'loading' | 'error' = 'ready',
) {
  const before = store.state;
  const originalClient = { ...hostMembershipClient };
  const originalListClients = appClient.clients.list;
  appClient.clients.list = async () => {
    if (status === 'loading') return new Promise(() => {});
    if (status === 'error') throw new Error('Controlled status failure');
    return [
      {
        clientId: 'preview-device',
        principalId: 'preview-owner',
        hostRole: 'owner',
        login: null,
        displayName: null,
        avatarUrl: null,
        connections: 1,
        capabilities: {},
        transports: ['wss'],
        connectedAt: '2026-10-03T00:00:00Z',
      },
    ];
  };
  const identity = remote
    ? { provider: 'gitlab' as const, host: 'gitlab.example', externalUserId: '84' }
    : { provider: 'github' as const, host: 'github.com', externalUserId: '42' };
  const members: HostMember[] = [
    {
      principalId: 'preview-owner',
      hostRole: 'owner',
      login: populated ? 'casey' : null,
      displayName: populated ? 'Casey Morgan' : 'Instance owner',
      ...(populated
        ? { identity: { provider: 'github' as const, host: 'github.com', externalUserId: '142' } }
        : {}),
      avatarUrl: null,
      addedAt: '2026-10-01T00:00:00Z',
    },
  ];
  if (populated)
    members.push({
      ...members[0],
      principalId: 'preview-sam',
      hostRole: 'member',
      login: 'sam',
      displayName: 'Sam Rivera',
      identity: { provider: 'gitlab', host: 'gitlab.team.example', externalUserId: '84' },
    });
  const invites: HostInvite[] = populated
    ? [
        {
          id: 'preview-invite',
          scope: 'host',
          role: 'member',
          createdByPrincipalId: 'preview-owner',
          pinLogin: 'alex',
          pinIdentity: { ...identity, externalUserId: '128' },
          reusable: false,
          redemptionCount: 0,
          createdAt: '2026-10-01T00:00:00Z',
          expiresAt: '2026-10-08T00:00:00Z',
        },
      ]
    : [];
  // Controlled data only. No provider, daemon or clipboard operation is performed.
  hostMembershipClient.listMembers = async () => ({ members, revision: 1 });
  hostMembershipClient.listInvites = async () => ({ invites });
  hostMembershipClient.createInvite = async () => {
    throw new Error('Preview does not create invitations');
  };
  hostMembershipClient.removeMember = async () => {
    throw new Error('Preview does not remove members');
  };
  hostMembershipClient.revokeInvite = async () => {
    throw new Error('Preview does not revoke invitations');
  };
  store.dispatch(setLabsMultiplayerEnabled(enabled));
  store.dispatch(
    connectionsListReceived({
      connections: getItems(before.connections.connections),
      activeId: LOCAL_CONNECTION_ID,
      windowBackendId: remote ? 'preview-remote' : LOCAL_CONNECTION_ID,
    }),
  );
  admitLegacyPrincipal();
  const context = store.state.principal.context;
  store.dispatch(principalContextChanged(context));
  const current = store.state.principal;
  if (role && !context) throw new Error('Preview connection was not admitted');
  if (role && context)
    store.dispatch(
      principalReceived(
        {
          context,
          invalidation: current.invalidation,
          presentationVersion: current.presentationVersion,
        },
        {
          principal: {
            id: 'preview-current',
            login: populated ? (remote ? 'robin-remote' : 'taylor') : null,
            displayName: populated ? (remote ? 'Robin Patel' : 'Taylor Chen') : null,
            avatarUrl: null,
            isAdministrator: role === 'owner',
            hostRole: role,
            hostMembershipRevision: 1,
            ...(populated ? { identity } : {}),
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
  else store.dispatch(principalContextChanged(null));
  store.dispatch(
    replaceWorkspaceList(
      populated
        ? [
            {
              id: 'preview-workspace',
              title: 'Design system',
              myRole: 'owner',
              canManage: true,
              memberCount: 2,
            } as Workspace,
          ]
        : [],
    ),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(
    hostedRosterReceived('preview-workspace', [
      {
        principalId: 'preview-current',
        login: 'taylor',
        displayName: 'Taylor Chen',
        avatarUrl: null,
        role: 'owner',
        addedAt: '2026-10-01T00:00:00Z',
      },
      {
        principalId: 'preview-guest',
        login: 'jules',
        displayName: 'Jules Martin',
        avatarUrl: null,
        role: 'collaborator',
        addedAt: '2026-10-01T00:00:00Z',
      },
    ]),
  );
  store.dispatch(
    guestSessionsListReceived({
      sessions: populated
        ? [
            {
              id: 'preview-joined',
              label: 'Studio host',
              hostname: 'Studio host',
              host: 'studio.example',
              hosts: ['studio.example'],
              port: 4180,
              fingerprint: 'preview',
              tcAddress: null,
              principalId: 'preview-remote-taylor',
              login: 'taylor-work',
              identity: { provider: 'gitlab', host: 'gitlab.example', externalUserId: '107' },
              tokenEncrypted: true,
              workspaces: [{ id: 'preview-joined-workspace', title: 'Release planning' }],
              updatedAt: 1,
            },
          ]
        : [],
      openIds: [],
      connectedIds: [],
    }),
  );
  const stop = store.runSaga(hostMembershipSaga);
  const stopPresence = store.runSaga(hostUserPresenceSaga);
  return () => {
    stop();
    stopPresence();
    appClient.clients.list = originalListClients;
    store.dispatch(
      connectionsListReceived({
        connections: getItems(before.connections.connections),
        activeId: before.connections.activeId,
        windowBackendId: before.connections.windowBackendId,
      }),
    );
    Object.assign(hostMembershipClient, originalClient);
    store.dispatch(
      guestSessionsListReceived({
        sessions: getItems(before.guestSessions.sessions),
        openIds: before.guestSessions.openIds,
        connectedIds: before.guestSessions.connectedIds,
      }),
    );
    store.dispatch(replaceWorkspaceList(getItems(before.workspace.workspaces)));
    store.dispatch(
      setWorkspaceHasLoaded(
        before.workspace.hasLoaded,
        before.workspace.loadedBackendId ?? undefined,
        before.workspace.capabilityContext,
      ),
    );
    store.dispatch(setLabsMultiplayerEnabled(before.userPreferences.labsMultiplayerEnabled));
    store.dispatch(principalContextChanged(null));
  };
}
