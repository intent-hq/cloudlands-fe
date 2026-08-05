<script lang="ts">
  /**
   * BlockerReportNotice Component
   *
   * Displays an inline attention banner when an agent reported a blocker via
   * `ws.agent.reportBlocker(reason)`. Rendered for system-role messages whose
   * text block carries `meta.kind = "blocker-report"`.
   */
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** The reason the agent gave for reporting a blocker */
    reason?: string;
    /** Additional CSS classes */
    class?: string;
  }

  let { reason = '', class: className = '' }: Props = $props();
</script>

<div
  class="blocker-report-notice flex items-start gap-2.5 px-3 py-2.5 my-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 {className}"
  transition:slide={{ axis: 'y', duration: 200 }}
  role="alert"
  aria-live="polite"
>
  <Fa icon={faTriangleExclamation} class="w-4 h-4 flex-shrink-0 mt-0.5" />
  <div class="flex flex-col gap-0.5 min-w-0">
    <span class="text-sm font-semibold">{m.chat_blockerReportNotice_title_label()}</span>
    {#if reason}
      <span class="text-sm whitespace-pre-wrap break-words">{reason}</span>
    {/if}
  </div>
</div>

<style>
  .blocker-report-notice {
    /* Ensure the banner is clearly visible and distinct from chat bubbles */
    width: 100%;
    max-width: 100%;
  }
</style>
