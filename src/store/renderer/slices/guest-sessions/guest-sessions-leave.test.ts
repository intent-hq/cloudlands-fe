import { describe, expect, it } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { withHostPrincipal } from '../../../../test/fixtures/principal-state';
import { initialState as workspace } from '../workspace/workspace-slice';
import {
  guestSessionsListReceived,
  guestSessionsReducer,
  guestWorkspaceLeaveAnnounced,
  initialState as guestSessions,
  leaveGuestWorkspaceRequested,
  leaveWorkspaceOperationSettled,
  leaveWorkspaceOperationStarted,
} from './guest-sessions-slice';
import {
  selectCanLeaveWorkspace,
  selectIsLeavingWorkspace,
  selectIsSelfLeftWorkspace,
} from './guest-sessions-selectors';
import { GuestSessionOperationError, guestWorkspaceKey } from './guest-sessions-types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';

const SESSION_BASE = {
  label: 'studio.local',
  host: '10.0.0.7',
  hosts: ['10.0.0.7'],
  port: 8443,
  fingerprint: 'AB:CD',
  tcAddress: null,
  hostname: 'studio.local',
  login: 'octocat',
  tokenEncrypted: true,
  hostRole: 'guest',
  pairedAt: 100,
  updatedAt: 1,
} as const;

/** A guest window bound to its saved invite session, which lists `ws` as joined. */
function guestWindowState(overrides: { myRole?: Workspace['myRole']; listed?: boolean } = {}) {
  const base = withHostPrincipal(
    {
      guestSessions,
      workspace: {
        ...workspace,
        workspaces: createCollection('id', [
          { id: WorkspaceId('ws'), myRole: overrides.myRole ?? 'collaborator' } as Workspace,
        ]),
      },
    },
    'guest',
  );
  const session = {
    ...SESSION_BASE,
    id: base.connections.windowBackendId,
    principalId: base.principal.snapshot!.principal.id,
    workspaces: overrides.listed === false ? [] : [{ id: 'ws', title: 'Shared project' }],
  } as GuestSessionRecord;
  return {
    ...base,
    guestSessions: { ...guestSessions, sessions: createCollection('id', [session]) },
  };
}

describe('workspace menu Leave eligibility', () => {
  it('offers Leave to a guest window for a workspace it joined by invite', () => {
    expect(selectCanLeaveWorkspace.select(guestWindowState(), 'ws')).toBe(true);
  });

  it('withholds Leave from the owner, unlisted workspaces and an empty id', () => {
    expect(selectCanLeaveWorkspace.select(guestWindowState({ myRole: 'owner' }), 'ws')).toBe(false);
    expect(selectCanLeaveWorkspace.select(guestWindowState({ listed: false }), 'ws')).toBe(false);
    expect(selectCanLeaveWorkspace.select(guestWindowState(), 'other')).toBe(false);
    expect(selectCanLeaveWorkspace.select(guestWindowState(), '')).toBe(false);
  });

  it('withholds Leave outside a guest window (owner or paired window)', () => {
    const state = guestWindowState();
    const ownerWindow = {
      ...state,
      guestSessions: { ...state.guestSessions, sessions: createCollection('id', []) },
    };
    expect(selectCanLeaveWorkspace.select(ownerWindow, 'ws')).toBe(false);
  });

  it('withholds Leave while the Multiplayer lab is off', () => {
    const state = guestWindowState();
    const labOff = {
      ...state,
      userPreferences: { ...state.userPreferences, labsMultiplayerEnabled: false },
    };
    expect(selectCanLeaveWorkspace.select(labOff, 'ws')).toBe(false);
  });

  it('withholds Leave from an instance member, whose access the host refuses to drop per workspace', () => {
    expect(
      selectCanLeaveWorkspace.select(withHostPrincipal(guestWindowState(), 'member'), 'ws'),
    ).toBe(false);
  });

  it('withholds Leave once the host refused it as inherited through host membership', () => {
    const state = guestWindowState();
    const key = guestWorkspaceKey(state.connections.windowBackendId, 'ws');
    const refused = {
      ...state,
      guestSessions: { ...state.guestSessions, inheritedWorkspaceKeys: [key] },
    };
    expect(selectCanLeaveWorkspace.select(refused, 'ws')).toBe(false);
  });

  it('reports an in-flight leave for the window session only', () => {
    const state = guestWindowState();
    const id = state.connections.windowBackendId;
    const leaving = {
      ...state,
      guestSessions: guestSessionsReducer(
        state.guestSessions,
        leaveWorkspaceOperationStarted(id, 'ws'),
      ),
    };
    expect(selectIsLeavingWorkspace.select(state, 'ws')).toBe(false);
    expect(selectIsLeavingWorkspace.select(leaving, 'ws')).toBe(true);
    expect(selectIsSelfLeftWorkspace.select(leaving, 'ws')).toBe(true);
    expect(selectIsLeavingWorkspace.select(leaving, 'other')).toBe(false);
  });
});

