<script lang="ts">
  /**
   * TurnFailureNotice Component
   *
   * Displays an inline failure banner when an agent turn ended in a terminal
   * failure. Rendered for system-role messages whose text block carries
   * `meta.kind = "turn-failure"`.
   */
  import { faCircleXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** The failure text carried by the notice message */
    reason?: string;
    /** Additional CSS classes */
    class?: string;
  }

  let { reason = '', class: className = '' }: Props = $props();
</script>

<div
  class="turn-failure-notice flex items-start gap-2.5 px-3 py-2.5 my-2 rounded-md bg-destructive/10 border border-destructive/30 text-destructive-foreground {className}"
  transition:slide={{ axis: 'y', duration: 200 }}
  role="alert"
  aria-live="polite"
>
  <Fa icon={faCircleXmark} class="w-4 h-4 flex-shrink-0 mt-0.5" />
  <div class="flex flex-col gap-0.5 min-w-0">
    <span class="text-sm font-semibold">{m.chat_turnFailureNotice_title_label()}</span>
    {#if reason}
      <span class="text-sm whitespace-pre-wrap break-words">{reason}</span>
    {/if}
  </div>
</div>

<style>
  .turn-failure-notice {
    /* Ensure the banner is clearly visible and distinct from chat bubbles */
    width: 100%;
    max-width: 100%;
  }
</style>
