import { describe, expect, it } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { withHostPrincipal, withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { selectPrincipalActionContext } from '../principal/principal-selectors';
import { initialState as guestSessions } from './guest-sessions-slice';
import { initialState as workspace } from '../workspace/workspace-slice';
import { selectCanManageHostedWorkspace, selectHostedWorkspaces } from './guest-sessions-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
function stateFor(role: 'owner' | 'member' | 'guest', canManage: boolean) {
  const state = withHostPrincipal(
    {
      guestSessions,
      workspace: {
        ...workspace,
        hasLoaded: true,
        loadedBackendId: 'local',
        workspaces: createCollection('id', [
          {
            id: WorkspaceId('ws'),
            myRole: role === 'member' ? 'collaborator' : 'owner',
            canManage,
            memberCount: 3,
          } as Workspace,
        ]),
      },
    },
    role,
  );
  state.workspace.capabilityContext = selectPrincipalActionContext.select(state);
  return state;
}
describe('Settings workspace sharing authority', () => {
  it('lists manageable workspaces for a member retaining myRole collaborator (#6390)', () => {
    const state = stateFor('member', true);
    expect(selectCanManageHostedWorkspace.select(state, 'ws')).toBe(true);
    expect(selectHostedWorkspaces.select(state).map((w) => w.id)).toEqual(['ws']);
  });
  it('rejects cached owner metadata, unknown authority, disabled Multiplayer and stale capability snapshots', () => {
    const state = stateFor('guest', false);
    expect(selectHostedWorkspaces.select(state)).toEqual([]);
    const admitted = stateFor('owner', true);
    for (const changed of [
      {
        ...admitted,
        userPreferences: { ...admitted.userPreferences, labsMultiplayerEnabled: false },
      },
      { ...admitted, workspace: { ...admitted.workspace, capabilityContext: 'old' } },
      { ...admitted, principal: { ...admitted.principal, status: 'unknown' as const } },
    ])
      expect(selectCanManageHostedWorkspace.select(changed, 'ws')).toBe(false);
  });
  it('retains admitted legacy owner behavior without inventing host membership', () => {
    const state = withLegacyPrincipal({
      guestSessions,
      workspace: {
        ...workspace,
        workspaces: createCollection('id', [
          { id: WorkspaceId('ws'), memberCount: 2 } as Workspace,
        ]),
      },
    });
    expect(selectCanManageHostedWorkspace.select(state, 'ws')).toBe(true);
  });
});
