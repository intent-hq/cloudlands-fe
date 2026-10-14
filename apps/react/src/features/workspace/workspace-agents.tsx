import { useLayoutEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { store } from '@/store';
import {
  selectAgentsLoaded,
  selectForegroundWorkspaceAgents,
} from '@/store/workspace-agents/workspace-agents-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  agentMetadataAcquired,
  agentMetadataReleased,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { AgentAvatarWithState } from '@/features/agent/components/agent-avatar/agent-avatar-with-state';
import { getAvatarStateForSession } from '../../../../../src/features/agent/components/agent-avatar/avatar-state-core';
import { CollapsiblePanel } from '@/components/ui/collapsible-panel';
import { ListRow, ListView } from '@/components/patterns/collection';
import { m } from '$shared/paraglide/messages.js';

function WorkspaceAgentRows({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const agents = selectForegroundWorkspaceAgents(workspaceId);
  const loaded = selectAgentsLoaded(workspaceId);
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  useLayoutEffect(() => {
    if (!authority) return;
    const consumerId = crypto.randomUUID();
    store.dispatch(agentMetadataAcquired(consumerId, workspaceId));
    return () => {
      store.dispatch(agentMetadataReleased(consumerId));
    };
  }, [workspaceId, authority]);
  return (
    <ListView
      items={authority ? agents.value : []}
      status={authority && loaded.value ? 'ready' : 'loading'}
      ariaLabel={m.workspace_multiSelectSidebar_agentsTab_label()}
      onActivate={(agent) =>
        void navigate({
          to: '/workspaces/$workspaceId',
          params: { workspaceId },
          search: (previous) => ({ ...previous, agent: agent.id }),
        })
      }
      getKey={(agent) => agent.id}
      getText={(agent) => agent.name}
      row={({ item: agent }) => (
        <ListRow
          data-workspace-agent={agent.id}
          title={agent.name}
          leading={
            <AgentAvatarWithState
              agentId={agent.id}
              specialist={agent.metadata?.specialist}
              provider={agent.provider}
              variant="compact"
              state={getAvatarStateForSession(agent)}
            />
          }
        />
      )}
    />
  );
}

export function WorkspaceAgents({ workspaceId }: { workspaceId: string }) {
  return (
    <section data-testid="workspace-agents" className="min-w-0">
      <CollapsiblePanel
        title={m.workspace_multiSelectSidebar_agentsTab_label()}
        defaultCollapsed
        showGradient={false}
        showChevronOnHover={false}
        className="h-auto"
      >
        <WorkspaceAgentRows workspaceId={workspaceId} />
      </CollapsiblePanel>
    </section>
  );
}
