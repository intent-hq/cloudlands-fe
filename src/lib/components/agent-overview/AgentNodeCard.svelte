<script lang="ts">
  /**
   * AgentNodeCard Component
   *
   * Compact card for displaying an agent in the force-directed graph.
   * Uses similar styling to AgentCard but more compact for visualization.
   */
  import type { AgentNode } from './types';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import {
    getAvatarState,
    getAvatarStateForSession,
  } from '$features/agent/components/agent-avatar/avatar-state';

  import {
    selectSpecialistName,
    selectSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import {
    selectAgentAttentionRequest,
    selectAgentSession,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    node: AgentNode;
    isActive?: boolean;
    onclick?: () => void;
  }

  let { node, isActive = false, onclick }: Props = $props();

  // svelte-ignore state_referenced_locally -- graph cards are mounted per agent; selector subscriptions are initialized once.
  const attentionRequest$ = selectAgentAttentionRequest(node.agentId);
  // svelte-ignore state_referenced_locally -- graph cards are mounted per agent; selector subscriptions are initialized once.
  const agentSession$ = selectAgentSession(node.agentId);

  // Get avatar state from agent status
  const state = $derived.by(() => {
    const options = { attentionKind: $attentionRequest$?.kind ?? null };
    if ($agentSession$) return getAvatarStateForSession($agentSession$, options);
    return getAvatarState(
      {
        isResponding: node.status === 'responding',
        status: node.status,
      },
      { ...options, isCompleted: node.status === 'completed', isFailed: node.status === 'failed' },
    );
  });

  // Get specialist ID (accepts any specialist including team specialists)
  const specialist = $derived.by(() => {
    return node.specialist || null;
  });

  // Reactive store subscription for specialist names
  const specialists$ = selectSpecialists();

  // Get specialist display name using unified lookup
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const specialistName = $derived.by(() => {
    void $specialists$;
    if (!specialist) return null;
    return selectSpecialistName.select(appStore.state, specialist);
  });
</script>

<button
  type="button"
  class="agent-node-card flex flex-col items-center gap-1 p-2 rounded-lg border transition-all duration-200 cursor-pointer
    {node.isCoordinator
    ? 'bg-primary/5 border-primary/30 shadow-sm'
    : 'bg-background/95 border-border hover:border-border'}
    {isActive ? 'ring-2 ring-primary/40' : ''}"
  {onclick}
>
  <!-- Avatar -->
  <div>
    <AgentAvatarWithState
      agentId={node.agentId}
      variant="emphasized"
      size={node.isCoordinator ? 32 : undefined}
      {state}
      specialist={specialist as BuiltinSpecialistId | null}
    />
  </div>

  <!-- Name -->
  <div class="text-center max-w-[80px]">
    <p class="text-ui font-medium text-foreground truncate">{node.name}</p>
    {#if $attentionRequest$?.timestamp}
      <RelativeTime
        date={$attentionRequest$.timestamp}
        compact
        class="text-ui leading-none {$attentionRequest$.kind === 'blocker'
          ? 'text-danger'
          : 'text-warning'}"
      />
    {/if}
    <!-- {#if specialist}
      <div class="flex items-center justify-center gap-0.5 mt-0.5">
        <SpecialistToolIcon {specialist} size={8} muted />
        <span class="text-ui text-subtle capitalize">
          {specialist === 'spec-writer' ? 'Coordinator' : specialist}
        </span>
      </div>
    {/if} -->
  </div>
</button>

<style>
  .agent-node-card {
    backdrop-filter: blur(8px);
    min-width: 64px;
    max-width: 100px;
  }
</style>
