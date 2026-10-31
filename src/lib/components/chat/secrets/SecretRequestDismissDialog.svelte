<script lang="ts">
  /**
   * Destructive confirmation shown before a secret request is dismissed
   * (PROTOCOL §5.56 `secret.dismiss`), matching the Q&A card's dismiss
   * dialog. Dismissing tells the agent the user declined and cannot be undone.
   * Cancel / Escape / backdrop close without side effects.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    name: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let { open = false, name, onConfirm, onCancel }: Props = $props();
</script>

<FormDialog
  {open}
  size="sm"
  title={m.chat_secretRequest_dismissDialog_title()}
  description={m.chat_secretRequest_dismissDialog_description({ name })}
  closeLabel={m.chat_secretRequest_dismissDialog_close_ariaLabel()}
  cancelLabel={m.chat_secretRequest_dismissDialog_cancel_label()}
  submitLabel={m.chat_secretRequest_dismissDialog_confirm_label()}
  submitVariant="destructive"
  focusSubmit
  onSubmit={() => onConfirm?.()}
  onCancel={() => onCancel?.()}
/>
