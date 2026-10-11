import { useId, useRef, useState, type ReactNode } from 'react';
import { m } from '$shared/paraglide/messages.js';
import { Button, type ButtonVariant } from '@/components/ui/button';
import { Dialog, DialogContent, type DialogContentProps } from '@/components/ui/dialog';
import { Form, FormActions, type FormProps } from '@/components/patterns/form';
import { cn } from '@/lib/utils';
import { DialogLayout } from './dialog-layout';
import {
  focusDialogTarget,
  useDialogLifecycle,
  type DialogFocusTarget,
} from './use-dialog-lifecycle';

export interface FormDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  static?: boolean;
  title: string;
  description?: string;
  titleId?: string;
  descriptionId?: string;
  children?: ReactNode;
  footer?: ReactNode;
  submitLabel?: string;
  cancelLabel?: string;
  submitVariant?: ButtonVariant;
  canSubmit?: boolean;
  busy?: boolean;
  /** Disable submission while leaving cancellation available during preflight. */
  submitBusy?: boolean;
  role?: 'dialog' | 'alertdialog';
  dismissOnInteractOutside?: boolean;
  showCancel?: boolean;
  showCloseButton?: boolean;
  closeLabel?: string;
  className?: string;
  size?: DialogContentProps['size'];
  initialFocus?: DialogFocusTarget;
  focusContent?: boolean;
  focusSubmit?: boolean;
  focusCancel?: boolean;
  escapeKeydownBehavior?: 'close' | 'ignore';
  enterKey?: FormProps['enterKey'];
  modEnter?: FormProps['modEnter'];
  onFocus?: DialogContentProps['onFocus'];
  onCloseAutoFocus?: DialogContentProps['onCloseAutoFocus'];
  onSubmit: () => void | Promise<void>;
  onCancel?: () => void;
}

export function FormDialog({
  open = false,
  onOpenChange,
  static: staticPosition = false,
  title,
  description,
  titleId,
  descriptionId,
  children,
  footer,
  submitLabel = m.modals_bulkActionConfirm_confirm_label(),
  cancelLabel = m.modals_bulkActionConfirm_cancel_label(),
  submitVariant = 'primary',
  canSubmit = true,
  busy = false,
  submitBusy = false,
  role = 'dialog',
  dismissOnInteractOutside = true,
  showCancel = true,
  showCloseButton = true,
  closeLabel = m.ui_dialog_close_ariaLabel(),
  className,
  size = 'default',
  initialFocus,
  focusContent = false,
  focusSubmit = false,
  focusCancel = false,
  escapeKeydownBehavior = 'close',
  enterKey = 'submit',
  modEnter = 'submit',
  onFocus,
  onCloseAutoFocus,
  onSubmit,
  onCancel,
}: FormDialogProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const [previousOpen, setPreviousOpen] = useState(open);
  const submitting = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const submitRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const lifecycle = useDialogLifecycle(open, onOpenChange, onCancel);
  const isBusy = busy || internalBusy;
  const uid = useId();
  const labelledBy = titleId ?? `${uid}-title`;
  const describedBy = descriptionId ?? (description ? `${uid}-description` : undefined);

  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (open) setSubmissionError('');
  }

  function cancel() {
    if (!busy && !submitting.current) lifecycle.close();
  }

  async function submit() {
    if (busy || submitting.current || submitBusy || !canSubmit) return;
    submitting.current = true;
    setInternalBusy(true);
    setSubmissionError('');
    try {
      await onSubmit();
    } catch {
      setSubmissionError(m.ui_dialog_submitFailed_error());
    } finally {
      submitting.current = false;
      setInternalBusy(false);
    }
  }

  return (
    <Dialog
      open={lifecycle.open}
      staticPosition={staticPosition}
      onOpenChange={(next) => !next && cancel()}
    >
      <DialogContent
        ref={contentRef}
        role={role}
        size={size}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={cn('flex min-h-0 flex-col overflow-hidden p-0', className)}
        closeDisabled={isBusy}
        showCloseButton={showCloseButton}
        closeLabel={closeLabel}
        onOpenAutoFocus={(event) => {
          lifecycle.captureFocus();
          focusDialogTarget(
            event,
            initialFocus ??
              (focusCancel
                ? cancelRef
                : focusSubmit
                  ? submitRef
                  : focusContent
                    ? contentRef
                    : null),
          );
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          lifecycle.restoreFocus(event);
        }}
        onFocus={onFocus}
        onInteractOutside={(event) => {
          if (busy || submitting.current || !dismissOnInteractOutside) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy || submitting.current || escapeKeydownBehavior === 'ignore')
            event.preventDefault();
        }}
      >
        <Form
          onSubmit={submit}
          busy={isBusy}
          enterKey={enterKey}
          modEnter={modEnter}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <DialogLayout
            title={title}
            description={description}
            titleId={labelledBy}
            descriptionId={describedBy}
            error={submissionError}
            footer={
              footer ?? (
                <FormActions
                  secondary={
                    showCancel && (
                      <Button
                        ref={cancelRef}
                        variant="ghost-light"
                        disabled={isBusy}
                        onClick={cancel}
                      >
                        {cancelLabel}
                      </Button>
                    )
                  }
                  primary={
                    <Button
                      ref={submitRef}
                      type="submit"
                      variant={submitVariant}
                      className={
                        focusSubmit
                          ? 'focus-visible:outline focus-visible:-outline-offset-1'
                          : undefined
                      }
                      loading={isBusy || submitBusy}
                      disabled={!canSubmit || isBusy || submitBusy}
                    >
                      {submitLabel}
                    </Button>
                  }
                />
              )
            }
          >
            {children}
          </DialogLayout>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
