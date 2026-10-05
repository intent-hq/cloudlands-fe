<script lang="ts">
  /**
   * InterruptionNotice Component
   *
   * Displays an inline notice banner when an agent conversation was interrupted.
   * Used for system-role messages that indicate the agent was terminated due to
   * an intentd restart or crash.
   */
  import ChatNotice from './ChatNotice.svelte';
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

<ChatNotice title={message} tone="warning" class="interruption-notice {className}" />
