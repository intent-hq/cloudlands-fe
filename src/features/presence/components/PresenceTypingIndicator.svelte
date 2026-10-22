<script lang="ts">
  /**
   * "{name} is typing…" row above the composer, fed by the presence slice's
   * receiver-local typing state (each `(source, pulse)` pair expires 3 s after
   * it was last seen). Renders nothing while nobody else is typing.
   */
  import { writable } from 'svelte/store';
  import { selectAgentTypingPeople } from '$store/renderer/slices/presence/presence-selectors';
  import {
    OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS,
    OPERATIONAL_ROW_TONE_CLASS,
  } from '$lib/components/chat/operational-disclosure-row';
  import PresenceAvatarStack from './PresenceAvatarStack.svelte';
  import { presenceTypingLabel } from './presence-person';

  interface Props {
    workspaceId: string;
    agentId: string;
    class?: string;
  }

  let { workspaceId, agentId, class: className = '' }: Props = $props();

  const workspaceIdStore = writable('');
  const agentIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });
  $effect(() => {
    agentIdStore.set(agentId);
  });

  const typing$ = selectAgentTypingPeople(workspaceIdStore, agentIdStore);
  const label = $derived(presenceTypingLabel($typing$));
</script>

{#if label}
  <div
    class="{OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} {OPERATIONAL_ROW_TONE_CLASS} flex min-h-7 min-w-0 items-center gap-[var(--operational-leading-gap)] px-[var(--operational-row-inline-padding)] {className}"
    role="status"
    aria-live="polite"
    data-presence-typing-indicator
  >
    <span
      class="inline-flex min-w-[var(--operational-leading-slot-size)] shrink-0 items-center justify-center"
    >
      <PresenceAvatarStack people={$typing$} size={16} decorative />
    </span>
    <span class="min-w-0 truncate">{label}</span>
    <span class="inline-flex shrink-0 items-center gap-0.5" aria-hidden="true">
      <span class="typing-dot size-1 rounded-full bg-current"></span>
      <span class="typing-dot size-1 rounded-full bg-current" style="animation-delay: 0.2s"></span>
      <span class="typing-dot size-1 rounded-full bg-current" style="animation-delay: 0.4s"></span>
    </span>
  </div>
{/if}

<style>
  @keyframes typing-dot {
    0%,
    80%,
    100% {
      opacity: 0.3;
    }
    40% {
      opacity: 1;
    }
  }

  .typing-dot {
    animation: typing-dot 1.4s ease-in-out infinite;
  }

  @container style(--motion-reduced: 1) {
    .typing-dot {
      animation: none;
      opacity: 0.6;
    }
  }
</style>
