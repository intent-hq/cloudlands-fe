<script lang="ts">
  /**
   * DiscussionRequestNotice Component
   *
   * Displays an inline attention banner when an agent requested a discussion
   * via `ws.agent.requestDiscussion(reason)`. Rendered for system-role
   * messages whose text block carries `meta.kind = "discussion-request"`.
   */
  import { faComments } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** The reason the agent gave for requesting a discussion */
    reason?: string;
    /** Additional CSS classes */
    class?: string;
  }

  let { reason = '', class: className = '' }: Props = $props();
</script>

<div
  class="discussion-request-notice flex items-start gap-2.5 px-3 py-2.5 my-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 {className}"
  transition:slide={{ axis: 'y', duration: 200 }}
  role="alert"
  aria-live="polite"
>
  <Fa icon={faComments} class="w-4 h-4 flex-shrink-0 mt-0.5" />
  <div class="flex flex-col gap-0.5 min-w-0">
    <span class="text-sm font-semibold">{m.chat_discussionRequestNotice_title_label()}</span>
    {#if reason}
      <span class="text-sm whitespace-pre-wrap break-words">{reason}</span>
    {/if}
  </div>
</div>

<style>
  .discussion-request-notice {
    /* Ensure the banner is clearly visible and distinct from chat bubbles */
    width: 100%;
    max-width: 100%;
  }
</style>
