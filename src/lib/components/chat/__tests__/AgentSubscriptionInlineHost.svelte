<script lang="ts">
  import { onDestroy } from 'svelte';
  import EventSubscriptionsCard from '$lib/components/chat/EventSubscriptionsCard.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    bulkUpsertSessions,
    removeSession,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import type { AgentMessage, AgentSession, ToolUseBlock } from '$shared/types';
  import { AgentStatus } from '$shared/types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import type { TaskProgressItem } from '$lib/components/chat/workspace-task-fallback';

  type PreviewKind = 'file' | 'terminal' | 'tool' | 'text';
  type ParentBackground = 'background' | 'muted' | 'accent';
  type AgentStateScenario =
    | 'responding'
    | 'live-payload-tool'
    | 'in-flight-tool'
    | 'blocked-tool'
    | 'active-peer-turn'
    | 'peer-wait'
    | 'stale-waiting';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    previewKind?: PreviewKind;
    mode?: 'agents' | 'mixed';
    agentCount?: number;
    longLabels?: boolean;
    reverseAgents?: boolean;
    finishedCount?: number;
    initiallyExpanded?: boolean;
    parentBackground?: ParentBackground;
    agentStateScenario?: AgentStateScenario;
    taskSets?: TaskProgressItem[][];
    showOutsideTarget?: boolean;
  }

  let {
    theme = 'light',
    width = 340,
    zoom = 1,
    previewKind = 'file',
    mode = 'agents',
    agentCount = 7,
    longLabels = false,
    reverseAgents = false,
    finishedCount = 0,
    initiallyExpanded = true,
    parentBackground = 'background',
    agentStateScenario = 'responding',
    taskSets = [],
    showOutsideTarget = false,
  }: Props = $props();
  const agentId = 'agent-subscription-inline-geometry';
  const workspaceId = 'workspace-subscription-inline-geometry';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });

  function makeToolUseBlock(
    id: string,
    name: string,
    input: Record<string, unknown>,
  ): ToolUseBlock {
    return { type: 'tool_use', id, name, input };
  }

  function toolUse(kind: Exclude<PreviewKind, 'text'>): ToolUseBlock {
    if (kind === 'terminal') {
      return makeToolUseBlock('subscription-inline:terminal', 'launch-process', {
        command:
          'pnpm test --filter `subscription-超長い-unbroken-token-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`',
      });
    }
    if (kind === 'tool') {
      return makeToolUseBlock('subscription-inline:tool', 'web-search', {
        query:
          '**semantic tokens** [documentation](https://example.com) 超長い-unbroken-token-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      });
    }
    return makeToolUseBlock('subscription-inline:file', 'view', {
      path: 'src/components/`SubscriptionAgentRowWithAnExtremelyLongUnicodeName超長い`.svelte',
      type: 'file',
    });
  }

  function previewMessage(kind: PreviewKind): AgentMessage {
    const contentBlocks =
      kind === 'text'
        ? [
            {
              type: 'text' as const,
              text: 'Review `src/agent.ts` with **strong markers**, [safe label](https://example.com), and 超長い-unbroken-token-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 <button>unsafe</button>',
            },
          ]
        : [toolUse(kind)];
    return {
      id: 'message-subscription-inline-preview',
      role: 'assistant',
      contentBlocks,
      timestamp: '2026-08-15T12:04:00.000Z',
    };
  }

  $effect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains('light');
    const hadDark = root.classList.contains('dark');
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    return () => {
      root.classList.toggle('light', hadLight);
      root.classList.toggle('dark', hadDark);
    };
  });

  $effect(() => {
    const currentKind = previewKind;
    const activity: Record<AgentStateScenario, Partial<AgentSession>> = {
      responding: { status: AgentStatus.Active, isResponding: true },
      'live-payload-tool': {
        status: AgentStatus.Active,
        isActive: true,
        isStreaming: false,
        isProcessing: false,
        isResponding: true,
        isWaitingOnTool: true,
        isWaitingForOtherAgents: false,
        turnInFlight: true,
        lastStreamActivityAt: '2026-08-17T12:04:59.000Z',
        lastToolUse: { name: 'view', status: 'running' },
      },
      'in-flight-tool': {
        status: AgentStatus.Waiting,
        isResponding: false,
        isWaitingOnTool: true,
      },
      'blocked-tool': { status: AgentStatus.Waiting },
      'active-peer-turn': {
        status: AgentStatus.Active,
        isResponding: true,
        isWaitingForOtherAgents: true,
        turnInFlight: true,
      },
      'peer-wait': {
        status: AgentStatus.Idle,
        isWaitingForOtherAgents: true,
      },
      'stale-waiting': { status: AgentStatus.Waiting, isResponding: true },
    };
    const currentActivity = activity[agentStateScenario];
    const session: AgentSession = {
      id: AgentId(agentId),
      backendSessionId: AgentId('backend-subscription-inline-geometry'),
      workspaceId: WorkspaceId(workspaceId),
      name: 'Primary Agent',
      status: currentActivity.status ?? AgentStatus.Active,
      isStreaming: currentActivity.isStreaming ?? false,
      isProcessing: currentActivity.isProcessing ?? false,
      isResponding: currentActivity.isResponding ?? false,
      isWaitingOnTool: currentActivity.isWaitingOnTool ?? false,
      isWaitingForOtherAgents: currentActivity.isWaitingForOtherAgents ?? false,
      turnInFlight: currentActivity.turnInFlight ?? false,
      lastStreamActivityAt: currentActivity.lastStreamActivityAt,
      lastAgentResponse:
        currentKind === 'text'
          ? 'Review `src/agent.ts` with **strong markers**, [safe label](https://example.com), and 超長い-unbroken-token-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 <button>unsafe</button>'
          : '',
      lastToolUse:
        currentActivity.lastToolUse ?? (currentKind === 'text' ? undefined : toolUse(currentKind)),
      messages: [previewMessage(currentKind)],
      createdAt: '2026-08-15T12:00:00.000Z',
      updatedAt: '2026-08-15T12:05:00.000Z',
    };
    store.dispatch(bulkUpsertSessions([session]));
  });

  onDestroy(() => {
    store.dispatch(removeSession(agentId));
    disposeStore();
  });

  const agents = $derived.by(() => {
    const rows = Array.from({ length: agentCount }, (_, index) => ({
      id: index === 0 ? agentId : `agent-subscription-filler-${index}`,
      name:
        index === 0
          ? longLabels
            ? 'Primary Agent With An Extremely Long Unicode Name 超長い名前 ABCDEFGHIJKLMNOPQRSTUVWXYZ'
            : 'Primary Agent'
          : `Filler ${index}`,
      finished: index >= agentCount - finishedCount,
      taskProgress: taskSets[index] ?? [],
    }));
    return reverseAgents ? rows.reverse() : rows;
  });
</script>

{#if showOutsideTarget}
  <button type="button" class="fixed top-1 right-1" data-testid="outside-target">Outside</button>
{/if}

{#snippet mixedPreview()}
  <div class="px-3 py-2 text-muted-foreground" data-testid="mixed-subscription-preview">
    Hook subscription
  </div>
{/snippet}

<section
  class:dark={theme === 'dark'}
  style:width="{width}px"
  style:zoom
  data-testid="subscription-inline-host"
>
  <div
    class="p-2 text-foreground {parentBackground === 'accent'
      ? 'bg-accent'
      : parentBackground === 'muted'
        ? 'bg-muted'
        : 'bg-background'}"
    data-parent-background={parentBackground}
  >
    <EventSubscriptionsCard
      {workspaceId}
      agentId="parent-subscription-inline-geometry"
      isolatedPreview={{
        count: mode === 'mixed' ? agents.length + 1 : agents.length,
        agents,
        mode,
        initiallyExpanded,
      }}
      previewContent={mixedPreview}
    />
  </div>
</section>
