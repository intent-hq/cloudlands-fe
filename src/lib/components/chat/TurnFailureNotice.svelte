<script lang="ts">
  /**
   * TurnFailureNotice Component
   *
   * Displays an inline failure notice when an agent turn ended in a terminal
   * failure. Rendered for system-role messages whose text block carries
   * `meta.kind = "turn-failure"`.
   */
  import ChatNotice from './ChatNotice.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** The failure text carried by the notice message */
    reason?: string;
    /** Additional CSS classes */
    class?: string;
  }

  let { reason = '', class: className = '' }: Props = $props();
</script>

<ChatNotice
  title={m.chat_turnFailureNotice_title_label()}
  tone="danger"
  {reason}
  class="turn-failure-notice {className}"
/>
