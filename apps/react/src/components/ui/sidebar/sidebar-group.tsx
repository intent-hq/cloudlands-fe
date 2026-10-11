// Source: sidebar-group{,-label,-content,-action,-actions}.svelte and sidebar-group-context.svelte.ts.
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { Slot } from 'radix-ui';
import { CaretDown } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { useAnimatedHeight } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface GroupState {
  collapsible: boolean;
  open: boolean;
  actionCount: number;
  toggle(): void;
  registerAction(): () => void;
}
const GroupContext = createContext<GroupState | null>(null);
const GroupActionsContext = createContext(false);
export type SidebarGroupProps = ComponentProps<'div'> & {
  collapsible?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};
export function SidebarGroup({
  className,
  collapsible = false,
  open: controlled,
  defaultOpen = true,
  onOpenChange,
  children,
  ...props
}: SidebarGroupProps) {
  const [internal, setInternal] = useState(defaultOpen);
  const [actionCount, setActionCount] = useState(0);
  const open = controlled ?? internal;
  const registerAction = useCallback(() => {
    setActionCount((count) => count + 1);
    return () => setActionCount((count) => count - 1);
  }, []);
  const toggle = useCallback(() => {
    if (!collapsible) return;
    setInternal(!open);
    onOpenChange?.(!open);
  }, [collapsible, open, onOpenChange]);
  const value = useMemo(
    () => ({ collapsible, open, actionCount, toggle, registerAction }),
    [collapsible, open, actionCount, toggle, registerAction],
  );
  return (
    <GroupContext value={value}>
      <div
        {...props}
        data-slot="sidebar-group"
        data-sidebar="group"
        data-open={open}
        data-collapsible={collapsible}
        className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
      >
        {children}
      </div>
    </GroupContext>
  );
}
export function SidebarGroupLabel({
  className,
  style,
  children,
  asChild,
  ...props
}: ComponentProps<'div'> & { asChild?: boolean }) {
  const group = useContext(GroupContext);
  const classes = cn(
    'group/group-label text-muted-foreground flex h-(--control-height-medium) w-full shrink-0 items-center justify-start gap-2 rounded-md px-2 text-xs font-normal transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none focus-visible:outline focus-visible:-outline-offset-1 [&>svg]:size-4 [&>svg]:shrink-0',
    group && group.actionCount > 0 && 'pr-(--group-actions-pad)',
    className,
  );
  const merged = {
    ...props,
    className: classes,
    'data-slot': 'sidebar-group-label',
    'data-sidebar': 'group-label',
    style: {
      '--group-actions-pad': `${(group?.actionCount ?? 0) * 28 + 6}px`,
      ...style,
    } as CSSProperties,
  };
  if (asChild) return <Slot.Root {...merged}>{children as ReactElement}</Slot.Root>;
  if (!group?.collapsible) return <div {...merged}>{children}</div>;
  const { ref, ...buttonProps } = merged;
  return (
    <Button
      {...(buttonProps as ComponentProps<typeof Button>)}
      ref={ref as ComponentProps<typeof Button>['ref']}
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={group.open}
      onClick={group.toggle}
    >
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      <span
        aria-hidden="true"
        className={cn(
          'ml-auto flex h-6 shrink-0 items-center justify-center overflow-hidden transition-[width,opacity] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
          group.open
            ? 'w-0 opacity-0 group-hover/group-label:w-6 group-hover/group-label:opacity-100 group-focus/group-label:w-6 group-focus/group-label:opacity-100'
            : 'w-6 opacity-100',
        )}
      >
        <CaretDown />
      </span>
    </Button>
  );
}
export function SidebarGroupContent({ ref, className, children, ...props }: ComponentProps<'div'>) {
  const group = useContext(GroupContext);
  const root = useRef<HTMLDivElement>(null);
  const open = group?.open ?? true;
  useAnimatedHeight(root, open);
  return (
    <div
      {...props}
      ref={(node) => {
        root.current = node;
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn('type-body w-full will-change-[height]', className)}
      aria-hidden={!open || undefined}
      inert={!open}
    >
      <div>{children}</div>
    </div>
  );
}
export function SidebarGroupActions({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <GroupActionsContext value>
      <div
        {...props}
        data-slot="sidebar-group-actions"
        data-sidebar="group-actions"
        className={cn(
          'absolute right-3.5 top-2 z-10 flex h-(--control-height-medium) items-center gap-1',
          className,
        )}
      >
        {children}
      </div>
    </GroupActionsContext>
  );
}
export function SidebarGroupAction({ className, ...props }: ComponentProps<typeof Button>) {
  const group = useContext(GroupContext);
  const clustered = useContext(GroupActionsContext);
  const registerAction = group?.registerAction;
  useLayoutEffect(() => registerAction?.(), [registerAction]);
  return (
    <Button
      variant="ghost"
      size="icon-compact"
      {...props}
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        clustered
          ? 'relative flex size-6 items-center justify-center'
          : 'absolute right-3.5 top-3 flex size-6 items-center justify-center',
        'text-muted-foreground rounded-md p-0 hover:bg-hover hover:text-foreground transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none focus-visible:outline focus-visible:-outline-offset-1 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:[stroke-width:1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-spring-fast hover:[&_svg]:[stroke-width:2] after:absolute after:-inset-2 md:after:hidden group-data-[collapsible=icon]:hidden',
        className,
      )}
    />
  );
}
