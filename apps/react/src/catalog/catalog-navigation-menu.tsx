// The fixed, expanded branch of the reference Sidebar composition used by CatalogShell.
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createProximityHover, useProximityHover, type ProximityHover } from '@/lib/interaction';
import { CatalogNavigationHighlight } from './catalog-navigation-highlight';
import { CatalogLink } from './catalog-link';
import type { CatalogNavEntry } from './catalog-navigation';

export function CatalogNavigationMenu({
  entries,
  activePath,
  density,
}: {
  entries: readonly CatalogNavEntry[];
  activePath: string;
  density: 'default' | 'compact';
}) {
  const root = useRef<HTMLUListElement>(null);
  const selected = entries.findIndex(
    (entry) =>
      entry.href === activePath ||
      (entry.href !== '/sandbox' && activePath.startsWith(`${entry.href}/`)),
  );
  const [focused, setFocused] = useState<number | null>(null);
  const [hover, setHover] = useState<ProximityHover | null>(null);
  useProximityHover(hover);
  const hovered = hover?.activeIndex ?? null;
  const rects = hover?.itemRects ?? [];
  const preferred = focused ?? (selected >= 0 ? selected : 0);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const instance = createProximityHover(node);
    // CatalogShell's source MenuButton child anchors do not bind the button ref,
    // so they do not register row geometry or render proximity overlays. Keep
    // the menu's focus bookkeeping without adding overlays absent from that path.
    setHover(instance);
    return () => instance.destroy();
  }, [entries, density]);

  function handleKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key))
      return;
    const buttons = Array.from(
      root.current?.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]') ?? [],
    );
    const current = buttons.indexOf(event.target as HTMLElement);
    if (current < 0 || !buttons.length) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + delta + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  function highlight(index: number | null, kind: 'active' | 'hover' | 'focus') {
    const rect = index === null ? undefined : rects[index];
    return (
      <CatalogNavigationHighlight
        rect={rect}
        identity={index}
        kind={kind}
        initialRect={kind === 'hover' && selected >= 0 ? rects[selected] : undefined}
      />
    );
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Delegates the source sidebar roving keyboard and proximity behavior to its real anchor children.
    <ul
      ref={root}
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className="relative flex w-full min-w-0 select-none flex-col gap-0.5 p-1"
      onKeyDown={handleKeyDown}
      onPointerDown={() => setFocused(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(null);
          hover?.setActiveIndex(null);
        }
      }}
    >
      {highlight(selected >= 0 ? selected : null, 'active')}
      {highlight(hovered, 'hover')}
      {highlight(focused, 'focus')}
      {entries.map((entry, index) => (
        <li
          key={entry.slug}
          data-slot="sidebar-menu-item"
          data-sidebar="menu-item"
          className="group/menu-item relative z-10"
        >
          <CatalogLink
            href={entry.href}
            data-slot="sidebar-menu-button"
            data-sidebar="menu-button"
            data-sidebar-index={index}
            data-size={density === 'compact' ? 'sm' : 'default'}
            data-active={index === selected}
            data-proximity-active={index === hovered}
            aria-current={index === selected ? 'page' : undefined}
            tabIndex={index === preferred ? 0 : -1}
            onFocus={(event) => {
              hover?.setActiveIndex(index);
              setFocused(event.target.matches(':focus-visible') ? index : null);
            }}
            style={{ '--row-gutter': '8px', '--row-gutter-hover': '8px' } as CSSProperties}
            className={`catalog-nav-link peer/menu-button relative z-10 flex w-full cursor-pointer select-none items-center gap-2 overflow-hidden rounded-md pl-2 pr-(--row-gutter) text-left transition-[padding] duration-spring-fast ease-spring-fast focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus-ring focus-visible:shadow-none motion-reduce:transition-none type-caption font-normal ${density === 'compact' ? 'h-(--control-height-compact)' : 'min-h-(--control-height-small) justify-start rounded-(--radius-row) px-2 py-1'}`}
          >
            {entry.name}
          </CatalogLink>
        </li>
      ))}
    </ul>
  );
}
