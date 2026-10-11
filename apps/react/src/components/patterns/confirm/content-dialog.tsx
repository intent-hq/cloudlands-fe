import { useId, type ReactNode, type Ref } from 'react';
import { Dialog, DialogContent, type DialogContentProps } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { DialogLayout } from './dialog-layout';
import {
  focusDialogTarget,
  useDialogLifecycle,
  type DialogFocusTarget,
} from './use-dialog-lifecycle';

export interface ContentDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  static?: boolean;
  title: string;
  description?: string;
  titleId?: string;
  descriptionId?: string;
  size?: DialogContentProps['size'];
  allowOverflow?: boolean;
  role?: 'dialog' | 'alertdialog';
  busy?: boolean;
  dismissOnInteractOutside?: boolean;
  showCloseButton?: boolean;
  closeLabel?: string;
  initialFocus?: DialogFocusTarget;
  contentRef?: Ref<HTMLDivElement>;
  escapeKeydownBehavior?: 'close' | 'ignore';
  children?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  onKeyDown?: DialogContentProps['onKeyDown'];
  onKeyDownCapture?: DialogContentProps['onKeyDownCapture'];
  onCloseAutoFocus?: DialogContentProps['onCloseAutoFocus'];
  onClose?: () => void;
}

export function ContentDialog({
  open = false,
  onOpenChange,
  static: staticPosition = false,
  title,
  description,
  titleId,
  descriptionId,
  size = 'default',
  allowOverflow = false,
  role = 'dialog',
  busy = false,
  dismissOnInteractOutside = true,
  showCloseButton = true,
  closeLabel,
  initialFocus,
  contentRef,
  escapeKeydownBehavior = 'close',
  children,
  headerActions,
  footer,
  onKeyDown,
  onKeyDownCapture,
  onCloseAutoFocus,
  onClose,
}: ContentDialogProps) {
  const lifecycle = useDialogLifecycle(open, onOpenChange, onClose);
  const uid = useId();
  const labelledBy = titleId ?? `${uid}-title`;
  const describedBy = description ? (descriptionId ?? `${uid}-description`) : undefined;
  return (
    <Dialog
      open={lifecycle.open}
      staticPosition={staticPosition}
      onOpenChange={(next) => {
        if (!next && !busy) lifecycle.close();
      }}
    >
      <DialogContent
        ref={contentRef}
        size={size}
        role={role}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        showCloseButton={showCloseButton}
        closeLabel={closeLabel}
        closeDisabled={busy}
        className={cn(
          'app-no-drag flex min-h-0 flex-col p-0',
          allowOverflow ? 'overflow-visible' : 'overflow-hidden',
        )}
        onOpenAutoFocus={(event) => {
          lifecycle.captureFocus();
          focusDialogTarget(event, initialFocus);
        }}
        onInteractOutside={(event) => {
          if (busy || !dismissOnInteractOutside) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy || escapeKeydownBehavior === 'ignore') event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          lifecycle.restoreFocus(event);
        }}
        onKeyDown={onKeyDown}
        onKeyDownCapture={onKeyDownCapture}
      >
        <DialogLayout
          title={title}
          description={description}
          titleId={labelledBy}
          descriptionId={describedBy}
          footer={footer}
          headerActions={headerActions}
        >
          {children}
        </DialogLayout>
      </DialogContent>
    </Dialog>
  );
}
