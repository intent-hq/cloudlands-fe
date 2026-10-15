import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';

export interface EditableNameProps {
  value: string;
  placeholder?: string;
  onSave: (newValue: string) => void;
  disabled?: boolean;
  className?: string;
  textClass?: string;
  title?: string;
  maxWidth?: number;
}

export function EditableName({
  value,
  placeholder = m.ui_editableName_placeholder(),
  onSave,
  disabled = false,
  className = '',
  textClass = 'text-sm font-medium',
  title = m.ui_editableName_rename_tooltip(),
  maxWidth = 200,
}: EditableNameProps) {
  const [isEditing, setEditing] = useState(false);
  const [editedValue, setEditedValue] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  // Blur and outside mousedown may both fire before React commits the display view.
  const editing = useRef(false);
  const save = () => {
    if (!editing.current) return;
    editing.current = false;
    const trimmed = (input.current?.value ?? editedValue).trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  };
  const latestSave = useRef(save);
  useLayoutEffect(() => {
    latestSave.current = save;
  });

  useLayoutEffect(() => {
    if (isEditing) {
      input.current?.focus();
      input.current?.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus({ preventScroll: true });
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    const outside = (event: MouseEvent) => {
      if (input.current && !input.current.contains(event.target as Node)) latestSave.current();
    };
    const timeout = setTimeout(() => document.addEventListener('mousedown', outside), 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mousedown', outside);
    };
  }, [isEditing]);

  return (
    <div
      className={cn(
        'relative inline-flex items-center min-w-0 shrink whitespace-nowrap',
        className,
      )}
    >
      {isEditing ? (
        <Input
          ref={input}
          aria-label={title}
          type="text"
          value={editedValue}
          onChange={(event) => setEditedValue(event.currentTarget.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              restoreFocus.current = true;
              save();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              restoreFocus.current = true;
              editing.current = false;
              setEditedValue(value);
              setEditing(false);
            }
          }}
          className={cn(
            textClass,
            'editable-name-input relative z-10 bg-transparent hover:bg-transparent border-none outline-none px-0',
            'focus:outline-none!',
            'min-w-[60px]',
          )}
          noFocusStyle
          placeholder={placeholder}
          style={{ width: Math.max(60, Math.min(maxWidth, editedValue.length * 8 + 20)), maxWidth }}
        />
      ) : (
        <Button
          ref={trigger}
          variant="plain"
          className={cn(
            textClass,
            'relative z-10 bg-transparent border-none cursor-text text-left',
            'truncate transition-opacity hover:opacity-80',
            disabled && 'cursor-default opacity-50',
          )}
          style={{ maxWidth }}
          onClick={() => {
            if (disabled) return;
            editing.current = true;
            setEditedValue(value);
            setEditing(true);
          }}
          disabled={disabled}
          title={title}
        >
          {value || placeholder}
        </Button>
      )}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none',
          isEditing
            ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-background'
            : '-inset-x-1 -inset-y-0.5 border-transparent bg-transparent',
        )}
      />
    </div>
  );
}
