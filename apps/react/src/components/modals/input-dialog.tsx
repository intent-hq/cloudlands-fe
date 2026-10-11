// Source: src/lib/components/modals/InputDialog.svelte.
import { useId, useRef, useState } from 'react';
import { FormDialog } from '@/components/patterns/confirm';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { m } from '$shared/paraglide/messages.js';

export interface InputDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  static?: boolean;
  title?: string;
  description?: string;
  placeholder?: string;
  label?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: (value: string) => void;
  onCancel?: () => void;
}

export function InputDialog({
  open = false,
  onOpenChange,
  static: staticPosition = false,
  title = m.modals_input_title(),
  description = '',
  placeholder = '',
  label,
  confirmLabel = m.modals_input_confirm_label(),
  cancelLabel = m.modals_input_cancel_label(),
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const [isOpen, setIsOpen] = useState(open);
  const [previousOpen, setPreviousOpen] = useState(open);
  const [inputValue, setInputValue] = useState('');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  if (previousOpen !== open) {
    setPreviousOpen(open);
    setIsOpen(open);
  }

  function changeOpen(next: boolean) {
    setIsOpen(next);
    onOpenChange?.(next);
  }

  function confirm() {
    if (!inputValue.trim()) return;
    onConfirm?.(inputValue.trim());
    changeOpen(false);
    setInputValue('');
  }

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={changeOpen}
      static={staticPosition}
      title={title}
      submitLabel={confirmLabel}
      submitVariant="primary"
      cancelLabel={cancelLabel}
      canSubmit={Boolean(inputValue.trim())}
      initialFocus={inputRef}
      onSubmit={confirm}
      onCancel={() => {
        setInputValue('');
        onCancel?.();
      }}
    >
      {description && <p className="type-body">{description}</p>}
      <Label htmlFor={inputId}>{label ?? title}</Label>
      <Input
        id={inputId}
        ref={inputRef}
        value={inputValue}
        onChange={(event) => setInputValue(event.currentTarget.value)}
        type="text"
        placeholder={placeholder}
      />
    </FormDialog>
  );
}
