import { useId, useRef } from 'react';
import { m } from '$shared/paraglide/messages.js';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  AlertOptions,
  ConfirmOptions,
  PromptOptions,
} from '$lib/components/patterns/confirm/types';
import { DestructiveConfirm } from './destructive-confirm';
import { FormDialog, type FormDialogProps } from './form-dialog';

export interface ConfirmRequestViewProps {
  request:
    | { kind: 'confirm'; options: ConfirmOptions }
    | { kind: 'prompt'; options: PromptOptions }
    | { kind: 'alert'; options: AlertOptions };
  value?: string;
  onValueChange?: (value: string) => void;
  busy?: boolean;
  static?: boolean;
  onAccept: (value: string) => void | Promise<void>;
  onCancel: () => void;
  onCloseAutoFocus?: FormDialogProps['onCloseAutoFocus'];
}

export function ConfirmRequestView({
  request,
  value = '',
  onValueChange,
  busy = false,
  static: staticPosition = false,
  onAccept,
  onCancel,
  onCloseAutoFocus,
}: ConfirmRequestViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const shared = { open: true, static: staticPosition, busy, onCancel, onCloseAutoFocus };
  if (request.kind === 'confirm') {
    return (
      <DestructiveConfirm
        {...shared}
        title={request.options.title}
        description={request.options.description}
        confirmLabel={request.options.confirmLabel ?? m.modals_bulkActionConfirm_confirm_label()}
        cancelLabel={request.options.cancelLabel ?? m.modals_bulkActionConfirm_cancel_label()}
        destructive={request.options.destructive ?? false}
        onConfirm={() => onAccept(value)}
      />
    );
  }
  if (request.kind === 'prompt') {
    return (
      <FormDialog
        {...shared}
        title={request.options.title}
        description={request.options.description}
        submitLabel={request.options.confirmLabel ?? m.modals_input_confirm_label()}
        cancelLabel={request.options.cancelLabel ?? m.modals_input_cancel_label()}
        canSubmit={!request.options.field.required || value.trim().length > 0}
        initialFocus={inputRef}
        onSubmit={() => onAccept(value)}
      >
        <div className="grid gap-2">
          {request.options.field.label && (
            <Label htmlFor={inputId}>{request.options.field.label}</Label>
          )}
          <Input
            id={inputId}
            ref={inputRef}
            value={value}
            onChange={(event) => onValueChange?.(event.currentTarget.value)}
            type={request.options.field.type ?? 'text'}
            placeholder={request.options.field.placeholder}
            aria-label={request.options.field.label ? undefined : request.options.title}
          />
        </div>
      </FormDialog>
    );
  }
  return (
    <FormDialog
      {...shared}
      role="alertdialog"
      title={request.options.title}
      description={request.options.description}
      submitLabel={request.options.confirmLabel ?? m.modals_input_confirm_label()}
      showCancel={false}
      dismissOnInteractOutside={false}
      onSubmit={() => onAccept(value)}
      onCancel={() => void onAccept(value)}
    />
  );
}
