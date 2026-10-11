// Source: src/lib/components/modals/MessageDialog.svelte.
import { useId, useState } from 'react';
import { DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/patterns/confirm';

export interface MessageDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  static?: boolean;
  title: string;
  message: string;
  type?: 'info' | 'warning' | 'error';
  /** One button per label; selection reports the label's index. */
  buttons: string[];
  /** Index reported when the dialog is dismissed (Escape / X). */
  cancelIndex?: number;
  onSelect?: (buttonIndex: number) => void;
}

export function MessageDialog({
  open = false,
  onOpenChange,
  static: staticPosition = false,
  title,
  message,
  buttons,
  cancelIndex = 0,
  onSelect,
}: MessageDialogProps) {
  const [isOpen, setIsOpen] = useState(open);
  const [previousOpen, setPreviousOpen] = useState(open);
  const descriptionId = useId();

  if (previousOpen !== open) {
    setPreviousOpen(open);
    setIsOpen(open);
  }

  function changeOpen(next: boolean) {
    setIsOpen(next);
    onOpenChange?.(next);
  }

  function select(index: number) {
    changeOpen(false);
    onSelect?.(index);
  }

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={changeOpen}
      static={staticPosition}
      role="alertdialog"
      title={title}
      descriptionId={descriptionId}
      dismissOnInteractOutside={false}
      focusContent
      onSubmit={() => select(buttons.length - 1)}
      onCancel={() => onSelect?.(cancelIndex)}
      footer={buttons.map((label, index) => (
        <Button
          key={index}
          variant={
            index === cancelIndex ? 'ghost' : index === buttons.length - 1 ? 'primary' : 'outline'
          }
          onClick={() => select(index)}
        >
          {label}
        </Button>
      ))}
    >
      <DialogDescription id={descriptionId} className="sr-only">
        {message}
      </DialogDescription>
      <p className="type-body">{message}</p>
    </FormDialog>
  );
}
