<script lang="ts">
  /**
   * AttentionRequestBanner Component
   *
   * Fallback notice shown when a pending attention request has no matching
   * saved notice in the loaded conversation. Scrolls with the
   * conversation at the shared content width, and
   * retires automatically when the daemon clears the session fields on the
   * user's next response — a user-origin delivery (sendMessage,
   * sendQueuedMessageNow, editAndRegenerate, drained user-origin queue
   * entry) — emitting `agent:updated` with `attentionRequestCleared`;
   * automatic deliveries leave it pending.
   */
  import { writable } from 'svelte/store';
  import {
    selectAgentAttentionRequest,
    selectAgentMessages,
    selectAgentHistoryMessages,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { hasMatchingAttentionNotice } from './attention-notice';
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
  const messages$ = selectAgentMessages(agentIdStore);
  const historyMessages$ = selectAgentHistoryMessages(agentIdStore);
  const hasSavedNotice = $derived(
    hasMatchingAttentionNotice($messages$, $attentionRequest$) ||
      hasMatchingAttentionNotice($historyMessages$, $attentionRequest$),
  );
  const isBlocker = $derived($attentionRequest$?.kind === 'blocker');
</script>

{#if $attentionRequest$ && !hasSavedNotice}
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
