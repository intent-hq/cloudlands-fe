// Source: sidebar-menu.svelte and sidebar-menu-context.ts.
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { createProximityHover, useProximityHover, type ProximityHover } from '@/lib/interaction';
import { usePresence } from '@/lib/motion';
import { SizeProvider, useSize, type UiSize } from '@/components/ui/size-context';
import { cn } from '@/lib/utils';
import { OPTION_LIST_CONTAINER_CLASS } from '$lib/styles/option-list-row';
import { SidebarMenuContext, SidebarMenuLevelContext } from './sidebar-menu-context';
import { SidebarMenuHighlight } from './sidebar-menu-highlight';

const rowSelector = '[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"]';
export function SidebarMenu({
  ref,
  className,
  size,
  children,
  onFocus,
  onBlur,
  onPointerDown,
  onKeyDown,
  ...props
}: ComponentProps<'ul'> & { size?: UiSize }) {
  const contextualSize = useSize();
  const root = useRef<HTMLUListElement>(null);
  const hoverRef = useRef<ProximityHover | null>(null);
  const [hover, setHover] = useState<ProximityHover | null>(null);
  useProximityHover(hover);
  const [activeIndexes, setActiveIndexes] = useState<ReadonlyMap<string, number>>(new Map());
  const [focusIndex, setFocus] = useState<number | null>(null);
  const [focusVisible, setFocusVisible] = useState(false);
  const [registered, setRegistered] = useState<ReadonlyMap<number, { level: string }>>(new Map());
  const levels = useMemo(
    () => new Map([...registered].map(([index, entry]) => [index, entry.level])),
    [registered],
  );
  const elements = useRef(new Map<number, HTMLElement>());
  const nextIndex = useRef(0);
  const claimIndex = useCallback(() => nextIndex.current++, []);
  const registerElement = useCallback(
    (index: number, element: HTMLElement | null, level = 'root') => {
      const previous = elements.current.get(index);
      if (element === previous || (!element && !previous)) return;
      if (element) elements.current.set(index, element);
      else elements.current.delete(index);
      hoverRef.current?.registerItem(index, element);
      setRegistered((previous) => {
        const next = new Map(previous);
        if (element) next.set(index, { level });
        else next.delete(index);
        return next;
      });
    },
    [],
  );
  const setActive = useCallback(
    (index: number, level: string, active: boolean) =>
      setActiveIndexes((previous) => {
        if (active ? previous.get(level) === index : previous.get(level) !== index) return previous;
        const next = new Map(previous);
        if (active) next.set(level, index);
        else next.delete(level);
        return next;
      }),
    [],
  );
  const refresh = useCallback(() => hoverRef.current?.measure(), []);
  useLayoutEffect(() => {
    if (!root.current) return;
    const instance = createProximityHover(root.current);
    hoverRef.current = instance;
    setHover(instance);
    for (const [index, element] of elements.current) instance.registerItem(index, element);
    return () => {
      instance.destroy();
      hoverRef.current = null;
    };
  }, []);
  const visibleButtons = () =>
    Array.from(root.current?.querySelectorAll<HTMLElement>(rowSelector) ?? []).filter(
      (button) =>
        !button.closest('[inert],[hidden]') && !button.matches(':disabled,[aria-disabled="true"]'),
    );
  const registeredIndexes = [...registered.keys()];
  const preferredIndex =
    [focusIndex, ...[...activeIndexes.values()].reverse(), ...registeredIndexes].find(
      (index) => index !== null && registered.has(index),
    ) ?? null;
  const context = useMemo(
    () => ({
      hover,
      activeIndexes,
      focusIndex,
      preferredIndex,
      levels,
      claimIndex,
      registerElement,
      setActive,
      setFocus,
      refresh,
    }),
    [
      hover,
      activeIndexes,
      focusIndex,
      preferredIndex,
      claimIndex,
      registerElement,
      setActive,
      refresh,
      levels,
    ],
  );
  const activeRects = [...activeIndexes.entries()].flatMap(([level, index]) =>
    hover?.itemRects[index] ? [{ level, index, rect: hover.itemRects[index]! }] : [],
  );
  const hoverIndex = hover?.activeIndex ?? null;
  const hoverRect = hoverIndex === null ? undefined : hover?.itemRects[hoverIndex];
  const anchorIndex =
    hoverIndex === null ? undefined : activeIndexes.get(levels.get(hoverIndex) ?? 'root');
  const anchor = anchorIndex === undefined ? activeRects[0]?.rect : hover?.itemRects[anchorIndex];
  const hoverItems = useMemo(
    () =>
      hoverRect && hoverIndex !== null
        ? [{ id: hover?.sessionId ?? 0, rect: hoverRect, index: hoverIndex, anchor }]
        : [],
    [hoverRect, hoverIndex, hover?.sessionId, anchor],
  );
  const hoverPresence = usePresence(hoverItems, (item) => item.id);
  const focusRect = focusIndex === null || !focusVisible ? undefined : hover?.itemRects[focusIndex];
  const focusItems = useMemo(
    () => (focusRect && focusIndex !== null ? [{ rect: focusRect, index: focusIndex }] : []),
    [focusRect, focusIndex],
  );
  const focusPresence = usePresence(focusItems, () => 'focus');
  return (
    <SidebarMenuContext value={context}>
      <SidebarMenuLevelContext value="root">
        <SizeProvider size={size ?? contextualSize}>
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Delegates navigation from row controls; this list is not focusable. */}
          <ul
            {...props}
            ref={(node) => {
              root.current = node;
              if (typeof ref === 'function') return ref(node);
              if (ref) ref.current = node;
            }}
            data-slot="sidebar-menu"
            data-sidebar="menu"
            className={cn(
              OPTION_LIST_CONTAINER_CLASS,
              'relative flex w-full min-w-0 select-none flex-col gap-0.5',
              className,
            )}
            onFocus={(event) => {
              onFocus?.(event);
              const target = event.target;
              if (!target.matches(rowSelector)) return;
              const index = Number(target.dataset.sidebarIndex);
              if (!Number.isInteger(index)) return;
              hover?.setActiveIndex(index);
              setFocus(index);
              setFocusVisible(target.matches(':focus-visible'));
            }}
            onBlur={(event) => {
              onBlur?.(event);
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setFocus(null);
              setFocusVisible(false);
              hover?.setActiveIndex(null);
            }}
            onPointerDown={(event) => {
              onPointerDown?.(event);
              setFocus(null);
              setFocusVisible(false);
            }}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              if (
                event.defaultPrevented ||
                !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(
                  event.key,
                )
              )
                return;
              const buttons = visibleButtons();
              const current = buttons.indexOf(event.target as HTMLElement);
              if (current < 0 || !buttons.length) return;
              event.preventDefault();
              event.stopPropagation();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (current +
                        (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }}
          >
            {activeRects.map((item) => (
              <SidebarMenuHighlight
                key={item.level}
                rect={item.rect}
                identity={item.index}
                kind="active"
              />
            ))}
            {hoverPresence.entries.map(({ key, value, present }) => (
              <SidebarMenuHighlight
                key={key}
                rect={value.rect}
                initialRect={value.anchor}
                identity={value.index}
                kind="hover"
                present={present}
                onExit={() => hoverPresence.remove(key)}
              />
            ))}
            {focusPresence.entries.map(({ key, value, present }) => (
              <SidebarMenuHighlight
                key={key}
                rect={value.rect}
                identity={value.index}
                kind="focus"
                present={present}
                onExit={() => focusPresence.remove(key)}
              />
            ))}
            {children}
          </ul>
        </SizeProvider>
      </SidebarMenuLevelContext>
    </SidebarMenuContext>
  );
}
