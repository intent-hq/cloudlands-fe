<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
  import { EmptyState, ErrorState, LoadingState } from '$lib/components/patterns/screen';
  import { store } from '$store/renderer/store';
  import {
    selectActiveAgentId,
    selectAllWorkspaceAgents,
    selectAgentsLoaded,
    resolveCanonicalInitialAgent,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import {
    hydrateAgentsRequested,
    setActiveAgentId,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import type { ChatAttentionFocusRequest } from '$lib/components/chat/chat-attention-focus';
  import { m } from '$shared/paraglide/messages.js';
  import type { Workspace } from '$shared/types';

  let { workspace, preview = false }: { workspace: Workspace; preview?: boolean } = $props();
  // The parent keys this component by workspace ID, keeping subscriptions and drafts scoped.
  const workspaceId = untrack(() => workspace.id);
  const agents$ = selectAllWorkspaceAgents(workspaceId);
  const activeId$ = selectActiveAgentId(workspaceId);
  const loaded$ = selectAgentsLoaded(workspaceId);
  const eligibleAgents = $derived(
    $agents$.filter(
      (agent) => !agent.retiredAt && !agent.pendingDeleteAt && agent.status !== 'deleted',
    ),
  );
  const agent = $derived(
    eligibleAgents.find((candidate) => candidate.id === $activeId$) ??
      resolveCanonicalInitialAgent(eligibleAgents),
  );
  let attentionFocus = $state<ChatAttentionFocusRequest & { agentId: string }>();
  let nextFocusRequest = 0;
  export function focusAttention(agentId: string, questionMessageId?: string) {
    if (preview || !eligibleAgents.some((candidate) => candidate.id === agentId)) return;
    attentionFocus = { agentId, questionMessageId, requestId: ++nextFocusRequest };
    store.dispatch(setActiveAgentId(workspaceId, agentId));
  }
  let timedOut = $state(false);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  function hydrate() {
    if (preview) return;
    timedOut = false;
    clearTimeout(timeout);
    // Reuse the production read lifecycle without mounting/restoring the workspace layout.
    store.dispatch(hydrateAgentsRequested(workspaceId));
    // Agent hydration currently logs failures without exposing an error selector.
    // Keep a failed read recoverable instead of leaving a permanent loading skeleton.
    timeout = setTimeout(() => {
      timedOut = true;
    }, 15_000);
  }
  onMount(() => {
    if (!preview) hydrate();
    return () => clearTimeout(timeout);
  });
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col" data-home-workspace-chat>
  {#if preview}
    <EmptyState density="compact">
      {#snippet title()}{m.agentOverview_hierarchyGraph_noAgents_title()}{/snippet}
    </EmptyState>
  {:else if agent}
    {#key agent.id}
      <ChatPanel
        {workspace}
        agentId={agent.id}
        agentName={agent.name}
        autoFocus={false}
        attentionFocusRequest={attentionFocus?.agentId === agent.id ? attentionFocus : undefined}
        isInitialWorkspaceAgent={false}
      />
    {/key}
  {:else if !$loaded$ && !timedOut}
    <LoadingState label={m.ui_spinner_loading_ariaLabel()} density="compact" />
  {:else if !$loaded$}
    <ErrorState density="compact" retryLabel={m.home_retry()} onRetry={hydrate}>
      {#snippet message()}{m.home_detail_unavailable()}{/snippet}
    </ErrorState>
  {:else}
    <EmptyState density="compact" actionLabel={m.home_retry()} onAction={hydrate}>
      {#snippet title()}{m.agentOverview_hierarchyGraph_noAgents_title()}{/snippet}
    </EmptyState>
  {/if}
</div>