describe('self-initiated leave marker', () => {
  const ID = 'guest-1';
  const KEY = guestWorkspaceKey(ID, 'ws');
  const session = {
    ...SESSION_BASE,
    id: ID,
    principalId: 'p',
    workspaces: [{ id: 'ws', title: 'Shared project' }],
  } as GuestSessionRecord;
  const listed = (workspaces: GuestSessionRecord['workspaces']) =>
    guestSessionsListReceived({
      sessions: [{ ...session, workspaces }],
      openIds: [ID],
      connectedIds: [ID],
    });
  const started = () =>
    guestSessionsReducer(
      guestSessionsReducer(guestSessions, listed(session.workspaces)),
      leaveWorkspaceOperationStarted(ID, 'ws'),
    );

  it('survives settle and success so a delta landing after the reply still reads as "you left"', () => {
    const request = leaveGuestWorkspaceRequested(ID, 'ws');
    let state = guestSessionsReducer(started(), listed(session.workspaces));
    expect(state.selfLeaveWorkspaceKeys).toEqual([KEY]);
    state = guestSessionsReducer(state, leaveWorkspaceOperationSettled(ID, 'ws'));
    state = guestSessionsReducer(state, request.success({ id: ID, workspaceId: 'ws', left: true }));
    state = guestSessionsReducer(state, listed([]));
    expect(state.selfLeaveWorkspaceKeys).toEqual([KEY]);
    state = guestSessionsReducer(state, guestWorkspaceLeaveAnnounced(ID, 'ws'));
    expect(state.selfLeaveWorkspaceKeys).toEqual([]);
  });

  it('is dropped by a failed, cancelled, no-op or refused leave', () => {
    const request = leaveGuestWorkspaceRequested(ID, 'ws');
    for (const outcome of [
      request.failure(new GuestSessionOperationError('ipc')),
      request.failure(new GuestSessionOperationError('cancelled')),
      request.success({ id: ID, workspaceId: 'ws', left: false }),
      request.success({
        id: ID,
        workspaceId: 'ws',
        left: false,
        refused: 'host-membership-required',
      }),
    ]) {
      expect(guestSessionsReducer(started(), outcome).selfLeaveWorkspaceKeys).toEqual([]);
    }
  });

  it('is dropped when the workspace is listed again after the leave (re-invite) or the session is forgotten', () => {
    const settled = guestSessionsReducer(started(), leaveWorkspaceOperationSettled(ID, 'ws'));
    expect(
      guestSessionsReducer(settled, listed(session.workspaces)).selfLeaveWorkspaceKeys,
    ).toEqual([]);
    const forgotten = guestSessionsReducer(
      settled,
      guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }),
    );
    expect(forgotten.selfLeaveWorkspaceKeys).toEqual([]);
  });
});
