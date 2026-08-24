<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { faComment } from '@fortawesome/free-solid-svg-icons';
  import type { AgentSession } from '$shared/types';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import AgentTabType from '$features/layout/tab-types/AgentTabType.svelte';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';
  import PanelLayout from '$lib/components/layout/panel-system/PanelLayout.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { setChatDraft } from '$store/renderer/slices/transient-ui/transient-ui-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  let {
    theme = 'light',
    zoom = 1,
    width = 720,
    chief = false,
    streaming = false,
    draft = '',
  }: {
    theme?: 'light' | 'dark';
    zoom?: number;
    width?: number;
    chief?: boolean;
    streaming?: boolean;
    draft?: string;
  } = $props();

  const fixture = untrack(() => ({ chief, streaming, draft }));
  const workspaceId = fixture.chief ? CHIEF_WORKSPACE_ID : 'chat-panel-composer-geometry';
  const agentId = fixture.chief ? 'chief-composer-agent' : 'regular-composer-agent';
  const timestamp = '2026-08-23T12:00:00.000Z';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const session = {
    id: agentId,
    workspaceId,
    name: fixture.chief ? 'Chief' : 'Composer geometry agent',
    status: fixture.streaming ? 'active' : 'idle',
    isActive: true,
    isStreaming: fixture.streaming,
    isProcessing: fixture.streaming,
    isResponding: fixture.streaming,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  } as unknown as AgentSession;

  tabTypeRegistry.register({
    type: 'agent',
    component: AgentTabType,
    icon: faComment,
    defaultTitle: 'Agent',
    categoryLabel: 'Agents',
    defaultWidthTier: 'narrow',
    sidebarTabId: 'agents',
    renameable: true,
  });
  store.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      title: fixture.chief ? 'Chief' : 'Composer geometry',
      branch: 'test',
      status: 'active',
      path: '/tmp/chat-panel-composer-geometry',
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never),
  );
  store.dispatch(bulkUpsertSessions([session], { preserveExplicitRuntimeFlags: false }));
  store.dispatch(setAgents(workspaceId, [session]));
  if (fixture.draft) store.dispatch(setChatDraft(workspaceId, agentId, fixture.draft));
  store.dispatch(
    initializeLayout(workspaceId, {
      root: { type: 'panel', panelId: 'chat-panel' },
      panels: {
        'chat-panel': {
          id: 'chat-panel',
          tabs: [
            {
              id: 'agent-tab',
              type: 'agent',
              title: session.name,
              agentId,
              workspaceId,
              closable: true,
            },
          ],
          activeTabId: 'agent-tab',
        },
      },
      focusedPanelId: 'chat-panel',
    }),
  );
  store.dispatch(setRestoreStatus(workspaceId, 'restored'));
  onDestroy(disposeStore);
</script>

<section class:dark={theme === 'dark'} style:zoom data-testid="chat-panel-composer-host">
  <div class="h-160" style:width="{width}px">
    <PanelLayout {workspaceId} layoutId={workspaceId} contained />
  </div>
</section>
