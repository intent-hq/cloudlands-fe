/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Keep the source group semantics and div ref contract without native fieldset behavior. */
// Source: src/lib/components/ui/checkbox-group; Radix checkbox semantics with shared choice rows.
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { useChoiceRows, ChoiceRowsHighlight } from './radio-group-rows';
const CheckboxContext = createContext<{
  value: readonly string[];
  disabled: boolean;
  name?: string;
  rows: ReturnType<typeof useChoiceRows>;
  setChecked: (value: string, checked: boolean) => void;
} | null>(null);
export type CheckboxGroupProps = Omit<ComponentProps<'div'>, 'defaultValue'> & {
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  layout?: 'inline' | 'stacked';
};
export function CheckboxGroup({
  ref,
  value,
  defaultValue = [],
  onValueChange,
  name,
  disabled = false,
  required = false,
  layout = 'stacked',
  className,
  children,
  ...props
}: CheckboxGroupProps) {
  const [internal, setInternal] = useState(defaultValue);
  const selected = value ?? internal;
  const rows = useChoiceRows();
  const setChecked = (item: string, checked: boolean) => {
    const next = checked
      ? selected.includes(item)
        ? selected
        : [...selected, item]
      : selected.filter((entry) => entry !== item);
    setInternal(next);
    onValueChange?.(next);
  };
  return (
    <CheckboxContext value={{ value: selected, disabled, name, rows, setChecked }}>
      <div
        {...props}
        ref={(node) => {
          rows.attachRoot(node);
          if (typeof ref === 'function') return ref(node);
          if (ref) ref.current = node;
        }}
        role="group"
        aria-disabled={disabled || undefined}
        data-required={required || undefined}
        data-choice-group="checkbox"
        className={cn(
          'relative isolate flex w-72 max-w-full gap-0 select-none',
          layout === 'inline' ? 'flex-row items-stretch' : 'flex-col',
          className,
        )}
      >
        <ChoiceRowsHighlight state={rows} />
        {children}
      </div>
    </CheckboxContext>
  );
}
export type CheckboxGroupItemProps = Omit<
  ComponentProps<typeof CheckboxPrimitive.Root>,
  'checked' | 'defaultChecked' | 'onCheckedChange'
> & {
  value: string;
  title: string;
  description?: string;
  marker?: (state: { selected: boolean; index: number }) => ReactNode;
};
export function CheckboxGroupItem({
  value,
  title,
  description,
  disabled = false,
  marker,
  className,
  onKeyDown,
  ...props
}: CheckboxGroupItemProps) {
  const context = useContext(CheckboxContext);
  if (!context) throw new Error('CheckboxGroupItem must be inside CheckboxGroup.');
  const selected = context.value.includes(value);
  const index = context.rows.rows.findIndex((row) => row.value === value);
  return (
    <CheckboxPrimitive.Root
      {...props}
      checked={selected}
      onCheckedChange={(checked) => context.setChecked(value, checked === true)}
      value={value}
      name={context.name}
      disabled={disabled || context.disabled}
      tabIndex={context.rows.keyboardValue === value ? 0 : -1}
      data-choice-value={value}
      data-choice-index={index}
      onKeyDown={(event) => {
        const previous = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        const next = event.key === 'ArrowRight' || event.key === 'ArrowDown';
        if (previous || next) {
          event.preventDefault();
          context.rows.focusAdjacent(value, previous ? -1 : 1);
        }
        onKeyDown?.(event);
      }}
      className={cn(
        'type-caption relative z-10 flex min-h-(--control-height-medium) min-w-0 cursor-pointer items-center gap-2 rounded-(--radius-row) border border-transparent bg-transparent px-2 py-1.5 text-left text-muted-foreground transition-[color,font-weight] duration-spring-fast ease-spring-fast disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
        selected && '[--text-caption-weight:500] text-foreground',
        className,
      )}
    >
      <span
        className={cn(
          'border-border flex size-4 shrink-0 items-center justify-center rounded-(--radius-small) border',
          selected ? 'border-transparent bg-transparent text-foreground' : 'bg-transparent',
        )}
      >
        {marker ? (
          marker({ selected, index })
        ) : selected ? (
          <svg className="size-3" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="m2.25 6.25 2.25 2.2 5.25-5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
            />
          </svg>
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="block">{title}</span>
        {description && (
          <span className="text-muted-foreground block text-ui-xs font-normal">{description}</span>
        )}
      </span>
    </CheckboxPrimitive.Root>
  );
}
export { CheckboxGroup as Root, CheckboxGroupItem as Item };
