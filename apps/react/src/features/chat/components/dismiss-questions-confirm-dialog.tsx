// Source: src/lib/components/chat/questions/DismissQuestionsConfirmDialog.svelte.
import { FormDialog } from '@/components/patterns/confirm';
import { m } from '$shared/paraglide/messages.js';

export interface DismissQuestionsConfirmDialogProps {
  open?: boolean;
  static?: boolean;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

export function DismissQuestionsConfirmDialog({
  open = false,
  static: staticPosition = false,
  onConfirm,
  onCancel,
}: DismissQuestionsConfirmDialogProps) {
  return (
    <FormDialog
      open={open}
      static={staticPosition}
      size="sm"
      title={m.chat_questionWizard_dismissDialog_title()}
      description={m.chat_questionWizard_dismissDialog_description()}
      closeLabel={m.chat_questionWizard_dismissDialog_close_ariaLabel()}
      cancelLabel={m.chat_questionWizard_dismissDialog_cancel_label()}
      submitLabel={m.chat_questionWizard_dismissDialog_confirm_label()}
      submitVariant="destructive"
      focusSubmit
      onSubmit={() => onConfirm?.()}
      onCancel={onCancel}
    />
  );
}

export default DismissQuestionsConfirmDialog;
