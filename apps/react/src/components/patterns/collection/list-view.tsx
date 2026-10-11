import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/patterns/screen';
import { LIST_STATE_GEOMETRY, type StateDensity } from '@/components/patterns/state-geometry';
import type { ListKey, ListRowContext, SelectionMode } from '@/components/patterns/collection';
import {
  ProximityHighlight,
  createProximityHover,
  useProximityHover,
  type ProximityHover,
} from '@/lib/interaction';
import { slide, usePresence, usePresenceTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';

export interface ListViewProps<T> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  items: readonly T[];
  row: (context: ListRowContext<T>) => ReactNode;
  getKey?: (item: T, index: number) => ListKey;
  getText?: (item: T, index: number) => string;
  selectable?: SelectionMode;
  selectedKeys?: ListKey[];
  selectionAppearance?: 'surface' | 'indicator';
  onSelectedKeysChange?: (keys: ListKey[]) => void;
  onActivate?: (item: T, index: number) => void;
  status?: 'ready' | 'loading' | 'error';
  empty?: ReactNode;
  loading?: ReactNode;
  error?: ReactNode;
  virtualize?: boolean | 'auto';
  animateRows?: boolean;
  rowHeight?: number;
  overscan?: number;
  stateDensity?: StateDensity;
  ariaLabel?: string;
}
const defaultKey = (_item: unknown, index: number) => index;
const noSelection: number[] = [];
const rowTransition = (node: HTMLElement) => slide(node, { tier: 'fast' }, { direction: 'both' });

/** Source: ListView.svelte. Selection remains controlled when selectedKeys is supplied. */
export function ListView<T>({
  status = 'ready',
  loading,
  error,
  empty,
  stateDensity = 'compact',
  ...props
}: ListViewProps<T>) {
  const [activeIndex, setActiveIndex] = useState(0);
  if (activeIndex >= props.items.length && activeIndex !== 0)
    setActiveIndex(Math.max(0, props.items.length - 1));
  const [localSelection, setLocalSelection] = useState<ListKey[]>([]);
  const selectedKeys = props.selectedKeys ?? localSelection;
  const changeSelection = (keys: ListKey[]) => {
    setLocalSelection(keys);
    props.onSelectedKeysChange?.(keys);
  };
  if (status === 'loading')
    return (
      loading ?? (
        <LoadingState
          recipe="list"
          count={3}
          label={m.ui_spinner_loading_ariaLabel()}
          density={
            props.rowHeight === LIST_STATE_GEOMETRY.compact.rowHeight ? 'compact' : 'default'
          }
          rowHeight={props.rowHeight ?? LIST_STATE_GEOMETRY.default.rowHeight}
          className={props.className}
        />
      )
    );
  if (status === 'error')
    return (
      error ?? (
        <ErrorState
          message={m.error_page_title()}
          density={stateDensity}
          className={props.className}
        />
      )
    );
  if (props.items.length === 0)
    return (
      empty ?? (
        <EmptyState
          description={m.ui_list_empty_label()}
          density={stateDensity}
          className={props.className}
          data-state-kind="empty"
        />
      )
    );
  return (
    <ReadyList
      {...props}
      activeIndex={activeIndex}
      setActiveIndex={setActiveIndex}
      selectedKeys={selectedKeys}
      onSelectedKeysChange={changeSelection}
    />
  );
}

type ReadyProps<T> = Omit<
  ListViewProps<T>,
  'status' | 'loading' | 'error' | 'empty' | 'stateDensity'
