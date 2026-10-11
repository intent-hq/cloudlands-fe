import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type FocusEventHandler,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import { Portal } from '@/components/ui/portal';
import {
  clampSurface,
  SurfaceProvider,
  surfaceClasses,
  useSurface,
} from '@/components/ui/surface-context';
import { crispOut, springIn, usePresence, usePresenceTransition } from '@/lib/motion';
import { scheduleLayoutRead, type CancelLayoutTask } from '$lib/utils/layout-phases';
import { cn } from '@/lib/utils';

export interface HoverCardProps {
  id?: string;
  anchor: string;
  position?: 'right' | 'bottom' | 'bottom-right' | 'bottom-left' | 'top';
  absolute?: boolean;
  anchorElement?: HTMLElement | null;
  staticPosition?: boolean;
  className?: string;
  children?: ReactNode;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
  onFocus?: FocusEventHandler<HTMLDivElement>;
  onBlur?: FocusEventHandler<HTMLDivElement>;
  /** Keep the component mounted and drive this flag to retain the source exit transition. */
  open?: boolean;
}

/** A positioned surface; the caller owns trigger hover, focus, and dismissal policy. */
export function HoverCard({ open = true, ...props }: HoverCardProps) {
  const items = useMemo(() => (open ? ['card'] : []), [open]);
  const presence = usePresence(items, (key) => key);
  const surface = clampSurface(useSurface() + 2);
  return (
    <SurfaceProvider level={surface}>
      {presence.entries.map(({ key, present }) => {
        const card = (
          <CardSurface {...props} present={present} onExit={() => presence.remove(key)} />
        );
        return props.staticPosition || props.absolute ? (
          <Fragment key={key}>{card}</Fragment>
        ) : (
          <Portal key={key} zIndex={50}>
            {card}
          </Portal>
        );
      })}
    </SurfaceProvider>
  );
}

