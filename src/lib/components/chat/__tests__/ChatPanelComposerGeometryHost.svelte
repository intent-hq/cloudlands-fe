<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { faComment } from '@fortawesome/free-solid-svg-icons';
  import { AgentStatus, type AgentSession } from '$shared/types';
  import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import AgentTabType from '$features/layout/tab-types/AgentTabType.svelte';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';
  import PanelLayout from '$lib/components/layout/panel-system/PanelLayout.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    bulkUpsertSessions,
    updateSession,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { setChatDraft } from '$store/renderer/slices/transient-ui/transient-ui-slice';
  import { replaceAgentQueue } from '$store/renderer/slices/agent-queue/agent-queue-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  let {
    theme = 'light',
    zoom = 1,
    width = 720,
    height = 640,
    chief = false,
    streaming = false,
    draft = '',
    attention = null,
    queued = false,
    suggestions = false,
    questions = false,
    initializeStore = true,
  }: {
    theme?: 'light' | 'dark';
    zoom?: number;
    width?: number;
    height?: number;
    chief?: boolean;
    streaming?: boolean;
    draft?: string;
    attention?: 'blocker' | 'discussion' | null;
    queued?: boolean;
    suggestions?: boolean;
    questions?: boolean;
    initializeStore?: boolean;
  } = $props();

  const fixture = untrack(() => ({ chief, streaming, draft, suggestions, questions }));
  let appliedStreaming = fixture.streaming;
  const workspaceId = fixture.chief ? CHIEF_WORKSPACE_ID : 'chat-panel-composer-geometry';
  const agentId = fixture.chief ? 'chief-composer-agent' : 'regular-composer-agent';
  const timestamp = '2026-08-23T12:00:00.000Z';
  const disposeStore = untrack(() => initializeStore)
    ? startRootStoreLifecycle(store, { startSagas: () => [] })
    : () => {};
  const session = {
    id: agentId,
    workspaceId,
    name: fixture.chief ? 'Chief' : 'Composer geometry agent',
    status: fixture.streaming ? AgentStatus.Active : AgentStatus.RuntimeIdle,
    isActive: true,
    isStreaming: fixture.streaming,
    isProcessing: fixture.streaming,
    isResponding: fixture.streaming,
    metadata: fixture.questions ? { pendingQuestionsMessageId: 'composer-question' } : undefined,
    messages: fixture.questions
      ? [
          {
            id: 'composer-question',
            role: 'assistant',
            timestamp,
            contentBlocks: [
              {
                type: 'resource',
                resource: {
                  uri: 'intent-question://composer-review',
                  name: 'Review plan',
                  mimeType: QUESTION_RESOURCE_MIME_TYPE,
                  text: JSON.stringify({
                    attachmentId: 'composer-review',
                    header: 'Review plan',
                    question: 'How should we approach the next improvement?',
                    explanation: 'Choose an approach, or write a different answer below.',
                    multiSelect: true,
                    options: [
                      {
                        label: 'Start with the smallest change',
                        description: 'Preserve the current behavior and verify the result.',
                      },
                      {
                        label: 'Compare two approaches',
                        description: 'Review safe fixture examples before choosing.',
                      },
                      {
                        label: 'Discuss the tradeoffs',
                        description: 'Agree on the scope before making changes.',
                      },
                    ],
                  }),
                },
              },
            ],
          },
        ]
      : fixture.suggestions
        ? [
            {
              id: 'suggestion-response',
              role: 'assistant',
              timestamp,
              contentBlocks: [
                {
                  type: 'text',
                  text: 'The layout is ready to review.\n\n<!-- suggested-prompts\nReview the layout.\nCheck the narrow panel too.\n-->',
                },
              ],
            },
          ]
        : [],
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
  $effect(() => {
    if (!fixture.questions) return;
    store.dispatch(
      updateSession(agentId, {
        metadata: { pendingQuestionsMessageId: questions ? 'composer-question' : '' },
      }),
    );
  });
  $effect(() => {
    const nextStreaming = streaming;
    if (nextStreaming === appliedStreaming) return;
    appliedStreaming = nextStreaming;
    store.dispatch(
      updateSession(agentId, {
        status: nextStreaming ? AgentStatus.Active : AgentStatus.RuntimeIdle,
        isStreaming: nextStreaming,
        isProcessing: nextStreaming,
        isResponding: nextStreaming,
      }),
    );
  });
  if (fixture.draft) store.dispatch(setChatDraft(workspaceId, agentId, fixture.draft));
  $effect(() => {
    store.dispatch(
      updateSession(agentId, {
        attentionRequestKind: attention ?? undefined,
        attentionRequestReason: attention
          ? 'Please review the fixture plan before continuing. This longer explanation must stay readable without covering the prompt or queued messages.'
          : undefined,
        attentionRequestTimestamp: attention ? timestamp : undefined,
      }),
    );
  });
  $effect(() => {
    store.dispatch(
      replaceAgentQueue(
        agentId,
        queued
          ? [
              {
                id: 'attention-queue-fixture',
                content: 'Check the narrow layout too.',
                queuedAt: timestamp,
                position: 0,
              },
            ]
          : [],
      ),
    );
  });
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
  <div class="relative" style:width="{width}px" style:height="{height}px">
    <div class="absolute inset-0 h-full w-full">
      <PanelLayout {workspaceId} layoutId={workspaceId} />
    </div>
  </div>
</section>
