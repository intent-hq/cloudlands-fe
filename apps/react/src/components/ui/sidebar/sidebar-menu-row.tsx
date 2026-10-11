// Source: sidebar-menu-item.svelte, sidebar-menu-sub-item.svelte and sidebar-menu-sub.svelte.
import {
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { useAnimatedHeight } from '@/lib/motion';
import { cn } from '@/lib/utils';
import {
  SidebarMenuContext,
  SidebarMenuLevelContext,
  SidebarMenuRowContext,
  SidebarMenuVisibleContext,
} from './sidebar-menu-context';

function MenuRow({ sub, className, children, ...props }: ComponentProps<'li'> & { sub: boolean }) {
  const menu = useContext(SidebarMenuContext);
  const level = useContext(SidebarMenuLevelContext);
  const [index] = useState(() => menu?.claimIndex(level) ?? -1);
  const [actions, setActions] = useState<ReadonlyMap<symbol, boolean>>(new Map());
  const [hasBadge, setHasBadge] = useState(false);
  const registerAction = useCallback((showOnHover: boolean) => {
    const key = Symbol();
    setActions((previous) => new Map(previous).set(key, showOnHover));
    return () =>
      setActions((previous) => {
        const next = new Map(previous);
        next.delete(key);
        return next;
      });
  }, []);
  const context = useMemo(
    () => ({
      index,
      level,
      isSubRow: sub,
      actionCount: actions.size,
      actionsShowOnHover: [...actions.values()].some(Boolean),
      hasBadge,
      registerAction,
      setHasBadge,
    }),
    [index, level, sub, actions, hasBadge, registerAction],
  );
  return (
    <SidebarMenuRowContext value={context}>
      <li
        {...props}
        data-slot={sub ? 'sidebar-menu-sub-item' : 'sidebar-menu-item'}
        data-sidebar={sub ? 'menu-sub-item' : 'menu-item'}
        className={cn(
          sub ? 'group/menu-sub-item relative z-10' : 'group/menu-item relative z-10',
          className,
        )}
      >
        {children}
      </li>
    </SidebarMenuRowContext>
  );
}
export function SidebarMenuItem(props: ComponentProps<'li'>) {
  return <MenuRow {...props} sub={false} />;
}
export function SidebarMenuSubItem(props: ComponentProps<'li'>) {
  return <MenuRow {...props} sub />;
}
export function SidebarMenuSub({
  className,
  open = true,
  children,
  ...props
}: ComponentProps<'ul'> & { open?: boolean }) {
  const menu = useContext(SidebarMenuContext);
  const parentVisible = useContext(SidebarMenuVisibleContext);
  const level = useId();
  const root = useRef<HTMLDivElement>(null);
  useAnimatedHeight(root, open);
  const refresh = menu?.refresh;
  useLayoutEffect(() => refresh?.(), [open, refresh]);
  return (
    <SidebarMenuLevelContext value={level}>
      <SidebarMenuVisibleContext value={parentVisible && open}>
        <div
          ref={root}
          aria-hidden={!open || undefined}
          inert={!open}
          className="will-change-[height]"
        >
          <ul
            {...props}
            data-slot="sidebar-menu-sub"
            data-sidebar="menu-sub"
            data-state={open ? 'open' : 'closed'}
            className={cn(
              'border-border relative ml-4 flex min-w-0 flex-col gap-0.5 border-l pl-2',
              className,
            )}
          >
            {children}
          </ul>
        </div>
      </SidebarMenuVisibleContext>
    </SidebarMenuLevelContext>
  );
}
