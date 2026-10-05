<script lang="ts">
  /**
   * Destructive confirmation shown before an inline proposal card's Dismiss
   * action. Dismissal is persistent (the host dispatches
   * `agent.resolveProposal` outcome 'dismissed', PROTOCOL §5.5, which
   * survives reload), so the copy warns that the proposal is dismissed
   * without applying and won't pend again. Cancel / Escape / backdrop close
   * without side effects. Mirrors DismissQuestionsConfirmDialog: canonical
   * dialog primitive, shared confirmation actions.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  interface Props {
    open?: boolean;
    static?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let { open = false, static: staticPosition = false, onConfirm, onCancel }: Props = $props();
</script>

<FormDialog
  {open}
  static={staticPosition}
  size="sm"
  title={m.chat_proposalTray_dismissDialog_title()}
  description={m.chat_proposalTray_dismissDialog_description()}
  closeLabel={m.chat_proposalTray_dismissDialog_close_ariaLabel()}
  cancelLabel={m.chat_proposalTray_dismissDialog_cancel_label()}
  submitLabel={m.chat_proposalTray_dismissDialog_confirm_label()}
  submitVariant="destructive"
  focusSubmit
  onSubmit={() => onConfirm?.()}
  onCancel={() => onCancel?.()}
/>
