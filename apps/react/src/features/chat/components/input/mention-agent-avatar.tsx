// Source: src/lib/components/chat/input/MentionAgentAvatar.svelte.
import { AgentAvatarWithState } from '@/features/agent/components/agent-avatar/agent-avatar-with-state';
import { selectAgentSession } from '@/store/agent-session/agent-session-selectors';
import { getAvatarStateForSession } from '../../../../../../../src/features/agent/components/agent-avatar/avatar-state-core';

export interface MentionAgentAvatarProps {
  agentId: string;
}

export function MentionAgentAvatar({ agentId }: MentionAgentAvatarProps) {
  // The configured Babel transform tracks this canonical ReactStore signal read.
  const session = selectAgentSession(agentId);
  const state = getAvatarStateForSession(session.value);
  return <AgentAvatarWithState agentId={agentId} variant="compact" state={state} />;
}
