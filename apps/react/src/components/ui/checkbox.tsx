// Based on shadcn/ui checkbox; mixed/read-only behavior matches checkbox.svelte.
import { useState, type ComponentProps } from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import './checkbox.css';

export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root> & {
  indeterminate?: boolean;
  onIndeterminateChange?: (indeterminate: boolean) => void;
  readOnly?: boolean;
  invalid?: boolean;
  size?: 'sm' | 'md' | 'lg';
  ariaLabel?: string;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
};
export function Checkbox({
  checked,
  defaultChecked = false,
  indeterminate,
  onCheckedChange,
  onIndeterminateChange,
  readOnly = false,
  invalid = false,
  disabled,
  className,
  size = 'md',
  ariaLabel,
  ariaLabelledby,
  ariaDescribedby,
  onClick,
  ...props
}: CheckboxProps) {
  const [localChecked, setLocalChecked] = useState<boolean | 'indeterminate'>(defaultChecked);
  const state = indeterminate ? 'indeterminate' : (checked ?? localChecked);
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      {...props}
      checked={state}
      disabled={disabled}
      aria-readonly={readOnly || undefined}
      aria-label={ariaLabel ?? props['aria-label']}
      aria-labelledby={ariaLabelledby ?? props['aria-labelledby']}
      aria-describedby={ariaDescribedby ?? props['aria-describedby']}
      aria-invalid={invalid || props['aria-invalid']}
      onCheckedChange={(next) => {
        if (readOnly) return;
        setLocalChecked(next);
        onCheckedChange?.(next);
        if (indeterminate) onIndeterminateChange?.(next === 'indeterminate');
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
        if (readOnly) event.preventDefault();
      }}
      className={cn(
        "checkbox-root border-border bg-card relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-(--radius-small) border-[1.5px] shadow-(--elevation-raised) transition-[border-color,background-color,box-shadow,opacity] duration-spring-fast ease-spring-fast after:absolute after:-inset-1.5 after:content-[''] motion-reduce:transition-none",
        'hover:border-input hover:bg-hover active:bg-active',
        disabled && 'cursor-not-allowed bg-muted/40 opacity-60 hover:border-border',
        readOnly && 'cursor-default',
        invalid && 'border-danger ring-1 ring-danger/25',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-2 focus-visible:shadow-none focus-visible:ring-0',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:hover:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:hover:bg-primary',
        { sm: 'size-3.5', md: 'size-4', lg: 'size-5' }[size],
        className,
      )}
    >
      <svg className="checkbox-mark size-[75%]" viewBox="0 0 12 12" aria-hidden="true">
        {state === 'indeterminate' ? (
          <path className="checkbox-line" d="M2.5 6h7" />
        ) : (
          <path className={state ? 'drawn' : undefined} d="m2.25 6.25 2.25 2.2 5.25-5" />
        )}
      </svg>
    </CheckboxPrimitive.Root>
  );
}
