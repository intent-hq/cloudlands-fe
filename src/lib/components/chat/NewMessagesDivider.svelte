<script lang="ts">
  import Fa from 'svelte-fa';
  import { faEnvelope } from '@fortawesome/free-solid-svg-icons';
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
  <div class="flex items-center gap-1.5 px-1">
    <Fa icon={faEnvelope} size="xs" class="text-muted-foreground/70" />
    <span class="whitespace-nowrap font-medium text-foreground/80 first-letter:uppercase">
      {m.chat_newMessagesDivider_label()}
    </span>
  </div>
  <div class="h-px flex-1 bg-border"></div>
</div>
