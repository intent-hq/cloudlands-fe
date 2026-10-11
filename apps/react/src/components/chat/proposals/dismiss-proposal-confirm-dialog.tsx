// Source: src/lib/components/chat/proposals/DismissProposalConfirmDialog.svelte.
import { FormDialog } from '@/components/patterns/confirm';
import { m } from '$shared/paraglide/messages.js';

export interface DismissProposalConfirmDialogProps {
  open?: boolean;
  static?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function DismissProposalConfirmDialog({
  open = false,
  static: staticPosition = false,
  onConfirm,
  onCancel,
}: DismissProposalConfirmDialogProps) {
  return (
    <FormDialog
      open={open}
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
  );
}
