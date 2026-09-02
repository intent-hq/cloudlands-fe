import { AgentStatus } from '$shared/types/agent.types';
import type { AgentSession } from '$shared/types/agent-session';

export interface AgentRuntimeStateInput {
  status?: AgentStatus | string;
  activationState?: string;
  isStreaming?: boolean;
  isProcessing?: boolean;
  isResponding?: boolean;
  isWaitingOnTool?: boolean;
  isWaitingForOtherAgents?: boolean;
  turnInFlight?: boolean;
  liveTurnOpen?: boolean;
  lastToolUse?: { status?: string };
}

function isTerminalStatus(status: AgentRuntimeStateInput['status']): boolean {
  return (
    status === AgentStatus.Completed ||
    status === AgentStatus.Error ||
    status === AgentStatus.Deleted ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'error' ||
    status === 'deleted'
  );
}

/** Strong evidence that a turn is doing work now. */
export function hasAgentActiveTurnEvidence(input: AgentRuntimeStateInput): boolean {
  return !!(
    input.turnInFlight ||
    input.liveTurnOpen ||
    input.isStreaming ||
    input.isProcessing ||
    input.isResponding ||
    input.isWaitingOnTool ||
    input.lastToolUse?.status?.toLowerCase() === 'running'
  );
}

/**
 * A live turn is in flight right now: active turn evidence on a non-terminal
 * status. Narrower than `isAgentRunningState` (a bare `active` status without
 * evidence does not count) — used to gate idle-only affordances (e.g. pending
 * attention-request indicators) that must not render mid-turn.
 */
export function isAgentTurnLive(input: AgentRuntimeStateInput): boolean {
  return !isTerminalStatus(input.status) && hasAgentActiveTurnEvidence(input);
}

/** Purple waiting requires an explicit wait and no active turn evidence. */
export function isAgentBlockedWaitingState(input: AgentRuntimeStateInput): boolean {
  if (isTerminalStatus(input.status) || hasAgentActiveTurnEvidence(input)) return false;
  return !!(
    input.isWaitingForOtherAgents ||
    input.status === AgentStatus.Waiting ||
    input.status === 'waiting'
  );
}

/** Yellow running state after terminal and blocked-wait precedence. */
export function isAgentRunningState(input: AgentRuntimeStateInput): boolean {
  if (isTerminalStatus(input.status) || isAgentBlockedWaitingState(input)) return false;
  return !!(
    hasAgentActiveTurnEvidence(input) ||
    input.activationState === 'activating' ||
    input.status === AgentStatus.Active ||
    input.status === AgentStatus.Processing ||
    input.status === 'active' ||
    input.status === 'processing' ||
    input.status === 'responding' ||
    input.status === 'streaming'
  );
}

/**
 * Map an AgentSession to the runtime-state input shape. Single source for the
 * session→input mapping so every consumer (avatar state, list grouping)
 * evaluates the predicates above against the same fields.
 */
export function toAgentRuntimeStateInput(session: AgentSession): AgentRuntimeStateInput {
  return {
    isStreaming: session.isStreaming,
    isProcessing: session.isProcessing,
    isResponding: session.isResponding,
    turnInFlight: session.turnInFlight,
    liveTurnOpen: (session as AgentSession & { liveTurnOpen?: boolean }).liveTurnOpen,
    isWaitingOnTool: session.isWaitingOnTool,
    isWaitingForOtherAgents: session.isWaitingForOtherAgents,
    lastToolUse: session.lastToolUse,
    activationState: session.activationState,
    status: session.status,
  };
}
