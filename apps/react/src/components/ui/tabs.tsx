// Based on shadcn/ui tabs; all tab recipes and proximity geometry are retained.
import * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { useSize, type UiSize } from '@/components/ui/size-context';
import { ChoiceHighlight } from './choice-highlight';

export type TabsVariant = 'default' | 'subtle' | 'underline';
const TabsContext = React.createContext({
  variant: 'default' as TabsVariant,
  size: 'default' as UiSize,
  disabled: false,
  loop: true,
  orientation: 'horizontal' as 'horizontal' | 'vertical',
});
export type TabsProps = React.ComponentProps<typeof TabsPrimitive.Root> & {
  variant?: TabsVariant;
  size?: UiSize;
  disabled?: boolean;
  loop?: boolean;
};
export function Tabs({
  variant = 'default',
  size,
  disabled = false,
  loop = true,
  orientation = 'horizontal',
  children,
  ...props
}: TabsProps) {
  const density = useSize();
  return (
    <TabsContext value={{ variant, size: size ?? density, disabled, loop, orientation }}>
      <TabsPrimitive.Root data-slot="tabs" orientation={orientation} {...props}>
        {children}
      </TabsPrimitive.Root>
    </TabsContext>
  );
}
export function TabsList({
  ref,
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const context = React.useContext(TabsContext);
  const root = React.useRef<HTMLDivElement>(null);
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      ref={(node) => {
        root.current = node;
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
      loop={context.loop}
      className={cn(
        'relative isolate inline-flex max-w-full items-center gap-0.5 select-none',
        context.variant === 'default'
          ? 'rounded-(--radius-medium) bg-muted/40'
          : 'max-w-full overflow-x-auto px-1',
        className,
      )}
      {...props}
    >
      <ChoiceHighlight
        containerRef={root}
        selector="[role=tab]"
        selectedSelector="[data-state=active]"
        variant={context.variant}
        axis={context.orientation === 'horizontal' ? 'x' : 'y'}
      />
      {children}
    </TabsPrimitive.List>
  );
}
export function TabsTrigger({
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const context = React.useContext(TabsContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-size={context.size}
      data-variant={context.variant}
      disabled={disabled || context.disabled}
      className={cn(
        'type-caption relative z-10 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-(--radius-medium) border-0 bg-transparent px-3 text-muted-foreground transition-colors duration-spring-fast ease-spring-fast disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
        context.size === 'compact' ? 'h-(--control-height-compact)' : 'h-(--control-height-medium)',
        'data-[state=active]:text-foreground data-[proximity-active=true]:text-foreground',
        context.variant === 'underline' &&
          'h-12 shrink-0 rounded-none border-b-2 border-transparent px-1 whitespace-nowrap hover:text-foreground data-[state=active]:border-foreground',
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content data-slot="tabs-content" className={cn('mt-3', className)} {...props} />
  );
}

// Preserve the source public barrel's namespace-style component names.
export { Tabs as Root, TabsList as List, TabsTrigger as Trigger, TabsContent as Content };
