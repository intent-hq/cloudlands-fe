import { useEffect, useRef, useState, type Key, type ReactNode } from 'react';

export interface VirtualListProps<T> {
  items?: readonly T[];
  itemHeight?: number;
  containerHeight?: number;
  overscan?: number;
  getKey?: (item: T, index: number) => Key;
  children?: (row: { item: T; index: number }) => ReactNode;
}

/** Source: VirtualList.svelte. This inner scroll container owns the viewport. */
export function VirtualList<T>({
  items = [],
  itemHeight = 50,
  containerHeight = 400,
  overscan = 3,
  getKey = (_, index) => index,
  children,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const frame = useRef<number | undefined>(undefined);
  const safeItems = Array.isArray(items) ? items : [];
  const visibleCount = Math.ceil(containerHeight / itemHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(safeItems.length, startIndex + visibleCount + overscan * 2);

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return (
    <div className="relative overflow-hidden" style={{ height: containerHeight }}>
      <div
        className="virtual-list-scroll h-full overflow-y-auto overflow-x-hidden"
        onScroll={(event) => {
          if (frame.current !== undefined) cancelAnimationFrame(frame.current);
          const target = event.currentTarget;
          frame.current = requestAnimationFrame(() => {
            frame.current = undefined;
            setScrollTop(target.scrollTop);
          });
        }}
      >
        <div className="relative" style={{ height: safeItems.length * itemHeight }}>
          <div
            className="absolute top-0 left-0 right-0"
            style={{ transform: `translateY(${startIndex * itemHeight}px)` }}
          >
            {safeItems.slice(startIndex, endIndex).map((item, index) => (
              <div
                key={getKey(item, startIndex + index)}
                className="flex items-center box-border"
                style={{ height: itemHeight }}
                data-index={startIndex + index}
              >
                {children?.({ item, index: startIndex + index })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
