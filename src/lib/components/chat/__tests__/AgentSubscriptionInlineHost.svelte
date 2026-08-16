<script lang="ts">
  import { onDestroy } from 'svelte';
  import EventSubscriptionsCard from '$lib/components/chat/EventSubscriptionsCard.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    bulkUpsertSessions,
    removeSession,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import type { AgentSession, ToolUseBlock } from '$shared/types';
  import { AgentStatus } from '$shared/types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

  type PreviewKind = 'file' | 'terminal' | 'tool' | 'text';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    previewKind?: PreviewKind;
    mode?: 'agents' | 'mixed';
    agentCount?: number;
    longLabels?: boolean;
  }

  let {
    theme = 'light',
    width = 340,
    zoom = 1,
    previewKind = 'file',
    mode = 'agents',
    agentCount = 7,
    longLabels = false,
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

  $effect(() => {
    const currentKind = previewKind;
    const session: AgentSession = {
      id: AgentId(agentId),
      backendSessionId: AgentId('backend-subscription-inline-geometry'),
      workspaceId: WorkspaceId(workspaceId),
      name: 'Primary Agent',
      status: AgentStatus.Active,
      isStreaming: true,
      lastAgentResponse:
        currentKind === 'text'
          ? 'Review `src/agent.ts` with **strong markers**, [safe label](https://example.com), and 超長い-unbroken-token-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 <button>unsafe</button>'
          : '',
      lastToolUse: currentKind === 'text' ? undefined : toolUse(currentKind),
      messages: [],
      createdAt: '2026-08-15T12:00:00.000Z',
      updatedAt: '2026-08-15T12:05:00.000Z',
    };
    store.dispatch(bulkUpsertSessions([session]));
  });

  onDestroy(() => {
    store.dispatch(removeSession(agentId));
    disposeStore();
  });

  const agents = $derived(
    Array.from({ length: agentCount }, (_, index) => ({
      id: index === 0 ? agentId : `agent-subscription-filler-${index}`,
      name:
        index === 0
          ? longLabels
            ? 'Primary Agent With An Extremely Long Unicode Name 超長い名前 ABCDEFGHIJKLMNOPQRSTUVWXYZ'
            : 'Primary Agent'
          : `Filler ${index}`,
    })),
  );
</script>

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
  <div class="bg-background p-2 text-foreground">
    <EventSubscriptionsCard
      {workspaceId}
      agentId="parent-subscription-inline-geometry"
      isolatedPreview={{
        count: mode === 'mixed' ? agents.length + 1 : agents.length,
        agents,
        mode,
        initiallyExpanded: true,
      }}
      previewContent={mixedPreview}
    />
  </div>
</section>
