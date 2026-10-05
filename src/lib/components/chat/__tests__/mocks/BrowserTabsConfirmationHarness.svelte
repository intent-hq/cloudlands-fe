<script lang="ts">
  import { onMount } from 'svelte';
  import BrowserTabsMenu from '../../BrowserTabsMenu.svelte';
  import { store } from '$store/renderer/store';
  import {
    removeSession,
    bulkUpsertSessions,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    clearPanelLayout,
    initializeLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { AgentStatus } from '$shared/types/agent.types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

  const workspaceId = WorkspaceId('browser-confirmation-workspace');
  const agentId = AgentId('browser-confirmation-agent');
  const panelId = 'browser-confirmation-panel';

  onMount(() => {
    store.dispatch(
      bulkUpsertSessions([
        {
          id: agentId,
          backendSessionId: null,
          workspaceId,
          name: 'Browser owner',
          status: AgentStatus.Active,
          messages: [],
          createdAt: '2026-09-23T00:00:00.000Z',
          updatedAt: '2026-09-23T00:00:00.000Z',
        },
      ]),
    );
    store.dispatch(
      initializeLayout(workspaceId, {
        root: { type: 'panel', panelId },
        panels: {
          [panelId]: {
            id: panelId,
            activeTabId: 'browser-first',
            tabs: ['first', 'second'].map((name) => ({
              id: `browser-${name}`,
              type: 'browser',
              title: name,
              ownerAgentId: agentId,
              closable: true,
            })),
          },
        },
        focusedPanelId: panelId,
      }),
    );
    return () => {
      store.dispatch(clearPanelLayout(workspaceId));
      store.dispatch(removeSession(agentId));
    };
  });
</script>

<div class="p-8">
  <BrowserTabsMenu {workspaceId} {agentId} />
</div>
