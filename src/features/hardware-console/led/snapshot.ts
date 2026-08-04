/**
 * Store state → `HardwareLedSnapshot` derivation.
 *
 * Reads the resolved 6-slot key assignment (same pure resolver the
 * key-switch service uses) and derives one `AgentKeyLedState` per slot from
 * the assigned workspace plus its top-level (foreground) agents, and the
 * ambient state from all assignable workspaces.
 *
 * Dependency-light per src/store/renderer/AGENTS.md middleware conventions:
 * no selector imports — reads plain state through a narrow structural type
 * (`LedSnapshotState`, satisfied by the app `StoreState`).
 */

import { AgentStatus, type Workspace } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { AgentActivationState } from '$shared/types/agent-session';
import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
import { derivePendingQuestions } from '$lib/components/chat/questions/pending-questions';
import { getItems, type Collection } from '$lib/store-shim/utils/collections/collection-utils';
import type { StoredAgentSession } from '$store/renderer/slices/agent-session/agent-session-types';
import type { DaemonHealth } from '$store/renderer/slices/daemon-health/daemon-health-types';
import { isKeyAssignableWorkspace, resolveKeySlots } from '../assignment/key-assignment';
import {
  AGENT_KEY_LED_COUNT,
  type AgentKeyLedState,
  type AmbientLedState,
  type HardwareLedSnapshot,
} from './frames';

/** The narrow slice of the app store state the LED derivation reads. */
export interface LedSnapshotState {
  workspace: { workspaces: Collection<Workspace, 'id'> };
  hardwareConsole: {
    keyPins: (string | null)[];
    excludedWorkspaceIds?: readonly string[];
    /** True while a push-to-talk recording is in progress. */
    pttRecording?: boolean;
  };
  workspaceAgents: {
    byWorkspaceId: Record<string, { foregroundAgentIds: readonly (string | number)[] }>;
  };
  agentSessions?: { byAgentId: Record<string, StoredAgentSession> };
  /**
   * Daemon connection health (daemon-health slice). `'down'` means the
   * backend connection is lost (status disconnected/connecting), so all
   * store-derived lighting is stale. Optional so narrow test fixtures
   * default to connected.
   */
  daemonHealth?: { health: DaemonHealth };
}

/**
 * Mirror of the canonical `isActiveAgentThread` gate in
 * agent-session-selectors.ts (kept local so this middleware-reachable module
 * imports no selectors). Gates the pending-question derivation exactly like
 * the wizard: a question only pends once the agent's own turn ended.
 */
function isAgentTurnActive(session: StoredAgentSession): boolean {
  const status = session.status as AgentStatus;
  if (
    status === AgentStatus.Completed ||
    status === AgentStatus.Error ||
    status === AgentStatus.Deleted
  ) {
    return false;
  }
  return (
    session.isProcessing === true ||
    session.isStreaming === true ||
    session.isResponding === true ||
    session.isWaitingOnTool === true ||
    session.activationState === AgentActivationState.ACTIVATING ||
    status === AgentStatus.Active ||
    status === AgentStatus.Processing ||
    status === AgentStatus.Waiting
  );
}

/** Whether a session has a pending Q&A wizard question (dismissal-gated). */
function hasPendingQuestion(session: StoredAgentSession): boolean {
  const pending = derivePendingQuestions(session.messages ?? [], isAgentTurnActive(session));
  if (!pending) return false;
  const dismissedId = session.metadata?.dismissedQuestionsMessageId;
  return !(typeof dismissedId === 'string' && dismissedId === pending.messageId);
}

/** Blocked = a pending `blocker` attention request (spec orange palette row). */
function isBlocked(session: StoredAgentSession): boolean {
  return getAgentAttentionRequest(session)?.kind === 'blocker';
}

/** Attention = pending question or discussion request (spec yellow palette row). */
function needsAttention(session: StoredAgentSession): boolean {
  return getAgentAttentionRequest(session)?.kind === 'discussion' || hasPendingQuestion(session);
}

function hasFailed(session: StoredAgentSession): boolean {
  return session.status === AgentStatus.Error;
}

function foregroundSessions(state: LedSnapshotState, workspaceId: string): StoredAgentSession[] {
  const ids = state.workspaceAgents.byWorkspaceId[workspaceId]?.foregroundAgentIds ?? [];
  const byAgentId = state.agentSessions?.byAgentId ?? {};
  const sessions: StoredAgentSession[] = [];
  for (const id of ids) {
    const session = byAgentId[String(id)];
    if (session) sessions.push(session);
  }
  return sessions;
}

