import { AgentStatus } from '$shared/types/agent.types';

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
