<script lang="ts">
  /**
   * Loading indicator shown while the composer draft restore (`drafts.get`,
   * PROTOCOL §5.16) is in flight and the composer blocks text entry.
   */
  import { m } from '$shared/paraglide/messages.js';
</script>

<div
  role="status"
  class="px-3 py-1.5 text-xs text-muted-foreground"
  data-testid="chat-draft-loading-gate"
>
  <span>{m.chat_draftGate_loading_label()}</span>
</div>
