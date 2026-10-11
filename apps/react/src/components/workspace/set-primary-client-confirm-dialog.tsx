// Source: src/lib/components/workspace/SetPrimaryClientConfirmDialog.svelte.
import { FormDialog } from '@/components/patterns/confirm';
import { m } from '$shared/paraglide/messages.js';

export interface SetPrimaryClientConfirmDialogProps {
  open?: boolean;
  static?: boolean;
  currentHost?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function SetPrimaryClientConfirmDialog({
  static: staticPosition = false,
  open = false,
  currentHost,
  onConfirm,
  onCancel,
}: SetPrimaryClientConfirmDialogProps) {
  return (
    <FormDialog
      static={staticPosition}
      open={open}
      title={m.workspace_drivingClient_setPrimaryDialog_title()}
      closeLabel={m.workspace_drivingClient_setPrimaryDialog_close_ariaLabel()}
      cancelLabel={m.workspace_drivingClient_setPrimaryDialog_cancel_label()}
      submitLabel={m.workspace_drivingClient_setPrimaryDialog_confirm_label()}
      submitVariant="primary"
      focusSubmit
      onSubmit={() => onConfirm?.()}
      onCancel={onCancel}
    >
      <p className="type-body">
        {currentHost
          ? m.workspace_drivingClient_setPrimaryDialog_description({ host: currentHost })
          : m.workspace_drivingClient_setPrimaryDialog_unresolved_description()}
      </p>
    </FormDialog>
  );
}
