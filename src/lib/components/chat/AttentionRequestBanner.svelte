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
   *
   * A reason the daemon's agent.list cap shortened (`reasonTruncated`) is
   * shown with a trailing ellipsis, then replaced by the full text from
   * agent.get when that read succeeds.
   */
  import { writable } from 'svelte/store';
  import {
    selectAgentAttentionRequest,
    selectAgentMessages,
    selectAgentHistoryMessages,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { hasMatchingAttentionNotice } from './attention-notice';
  import { loadFullAttentionReason } from './attention-reason';
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

  const requestKey = $derived(
    $attentionRequest$
      ? `${agentId}|${$attentionRequest$.kind}|${$attentionRequest$.timestamp ?? ''}`
      : null,
  );
  let fullReason = $state<{ key: string; reason: string } | null>(null);
  const needsFullReason = $derived(
    !hasSavedNotice && $attentionRequest$?.reasonTruncated === true && requestKey !== null,
  );

  $effect(() => {
    const request = $attentionRequest$;
    const key = requestKey;
    if (!needsFullReason || !request || !key || fullReason?.key === key) return;
    let cancelled = false;
    void loadFullAttentionReason(agentId, request).then((reason) => {
      if (!cancelled && reason) fullReason = { key, reason };
    });
    return () => {
      cancelled = true;
    };
  });

  const displayReason = $derived.by(() => {
    const request = $attentionRequest$;
    if (!request?.reason) return request?.reason;
    if (fullReason && fullReason.key === requestKey) return fullReason.reason;
    return request.reasonTruncated ? `${request.reason.trimEnd()}…` : request.reason;
  });
</script>

{#if $attentionRequest$ && !hasSavedNotice}
  <ChatNotice
    title={isBlocker
      ? m.chat_agentCard_attentionBlocker_label()
      : m.chat_agentCard_attentionDiscussion_label()}
    tone={isBlocker ? 'danger' : 'warning'}
    reason={displayReason}
    timestamp={$attentionRequest$.timestamp}
    announce={false}
    testIdPrefix="attention-request"
  />
{/if}
