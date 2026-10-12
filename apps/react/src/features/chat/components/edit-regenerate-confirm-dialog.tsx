// Source: src/lib/components/chat/EditRegenerateConfirmDialog.svelte.
import { BulkActionConfirmDialog } from '@/components/modals/bulk-action-confirm-dialog';
import { m } from '$shared/paraglide/messages.js';

export interface EditRegenerateConfirmDialogProps {
  open?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

/** Confirmation callbacks only; the caller owns the edit-and-regenerate dispatch. */
export function EditRegenerateConfirmDialog({
  open = false,
  onConfirm,
  onCancel,
}: EditRegenerateConfirmDialogProps) {
  return (
    <BulkActionConfirmDialog
      open={open}
      title={m.chat_editRegenerate_confirm_title()}
      description={m.chat_editRegenerate_confirm_description()}
      confirmText={m.chat_editRegenerate_confirm_button()}
      variant="destructive"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
