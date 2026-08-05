<script lang="ts">
  import Fa from 'svelte-fa';
  import { faEnvelope } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
</script>

<!-- Presentation-only unread marker (sibling of DateSeparator) — never part of
     the transcript; anchored after the session's lastSeenMessageId message. -->
<div
  data-new-messages-divider
  class="flex items-center gap-3 my-6 px-6 font-family-child"
  role="separator"
  aria-label={m.chat_newMessagesDivider_label()}
>
  <div class="flex-1 h-px bg-accent/60"></div>
  <div class="flex items-center gap-2 px-3 py-1 bg-accent/10 rounded-full border border-accent/40">
    <Fa icon={faEnvelope} size="xs" class="text-accent" />
    <span class="text-xs font-medium text-accent first-letter:uppercase">
      {m.chat_newMessagesDivider_label()}
    </span>
  </div>
  <div class="flex-1 h-px bg-accent/60"></div>
</div>
