<script lang="ts">
  /**
   * Loading indicator shown while the composer draft restore (`drafts.get`,
   * PROTOCOL §5.16) is in flight and the composer blocks text entry.
   */
  import Fa from 'svelte-fa';
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
</script>

<div
  role="status"
  class="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground"
  data-testid="chat-draft-loading-gate"
>
  <Fa icon={faSpinner} spin />
  <span>{m.chat_draftGate_loading_label()}</span>
</div>
