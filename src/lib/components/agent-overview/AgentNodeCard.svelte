<script lang="ts">
  /**
   * AgentNodeCard Component
   *
   * Compact card for displaying an agent in the force-directed graph.
   * Uses similar styling to AgentCard but more compact for visualization.
   */
  import type { AgentNode } from './types';
  import AugieAvatarWithState from '../ui/auggie-avatar/AugieAvatarWithState.svelte';
  import { getAvatarState } from '../ui/auggie-avatar/avatar-state';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import {
  selectSpecialistName,
  selectSpecialists,
} from '$lib/store/slices/specialists/specialists-selectors';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';

  interface Props {
    node: AgentNode;
    isActive?: boolean;
    onclick?: () => void;
  }

  let { node, isActive = false, onclick }: Props = $props();

  // Get avatar state from agent status
  const state = $derived(
    getAvatarState({
      isStreaming: node.status === 'responding',
      status: node.status,
    }),
  );

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
    return selectSpecialistName.select(getReduxStore().getState(), specialist);
  });
</script>

<button
  type="button"
  class="agent-node-card flex flex-col items-center gap-1 p-2 rounded-lg border transition-all duration-200 cursor-pointer
    {node.isCoordinator
    ? 'bg-primary/5 border-primary/30 shadow-sm'
    : 'bg-background/95 border-border/50 hover:border-border'}
    {isActive ? 'ring-2 ring-primary/40' : ''}"
  {onclick}
>
  <!-- Avatar -->
  <div class="relative">
    <AugieAvatarWithState
      agentId={node.agentId}
      size={node.isCoordinator ? 32 : 24}
      {state}
      specialist={specialist as BuiltinSpecialistId | null}
    />
    {#if node.isCoordinator}
      <div
        class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-primary rounded-full flex items-center justify-center"
      >
        <span class="text-xs text-primary-foreground font-bold leading-none">★</span>
      </div>
    {/if}
  </div>

  <!-- Name -->
  <div class="text-center max-w-[80px]">
    <p class="text-ui font-medium text-foreground truncate">{node.name}</p>
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
