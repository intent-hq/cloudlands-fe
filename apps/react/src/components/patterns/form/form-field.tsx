import { useId, type ReactNode } from 'react';
import { InputMessage } from '@/components/ui/input-message';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { FormControlProps } from '$lib/components/patterns/form/types';

export type { FormControlProps } from '$lib/components/patterns/form/types';

export interface FormFieldProps {
  label: string;
  control: (props: FormControlProps) => ReactNode;
  id?: string;
  name?: string;
  description?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function FormField({
  label,
  control,
  id,
  name,
  description,
  error,
  required = false,
  disabled = false,
  className,
}: FormFieldProps) {
  const uid = useId();
  const controlId = id ?? `${uid}-control`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div
      data-slot="form-field"
      data-invalid={error ? true : undefined}
      data-disabled={disabled ? true : undefined}
      className={cn('group grid min-w-0 gap-1.5', className)}
    >
      <Label htmlFor={controlId} invalid={Boolean(error)}>
        {label}
      </Label>
      {control({
        id: controlId,
        name,
        required,
        disabled,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {description && <InputMessage id={descriptionId}>{description}</InputMessage>}
      {error && (
        <InputMessage id={errorId} tone="error">
          {error}
        </InputMessage>
      )}
    </div>
  );
}