const COMPLETE_DISPLAY_STATUSES: ReadonlySet<string> = new Set([
  'complete',
  'pr_ready',
  'pr_open',
  'pr_merged',
]);

/**
 * Work-in-progress gate shared by the key derivation and the ambient scan:
 * live agent activity, or the daemon-derived `in_progress` displayStatus
 * (which folds in active background hooks — intentd#856).
 */
function isWorkspaceRunning(workspace: Workspace): boolean {
  return workspace.activity === 'agent_running' || workspace.displayStatus === 'in_progress';
}

/** Whether a workspace has a complete-family displayStatus (spec green row). */
function isWorkspaceComplete(workspace: Workspace): boolean {
  return (
    workspace.displayStatus !== undefined && COMPLETE_DISPLAY_STATUSES.has(workspace.displayStatus)
  );
}

/**
 * Per-key state for one assigned workspace (spec agent-key LED palette).
 * Precedence: failed > blocked > attention > running > unread > complete >
 * idle. `unread` is the backend-owned dismissible attention flag
 * (`workspace.attention === 'unread'`, PROTOCOL §5.1).
 */
export function deriveAgentKeyLedState(
  workspace: Workspace,
  agents: readonly StoredAgentSession[],
): AgentKeyLedState {
  if (agents.some(hasFailed)) return 'failed';
  if (agents.some(isBlocked)) return 'blocked';
  if (agents.some(needsAttention)) return 'attention';
  if (isWorkspaceRunning(workspace)) return 'running';
  if (workspace.attention === 'unread') return 'unread';
  if (isWorkspaceComplete(workspace)) return 'complete';
  return 'idle';
}

/** Build the full lighting snapshot (6 key states + ambient) from state. */
export function buildHardwareLedSnapshot(state: LedSnapshotState): HardwareLedSnapshot {
  // Daemon connection down → every store-derived state is stale: blank all
  // 6 keys and show only the disconnected snake (spec precedence row 1).
  // Recovers automatically once health leaves 'down' on reconnect.
  if (state.daemonHealth?.health === 'down') {
    return {
      keys: new Array<AgentKeyLedState>(AGENT_KEY_LED_COUNT).fill('unassigned'),
      ambient: { kind: 'disconnected' },
    };
  }

  const workspaces = getItems(state.workspace.workspaces).filter(
    (workspace) => workspace.id !== CHIEF_WORKSPACE_ID && isKeyAssignableWorkspace(workspace),
  );
  const byId = new Map<string, Workspace>();
  for (const workspace of workspaces) byId.set(workspace.id, workspace);

  const slots = resolveKeySlots(
    state.hardwareConsole.keyPins,
    workspaces,
    state.hardwareConsole.excludedWorkspaceIds ?? [],
  );
  const keys: AgentKeyLedState[] = slots.map((workspaceId) => {
    const workspace = workspaceId === null ? undefined : byId.get(workspaceId);
    if (!workspace) return 'unassigned';
    return deriveAgentKeyLedState(workspace, foregroundSessions(state, workspace.id));
  });

  // Ambient scans ALL assignable workspaces (not just the 6 assigned), in
  // spec mapping-table precedence: failed > blocked > question/discussion >
  // unread > running (breath speed ∝ count) > complete > dark. `unread`
  // outranks `running` so unseen output stays visible even while other
  // workspaces are still running; `complete` is terminal (every completion
  // passes through unread first) and only wins once nothing is running.
  // An in-progress push-to-talk recording outranks everything.
  let anyFailed = false;
  let anyBlocked = false;
  let anyAttention = false;
  let runningCount = 0;
  let anyUnread = false;
  let anyComplete = false;
  for (const workspace of workspaces) {
    const agents = foregroundSessions(state, workspace.id);
    if (agents.some(hasFailed)) anyFailed = true;
    if (agents.some(isBlocked)) anyBlocked = true;
    if (agents.some(needsAttention)) anyAttention = true;
    if (isWorkspaceRunning(workspace)) runningCount += 1;
    if (workspace.attention === 'unread') anyUnread = true;
    if (isWorkspaceComplete(workspace)) anyComplete = true;
  }
  let ambient: AmbientLedState;
  if (state.hardwareConsole.pttRecording === true) ambient = { kind: 'recording' };
  else if (anyFailed) ambient = { kind: 'failed' };
  else if (anyBlocked) ambient = { kind: 'blocked' };
  else if (anyAttention) ambient = { kind: 'question' };
  else if (anyUnread) ambient = { kind: 'unread' };
  else if (runningCount > 0) ambient = { kind: 'running', runningCount };
  else if (anyComplete) ambient = { kind: 'complete' };
  else ambient = { kind: 'dark' };

  return { keys, ambient };
}
