<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import HomeLoading from './HomeLoading.svelte';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
  import { EmptyState, ErrorState } from '$lib/components/patterns/screen';
  import { store } from '$store/renderer/store';
  import {
    selectAllWorkspaceAgents,
    selectAgentsLoaded,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { homePreviewEligibleAgents } from './home-preview-agent';
  import { hydrateAgentsRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { chatViewEnded } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
  import { MARK_AGENT_SEEN_DEBOUNCE_MS } from '$features/agent/mark-agent-seen';
  import type { ChatAttentionFocusRequest } from '$lib/components/chat/chat-attention-focus';
  import { m } from '$shared/paraglide/messages.js';
  import type { AgentSession, Workspace } from '$shared/types';

  let {
    workspace,
    preview = false,
    agent,
    onpick,
  }: {
    workspace: Workspace;
    preview?: boolean;
    /** The agent the preview shows; the parent decides which one. */
    agent: AgentSession | null;
    /** Records an explicit choice of agent, e.g. from an attention item. */
    onpick: (agentId: string) => void;
  } = $props();
  // The parent keys this component by workspace ID, keeping subscriptions and drafts scoped.
  const workspaceId = untrack(() => workspace.id);
  const agents$ = selectAllWorkspaceAgents(workspaceId);
  const loaded$ = selectAgentsLoaded(workspaceId);
  const eligibleAgents = $derived(homePreviewEligibleAgents($agents$));
  // A primitive so agent-list refreshes that keep the same agent on screen do
  // not end its viewing session.
  const shownAgentId = $derived(preview ? undefined : agent?.id);
  // This surface never closes an agent tab or switches the active workspace
  // tab, so report when it stops showing a conversation (agent/workspace
  // switch, preview close, leaving Home): the unread-tracking saga treats it
  // as a stop-looking boundary that advances the seen marker and ends the
  // "New messages" divider session. A view shorter than the view trigger's
  // debounce (a fallback agent flashed while the active agent resolves, or a
  // quick skim) was never reading, so it is not reported. The dispatch waits
  // for the teardown flush so the departing ChatPanel has released its chat
  // interest lease and written its scroll cache first.
  $effect(() => {
    const agentId = shownAgentId;
    if (!agentId) return;
    const shownAt = Date.now();
    return () => {
      if (Date.now() - shownAt < MARK_AGENT_SEEN_DEBOUNCE_MS) return;
      setTimeout(() => store.dispatch(chatViewEnded(agentId)), 0);
    };
  });
  let attentionFocus = $state<ChatAttentionFocusRequest & { agentId: string }>();
  let nextFocusRequest = 0;
  export function focusAttention(agentId: string, questionMessageId?: string) {
    if (preview || !eligibleAgents.some((candidate) => candidate.id === agentId)) return;
    attentionFocus = { agentId, questionMessageId, requestId: ++nextFocusRequest };
    onpick(agentId);
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

<div
  class="flex h-full min-h-0 min-w-0 flex-col"
  data-home-workspace-chat
  data-workspace-link-target={workspace.id}
>
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
    <div class="p-4"><HomeLoading detail /></div>
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
