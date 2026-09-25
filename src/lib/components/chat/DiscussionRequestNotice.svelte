<script lang="ts">
  /**
   * DiscussionRequestNotice Component
   *
   * Displays an inline attention banner when an agent requested a discussion
   * via `ws.agent.requestDiscussion(reason)`. Rendered for system-role
   * messages whose text block carries `meta.kind = "discussion-request"`.
   */
  import ChatNotice from './ChatNotice.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** The reason the agent gave for requesting a discussion */
    reason?: string;
    /** Additional CSS classes */
    class?: string;
  }

  let { reason = '', class: className = '' }: Props = $props();
</script>

<ChatNotice
  title={m.chat_discussionRequestNotice_title_label()}
  tone="warning"
  {reason}
  class="discussion-request-notice {className}"
/>
