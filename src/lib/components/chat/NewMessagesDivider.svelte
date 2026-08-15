<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
</script>

<!-- Presentation-only unread marker (sibling of DateSeparator) — never part of
     the transcript; anchored after the session's lastSeenMessageId message. -->
<div
  data-new-messages-divider
  class="type-caption font-family-child my-6 flex items-center gap-2 px-2"
  role="separator"
  aria-label={m.chat_newMessagesDivider_label()}
>
  <div class="h-px flex-1 bg-border"></div>
  <span class="whitespace-nowrap px-1 font-medium text-foreground first-letter:uppercase">
    {m.chat_newMessagesDivider_label()}
  </span>
  <div class="h-px flex-1 bg-border"></div>
</div>
