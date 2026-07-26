<script lang="ts" module>
  // Re-export AvatarState type from the centralized module
  // This maintains backward compatibility for existing imports
  export type { AvatarState } from './avatar-state';
</script>

<script lang="ts">
  import AuggieAvatar from './AuggieAvatar.svelte';
  import { cn } from '$lib/utils.js';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faX,
    faHourglass,
    faExclamationTriangle,
  } from '@fortawesome/free-solid-svg-icons';
  import { selectAgentProvider } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import type { AvatarState } from './avatar-state';
  import { isKnownNonAuggieProvider } from './non-auggie-agents';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import { writable } from 'svelte/store';

  interface Props {
    agentId: string;
    size?: number;
    state?: AvatarState;
    class?: string;
    /** Specialist type to show a glowing tool icon overlay */
    specialist?: BuiltinSpecialistId | null;
  }

  let {
    agentId,
    size = 20,
    state = 'idle',
    class: className = '',
    specialist = null,
  }: Props = $props();

  // Indicator size scales with avatar size
  let indicatorSize = $derived(Math.max(6, Math.round(size * 0.3)));

  // Whether to show as dimmed monochrome (completed agents)
  let isDimmed = $derived(state === 'completed');

  // svelte-ignore state_referenced_locally -- selector args are mirrored into a readable for mounted avatar reuse.
  const agentIdStore = writable(agentId);
  $effect(() => {
    agentIdStore.set(agentId);
  });
  const agentProvider$ = selectAgentProvider(agentIdStore);
  let hasProviderIcon = $derived(isKnownNonAuggieProvider($agentProvider$));

</script>

<div class={cn('relative inline-flex', className)}>
  <!-- Grayscale/dim only the avatar so the completed check indicator stays colored -->
  <span class={cn('inline-flex', isDimmed ? 'grayscale opacity-60' : '')}>
    <AuggieAvatar {agentId} {size} {specialist} />
  </span>

  {#if state === 'running' || state === 'responding'}
    <!-- Running indicator - green pulsing dot -->
    <div
      class="absolute -top-0.5 -right-0.75 rounded-full bg-green-500 border border-background"
      style="width: {indicatorSize}px; height: {indicatorSize}px;"
    ></div>
  {:else if state === 'unread'}
    <!-- Unread indicator - blue dot -->
    <div
      class="absolute -top-0.5 -right-0.75 rounded-full bg-blue-500 border border-background"
      style="width: {indicatorSize}px; height: {indicatorSize}px;"
    ></div>
  {:else if state === 'completed' && !hasProviderIcon}
    <!-- Completed indicator - green checkmark -->
    <span
      class="absolute -top-0.5 -right-0.75 p-0.5 bg-sidebar rounded-full flex items-center justify-center text-emerald-500"
      style="font-size: {Math.max(8, size * 0.35)}px; line-height: 1;"
    >
      <Fa icon={faCheck} />
    </span>
  {:else if state === 'failed'}
    <!-- Failed indicator - red X -->
    <span
      class="absolute -top-0.5 -right-0.75 p-0.5 bg-sidebar rounded-full flex items-center justify-center text-red-500"
      style="font-size: {Math.max(8, size * 0.35)}px; line-height: 1;"
    >
      <Fa icon={faX} />
    </span>
  {:else if state === 'needs-permission'}
    <!-- Needs permission indicator - amber warning triangle -->
    <span
      class="absolute -top-1 -right-0.75 p-0.5 flex items-center justify-center text-amber-500"
      style="font-size: {Math.max(8, size * 0.35)}px; line-height: 1;"
    >
      <Fa icon={faExclamationTriangle} class="relative z-10" />
      <Fa icon={faExclamationTriangle} size={21} class="text-background origin-center absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-0" />
    </span>
  {:else if state === 'waiting'}
    <!-- Waiting indicator - hourglass -->
    <span
      class="absolute -top-0.5 -right-0.75 p-0.5 bg-sidebar rounded-full flex items-center justify-center text-subtle"
      style="font-size: {Math.max(8, size * 0.35)}px; line-height: 1;"
    >
      <Fa icon={faHourglass} />
    </span>
  {/if}
</div>
