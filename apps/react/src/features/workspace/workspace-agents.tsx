import { normalizeHomeConfiguration } from '../../../../../src/features/home/home-workspaces-persistence';
import { WorkspaceId } from '$shared/types/branded-ids';
import { CreateAgentSection } from '@/components/workspace/create-agent-section';
import {
  createAgentFromConfigRequested,
  clearAgentCreationOutcome,
} from '../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { store } from '@/store';
import {
  selectAgentCreationOutcome,
  selectAgentCreationResource,
  selectAgentsLoaded,
  selectFilteredForegroundWorkspaceAgents,
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
import { SidebarExpandableSearch } from '@/components/workspace/sidebar/sidebar-expandable-search';
import { m } from '$shared/paraglide/messages.js';

function WorkspaceAgentCreation({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const resource = selectAgentCreationResource(workspaceId).value;
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const consumerId = `workspace-general:${resource ?? workspaceId}`;
  const outcome = selectAgentCreationOutcome(consumerId, workspaceId, resource ?? '').value;
  // This ref owns only navigation from this mounted control, never the create operation.
  const activated = useRef<number | null>(null);
  useLayoutEffect(() => {
    activated.current = null;
    return () => {
      activated.current = null;
      const current = selectAgentCreationOutcome.select(
        store.state,
        consumerId,
        workspaceId,
        resource ?? '',
      );
      if (current && current.status !== 'pending' && current.status !== 'uncertain') {
        store.dispatch(clearAgentCreationOutcome(consumerId, current.seq));
      }
    };
  }, [consumerId, workspaceId, resource]);
  useLayoutEffect(() => {
    if (
      !authority ||
      !resource ||
      outcome?.seq !== activated.current ||
      outcome.status !== 'success' ||
      !outcome.agentId
    )
      return;
    activated.current = null;
    void navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId },
      search: (previous) => ({
        q: typeof previous.q === 'string' ? previous.q : undefined,
        homeQuery: typeof previous.homeQuery === 'string' ? previous.homeQuery : undefined,
        homeFilter: normalizeHomeConfiguration({ filter: previous.homeFilter }).filter,
        agent: outcome.agentId,
      }),
    });
  }, [authority, resource, outcome, navigate, workspaceId]);
  const blocked = outcome?.status === 'pending' || outcome?.status === 'uncertain';
  return (
    <div data-testid="workspace-agent-creation">
      <CreateAgentSection
        disabled={!authority || !resource || blocked}
        pending={outcome?.status === 'pending'}
        onCreateWithSpecialist={() => {
          if (!resource || !selectAdmittedWorkspaceReadContext.select(store.state, workspaceId))
            return;
          const current = selectAgentCreationOutcome.select(
            store.state,
            consumerId,
            workspaceId,
            resource,
          );
          if (current?.status === 'pending' || current?.status === 'uncertain') return;
          const request = createAgentFromConfigRequested(
            workspaceId,
            { workspaceId: WorkspaceId(workspaceId), source: 'workspace-general' },
            {
              consumer: { id: consumerId, resourceId: resource },
              activateAgent: false,
              notifyOnError: false,
              protectUncertainCreation: true,
            },
          );
          activated.current = request.seq;
          void request.promise.catch(() => undefined);
          store.dispatch(request);
        }}
      />
      {outcome?.status === 'failure' && (
        <p role="alert" className="px-3 text-sm text-destructive">
          {m.agent_creation_createFailed_error()}
        </p>
      )}
      {outcome?.status === 'uncertain' && (
        <p role="alert" className="px-3 text-sm text-muted-foreground">
          {m.workspace_agentCreation_uncertain_description()}
        </p>
      )}
    </div>
  );
}

function WorkspaceAgentRows({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const agents = selectFilteredForegroundWorkspaceAgents(workspaceId, query);
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
    <div className="grid min-w-0 gap-2">
      <SidebarExpandableSearch
        scope="agents"
        placement="toolbar"
        query={query}
        onQueryChange={setQuery}
        placeholder={m.workspace_multiSelectSidebar_searchAgents_placeholder()}
      />
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
    </div>
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
        <WorkspaceAgentCreation workspaceId={workspaceId} />
        <WorkspaceAgentRows workspaceId={workspaceId} />
      </CollapsiblePanel>
    </section>
  );
}
