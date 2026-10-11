// Source: src/lib/components/ui/smart-corner-tabs/SmartCornerTabs.svelte.
import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Spring, spring, prefersReducedMotion, onReducedMotionChange } from '@/lib/motion';
import { cn } from '@/lib/utils';
import {
  clampSurfaceGeometry,
  makeSurfacePath,
  type SurfaceGeometry,
} from './smart-corner-tabs-geometry';

export interface SmartCornerTab {
  id: string;
  label: string;
  disabled?: boolean;
}
export interface SmartCornerTabsProps {
  tabs: SmartCornerTab[];
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  panelId?: string;
  ariaLabel?: string;
  className?: string;
  children?: (tab: SmartCornerTab) => ReactNode;
}
export function SmartCornerTabs({
  tabs,
  activeTabId,
  onTabChange,
  panelId: suppliedPanelId,
  ariaLabel,
  className,
  children,
}: SmartCornerTabsProps) {
  const uid = useId();
  const panelId = suppliedPanelId ?? `smart-corner-tabpanel-${uid}`;
  const surfacePathId = `${panelId}-surface`;
  const [internalId, setInternalId] = useState(activeTabId ?? tabs[0]?.id ?? '');
  const activeId =
    activeTabId ?? (tabs.some((tab) => tab.id === internalId) ? internalId : (tabs[0]?.id ?? ''));
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const [visualId, setVisualId] = useState(activeId);
  const [geometry, setGeometry] = useState<SurfaceGeometry | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; width: number } | null>(null);
  const [pressOffset, setPressOffset] = useState(0);
  const [reduced, setReduced] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const surface = useRef<Spring<SurfaceGeometry> | null>(null);
  const press = useRef<Spring<number> | null>(null);
  const stopSurface = useRef<(() => void) | null>(null);
  const measure = useCallback(() => {
    const node = root.current,
      strip = list.current,
      button = buttons.current.get(activeId);
    if (!node || !strip || !button) return;
    const rootBox = node.getBoundingClientRect(),
      stripBox = strip.getBoundingClientRect(),
      tabBox = button.getBoundingClientRect();
    const scaleX = rootBox.width / node.offsetWidth || 1,
      scaleY = rootBox.height / node.offsetHeight || 1;
    const next = clampSurfaceGeometry({
      width: node.clientWidth,
      height: node.clientHeight,
      x: (tabBox.left - rootBox.left) / scaleX,
      tabWidth: tabBox.width / scaleX,
      topY: (stripBox.top - rootBox.top) / scaleY,
      panelY: (stripBox.bottom - rootBox.top) / scaleY,
      radius: 20,
      outerRadius: 20,
    });
    if (!surface.current) {
      const motion = new Spring(next, 'slow');
      surface.current = motion;
      stopSurface.current = motion.subscribe(() => setGeometry(motion.current));
      setGeometry(next);
    } else void surface.current.set(next);
  }, [activeId]);
  useLayoutEffect(() => {
    const motion = new Spring(0, 'fast');
    press.current = motion;
    const stop = motion.subscribe(() => setPressOffset(motion.current));
    const updateReduced = () => {
      const value = prefersReducedMotion();
      setReduced(value);
      if (value && surface.current)
        void surface.current.set(surface.current.target, { instant: true });
      if (value) void motion.set(motion.target, { instant: true });
    };
    updateReduced();
    const stopReduced = onReducedMotionChange(updateReduced);
    return () => {
      stop();
      stopReduced();
      motion.destroy();
      press.current = null;
      stopSurface.current?.();
      surface.current?.destroy();
      surface.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (reduced || prefersReducedMotion()) {
      return;
    }
    const timer = setTimeout(() => setVisualId(activeId), spring.moderate.settleMs);
    return () => clearTimeout(timer);
  }, [activeId, reduced]);
  useLayoutEffect(() => {
    let disposed = false;
    let frame: number | undefined;
    const schedule = () => {
      if (disposed || frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        measure();
      });
    };
    const observer = new ResizeObserver(schedule);
    if (root.current) observer.observe(root.current);
    if (list.current) observer.observe(list.current);
    for (const button of buttons.current.values()) observer.observe(button);
    const strip = list.current?.parentElement;
    strip?.addEventListener('scroll', schedule, { passive: true });
    document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      strip?.removeEventListener('scroll', schedule);
    };
  }, [measure, tabs]);
  const activate = (id: string) => {
    if (!tabs.some((tab) => tab.id === id && !tab.disabled)) return;
    setInternalId(id);
    onTabChange?.(id);
    buttons.current.get(id)?.scrollIntoView({
      behavior: reduced || prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  };
  const path = geometry
    ? makeSurfacePath({
        ...geometry,
        topY: geometry.topY - pressOffset,
        radius: geometry.radius + pressOffset * 0.35,
      })
    : '';
  return (
    <div
      ref={root}
      className={cn(
        'smart-corner-tabs relative isolate flex min-h-64 flex-col overflow-visible bg-muted/70',
        className,
      )}
      data-smart-corner-tabs
    >
      <div className="smart-corner-tabs-strip relative z-10 flex min-h-12 items-end overflow-x-auto scrollbar-none">
        <div
          ref={list}
          className="relative flex min-w-full items-end gap-1 px-2 pt-2"
          role="tablist"
          aria-label={ariaLabel}
        >
          <div
            className={cn(
              'pointer-events-none absolute bottom-1 top-2 rounded-lg bg-card/10 transition-[left,width,opacity] duration-spring-moderate ease-spring-moderate motion-reduce:transition-none',
              (!hover || hover.id === activeId) && 'opacity-0',
            )}
            style={{ left: hover?.x ?? 0, width: hover?.width ?? 0 }}
            aria-hidden="true"
          />
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              ref={(node) => {
                if (node) buttons.current.set(tab.id, node as HTMLButtonElement);
                else buttons.current.delete(tab.id);
              }}
              variant="plain"
              id={`${surfacePathId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              aria-controls={panelId}
              tabIndex={tab.id === activeId ? 0 : -1}
              disabled={tab.disabled}
              className={cn(
                'relative z-10 min-w-max rounded-lg px-4 py-2.5 text-sm font-medium transition-colors duration-spring-moderate ease-spring-moderate motion-reduce:transition-none focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                tab.id === (reduced ? activeId : visualId)
                  ? 'text-card-foreground'
                  : 'text-muted-foreground',
              )}
              data-smart-corner-tab={tab.id}
              onClick={() => activate(tab.id)}
              onKeyDown={(event) => {
                const enabled = tabs.filter((item) => !item.disabled);
                const at = enabled.findIndex((item) => item.id === tab.id);
                if (at < 0) return;
                let next: number | null = null;
                if (event.key === 'ArrowRight') next = (at + 1) % enabled.length;
                else if (event.key === 'ArrowLeft')
                  next = (at - 1 + enabled.length) % enabled.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = enabled.length - 1;
                if (next !== null) {
                  event.preventDefault();
                  buttons.current.get(enabled[next].id)?.focus();
                  activate(enabled[next].id);
                } else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  activate(tab.id);
                }
              }}
              onPointerEnter={(event) => {
                if (!list.current) return;
                const box = event.currentTarget.getBoundingClientRect();
                const listBox = list.current.getBoundingClientRect();
                const scale = listBox.width / list.current.offsetWidth || 1;
                setHover({
                  id: tab.id,
                  x: (box.left - listBox.left) / scale,
                  width: box.width / scale,
                });
              }}
              onPointerLeave={() => {
                setHover(null);
                void press.current?.set(0);
              }}
              onPointerDown={() => void press.current?.set(7)}
              onPointerUp={() => void press.current?.set(0)}
              onPointerCancel={() => void press.current?.set(0)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>
      <svg
        className="smart-corner-tabs-surface pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible"
        viewBox={`0 0 ${geometry?.width ?? 1} ${geometry?.height ?? 1}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <clipPath id={surfacePathId} clipPathUnits="userSpaceOnUse">
            <path d={path} />
          </clipPath>
        </defs>
        <path d={path} fill="hsl(var(--card))" />
      </svg>
      <div
        id={panelId}
        className="relative z-10 min-h-52 flex-1 rounded-b-xl px-5 py-6 text-card-foreground"
        role="tabpanel"
        aria-labelledby={activeTab ? `${surfacePathId}-tab-${activeTab.id}` : undefined}
        tabIndex={0}
      >
        {activeTab &&
          (children ? (
            children(activeTab)
          ) : (
            <h2 className="text-lg font-semibold">{activeTab.label}</h2>
          ))}
      </div>
    </div>
  );
}
export default SmartCornerTabs;
