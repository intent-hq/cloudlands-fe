import { getContext, onDestroy, setContext } from 'svelte';
import { scheduleLayoutRead, scheduleLayoutWrite } from '$lib/utils/layout-phases';
import {
  createOperationalRowWindow,
  type OperationalRowDescriptor,
} from './operational-row-window';

const CONTEXT = Symbol('operational-panel');
type Entry = Omit<OperationalRowDescriptor, 'scopeId'> & { mountPath?: string };
export type WindowSegment = {
  key: string;
  start: number;
  end: number;
  height: number;
  type: 'row' | 'spacer';
  admitted: boolean;
};
type Root = {
  node: HTMLElement;
  entries: Entry[];
  notify: (segments: WindowSegment[]) => void;
  shells: Set<string>;
  segments?: WindowSegment[];
  geometry?: {
    top: number;
    scale: number;
    scroll?: HTMLElement;
    scrollTop: number;
    scrollRectTop: number;
    scrollScale: number;
  };
};

/** One owner for every renderer and nested scroll region in a panel. */
function createPanel(getScrollRoot: () => HTMLElement | undefined) {
  const policy = createOperationalRowWindow();
  const roots = new Map<string, Root>();
  const heights = new Map<string, number>();
  const widths = new Map<string, number>();
  const headers = new Map<string, { height: number; offset: number }>();
  const elements = new Map<string, HTMLElement>();
  const owners = new Map<string, string>();
  const anchors = new Map<HTMLElement, { key: string; top: number; scrollTop: number }>();
  const retained = new Map<string, object>();
  let disposed = false;
  let generation = 0;
  let cancelRead: (() => void) | undefined;
  let cancelWrite: (() => void) | undefined;
  let listening: HTMLElement | undefined;
  let listeningWindow = false;
  let resize: ResizeObserver | undefined;
  let mounted = new Set<string>();
  const pins = new Set<string>();

  function height(entry: Entry) {
    return heights.get(entry.key) ?? entry.estimatedHeight;
  }
  function publish() {
    mounted = new Set(policy.snapshot().mountedKeys);
    for (const [scope, root] of roots) {
      const segments: WindowSegment[] = [];
      root.entries.forEach((entry, index) => {
        const admitted = owners.get(entry.key) === scope && mounted.has(entry.key);
        const type =
          admitted || entry.kind === 'content' || root.shells.has(entry.key) ? 'row' : 'spacer';
        const previous = segments.at(-1);
        if (type === 'spacer' && previous?.type === 'spacer') {
          previous.end = index + 1;
          previous.height += height(entry);
          previous.key = `gap:${root.entries[previous.start].key}:${entry.key}`;
        } else
          segments.push({
            key: type === 'spacer' ? `gap:${entry.key}:${entry.key}` : entry.key,
            start: index,
            end: index + 1,
            height: height(entry),
            type,
            admitted,
          });
      });
      if (
        !root.segments ||
        segments.length !== root.segments.length ||
        segments.some((segment, index) => {
          const old = root.segments?.[index];
          return (
            !old ||
            segment.key !== old.key ||
            segment.height !== old.height ||
            segment.admitted !== old.admitted ||
            segment.start !== old.start ||
            segment.end !== old.end ||
            segment.type !== old.type
          );
        })
      ) {
        root.segments = segments;
        root.notify(segments);
      }
    }
  }
  function rebuild() {
    policy.setEntries(
      [...roots].flatMap(([scopeId, root]) =>
        root.entries
          .filter((entry) => owners.get(entry.key) === scopeId)
          .map((entry) => ({ ...entry, scopeId, estimatedHeight: height(entry) })),
      ),
    );
    policy.setPins([...pins].reverse());
  }
  function ensureObserver() {
    if (!listeningWindow) {
      window.addEventListener('scroll', schedule, { capture: true, passive: true });
      window.addEventListener('resize', schedule, { passive: true });
      listeningWindow = true;
    }
    resize ??= typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    const root = getScrollRoot();
    if (root !== listening) {
      listening?.removeEventListener('scroll', schedule, true);
      if (listening) resize?.unobserve(listening);
      listening = root;
      listening?.addEventListener('scroll', schedule, { capture: true, passive: true });
      if (listening) resize?.observe(listening);
    }
  }
  function schedule() {
    if (disposed || cancelRead) return;
    cancelRead = scheduleLayoutRead(read);
  }
  function read() {
    cancelRead = undefined;
    if (disposed) return;
    ensureObserver();
    const revision = generation;
    const visible: string[] = [];
    const nextAnchors = new Map<HTMLElement, { key: string; top: number; scrollTop: number }>();
    const corrections = new Map<HTMLElement, { delta: number; scrollTop: number }>();
    for (const [scroll, anchor] of anchors) {
      const node = elements.get(anchor.key);
      if (node?.isConnected && scroll.scrollTop === anchor.scrollTop) {
        const delta = node.getBoundingClientRect().top - anchor.top;
        if (Math.abs(delta) > 0.5) {
          const scale =
            scroll.offsetWidth > 0 ? scroll.getBoundingClientRect().width / scroll.offsetWidth : 1;
          corrections.set(scroll, { delta, scrollTop: anchor.scrollTop + delta / (scale || 1) });
        }
      }
    }
    const before: { key: string; distance: number }[] = [];
    const after: { key: string; distance: number }[] = [];
    const measurements: { key: string; height: number }[] = [];
    for (const [scope, root] of roots) {
      const box = root.node.getBoundingClientRect();
      const scale = root.node.offsetWidth > 0 ? box.width / root.node.offsetWidth : 1;
      if (box.width > 0 && widths.get(scope) !== box.width) {
        widths.set(scope, box.width);
        for (const entry of root.entries) {
          heights.delete(entry.key);
          headers.delete(entry.key);
        }
      }
      let clipTop = 0;
      let clipBottom = window.innerHeight;
      let hidden = box.width <= 0;
      let scroll: HTMLElement | undefined;
      for (let parent = root.node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          parent.matches('[data-operational-expanded-content][aria-hidden="true"]')
        )
          hidden = true;
        if (!scroll && /(auto|scroll)/.test(style.overflowY)) scroll = parent;
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          const clip = parent.getBoundingClientRect();
          clipTop = Math.max(clipTop, clip.top);
          clipBottom = Math.min(clipBottom, clip.bottom);
        }
      }
      const scrollBox = scroll?.getBoundingClientRect();
      root.geometry = {
        top: box.top,
        scale,
        scroll,
        scrollTop: scroll?.scrollTop ?? 0,
        scrollRectTop: scrollBox?.top ?? 0,
        scrollScale:
          scroll && scroll.offsetWidth > 0 ? (scrollBox?.width ?? 0) / scroll.offsetWidth || 1 : 1,
      };
      root.shells.clear();
      let top = box.top;
      for (const entry of root.entries) {
        const node = elements.get(entry.key);
        const measured = node?.isConnected ? node.getBoundingClientRect().height / scale : 0;
        if (node && entry.kind === 'group' && mounted.has(entry.key)) {
          const summary = node
            .querySelector('[data-operational-disclosure-row]')
            ?.getBoundingClientRect();
          if (summary && summary.height > 0)
            headers.set(entry.key, {
              height: summary.height / scale,
              offset: (summary.top - node.getBoundingClientRect().top) / scale,
            });
        }
        if (!hidden && measured > 0 && Number.isFinite(measured))
          measurements.push({ key: entry.key, height: measured });
        const extent = measured > 0 ? measured : height(entry);
        const bottom = top + extent * scale;
        if (
          !hidden &&
          clipBottom > clipTop &&
          entry.kind !== 'content' &&
          owners.get(entry.key) === scope
        ) {
          // Group geometry reserves the full body in this list; only its summary
          // is an operational row. Children project their own clipped viewport.
          const summary = headers.get(entry.key);
          const rowTop = entry.kind === 'group' ? top + (summary?.offset ?? 0) * scale : top;
          const rowBottom =
            entry.kind === 'group' ? rowTop + (summary?.height ?? 28) * scale : bottom;
          if (rowTop < clipBottom && rowBottom > clipTop) {
            visible.push(entry.key);
            if (scroll && !nextAnchors.has(scroll) && entry.kind !== 'group')
              nextAnchors.set(scroll, { key: entry.key, top, scrollTop: scroll.scrollTop });
          } else if (rowBottom <= clipTop)
            before.push({ key: entry.key, distance: clipTop - rowBottom });
          else after.push({ key: entry.key, distance: top - clipBottom });
          if (entry.kind === 'group' && top < clipBottom && bottom > clipTop)
            root.shells.add(entry.key);
        }
        top = bottom;
      }
    }
    cancelWrite = scheduleLayoutWrite(() => {
      cancelWrite = undefined;
      if (disposed) return;
      if (revision !== generation) {
        schedule();
        return;
      }
      for (const measurement of measurements) heights.set(measurement.key, measurement.height);
      rebuild();
      policy.measure(measurements);
      for (const [scroll, correction] of corrections) scroll.scrollTop = correction.scrollTop;
      anchors.clear();
      for (const [scroll, anchor] of nextAnchors)
        anchors.set(scroll, {
          ...anchor,
          top: anchor.top - (corrections.get(scroll)?.delta ?? 0),
          scrollTop: corrections.get(scroll)?.scrollTop ?? anchor.scrollTop,
        });
      policy.setVisibility({
        visibleKeys: visible,
        beforeKeys: before.sort((a, b) => a.distance - b.distance).map((x) => x.key),
        afterKeys: after.sort((a, b) => a.distance - b.distance).map((x) => x.key),
      });
      // The document timeline is the browser's shared RAF timestamp. All
      // nested roots are admitted together, after the batched geometry reads.
      policy.advanceFrame(Number(document.timeline?.currentTime ?? performance.now()));
      publish();
      if (policy.snapshot().pendingKeys.length) schedule();
    });
  }
  return {
    policy,
    locate(key: string) {
      const scope = owners.get(key);
      const root = scope ? roots.get(scope) : undefined;
      if (!root?.geometry) return undefined;
      let offset = 0;
      for (const entry of root.entries) {
        if (entry.key === key)
          return {
            node: elements.get(key),
            scrollRoot: root.geometry.scroll,
            top:
              root.geometry.scrollTop +
              (root.geometry.top - root.geometry.scrollRectTop + offset * root.geometry.scale) /
                root.geometry.scrollScale,
            height: (height(entry) * root.geometry.scale) / root.geometry.scrollScale,
          };
        offset += height(entry);
      }
      return undefined;
    },
    summaryHeight(key: string) {
      return headers.get(key)?.height ?? 28;
    },
    state<T extends object>(key: string, initial: () => T): T {
      let value = retained.get(key);
      if (!value) {
        const created = initial();
        value = created;
        retained.set(key, value);
      }
      return value as T;
    },
    pin(key: string, active: boolean) {
      if (active) pins.add(key);
      else pins.delete(key);
      policy.setPins([...pins].reverse());
      schedule();
    },
    attach(scope: string, node: HTMLElement, entries: Entry[], notify: Root['notify']) {
      generation++;
      const previous = roots.get(scope);
      if (previous) {
        previous.notify([]);
        resize?.unobserve(previous.node);
        previous.node.removeEventListener('scroll', schedule, true);
        policy.invalidateMounts(previous.entries.map((entry) => entry.key));
        for (const entry of previous.entries)
          if (owners.get(entry.key) === scope) owners.delete(entry.key);
      }
      // Attachment, not just teardown, revokes every retained DOM permission.
      policy.invalidateMounts(entries.map((entry) => entry.key));
      for (const entry of entries) owners.set(entry.key, scope);
      roots.set(scope, { node, entries, notify, shells: new Set() });
      ensureObserver();
      resize?.observe(node);
      node.addEventListener('scroll', schedule, { capture: true, passive: true });
      rebuild();
      publish();
      schedule();
      return () => {
        const root = roots.get(scope);
        if (root?.node !== node) return;
        generation++;
        policy.invalidateMounts(
          root.entries.filter((entry) => owners.get(entry.key) === scope).map((entry) => entry.key),
        );
        for (const entry of root.entries)
          if (owners.get(entry.key) === scope) owners.delete(entry.key);
        roots.delete(scope);
        resize?.unobserve(node);
        node.removeEventListener('scroll', schedule, true);
        rebuild();
        publish();
        schedule();
      };
    },
    update(scope: string, entries: Entry[]) {
      const root = roots.get(scope);
      if (!root) return;
      if (
        root.entries.length === entries.length &&
        root.entries.every(
          (entry, index) =>
            entry.key === entries[index].key &&
            entry.kind === entries[index].kind &&
            entry.mountPath === entries[index].mountPath &&
            entry.estimatedHeight === entries[index].estimatedHeight,
        )
      ) {
        root.entries = entries;
        return;
      }
      generation++;
      const nextKeys = new Set(entries.map((entry) => entry.key));
      for (const entry of root.entries)
        if (!nextKeys.has(entry.key) && owners.get(entry.key) === scope) owners.delete(entry.key);
      const previous = new Map(root.entries.map((entry) => [entry.key, entry]));
      for (const entry of entries) {
        if (owners.has(entry.key) && owners.get(entry.key) !== scope)
          policy.invalidateMounts([entry.key]);
        owners.set(entry.key, scope);
      }
      policy.invalidateMounts(
        entries
          .filter(
            (entry) =>
              previous.has(entry.key) &&
              (previous.get(entry.key)?.kind !== entry.kind ||
                previous.get(entry.key)?.mountPath !== entry.mountPath),
          )
          .map((entry) => entry.key),
      );
      root.entries = entries;
      rebuild();
      publish();
      schedule();
    },
    watch(node: HTMLElement, key: string) {
      elements.set(key, node);
      const focus = () => {
        pins.delete(key);
        pins.add(key);
        policy.setPins([...pins].reverse());
        schedule();
      };
      const blur = () => {
        if (!node.contains(document.activeElement)) {
          pins.delete(key);
          policy.setPins([...pins].reverse());
          schedule();
        }
      };
      const leave = () => queueMicrotask(blur);
      node.addEventListener('focusin', focus);
      node.addEventListener('focusout', leave);
      ensureObserver();
      resize?.observe(node);
      schedule();
      return {
        destroy() {
          node.removeEventListener('focusin', focus);
          node.removeEventListener('focusout', leave);
          if (elements.get(key) === node) elements.delete(key);
          resize?.unobserve(node);
          schedule();
        },
      };
    },
    dispose() {
      disposed = true;
      cancelRead?.();
      cancelWrite?.();
      resize?.disconnect();
      if (listeningWindow) {
        window.removeEventListener('scroll', schedule, true);
        window.removeEventListener('resize', schedule);
      }
      listening?.removeEventListener('scroll', schedule, true);
      for (const root of roots.values()) root.node.removeEventListener('scroll', schedule, true);
      roots.clear();
      heights.clear();
      widths.clear();
      headers.clear();
      elements.clear();
      owners.clear();
      anchors.clear();
      retained.clear();
      pins.clear();
      policy.dispose();
    },
  };
}

export function provideOperationalPanel(getScrollRoot: () => HTMLElement | undefined) {
  const panel = createPanel(getScrollRoot);
  setContext(CONTEXT, panel);
  onDestroy(() => panel.dispose());
  return panel;
}
export function useOperationalPanel() {
  return (
    getContext<ReturnType<typeof createPanel> | undefined>(CONTEXT) ??
    provideOperationalPanel(() => undefined)
  );
}
