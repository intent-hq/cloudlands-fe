<script lang="ts">
  import { appClient } from '$lib/client';
  import { Toast } from '$lib/components/ui/toast';
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
    prependHistoryMessages,
    seedHistoryAround,
    setHistoryOldestReached,
    setAgentStreaming,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    chatTranscriptSnapshotApplied,
    scrollbackFetchStarted,
    scrollbackGapPageSettled,
  } from '$store/renderer/slices/chat-state/chat-state-slice';

  const workspaceId = 'message-navigator-integration';
  const agentId = 'message-navigator-agent';
  const timestamp = '2026-08-16T04:00:00.000Z';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  let {
    theme = 'light',
    messages: fixtureMessages,
    historyMessages = [],
    historyGap = false,
    historyStartLoaded = true,
    conversationPages = [],
    deferPages = false,
    retired = false,
  }: {
    theme?: 'light' | 'dark';
    messages?: AgentMessage[];
    historyMessages?: AgentMessage[];
    historyGap?: boolean;
    historyStartLoaded?: boolean;
    conversationPages?: (
      Awaited<ReturnType<typeof appClient.agents.getConversation>> | { error: string }
    )[];
    deferPages?: boolean;
    retired?: boolean;
  } = $props();

  $effect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains('light');
    const hadDark = root.classList.contains('dark');
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    return () => {
      root.classList.toggle('light', hadLight);
      root.classList.toggle('dark', hadDark);
    };
  });

  const waitNote =
    '[SYSTEM NOTE] This message was queued at 2026-08-16T04:00:08.000Z and waited 37s before delivery.';
  const staleNote =
    '[SYSTEM NOTE] This message was queued before you completed; your completion report was already delivered to your parent at 2026-08-16T04:00:09.000Z. Only call reportToParent again if this message materially changes the outcome — do not re-send the same report.';

  function textMessage(
    id: string,
    role: AgentMessage['role'],
    text: string,
    second: number,
    metadata?: AgentMessage['metadata'],
  ) {
    return {
      id,
      role,
      timestamp: `2026-08-16T04:00:${String(second).padStart(2, '0')}.000Z`,
      contentBlocks: [{ type: 'text', text }],
      metadata,
    } as AgentMessage;
  }

  const messages = Array.from({ length: 25 }, (_, index) => {
    const number = index + 1;
    const userText =
      number === 1
        ? 'OK'
        : number === 2
          ? `Duplicate prefix — ${'a deliberately long message preview that must end with an ellipsis instead of clipping '.repeat(6)}`
          : number === 3
            ? 'Authored literal [SYSTEM NOTE] must stay visible'
            : number === 4
              ? 'Duplicate prefix — short sibling'
              : number === 5
                ? 'Multilingual: こんにちは Привет مرحبا café नमस्ते 😀'
                : number === 6
                  ? `Virtualized target six\n\n${staleNote}\n\n${waitNote}`
                  : `User prompt ${number} with enough transcript content to make scrolling measurable.`;
    return [
      textMessage(
        `user-${number}`,
        'user',
        userText,
        index * 2,
        number === 6
          ? { queueInfo: { queuedAt: '2026-08-16T04:00:08.000Z', waitedMs: 37_000 } }
          : undefined,
      ),
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
    retiredAt: retired ? timestamp : undefined,
    isActive: false,
    isStreaming: false,
    isProcessing: false,
    isResponding: false,
    messages: fixtureMessages ?? messages,
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
  if (historyMessages.length > 0) {
    store.dispatch(
      historyGap
        ? seedHistoryAround(agentId, historyMessages, 0)
        : prependHistoryMessages(agentId, historyMessages),
    );
    store.dispatch(setHistoryOldestReached(agentId, historyStartLoaded));
    // Keep the missing page in flight while testing both loaded sides. The
    // real panel otherwise drops a detached segment on return to the live tail.
    if (historyGap) store.dispatch(scrollbackFetchStarted(agentId, 'gap'));
  }
  if (!historyStartLoaded) {
    store.dispatch(
      chatTranscriptSnapshotApplied(agentId, { truncated: true, totalMessages: 1000 }),
    );
  }
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
    store.dispatch(setAgentStreaming(agentId, true));
    store.dispatch(
      addMessage(
        agentId,
        textMessage(
          'assistant-appended',
          'assistant',
          'New streamed tail content. '.repeat(20),
          50,
        ),
      ),
    );
  }

  const navigationState$ = store.createSelector((state) => ({
    historyIds:
      state.agentSessions?.historySegmentsByAgentId?.[agentId]?.messages.map((m) => m.id) ?? [],
    busy: state.chatState?.byAgentId[agentId]?.fetchingHistorySeek ?? false,
  }))();
  let pageResponses = $state(0);
  let panelMounted = $state(true);
  let pageRequests = $state<string[]>([]);
  const pendingPages: (() => void)[] = [];
  const originalGetConversation = appClient.agents.getConversation;
  if (conversationPages.length > 0) {
    appClient.agents.getConversation = async (
      requestedAgentId,
      limit,
      token,
      anchor,
      ordinal,
      requestedWorkspaceId,
    ) => {
      if (
        requestedAgentId !== agentId ||
        requestedWorkspaceId !== workspaceId ||
        limit !== 200 ||
        ordinal !== undefined
      )
        throw new Error('Unexpected conversation request');
      const pageIndex = pageRequests.length;
      pageRequests = [...pageRequests, token ?? anchor ?? 'unanchored'];
      if (deferPages) await new Promise<void>((resolve) => pendingPages.push(resolve));
      pageResponses++;
      const page = conversationPages[pageIndex];
      if (!page) throw new Error('Unexpected extra page');
      if ('error' in page) throw new Error(page.error);
      return structuredClone(page);
    };
  }
  function discardTranscript() {
    store.dispatch(
      chatTranscriptSnapshotApplied(agentId, {
        truncated: true,
        totalMessages: 1000,
        resumed: false,
      }),
    );
  }
  onDestroy(() => {
    appClient.agents.getConversation = originalGetConversation;
    for (const release of pendingPages) release();
    disposeStore();
  });
</script>

<div
  class="relative h-[min(640px,100vh)] w-full max-w-[720px]"
  data-testid="message-navigator-integration-host"
  data-theme={theme}
>
  <Toast />
  <span class="sr-only" data-testid="navigation-state">{JSON.stringify($navigationState$)}</span>
  <span class="sr-only" data-testid="page-responses">{pageResponses}</span>
  <span class="sr-only" data-testid="page-requests">{JSON.stringify(pageRequests)}</span>
  <button class="sr-only" data-testid="release-page" onclick={() => pendingPages.shift()?.()}
    >Release page</button
  >
  <button class="sr-only" data-testid="discard-transcript" onclick={discardTranscript}
    >Discard transcript</button
  >
  <button
    class="sr-only"
    data-testid="settle-gap"
    onclick={() => store.dispatch(scrollbackGapPageSettled(agentId, null))}>Settle gap</button
  >
  <button class="sr-only" data-testid="toggle-panel" onclick={() => (panelMounted = !panelMounted)}
    >Toggle panel</button
  >
  {#if panelMounted}<PanelLayout {workspaceId} layoutId={workspaceId} contained />{/if}
  <button
    type="button"
    class="sr-only"
    data-testid="append-streaming-message"
    onclick={appendStreamingMessage}>Append streaming message</button
  >
</div>
