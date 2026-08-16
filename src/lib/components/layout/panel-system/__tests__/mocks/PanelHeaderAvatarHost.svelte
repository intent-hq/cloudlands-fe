<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AgentSession } from '$shared/types';
  import { AgentStatus } from '$shared/types/agent.types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    permissionRequestReceived,
    removePermissionRequest,
  } from '$store/renderer/slices/permission/permission-slice';
  import { eventReceived } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import PanelTabBar from '../../PanelTabBar.svelte';

  type Scenario =
    | 'idle'
    | 'responding'
    | 'processing'
    | 'waiting'
    | 'failed'
    | 'permission'
    | 'agent-switch'
    | 'completed';

  let {
    theme = 'light',
    width = 280,
    zoom = 1,
    scenario = 'idle',
  }: { theme?: 'light' | 'dark'; width?: number; zoom?: number; scenario?: Scenario } = $props();

  const workspaceId = WorkspaceId('panel-avatar-workspace');
  const agentA = AgentId('panel-avatar-agent-a');
  const agentB = AgentId('panel-avatar-agent-b');
  const timestamp = '2026-08-16T01:00:00.000Z';
  const permissionId = 'panel-avatar-permission';
  let eventIndex = 0;
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  function session(id: typeof agentA, name: string): AgentSession {
    return {
      id,
      backendSessionId: null,
      workspaceId,
      name,
      status: AgentStatus.RuntimeIdle,
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  store.dispatch(bulkUpsertSessions([session(agentA, 'Agent A'), session(agentB, 'Agent B')]));

  function dispatchStatus(
    agentId: string,
    status: string,
    flags: { isProcessing?: boolean; isResponding?: boolean } = {},
  ) {
    store.dispatch(
      eventReceived(workspaceId, {
        id: `panel-avatar-event-${eventIndex++}`,
        workspaceId,
        timestamp,
        type: 'agent:status-changed',
        actor: { type: 'agent', id: agentId },
        data: {
          agentId,
          status,
          activationState: null,
          isActive: flags.isProcessing === true || flags.isResponding === true,
          isStreaming: false,
          isProcessing: flags.isProcessing ?? false,
          isResponding: flags.isResponding ?? false,
          stopReason: status === AgentStatus.Error ? 'fixture failure' : null,
        },
      }),
    );
  }

  $effect(() => {
    store.dispatch(removePermissionRequest(permissionId));
    dispatchStatus(agentA, AgentStatus.RuntimeIdle);
    dispatchStatus(agentB, AgentStatus.RuntimeIdle);

    if (scenario === 'responding') dispatchStatus(agentA, 'responding', { isResponding: true });
    if (scenario === 'processing') dispatchStatus(agentA, 'processing', { isProcessing: true });
    if (scenario === 'waiting') dispatchStatus(agentA, AgentStatus.Waiting);
    if (scenario === 'failed') dispatchStatus(agentA, AgentStatus.Error);
    if (scenario === 'agent-switch') dispatchStatus(agentB, 'responding', { isResponding: true });
    if (scenario === 'completed') dispatchStatus(agentA, AgentStatus.Completed);
    if (scenario === 'permission') {
      store.dispatch(
        permissionRequestReceived({
          requestId: permissionId,
          sessionId: agentA,
          title: 'Panel avatar permission',
          options: [{ id: 'approve', label: 'Approve' }],
          timestamp: Date.parse(timestamp),
        }),
      );
    }
  });

  const activeTabId = $derived(scenario === 'agent-switch' ? 'tab-b' : 'tab-a');
  const tabs = [
    { id: 'tab-a', type: 'agent' as const, title: 'Agent A', agentId: agentA, closable: true },
    { id: 'tab-b', type: 'agent' as const, title: 'Agent B', agentId: agentB, closable: true },
  ];
</script>

<section
  class:dark={theme === 'dark'}
  class="overflow-hidden bg-background text-foreground"
  style:width={`${width}px`}
  style:zoom
  data-testid="panel-avatar-host"
  data-active-agent={activeTabId === 'tab-b' ? agentB : agentA}
>
  <PanelTabBar {tabs} {activeTabId} panelId="panel-avatar" {workspaceId} isFocused />
</section>
