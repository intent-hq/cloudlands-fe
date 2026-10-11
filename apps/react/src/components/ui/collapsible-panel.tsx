// Source: src/lib/components/ui/CollapsiblePanel.svelte.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CaretDown, type Icon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { slide, usePresence, usePresenceTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { store } from '@/store';
import { selectCollapsiblePanelCollapsed } from '@/store/ui-layout/ui-layout-selectors';
import {
  requestCollapsiblePanelCollapsed,
  setCollapsiblePanelCollapsed,
} from '../../../../../src/store/renderer/slices/ui-layout/ui-layout-slice';

export interface CollapsiblePanelProps {
  title: string;
  icon?: Icon;
  defaultCollapsed?: boolean;
  storageKey?: string;
  className?: string;
  headerClass?: string;
  contentClass?: string;
  showChevronOnHover?: boolean;
  showGradient?: boolean;
  headerActions?: ReactNode;
  children?: ReactNode;
}

const transition = (node: HTMLElement) => slide(node, { tier: 'moderate' }, { direction: 'both' });

function PanelContent({
  present,
  onExit,
  className,
  showGradient,
  children,
}: {
  present: boolean;
  onExit: () => void;
  className?: string;
  showGradient: boolean;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePresenceTransition(ref, present, onExit, transition);
  return (
    <div
      ref={ref}
      inert={!present}
      aria-hidden={!present || undefined}
      className={cn('relative z-0 flex min-h-0 w-full flex-1 flex-col overflow-hidden', className)}
    >
      {showGradient && (
        <div
          className="pointer-events-none absolute -top-2 right-0 left-0 z-10 h-2 bg-gradient-to-b from-sidebar to-transparent"
          aria-hidden="true"
        />
      )}
      {children}
      {showGradient && (
        <div
          className="pointer-events-none absolute right-0 -bottom-2 left-0 z-10 h-2 bg-gradient-to-t from-sidebar to-transparent"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export function CollapsiblePanel({
  title,
  icon: PanelIcon,
  defaultCollapsed = false,
  storageKey,
  className,
  headerClass,
  contentClass,
  showChevronOnHover = true,
  showGradient = true,
  headerActions,
  children,
}: CollapsiblePanelProps) {
  // The source binds its selector and hydration request once per mounted panel.
  const [initialStorageKey] = useState(storageKey);
  const persistedCollapsed = selectCollapsiblePanelCollapsed(initialStorageKey ?? '').value;
  const [state, setState] = useState(() => ({
    collapsed: persistedCollapsed ?? defaultCollapsed,
    appliedPersistedCollapsed: persistedCollapsed,
  }));
  let collapsed = state.collapsed;
  if (persistedCollapsed !== undefined && persistedCollapsed !== state.appliedPersistedCollapsed) {
    collapsed = persistedCollapsed;
    setState({ collapsed, appliedPersistedCollapsed: persistedCollapsed });
  }
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    if (initialStorageKey) store.dispatch(requestCollapsiblePanelCollapsed(initialStorageKey));
  }, [initialStorageKey]);

  const items = useMemo(() => (collapsed ? [] : ['content']), [collapsed]);
  const { entries, remove } = usePresence(items, (key) => key);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setState((current) => ({ ...current, collapsed: next }));
    if (storageKey) store.dispatch(setCollapsiblePanelCollapsed(storageKey, next));
  };

  return (
    <div className={cn('flex h-full w-full flex-col', className)}>
      <Button
        variant="plain"
        type="button"
        className={cn(
          'relative z-10 w-full cursor-pointer px-3.5 pt-[0.9rem] text-left',
          headerClass,
        )}
        onClick={toggleCollapsed}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        aria-expanded={!collapsed}
      >
        <div className="relative flex flex-1 items-center gap-2">
          <div className="flex flex-1 items-center gap-2">
            {PanelIcon && (
              <PanelIcon size="0.875em" aria-hidden="true" className="text-ghost opacity-30" />
            )}
            <h3 className="m-0 text-sm font-medium">{title}</h3>
            <div
              className={cn(
                'mt-[2px] text-subtle transition-[opacity,transform] duration-spring-moderate ease-spring-moderate motion-reduce:transition-none',
                !hovering && showChevronOnHover ? 'opacity-0' : 'opacity-100',
                collapsed && 'rotate-90',
              )}
            >
              <CaretDown size="0.75em" aria-hidden="true" />
            </div>
          </div>
          {headerActions}
        </div>
      </Button>
      {entries.map(({ key, present }) => (
        <PanelContent
          key={key}
          present={present}
          onExit={() => remove(key)}
          className={contentClass}
          showGradient={showGradient}
        >
          {children}
        </PanelContent>
      ))}
    </div>
  );
}
