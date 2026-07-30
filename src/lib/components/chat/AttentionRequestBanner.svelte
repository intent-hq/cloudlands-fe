<script lang="ts">
  /**
   * AttentionRequestBanner Component
   *
   * Conversation-footer row shown when the current agent has a pending
   * attention request (requestDiscussion / reportBlocker). Renders alongside
   * the existing waiting/completed treatments (AgentSubscriptions) and
   * retires automatically when the daemon clears the session fields on the
   * agent's next message (`agent:updated` with `attentionRequestCleared`).
   */
  import { writable } from 'svelte/store';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import { faCommentDots, faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { selectAgentAttentionRequest } from '$store/renderer/slices/agent-session/agent-session-selectors';
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
</script>

{#if $attentionRequest$}
  <div
    class="w-full font-family-child"
    data-testid="attention-request-banner"
    transition:slide={{ axis: 'y', duration: 200 }}
  >
    <div class="flex items-center gap-2 px-3 py-1.5 text-sm">
      <span
        class="shrink-0 flex items-center gap-2 whitespace-nowrap {$attentionRequest$.kind ===
        'blocker'
          ? 'text-red-500'
          : 'text-amber-500'}"
      >
        <Fa
          icon={$attentionRequest$.kind === 'blocker' ? faCircleExclamation : faCommentDots}
          size="13"
        />
        {$attentionRequest$.kind === 'blocker'
          ? m.chat_agentCard_attentionBlocker_label()
          : m.chat_agentCard_attentionDiscussion_label()}
      </span>
      {#if $attentionRequest$.reason}
        <span class="min-w-0 flex-1 truncate text-subtle">
          {$attentionRequest$.reason}
        </span>
      {/if}
    </div>
  </div>
{/if}