const COLLISION_PADDING = 8;
const SIDE_OFFSET = 4;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function CardSurface({
  id,
  anchor,
  position = 'right',
  absolute = false,
  anchorElement = null,
  staticPosition = false,
  className = '',
  children,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  present,
  onExit,
}: Omit<HoverCardProps, 'open'> & { present: boolean; onExit: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const surface = useSurface();
  const isBottom = position === 'bottom-right' || position === 'bottom-left';
  const isTop = position === 'top';

  useLayoutEffect(() => {
    if (staticPosition || absolute || !card.current) return;
    const element = card.current;
    const document = element.ownerDocument;
    const view = document.defaultView;
    if (!view) return;
    let cachedTrigger: HTMLElement | null = null;
    let observedTrigger: HTMLElement | null = null;
    let pending: CancelLayoutTask | null = null;
    let observer: ResizeObserver | undefined;

    const isCachedTriggerValid = () =>
      cachedTrigger?.isConnected &&
      (cachedTrigger.style.getPropertyValue('anchor-name').includes(anchor) ||
        view.getComputedStyle(cachedTrigger).getPropertyValue('anchor-name').includes(anchor));

    const findAnchorElement = () => {
      if (anchorElement) return anchorElement;
      if (isCachedTriggerValid()) return cachedTrigger;
      cachedTrigger =
        Array.from(document.querySelectorAll<HTMLElement>('[style*="anchor-name"]')).find(
          (node) =>
            node.style.getPropertyValue('anchor-name').includes(anchor) ||
            view.getComputedStyle(node).getPropertyValue('anchor-name').includes(anchor),
        ) ?? null;
      return cachedTrigger;
    };

    const updateMeasuredPosition = () => {
      const trigger = findAnchorElement();
      if (!trigger) return;
      if (observer && observedTrigger !== trigger) {
        if (observedTrigger) observer.unobserve(observedTrigger);
        observer.observe(trigger);
        observedTrigger = trigger;
      }
      const triggerRect = trigger.getBoundingClientRect();
      const cardRect = element.getBoundingClientRect();
      const viewportWidth = view.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = view.innerHeight || document.documentElement.clientHeight;
      const cardWidth = cardRect.width || element.offsetWidth;
      const cardHeight = cardRect.height || element.offsetHeight;
      const spaceAbove = Math.max(0, triggerRect.top - SIDE_OFFSET - COLLISION_PADDING);
      const spaceBelow = Math.max(
        0,
        viewportHeight - triggerRect.bottom - SIDE_OFFSET - COLLISION_PADDING,
      );
      const placeAbove = isTop
        ? !(spaceAbove < cardHeight && spaceBelow > spaceAbove)
        : isBottom && spaceBelow < cardHeight && spaceAbove > spaceBelow;
      let left = triggerRect.left;
      let top = triggerRect.bottom + SIDE_OFFSET;
      let availableHeight = placeAbove ? spaceAbove : spaceBelow;

      if (position === 'right') {
        const spaceLeft = triggerRect.left - SIDE_OFFSET - COLLISION_PADDING;
        const spaceRight = viewportWidth - triggerRect.right - SIDE_OFFSET - COLLISION_PADDING;
        const placeRight = spaceRight >= cardWidth || spaceRight >= spaceLeft;
        left = placeRight
          ? triggerRect.right + SIDE_OFFSET
          : triggerRect.left - cardWidth - SIDE_OFFSET;
        top = triggerRect.top;
        availableHeight = Math.max(0, viewportHeight - COLLISION_PADDING * 2);
      } else if (position === 'bottom') {
        left = triggerRect.left - cardWidth - SIDE_OFFSET;
        top = triggerRect.bottom - cardHeight;
      } else if (isTop || isBottom) {
        if (position === 'bottom-left') left = triggerRect.right - cardWidth;
        else if (isTop) left = triggerRect.left + triggerRect.width / 2 - cardWidth / 2;
        top = placeAbove
          ? triggerRect.top - Math.min(cardHeight, availableHeight) - SIDE_OFFSET
          : triggerRect.bottom + SIDE_OFFSET;
      }
      left = clamp(
        left,
        COLLISION_PADDING,
        Math.max(COLLISION_PADDING, viewportWidth - cardWidth - COLLISION_PADDING),
      );
      top = clamp(
        top,
        COLLISION_PADDING,
        Math.max(
          COLLISION_PADDING,
          viewportHeight - Math.min(cardHeight, availableHeight) - COLLISION_PADDING,
        ),
      );
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.maxHeight = `${availableHeight}px`;
    };
    const requestMeasuredPositionUpdate = () => {
      if (pending) return;
      pending = scheduleLayoutRead(() => {
        pending = null;
        updateMeasuredPosition();
      });
    };
    const handleScroll = (event: Event) => {
      const trigger = anchorElement ?? (isCachedTriggerValid() ? cachedTrigger : null);
      if (trigger && event.target instanceof Node && !event.target.contains(trigger)) return;
      requestMeasuredPositionUpdate();
    };
    if (typeof ResizeObserver !== 'undefined')
      observer = new ResizeObserver(requestMeasuredPositionUpdate);
    // Measure before the intro is applied, so the first paint already has its position.
    updateMeasuredPosition();
    observer?.observe(element);
    view.addEventListener('resize', requestMeasuredPositionUpdate);
    view.addEventListener('scroll', handleScroll, true);
    return () => {
      observer?.disconnect();
      pending?.();
      view.removeEventListener('resize', requestMeasuredPositionUpdate);
      view.removeEventListener('scroll', handleScroll, true);
    };
  }, [anchor, anchorElement, absolute, staticPosition, position, isBottom, isTop]);

  const transition = useCallback(
    (node: HTMLElement) => {
      const offset =
        position === 'right'
          ? { x: -4, y: 0 }
          : position === 'bottom'
            ? { x: 4, y: 0 }
            : isTop
              ? { x: 0, y: 4 }
              : { x: 0, y: -4 };
      // Capture natural styles before either direction writes its animated properties.
      const enter = springIn(node, { tier: 'fast', ...offset, scale: 0.96 });
      const exit = crispOut(node, { tier: 'fast' });
      return ({ direction = 'in' }: { direction?: 'in' | 'out' } = {}) =>
        direction === 'in' ? enter : exit;
    },
    [position, isTop],
  );
  usePresenceTransition(card, present, onExit, transition, !staticPosition);

  const style: CSSProperties | undefined =
    absolute && !staticPosition
      ? {
          positionAnchor: anchor,
          right: position === 'bottom' ? 'anchor(left)' : undefined,
          left:
            position === 'right'
              ? 'anchor(right)'
              : isBottom
                ? 'anchor(left)'
                : isTop
                  ? 'anchor(center)'
                  : undefined,
          top: position === 'right' ? 'anchor(top)' : isBottom ? 'anchor(bottom)' : undefined,
          bottom: position === 'bottom' ? 'anchor(bottom)' : isTop ? 'anchor(top)' : undefined,
          marginRight: position === 'bottom' ? 8 : undefined,
          marginLeft: position === 'right' ? 8 : undefined,
          marginTop: isBottom ? 4 : undefined,
          marginBottom: isTop ? 4 : undefined,
          translate: isTop ? '-50% 0' : undefined,
        }
      : undefined;

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Preserve caller-owned hover continuity and bubbling focus tracking without making the tooltip a button.
    <div
      ref={card}
      id={id}
      className={cn(
        staticPosition ? 'relative' : absolute ? 'absolute' : 'fixed',
        'z-50 w-64 flex flex-col border border-border',
        absolute && !staticPosition ? 'pointer-events-none' : 'overflow-y-auto pointer-events-auto',
        surfaceClasses(surface),
        className,
      )}
      data-static-position={staticPosition ? '' : undefined}
      data-surface-level={surface}
      role="tooltip"
      style={style}
      onMouseEnter={staticPosition ? undefined : onMouseEnter}
      onMouseLeave={staticPosition ? undefined : onMouseLeave}
      onFocus={staticPosition ? undefined : onFocus}
      onBlur={staticPosition ? undefined : onBlur}
    >
      {children}
    </div>
  );
}
