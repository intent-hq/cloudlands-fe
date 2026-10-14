import { afterEach, beforeEach, expect, it } from 'vitest';
import { store } from '../index';
import { selectFileReadContext } from './files-selectors';
import { selectPrincipalActionContext } from '../principal/principal-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  workspaceReducer,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  agentSessionReducer,
  bulkUpsertSessions,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';
import { WorkspaceStatus } from '$shared/types';
import type { WireAgentSession } from '../../../../../src/store/renderer/slices/agent-session/agent-session-types';

let dispose: () => void;
beforeEach(() => {
  dispose = store.init();
});
afterEach(() => {
  dispose();
});
const workspaceId = WorkspaceId('attachment-workspace');
const agent: WireAgentSession = {
  id: AgentId('attachment-agent'),
  workspaceId,
  backendSessionId: null,
  name: 'Attachment owner',
  status: AgentStatus.Active,
  messages: [],
  createdAt: '2026-10-14T00:00:00Z',
  updatedAt: '2026-10-14T00:00:00Z',
};
function admitted() {
  const state = { ...store.state, ...createAdmittedLegacyPrincipal() };
  const context = selectPrincipalActionContext.select(state);
  return {
    ...state,
    workspace: workspaceReducer(
      workspaceReducer(
        state.workspace,
        setWorkspaceEntity({
          id: workspaceId,
          title: 'Files',
          branch: 'main',
          changesets: [],
          timeline: [],
          conversationInfo: [],
          status: WorkspaceStatus.Active,
          createdAt: '2026-10-14T00:00:00Z',
          updatedAt: '2026-10-14T00:00:00Z',
        }),
      ),
      setWorkspaceHasLoaded(true, state.connections.windowBackendId, context),
    ),
    agentSessions: agentSessionReducer(state.agentSessions, bulkUpsertSessions([agent])),
  };
}

it('keeps ordinary file admission and rejects missing or foreign attachment owners', () => {
  const state = admitted();
  const context = selectPrincipalActionContext.select(state);
  expect(context).toBeTruthy();
  expect(selectFileReadContext.select(state, workspaceId)).toBe(context);
  expect(selectFileReadContext.select(state, workspaceId, agent.id)).toBe(context);
  expect(selectFileReadContext.select(state, workspaceId, '')).toBeNull();
  expect(selectFileReadContext.select(state, workspaceId, 'missing')).toBeNull();
  const foreign = {
    ...state,
    agentSessions: agentSessionReducer(
      state.agentSessions,
      bulkUpsertSessions([{ ...agent, workspaceId: WorkspaceId('other') }]),
    ),
  };
  expect(selectFileReadContext.select(foreign, workspaceId, agent.id)).toBeNull();
});

it.each([
  { nodePath: '/node/worktree' },
  { placement: { target: 'remote', checkout: 'isolated' } },
  { placement: { target: 'local', checkout: 'isolated' } },
] as const)('retires a previously admitted preview when its owner changes to %j', (node) => {
  const state = admitted();
  expect(selectFileReadContext.select(state, workspaceId, agent.id)).toBeTruthy();
  const next = {
    ...state,
    agentSessions: agentSessionReducer(
      state.agentSessions,
      bulkUpsertSessions([{ ...agent, ...node }]),
    ),
  };
  expect(selectFileReadContext.select(next, workspaceId, agent.id)).toBeNull();
  expect(selectFileReadContext.select(next, workspaceId)).toBeTruthy();
});

it('denies cached attachment presentation when workspace authority retires', () => {
  const state = admitted();
  expect(selectFileReadContext.select(state, workspaceId, agent.id)).toBeTruthy();
  const retired = {
    ...state,
    workspace: workspaceReducer(
      state.workspace,
      setWorkspaceHasLoaded(false, state.connections.windowBackendId),
    ),
  };
  expect(selectFileReadContext.select(retired, workspaceId, agent.id)).toBeNull();
});
