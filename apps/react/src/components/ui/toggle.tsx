// Based on shadcn/ui toggle; styling and event aliases mirror toggle.svelte.
import type { ComponentProps } from 'react';
import { Toggle as TogglePrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export type ToggleSize = 'default' | 'sm' | 'lg' | 'xs';
export type ToggleProps = Omit<ComponentProps<typeof TogglePrimitive.Root>, 'onChange'> & {
  size?: ToggleSize;
  ariaLabel?: string;
  ariaDescribedby?: string;
  onChange?: (pressed: boolean) => void;
};
export function Toggle({
  className,
  size = 'default',
  ariaLabel,
  ariaDescribedby,
  onChange,
  onPressedChange,
  ...props
}: ToggleProps) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      {...props}
      aria-label={ariaLabel ?? props['aria-label']}
      aria-describedby={ariaDescribedby ?? props['aria-describedby']}
      onPressedChange={(pressed) => {
        onChange?.(pressed);
        onPressedChange?.(pressed);
      }}
      className={cn(
        'type-caption inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-(--radius-medium) border border-border bg-muted text-muted-foreground transition-[background-color,color,box-shadow] duration-spring-fast ease-spring-fast data-[state=off]:hover:bg-hover data-[state=off]:active:bg-active disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-selected data-[state=on]:shadow-(--elevation-raised) data-[state=on]:text-foreground data-[state=on]:hover:bg-selected motion-reduce:transition-none',
        {
          default: 'h-(--control-height-medium) px-2.5',
          sm: 'h-(--control-height-small) px-2',
          xs: 'h-(--control-height-small) px-2',
          lg: 'h-(--control-height-large) px-3',
        }[size],
        className,
      )}
    />
  );
}
