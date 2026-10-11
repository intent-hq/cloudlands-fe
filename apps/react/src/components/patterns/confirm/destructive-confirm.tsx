import type { ReactNode } from 'react';
import { FormDialog, type FormDialogProps } from './form-dialog';

export interface DestructiveConfirmProps extends Pick<
  FormDialogProps,
  | 'open'
  | 'onOpenChange'
  | 'static'
  | 'title'
  | 'description'
  | 'cancelLabel'
  | 'busy'
  | 'submitBusy'
  | 'canSubmit'
  | 'focusSubmit'
  | 'focusCancel'
  | 'enterKey'
  | 'modEnter'
  | 'className'
  | 'closeLabel'
  | 'onCancel'
  | 'onCloseAutoFocus'
> {
  confirmLabel: string;
  details?: ReactNode;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function DestructiveConfirm({
  confirmLabel,
  details,
  destructive = true,
  focusSubmit = true,
  onConfirm,
  ...props
}: DestructiveConfirmProps) {
  return (
    <FormDialog
      {...props}
      submitLabel={confirmLabel}
      submitVariant={destructive ? 'destructive' : 'default'}
      focusSubmit={focusSubmit}
      onSubmit={onConfirm}
    >
      <>{details}</>
    </FormDialog>
  );
}