> & { activeIndex: number; setActiveIndex: Dispatch<SetStateAction<number>> };
function ReadyList<T>({
  activeIndex,
  setActiveIndex,
  items,
  row,
  getKey = defaultKey,
  getText,
  selectable = false,
  selectedKeys = noSelection,
  selectionAppearance = 'surface',
  onSelectedKeysChange,
  onActivate,
  virtualize = 'auto',
  animateRows = false,
  rowHeight = LIST_STATE_GEOMETRY.default.rowHeight,
  overscan = 4,
  ariaLabel,
  className,
  onScroll,
  ...props
}: ReadyProps<T>) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<ProximityHover | null>(null);
  useProximityHover(hover);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const typeahead = useRef({ value: '', at: 0 });
  const focusFrame = useRef<number | undefined>(undefined);
  const alive = useRef(false);
  const isVirtualized = virtualize === true || (virtualize === 'auto' && items.length > 200);
  const startIndex = isVirtualized ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan) : 0;
  const endIndex = isVirtualized
    ? Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
    : items.length;
  const visibleRows = useMemo(
    () =>
      items.slice(startIndex, endIndex).map((item, offset) => ({
        item,
        index: startIndex + offset,
        key: getKey(item, startIndex + offset),
      })),
    [items, startIndex, endIndex, getKey],
  );
  const animated = animateRows && !isVirtualized;
  const presence = usePresence(visibleRows, (entry) => entry.key, animated);
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedIndexes = useMemo(
    () => items.flatMap((item, index) => (selectedSet.has(getKey(item, index)) ? [index] : [])),
    [items, getKey, selectedSet],
  );

  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !isVirtualized) return;
    const measure = () => {
      setViewportHeight(element.clientHeight);
      setScrollTop(element.scrollTop);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isVirtualized]);
  useLayoutEffect(() => {
    if (!content.current) return;
    const instance = createProximityHover(content.current);
    setHover(instance);
    return () => instance.destroy();
  }, []);

  function toggleSelection(index: number) {
    if (!selectable) return;
    const key = getKey(items[index], index);
    if (selectable === 'single') {
      onSelectedKeysChange?.(selectedSet.has(key) ? [] : [key]);
      return;
    }
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedKeysChange?.([...next]);
  }
  function focusIndex(index: number) {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setActiveIndex(next);
    hover?.setActiveIndex(next);
    if (isVirtualized && viewport.current) {
      viewport.current.scrollTop = next * rowHeight;
      setScrollTop(viewport.current.scrollTop);
    }
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = undefined;
      if (alive.current)
        content.current?.querySelector<HTMLElement>(`[data-list-index="${next}"]`)?.focus();
    });
  }
  function handleKeydown(event: KeyboardEvent<HTMLDivElement>, item: T, index: number) {
    if (isNestedControl(event)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusIndex(index + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusIndex(event.key === 'Home' ? 0 : items.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleSelection(index);
      onActivate?.(item, index);
      return;
    }
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    const now = event.timeStamp;
    typeahead.current = {
      value: now - typeahead.current.at > 500 ? event.key : typeahead.current.value + event.key,
      at: now,
    };
    const query = typeahead.current.value.toLocaleLowerCase();
    for (let offset = 1; offset <= items.length; offset += 1) {
      const candidate = (index + offset) % items.length;
      if (
        (getText?.(items[candidate], candidate) ?? String(getKey(items[candidate], candidate)))
          .toLocaleLowerCase()
          .startsWith(query)
      ) {
        event.preventDefault();
        focusIndex(candidate);
        break;
      }
    }
  }
  return (
    <div
      ref={viewport}
      data-slot="list-view"
      data-virtualized={isVirtualized || undefined}
      className={cn('min-w-0 overflow-auto', className)}
      role={selectable ? 'listbox' : 'list'}
      aria-label={ariaLabel}
      aria-multiselectable={selectable === 'multi' || undefined}
      onScroll={(event) => {
        setScrollTop(event.currentTarget.scrollTop);
        hover?.measure();
        onScroll?.(event);
      }}
      {...props}
    >
      <div
        ref={content}
        className="relative min-w-0"
        style={{ height: isVirtualized ? items.length * rowHeight : undefined }}
      >
        {hover && (
          <ProximityHighlight
            store={hover}
            selectedIndexes={selectionAppearance === 'surface' ? selectedIndexes : noSelection}
          />
        )}
        <div
          style={{
            transform: isVirtualized ? `translateY(${startIndex * rowHeight}px)` : undefined,
          }}
        >
          {presence.entries.map(({ key, value: { item, index }, present }) => (
            <ListItem
              key={key}
              hover={hover}
              index={index}
              present={present}
              animate={animated}
              onExit={() => presence.remove(key)}
              container={content}
              onFocusRemoved={() => {
                if (alive.current && !isVirtualized) focusIndex(index);
              }}
              className={cn(
                'group/collection-row relative z-10 min-w-0 rounded-(--radius-row) focus-visible:-outline-offset-1 has-[>[data-inset=card]]:mx-2 [&>[data-inset=card]]:mx-0',
                (selectable || onActivate) && 'cursor-pointer',
              )}
              role={selectable ? 'option' : 'listitem'}
              aria-selected={selectable ? selectedSet.has(key as ListKey) : undefined}
              tabIndex={present && index === Math.min(activeIndex, items.length - 1) ? 0 : -1}
              onClick={(event) => {
                if (!present || isNestedControl(event)) return;
                setActiveIndex(index);
                hover?.setActiveIndex(index);
                toggleSelection(index);
                onActivate?.(item, index);
              }}
              onFocus={() => {
                setActiveIndex(index);
                hover?.setActiveIndex(index);
              }}
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget) &&
                  hover?.activeIndex === index
                )
                  hover.setActiveIndex(null);
              }}
              onKeyDown={(event) => {
                if (present) handleKeydown(event, item, index);
              }}
            >
              {row({
                item,
                index,
                selected: selectedSet.has(key as ListKey),
                highlighted: hover?.activeIndex === index,
              })}
            </ListItem>
          ))}
        </div>
      </div>
    </div>
  );
}

