<script lang="ts">
  /**
   * InterruptionNotice Component
   *
   * Displays an inline notice banner when an agent conversation was interrupted.
   * Used for system-role messages that indicate the agent was terminated due to
   * an intentd restart or crash.
   */
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** The system message content (text from the message) */
    message?: string;
    /** Additional CSS classes */
    class?: string;
  }

  let { message = m.chat_interruptionNotice_default_message(), class: className = '' }: Props =
    $props();
</script>

<div
  class="interruption-notice flex items-center gap-2.5 px-3 py-2.5 my-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 {className}"
  transition:slide={{ axis: 'y', duration: 200 }}
  role="alert"
  aria-live="polite"
>
  <Fa icon={faTriangleExclamation} class="w-4 h-4 flex-shrink-0" />
  <span class="text-sm font-medium">{message}</span>
</div>

<style>
  .interruption-notice {
    /* Ensure the banner is clearly visible and distinct from chat bubbles */
    width: 100%;
    max-width: 100%;
  }
</style>
