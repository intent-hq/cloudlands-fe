<script lang="ts">
  /**
   * Go/no-go confirmation shown before an edit-and-regenerate dispatch.
   * `agent.editAndRegenerate` (PROTOCOL §5.5) destructively truncates the
   * transcript from the edited message onward, so the user must explicitly
   * confirm before the edit is sent. Cancelling returns to edit mode with the
   * draft intact.
   *
   * Portaled to the document body (same pattern as DeleteWarningDialog) so the
   * fixed-position overlay escapes ChatMessage's overflow/stacking contexts —
   * rendered inline it gets clipped inside the message edit box.
   */
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let { open = false, onConfirm, onCancel }: Props = $props();
</script>

{#if open}
  <Portal target="body" zIndex={100}>
    <BulkActionConfirmDialog
      {open}
      title={m.chat_editRegenerate_confirm_title()}
      description={m.chat_editRegenerate_confirm_description()}
      confirmText={m.chat_editRegenerate_confirm_button()}
      variant="destructive"
      {onConfirm}
      {onCancel}
    />
  </Portal>
{/if}
