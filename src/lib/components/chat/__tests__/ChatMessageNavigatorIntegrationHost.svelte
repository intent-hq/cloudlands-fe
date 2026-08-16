<script lang="ts">
  import { onDestroy } from 'svelte';
  import { faComment } from '@fortawesome/free-solid-svg-icons';
  import type { AgentMessage, AgentSession } from '$shared/types';
  import AgentTabType from '$features/layout/tab-types/AgentTabType.svelte';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';
  import PanelLayout from '$lib/components/layout/panel-system/PanelLayout.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    addMessage,
    bulkUpsertSessions,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  const workspaceId = 'message-navigator-integration';
  const agentId = 'message-navigator-agent';
  const timestamp = '2026-08-16T04:00:00.000Z';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });

  function textMessage(id: string, role: AgentMessage['role'], text: string, second: number) {
    return {
      id,
      role,
      timestamp: `2026-08-16T04:00:${String(second).padStart(2, '0')}.000Z`,
      contentBlocks: [{ type: 'text', text }],
    } as AgentMessage;
  }

  const messages = Array.from({ length: 15 }, (_, index) => {
    const number = index + 1;
    const userText =
      number === 3
        ? '[SYSTEM NOTE] Internal-only picker row'
        : number === 6
          ? 'Virtualized target six [SYSTEM NOTE] hidden picker suffix'
          : `User prompt ${number} with enough transcript content to make scrolling measurable.`;
    return [
      textMessage(`user-${number}`, 'user', userText, index * 2),
      textMessage(
        `assistant-${number}`,
        'assistant',
        `Assistant response ${number}. `.repeat(14),
        index * 2 + 1,
      ),
    ];
  }).flat();
  const session = {
    id: agentId,
    workspaceId,
    name: 'Navigation agent',
    status: 'idle',
    isActive: false,
    isStreaming: false,
    isProcessing: false,
    isResponding: false,
    messages,
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
      title: 'Message navigator integration',
      branch: 'test',
      status: 'active',
      path: '/tmp/message-navigator-integration',
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never),
  );
  store.dispatch(bulkUpsertSessions([session], { preserveExplicitRuntimeFlags: false }));
  store.dispatch(setAgents(workspaceId, [session]));
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
              title: 'Navigation agent',
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

  function appendStreamingMessage() {
    store.dispatch(
      addMessage(
        agentId,
        textMessage(
          'assistant-appended',
          'assistant',
          'New streamed tail content. '.repeat(20),
          40,
        ),
      ),
    );
  }

  onDestroy(disposeStore);
</script>

<div class="relative h-[640px] w-[720px]" data-testid="message-navigator-integration-host">
  <PanelLayout {workspaceId} layoutId={workspaceId} contained />
  <button
    type="button"
    class="sr-only"
    data-testid="append-streaming-message"
    onclick={appendStreamingMessage}>Append streaming message</button
  >
</div>
