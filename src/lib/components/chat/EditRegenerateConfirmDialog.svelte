<script lang="ts">
  /**
   * Go/no-go confirmation shown before an edit-and-regenerate dispatch.
   * `agent.editAndRegenerate` (PROTOCOL §5.5) destructively truncates the
   * transcript from the edited message onward, so the user must explicitly
   * confirm before the edit is sent. Cancelling returns to edit mode with the
   * draft intact.
   *
   * BulkActionConfirmDialog uses the canonical portaled dialog primitive, so
   * the confirmation escapes ChatMessage's overflow/stacking contexts.
   */
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let { open = false, onConfirm, onCancel }: Props = $props();
</script>

<BulkActionConfirmDialog
  {open}
  title={m.chat_editRegenerate_confirm_title()}
  description={m.chat_editRegenerate_confirm_description()}
  confirmText={m.chat_editRegenerate_confirm_button()}
  variant="destructive"
  {onConfirm}
  {onCancel}
/>