function isNestedControl(
  event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>,
): boolean {
  const target = event.target as Element | null;
  const control = target?.closest(
    'button,a,input,select,textarea,[role="button"],[role="menuitem"]',
  );
  return Boolean(control && control !== event.currentTarget);
}

function ListItem({
  hover,
  index,
  present,
  animate,
  onExit,
  onFocusRemoved,
  container,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  hover: ProximityHover | null;
  index: number;
  present: boolean;
  animate: boolean;
  onExit: () => void;
  onFocusRemoved: () => void;
  container: RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const focusWithin = useRef(false);
  const restoreFocus = useRef(onFocusRemoved);
  useLayoutEffect(() => {
    restoreFocus.current = onFocusRemoved;
  }, [onFocusRemoved]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !hover || !present) return;
    hover.registerItem(index, node);
    return () => hover.registerItem(index, null);
  }, [hover, index, present]);
  useLayoutEffect(() => {
    const node = ref.current;
    const containerNode = container.current;
    return () => {
      if (node?.contains(node.ownerDocument.activeElement) && containerNode?.isConnected)
        restoreFocus.current();
    };
  }, [container]);
  useLayoutEffect(() => {
    // Making an outgoing row inert can clear activeElement before its outro ends.
    if (!present && focusWithin.current) {
      focusWithin.current = false;
      restoreFocus.current();
    }
  }, [present]);
  usePresenceTransition(ref, present, onExit, rowTransition, animate);
  return (
    <div
      ref={ref}
      data-slot="list-view-item"
      data-list-index={present ? index : undefined}
      data-highlighted={(present && hover?.activeIndex === index) || undefined}
      inert={!present}
      {...props}
      onFocusCapture={(event) => {
        focusWithin.current = true;
        props.onFocusCapture?.(event);
      }}
      onBlurCapture={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          (present || event.relatedTarget !== null)
        )
          focusWithin.current = false;
        props.onBlurCapture?.(event);
      }}
    />
  );
}
