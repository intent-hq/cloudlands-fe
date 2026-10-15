import { AgentAvatarWithState } from '@/features/agent/components/agent-avatar/agent-avatar-with-state';
import {
  selectAgentSession,
  selectAgentProvider,
} from '@/store/agent-session/agent-session-selectors';
import { selectPendingCount } from '@/store/permission/permission-selectors';
import { getAvatarStateForSession } from '../../../../../src/features/agent/components/agent-avatar/avatar-state-core';

/** Source PanelHeaderAgentAvatar and selected foreground row state. */
export function DesktopAgentAvatar({ agentId, active }: { agentId: string; active: boolean }) {
  const session = selectAgentSession(agentId).value;
  const provider = selectAgentProvider(agentId).value;
  const permissions = selectPendingCount(agentId).value;
  return (
    <AgentAvatarWithState
      agentId={agentId}
      variant="emphasized"
      provider={provider}
      specialist={session?.metadata?.specialist ?? session?.agentMetadata?.specialist}
      state={getAvatarStateForSession(session, {
        isActive: active,
        hasPermissionRequest: permissions > 0,
      })}
    />
  );
}
