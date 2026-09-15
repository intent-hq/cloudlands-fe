/**
 * Hover-card roster selectors: the owner gate (`workspace.myRole === 'owner'`
 * and not withheld by the daemon) and the keyed roster reads, as pure
 * state-in / value-out cases.
 */
import { describe, expect, it } from 'vitest';

import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { WorkspaceMember } from '$features/workspace-sharing/types';
import type { Workspace, WorkspaceRole } from '$shared/types';
import type { StoreState } from '../../types';
import {
  selectWorkspaceRosterCanManage,
  selectWorkspaceRosterMembers,
  selectWorkspaceRosterRemoveError,
  selectWorkspaceRosterRemovingPrincipalId,
  selectWorkspaceRosterTracked,
  selectWorkspaceRosterWithheld,
} from './workspace-share-selectors';
import {
  initialState,
  shareRosterLoaded,
  shareRosterMemberRemoveRequested,
  shareRosterRequested,
  shareRosterWithheld,
  workspaceShareReducer,
} from './workspace-share-slice';

const owner: WorkspaceMember = {
  principalId: 'p-alice',
  login: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  role: 'owner',
  addedAt: '2026-09-01T00:00:00Z',
};
const guest: WorkspaceMember = { ...owner, principalId: 'p-guest', role: 'collaborator' };

function stateWith(
  roles: Record<string, WorkspaceRole | undefined>,
  ...actions: Parameters<typeof workspaceShareReducer>[1][]
): StoreState {
  const workspaces = Object.entries(roles).map(
    ([id, myRole]) => ({ id, title: id, myRole }) as unknown as Workspace,
  );
  return {
    workspaceShare: actions.reduce(workspaceShareReducer, initialState),
    workspace: { workspaces: createCollection('id', workspaces) },
  } as unknown as StoreState;
}

const loaded = [
  shareRosterRequested({ workspaceId: 'ws-1' }),
  shareRosterLoaded({ workspaceId: 'ws-1', members: [owner, guest] }),
];

describe('selectWorkspaceRosterCanManage', () => {
  it('is true only for the owner of a workspace the daemon has not withheld', () => {
    expect(selectWorkspaceRosterCanManage.select(stateWith({ 'ws-1': 'owner' }), 'ws-1')).toBe(
      true,
    );
    expect(
      selectWorkspaceRosterCanManage.select(stateWith({ 'ws-1': 'collaborator' }), 'ws-1'),
    ).toBe(false);
    expect(selectWorkspaceRosterCanManage.select(stateWith({ 'ws-1': undefined }), 'ws-1')).toBe(
      false,
    );
    expect(selectWorkspaceRosterCanManage.select(stateWith({}), 'ws-1')).toBe(false);
    expect(selectWorkspaceRosterCanManage.select(stateWith({ 'ws-1': 'owner' }), undefined)).toBe(
      false,
    );
  });

  it('turns false for the owner once the daemon refused an owner-only method', () => {
    const state = stateWith(
      { 'ws-1': 'owner', 'ws-2': 'owner' },
      ...loaded,
      shareRosterWithheld({ workspaceId: 'ws-1' }),
    );
    expect(selectWorkspaceRosterCanManage.select(state, 'ws-1')).toBe(false);
    expect(selectWorkspaceRosterWithheld.select(state, 'ws-1')).toBe(true);
    expect(selectWorkspaceRosterCanManage.select(state, 'ws-2')).toBe(true);
    expect(selectWorkspaceRosterWithheld.select(state, 'ws-2')).toBe(false);
  });
});

describe('keyed roster reads', () => {
  it('reads the rows, in-flight removal, and error of the named workspace only', () => {
    const state = stateWith(
      { 'ws-1': 'owner' },
      ...loaded,
      shareRosterMemberRemoveRequested({ workspaceId: 'ws-1', principalId: 'p-guest' }),
    );
    expect(selectWorkspaceRosterMembers.select(state, 'ws-1').map((m) => m.principalId)).toEqual([
      'p-alice',
      'p-guest',
    ]);
    expect(selectWorkspaceRosterMembers.select(state, 'ws-2')).toEqual([]);
    expect(selectWorkspaceRosterMembers.select(state, undefined)).toEqual([]);
    expect(selectWorkspaceRosterRemovingPrincipalId.select(state, 'ws-1')).toBe('p-guest');
    expect(selectWorkspaceRosterRemovingPrincipalId.select(state, 'ws-2')).toBeNull();
    expect(selectWorkspaceRosterRemoveError.select(state, 'ws-1')).toBeNull();
    expect(selectWorkspaceRosterTracked.select(state, 'ws-1')).toBe(true);
    expect(selectWorkspaceRosterTracked.select(state, 'ws-2')).toBe(false);
  });
});
