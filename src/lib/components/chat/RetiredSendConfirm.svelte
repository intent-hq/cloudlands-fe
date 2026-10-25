<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

  /**
   * Shown before the first send in a retired workspace (PROTOCOL §5.1): the
   * daemon revives it on send as a fresh blank checkout, so confirm first.
   */
  let { onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void } = $props();
</script>

<div
  role="alert"
  data-testid="retired-send-confirm"
  class="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2"
>
  <p class="min-w-0 flex-1 type-caption text-foreground">{m.workspace_retiredSend_notice()}</p>
  <div class="flex shrink-0 gap-2">
    <Button variant="ghost" size="sm" onclick={onCancel}
      >{m.modals_bulkActionConfirm_cancel_label()}</Button
    >
    <Button variant="primary" size="sm" onclick={onConfirm}
      >{m.workspace_retiredSend_confirm_label()}</Button
    >
  </div>
</div>
