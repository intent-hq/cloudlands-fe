import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { store } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import MentionAgentAvatar from './MentionAgentAvatar.svelte';

const agentId = AgentId('preview-agent-avatar');
const workspaceId = WorkspaceId('preview-agent-avatar-workspace');
const timestamp = '2026-08-23T12:00:00.000Z';

function setup(status: AgentStatus) {
  return () => {
    const session: AgentSession = {
      id: agentId,
      backendSessionId: null,
      workspaceId,
      name: 'Preview agent',
      status,
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.dispatch(removeSession(agentId));
    store.dispatch(bulkUpsertSessions([session]));
    return () => store.dispatch(removeSession(agentId));
  };
}

export const preview = definePreview<ComponentProps<typeof MentionAgentAvatar>>({
  id: 'mention-agent-avatar',
  title: 'Mention agent avatar',
  defaultState: 'idle',
  states: {
    idle: { props: { agentId }, setup: setup(AgentStatus.RuntimeIdle) },
    waiting: { props: { agentId }, setup: setup(AgentStatus.Waiting) },
    error: { props: { agentId }, setup: setup(AgentStatus.Error) },
  },
});

export default MentionAgentAvatar;
