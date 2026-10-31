import { call, put, select, take, type SagaGenerator } from 'typed-redux-saga';
import type { Action } from '@redux-saga/types';
import type { AgentSession, Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import {
  selectWorkspaceItems,
  selectWorkspaceListLoadedForBackend,
} from '$store/renderer/slices/workspace/workspace-selectors';
import { selectAgentSessionsById } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { addMessage } from '$store/renderer/slices/agent-session/agent-session-slice';
import { chatSendStarted, sendMessage } from '$store/renderer/slices/chat-state/chat-state-slice';
import { decideHomeSetAside, homeSetAsideAttention } from './home-set-aside-attention';
import {
  selectHomePersistenceScope,
  selectHomeSetAsideBackendId,
  selectHomeSetAsideRecords,
} from './home-workspaces-selectors';
import {
  bringBackHomeWorkspace,
  homeSetAsideKnownAttentionRecorded,
  homeWorkspaceReturned,
} from './home-workspaces-slice';
import type { HomeSetAsideRecord } from './home-workspaces-persistence';

type SendAction = ReturnType<typeof sendMessage>;
type SendStartedAction = ReturnType<typeof chatSendStarted>;
type AddMessageAction = ReturnType<typeof addMessage>;
const stateOwners = [
  'workspace/',
  'agentSessions/',
  'workspaceEvents/',
  'homeWorkspaces/',
  'principal/',
  'connections/',
  'daemonHealth/',
  'workspace-lifecycle/',
];

function isSetAsideAction(action: Action): boolean {
  return (
    action.type === sendMessage.type ||
    action.type === chatSendStarted.type ||
    stateOwners.some((prefix) => action.type.startsWith(prefix))
  );
}

/** Workspace that received a user instruction, if this action is one. */
function* instructedWorkspaceId(action: Action): SagaGenerator<string | null> {
  if (action.type === sendMessage.type) return (action as SendAction).payload.payload.wsId ?? null;
  // Local sends and edit/regenerate start without an assistant row; daemon
  // stream starts (agent-initiated turns) always carry one.
  if (action.type === chatSendStarted.type) {
    const payload = (action as SendStartedAction).payload;
    return !('assistantMessageId' in payload) && payload.wsId ? payload.wsId : null;
  }
  // The module send path (code review, new-agent first message) adds the user row directly.
  if (action.type === addMessage.type) {
    const [agentId, message] = (action as AddMessageAction).payload;
    if (message?.role !== 'user') return null;
    const sessions = yield* select(selectAgentSessionsById.select);
    return sessions[agentId]?.workspaceId ?? null;
  }
  return null;
}

/**
 * Brings set-aside workspaces back on a user instruction or new actionable
 * attention. Runs for the app lifetime; it only reads state and never touches
 * agents, scripts, hooks or watches.
 */
export function* homeSetAsideSaga(): SagaGenerator<void> {
  // Agents seen loaded per set-aside workspace in this app session.
  const observed = new Map<string, Set<string>>();
  let lastScope: string | null = null;
  let lastWorkspaces: unknown;
  let lastSessions: unknown;
  let lastSetAside: unknown;
  while (true) {
    const action = yield* take<Action>(isSetAsideAction);
    // Records are empty unless hydrated for the current account/backend.
    const scope = yield* select(selectHomePersistenceScope.select);
    if (scope !== lastScope) {
      lastScope = scope;
      observed.clear();
      lastWorkspaces = lastSessions = lastSetAside = undefined;
    }
    const setAside = yield* select(selectHomeSetAsideRecords.select);
    if (Object.keys(setAside).length === 0) {
      observed.clear();
      lastSetAside = setAside;
      continue;
    }
    const instructed = yield* call(instructedWorkspaceId, action);
    if (instructed && setAside[instructed]) {
      yield* put(homeWorkspaceReturned(instructed, 'instruction'));
      continue;
    }
    if (action.type === bringBackHomeWorkspace.type) continue;
    // Never judge records against a previous backend's or a still-loading list.
    const backendId = yield* select(selectHomeSetAsideBackendId.select);
    if (!backendId || !(yield* select(selectWorkspaceListLoadedForBackend.select, backendId)))
      continue;
    const workspaces = yield* select(selectWorkspaceItems.select);
    const sessions = yield* select(selectAgentSessionsById.select);
    if (workspaces === lastWorkspaces && sessions === lastSessions && setAside === lastSetAside)
      continue;
    lastWorkspaces = workspaces;
    lastSessions = sessions;
    lastSetAside = setAside;
    yield* call(evaluate, setAside, workspaces, sessions, observed);
  }
}

function* evaluate(
  setAside: Readonly<Record<string, HomeSetAsideRecord>>,
  workspaces: Workspace[],
  sessions: Readonly<Record<string, AgentSession>>,
  observed: Map<string, Set<string>>,
): SagaGenerator<void> {
  for (const id of observed.keys()) if (!setAside[id]) observed.delete(id);
  const byId = new Map<string, Workspace>(workspaces.map((workspace) => [workspace.id, workspace]));
  const agentsByWorkspace = new Map<string, AgentSession[]>();
  for (const session of Object.values(sessions)) {
    if (!session?.workspaceId || !setAside[session.workspaceId]) continue;
    const list = agentsByWorkspace.get(session.workspaceId) ?? [];
    list.push(session);
    agentsByWorkspace.set(session.workspaceId, list);
  }
  const now = Date.now();
  for (const [id, record] of Object.entries(setAside)) {
    const workspace = byId.get(id);
    // A list refresh can omit rows transiently; absence is never evidence.
    if (!workspace) continue;
    // Archive/delete are separate, stronger actions: free the bounded record
    // rather than keep personal state for work that left the active list.
    if (workspace.status === WorkspaceStatusEnum.Deleted || workspace.pendingDeleteAt) {
      if (workspace.status === WorkspaceStatusEnum.Deleted)
        yield* put(homeWorkspaceReturned(id, 'deleted'));
      continue;
    }
    if (
      workspace.status === WorkspaceStatusEnum.Archived ||
      workspace.status === WorkspaceStatusEnum.Retired
    ) {
      yield* put(homeWorkspaceReturned(id, 'archived'));
      continue;
    }
    const agents = agentsByWorkspace.get(id) ?? [];
    const seen = observed.get(id) ?? new Set<string>();
    const decision = decideHomeSetAside(
      record,
      homeSetAsideAttention(workspace, agents),
      seen,
      now,
    );
    if (decision.kind === 'return') {
      yield* put(homeWorkspaceReturned(id, 'attention'));
      continue;
    }
    for (const agent of agents) seen.add(agent.id);
    observed.set(id, seen);
    if (decision.kind === 'record')
      yield* put(homeSetAsideKnownAttentionRecorded(id, decision.known, decision.knownAt));
  }
}
