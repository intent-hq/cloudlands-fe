// Source: src/lib/components/ui/radio-group; shadcn Radix semantics with Intent option rows.
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react';
import { RadioGroup as RadioPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { useChoiceRows, ChoiceRowsHighlight } from './radio-group-rows';
const RadioContext = createContext<{
  value: string;
  disabled: boolean;
  rows: ReturnType<typeof useChoiceRows>;
} | null>(null);
export type RadioGroupProps = ComponentProps<typeof RadioPrimitive.Root> & {
  layout?: 'inline' | 'stacked';
  readOnly?: boolean;
  readonly?: boolean;
};
export function RadioGroup({
  ref,
  value,
  defaultValue = '',
  onValueChange,
  disabled = false,
  readOnly = false,
  readonly = false,
  layout = 'stacked',
  className,
  children,
  ...props
}: RadioGroupProps) {
  const [internal, setInternal] = useState(defaultValue);
  const selected = value ?? internal;
  const rows = useChoiceRows();
  return (
    <RadioContext value={{ value: selected, disabled, rows }}>
      <RadioPrimitive.Root
        {...props}
        ref={(node) => {
          rows.attachRoot(node);
          if (typeof ref === 'function') return ref(node);
          if (ref) ref.current = node;
        }}
        value={selected}
        onValueChange={(next) => {
          if (readOnly || readonly) return;
          setInternal(next);
          onValueChange?.(next);
        }}
        disabled={disabled}
        aria-readonly={readOnly || readonly || undefined}
        orientation={layout === 'inline' ? 'horizontal' : 'vertical'}
        data-choice-group="radio"
        className={cn(
          'relative isolate flex w-72 max-w-full gap-0 select-none',
          'p-1',
          layout === 'inline' ? 'flex-row items-stretch' : 'flex-col',
          className,
        )}
      >
        <ChoiceRowsHighlight state={rows} selectedClass="bg-active" />
        {children}
      </RadioPrimitive.Root>
    </RadioContext>
  );
}
export type RadioGroupItemProps = ComponentProps<typeof RadioPrimitive.Item> & {
  title: string;
  description?: string;
  marker?: (state: { selected: boolean; index: number }) => ReactNode;
};
export function RadioGroupItem({
  value,
  title,
  description,
  disabled = false,
  marker,
  className,
  ...props
}: RadioGroupItemProps) {
  const context = useContext(RadioContext);
  if (!context) throw new Error('RadioGroupItem must be inside RadioGroup.');
  const selected = context.value === value;
  const index = context.rows.rows.findIndex((row) => row.value === value);
  return (
    <RadioPrimitive.Item
      {...props}
      value={value}
      disabled={disabled || context.disabled}
      data-choice-value={value}
      data-choice-index={index}
      className={cn(
        'type-caption min-h-(--control-height-small) justify-start rounded-(--radius-row) px-2 py-1 text-left font-normal',
        'relative z-10 flex min-w-0 cursor-pointer items-start gap-2 border border-transparent bg-transparent text-left text-muted-foreground transition-[color,font-weight] duration-spring-fast ease-spring-fast focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:shadow-none disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
        selected && 'font-medium text-foreground',
        className,
      )}
    >
      <span className="first-line-icon">
        <span
          className={cn(
            'border-border flex size-4 shrink-0 items-center justify-center rounded-full border',
            selected ? 'border-transparent bg-transparent' : 'bg-transparent',
          )}
        >
          {marker ? (
            marker({ selected, index })
          ) : selected ? (
            <span className="bg-foreground size-2 rounded-full" />
          ) : null}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block">{title}</span>
        {description && (
          <span className="text-muted-foreground block text-ui-xs font-normal">{description}</span>
        )}
      </span>
    </RadioPrimitive.Item>
  );
}
export { RadioGroup as Root, RadioGroupItem as Item };
