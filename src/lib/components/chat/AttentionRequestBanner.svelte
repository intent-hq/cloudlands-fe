<script lang="ts">
  /**
   * AttentionRequestBanner Component
   *
   * Transcript notice shown when the current agent has a pending
   * attention request (requestDiscussion / reportBlocker). Scrolls with the
   * conversation at the shared content width, and
   * retires automatically when the daemon clears the session fields on the
   * user's next response — a user-origin delivery (sendMessage,
   * sendQueuedMessageNow, editAndRegenerate, drained user-origin queue
   * entry) — emitting `agent:updated` with `attentionRequestCleared`;
   * automatic deliveries leave it pending.
   */
  import { writable } from 'svelte/store';
  import { selectAgentAttentionRequest } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import ChatNotice from './ChatNotice.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    agentId: string;
  }

  let { agentId }: Props = $props();

  // svelte-ignore state_referenced_locally -- selector is initialized with the current agent; the effect below mirrors prop changes.
  const agentIdStore = writable(agentId);
  $effect(() => {
    agentIdStore.set(agentId);
  });

  const attentionRequest$ = selectAgentAttentionRequest(agentIdStore);
  const isBlocker = $derived($attentionRequest$?.kind === 'blocker');
</script>

{#if $attentionRequest$}
  <ChatNotice
    title={isBlocker
      ? m.chat_agentCard_attentionBlocker_label()
      : m.chat_agentCard_attentionDiscussion_label()}
    tone={isBlocker ? 'danger' : 'warning'}
    reason={$attentionRequest$.reason}
    timestamp={$attentionRequest$.timestamp}
    announce={false}
    testIdPrefix="attention-request"
  />
{/if}
