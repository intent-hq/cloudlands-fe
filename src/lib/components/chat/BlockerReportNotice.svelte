<script lang="ts">
  /**
   * BlockerReportNotice Component
   *
   * Displays an inline attention banner when an agent reported a blocker via
   * `ws.agent.reportBlocker(reason)`. Rendered for system-role messages whose
   * text block carries `meta.kind = "blocker-report"`.
   */
  import ChatNotice from './ChatNotice.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** The reason the agent gave for reporting a blocker */
    reason?: string;
    /** Additional CSS classes */
    class?: string;
  }

  let { reason = '', class: className = '' }: Props = $props();
</script>

<ChatNotice
  title={m.chat_blockerReportNotice_title_label()}
  tone="danger"
  {reason}
  class="blocker-report-notice {className}"
/>
