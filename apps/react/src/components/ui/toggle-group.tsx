// Based on shadcn/ui toggle-group; variants and proximity mirror the Svelte group.
import * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import type { ToggleSize } from '@/components/ui/toggle';
import { ChoiceHighlight } from './choice-highlight';
import type { ProximityAxis } from '@/lib/interaction/proximity-hover';

type ToggleGroupVariant = 'default' | 'outline' | 'flat';
const ToggleGroupContext = React.createContext({
  size: 'default' as ToggleSize,
  variant: 'default' as ToggleGroupVariant,
});
export type ToggleGroupProps = React.ComponentProps<typeof ToggleGroupPrimitive.Root> & {
  size?: ToggleSize;
  variant?: ToggleGroupVariant;
  axis?: ProximityAxis;
};
export function ToggleGroup({
  ref,
  className,
  children,
  size = 'default',
  variant = 'default',
  axis = 'x',
  ...props
}: ToggleGroupProps) {
  const root = React.useRef<HTMLDivElement>(null);
  return (
    <ToggleGroupContext value={{ size, variant }}>
      <ToggleGroupPrimitive.Root
        data-slot="toggle-group"
        ref={(node) => {
          root.current = node;
          if (typeof ref === 'function') return ref(node);
          if (ref) ref.current = node;
        }}
        className={cn(
          'relative isolate inline-flex shrink-0 items-center justify-center gap-0.5 rounded-(--radius-medium) border-0 bg-card',
          {
            default: 'shadow-(--elevation-raised)',
            outline: 'border border-border shadow-none',
            flat: 'bg-muted/40 shadow-none',
          }[variant],
          className,
        )}
        {...props}
      >
        <ChoiceHighlight
          containerRef={root}
          selector="[data-slot=toggle-group-item]"
          selectedSelector="[data-state=on]"
          axis={axis}
        />
        {children}
      </ToggleGroupPrimitive.Root>
    </ToggleGroupContext>
  );
}
export function ToggleGroupItem({
  className,
  size,
  variant,
  tooltip,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & {
  size?: ToggleSize;
  variant?: ToggleGroupVariant;
  tooltip?: string;
}) {
  const context = React.useContext(ToggleGroupContext);
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      title={tooltip}
      className={cn(
        'type-caption relative z-10 inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-(--radius-medium) border-0 bg-transparent font-normal text-muted-foreground transition-[color,font-weight] duration-spring-fast ease-spring-fast hover:text-foreground active:bg-active disabled:pointer-events-none disabled:opacity-50 data-[state=on]:[--text-caption-weight:500] data-[state=on]:text-foreground motion-reduce:transition-none',
        (variant ?? context.variant) === 'outline' && 'bg-transparent',
        {
          default: 'h-(--control-height-medium) min-w-8 px-2',
          xs: 'h-(--control-height-small) min-w-7 px-1.5',
          sm: 'h-(--control-height-small) min-w-7 px-1.5',
          lg: 'h-(--control-height-large) min-w-9 px-2.5',
        }[size ?? context.size],
        className,
      )}
      {...props}
    />
  );
}
