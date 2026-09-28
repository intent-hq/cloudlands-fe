import { getContext, onDestroy, setContext } from 'svelte';
import { scheduleLayoutRead, scheduleLayoutWrite } from '$lib/utils/layout-phases';
import {
  createOperationalRowWindow,
  type OperationalRowDescriptor,
} from './operational-row-window';

const CONTEXT = Symbol('operational-panel');
type Entry = Omit<OperationalRowDescriptor, 'scopeId'> & {
  mountPath?: string;
  navigation?: { messageId: string; path: string; text?: string };
};
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
  order: number;
  targets: Map<string, Entry[]>;
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

type Anchor = { key: string; top: number; scrollTop: number; scope: string; root: Root };
type NavigationObservation = {
  node: HTMLElement;
  root: Root;
  scope: string;
  generation: number;
  revision: number;
  visible: boolean;
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
  const navigationTargets = new Map<string, Map<Root, Entry[]>>();
  let nextRootOrder = 0;
  let entriesChanged = false;
  const targetId = (messageId: string, path: string) => JSON.stringify([messageId, path]);
  const anchors = new Map<HTMLElement, Anchor>();
  const retained = new Map<string, object>();
  let disposed = false;
  let generation = 0;
  let readRevision = 0;
  let projectionRevision = 0;
  let observations = new Map<string, NavigationObservation>();
  let cancelRead: (() => void) | undefined;
  let cancelWrite: (() => void) | undefined;
  let listening: HTMLElement | undefined;
  let listeningWindow = false;
  let resize: ResizeObserver | undefined;
  let mounted = new Set<string>();
  const pins = new Map<string, Set<object>>();
  const defaultPinOwner = {};
  const focusPins = new Set<string>();

  function syncPins() {
    policy.setPins([...focusPins, ...pins.keys()].reverse());
  }

  function height(entry: Entry) {
    return heights.get(entry.key) ?? entry.estimatedHeight;
  }
  function currentElement(scope: string, root: Root, key: string) {
    if (owners.get(key) !== scope) return undefined;
    const node = elements.get(key);
    return node?.isConnected && root.node.contains(node) ? node : undefined;
  }
  function publishRoot(scope: string, root: Root) {
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
      projectionRevision++;
      observations.clear();
      root.notify(segments);
    }
  }
  function publish() {
    const snapshot = policy.snapshot();
    mounted = new Set(snapshot.mountedKeys);
    for (const [scope, root] of roots) publishRoot(scope, root);
    return snapshot;
  }
  function removeTargets(root: Root) {
    for (const id of root.targets.keys()) {
      const scopes = navigationTargets.get(id);
      scopes?.delete(root);
      if (!scopes?.size) navigationTargets.delete(id);
    }
    root.targets.clear();
  }
  function indexTargets(scope: string, root: Root) {
    removeTargets(root);
    for (const entry of root.entries) {
      if (owners.get(entry.key) !== scope) continue;
      const navigation = entry.navigation;
      if (!navigation) continue;
      const id = targetId(navigation.messageId, navigation.path);
      let entries = root.targets.get(id);
      if (!entries) {
        entries = [];
        root.targets.set(id, entries);
        let scopes = navigationTargets.get(id);
        if (!scopes) navigationTargets.set(id, (scopes = new Map()));
        scopes.set(root, entries);
      }
      entries.push(entry);
    }
  }
  function targetsFor(messageId: string, path: string) {
    return [...(navigationTargets.get(targetId(messageId, path)) ?? [])]
      .sort(([a], [b]) => a.order - b.order)
      .flatMap(([, entries]) => entries);
  }
  function invalidate(keys: string[]) {
    policy.invalidateMounts(keys);
    // Only the frame snapshot grants permission. Scope mutations may revoke it
    // immediately, without scanning every panel descriptor for a new snapshot.
    for (const key of keys) mounted.delete(key);
  }
  function claim(scope: string, entries: Entry[]) {
    const displaced = new Set<string>();
    for (const entry of entries) {
      const old = owners.get(entry.key);
      if (old && old !== scope) displaced.add(old);
      owners.set(entry.key, scope);
    }
    return displaced;
  }
  function refreshScopes(scopes: Iterable<string>) {
    for (const scope of scopes) {
      const root = roots.get(scope);
      if (!root) continue;
      indexTargets(scope, root);
      publishRoot(scope, root);
    }
  }
  function rebuild() {
    if (!entriesChanged) return;
    entriesChanged = false;
    policy.setEntries(
      [...roots].flatMap(([scopeId, root]) =>
        root.entries
          .filter((entry) => owners.get(entry.key) === scopeId)
          .map((entry) => ({
            key: entry.key,
            kind: entry.kind,
            scopeId,
            estimatedHeight: height(entry),
          })),
      ),
    );
    syncPins();
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
    const completedRevision = ++readRevision;
    const nextObservations = new Map<string, NavigationObservation>();
    const visible: string[] = [];
    const nextAnchors = new Map<HTMLElement, Anchor>();
    const corrections = new Map<HTMLElement, { delta: number; scrollTop: number }>();
    for (const [scroll, anchor] of anchors) {
      const root = roots.get(anchor.scope);
      const node =
        root === anchor.root ? currentElement(anchor.scope, root, anchor.key) : undefined;
      if (node && scroll.scrollTop === anchor.scrollTop) {
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
          if (owners.get(entry.key) !== scope) continue;
          heights.delete(entry.key);
          headers.delete(entry.key);
        }
      }
      let clipLeft = 0;
      let clipRight = window.innerWidth;
      let clipTop = 0;
      let clipBottom = window.innerHeight;
      // A spacer-only shrink-to-fit parent can have zero intrinsic width until
      // its first admitted row renders. Its positive flow height is still visible.
      let hidden = box.height <= 0;
      let scroll: HTMLElement | undefined;
      let scrollCandidate: HTMLElement | undefined;
      for (let parent = root.node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          parent.matches('[data-operational-expanded-content][aria-hidden="true"]')
        )
          hidden = true;
        if (/(auto|scroll)/.test(style.overflowY)) {
          scrollCandidate ??= parent;
          // Unconstrained disclosure bodies advertise auto overflow but cannot
          // move vertically. Keep walking to the actual transcript scrollport.
          if (!scroll && parent.scrollHeight > parent.clientHeight) scroll = parent;
        }
        const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
        const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
        if (clipsX || clipsY) {
          const clip = parent.getBoundingClientRect();
          if (clipsX) {
            clipLeft = Math.max(clipLeft, clip.left);
            clipRight = Math.min(clipRight, clip.right);
          }
          if (clipsY) {
            clipTop = Math.max(clipTop, clip.top);
            clipBottom = Math.min(clipBottom, clip.bottom);
          }
        }
      }
      // A zero-width intrinsic root may grow when admitted, but a clipped
      // ancestor cannot: only project rows where its horizontal clip is open.
      hidden ||=
        clipRight <= clipLeft ||
        box.left >= clipRight ||
        (box.width > 0 ? box.right <= clipLeft : box.left < clipLeft);
      const documentScroll = (document.scrollingElement ?? document.documentElement) as HTMLElement;
      scroll ??= scrollCandidate ?? documentScroll;
      const scrollBox = scroll.getBoundingClientRect();
      root.geometry = {
        top: box.top,
        scale,
        scroll,
        scrollTop: scroll?.scrollTop ?? 0,
        scrollRectTop: scroll === documentScroll ? 0 : scrollBox.top,
        scrollScale:
          scroll && scroll.offsetWidth > 0 ? (scrollBox?.width ?? 0) / scroll.offsetWidth || 1 : 1,
      };
      root.shells.clear();
      let top = box.top;
      for (const entry of root.entries) {
        const node = currentElement(scope, root, entry.key);
        const rowRect = node?.getBoundingClientRect();
        const measured = rowRect ? rowRect.height / scale : 0;
        let targetRect = entry.kind === 'group' ? undefined : rowRect;
        if (node && entry.kind === 'group' && mounted.has(entry.key)) {
          const summary = node
            .querySelector('[data-operational-disclosure-row]')
            ?.getBoundingClientRect();
          targetRect = summary;
          if (summary && summary.height > 0)
            headers.set(entry.key, {
              height: summary.height / scale,
              offset: (summary.top - rowRect!.top) / scale,
            });
        }
        if (node)
          nextObservations.set(entry.key, {
            node,
            root,
            scope,
            generation: revision,
            revision: completedRevision,
            visible:
              !hidden &&
              clipBottom > clipTop &&
              clipRight > clipLeft &&
              !!targetRect &&
              targetRect.height > 0 &&
              targetRect.width > 0 &&
              targetRect.top < clipBottom &&
              targetRect.bottom > clipTop &&
              targetRect.left < clipRight &&
              targetRect.right > clipLeft,
          });
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
              nextAnchors.set(scroll, {
                key: entry.key,
                top,
                scrollTop: scroll.scrollTop,
                scope,
                root,
              });
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
      // Admission and retained heights do not certify a current node's position.
      // Publish navigation evidence only from a generation-accepted read.
      // Anchor corrections below move the scrollport after these rectangles
      // were read. Certify their new position in a subsequent batched read.
      const beforePublish = projectionRevision;
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
      const snapshot = publish();
      // Admission and spacer changes can move an already-mounted target when
      // Svelte renders this publication. Read again before certifying arrival.
      const projectionChanged = projectionRevision !== beforePublish;
      observations = corrections.size || projectionChanged ? new Map() : nextObservations;
      if (snapshot.pendingKeys.length || corrections.size || projectionChanged) schedule();
    });
  }
  return {
    policy,
    refreshGeometry() {
      schedule();
      // An already-started read cannot satisfy this request even if its write
      // phase is pending. Callers must observe a strictly larger revision.
      return readRevision;
    },
    resolveTarget(messageId: string, path: string) {
      return targetsFor(messageId, path)[0]?.key;
    },
    resolveMatch(messageId: string, path: string, query: string, occurrence: number) {
      const entries = targetsFor(messageId, path);
      const first = entries[0];
      if (!first) return undefined;
      const needle = query.trim().toLowerCase();
      if (entries.length === 1 || !needle) return { key: first.key, occurrenceInRow: occurrence };
      let remaining = occurrence;
      for (const entry of entries) {
        const text = entry.navigation?.text?.toLowerCase() ?? '';
        let count = 0;
        let offset = 0;
        while ((offset = text.indexOf(needle, offset)) !== -1) {
          count++;
          offset += needle.length;
        }
        if (remaining < count) return { key: entry.key, occurrenceInRow: remaining };
        remaining -= count;
      }
      return undefined;
    },
    locate(key: string) {
      const scope = owners.get(key);
      const root = scope ? roots.get(scope) : undefined;
      if (!scope || !root?.geometry) return undefined;
      let offset = 0;
      for (const entry of root.entries) {
        if (entry.key === key) {
          const node = currentElement(scope, root, key);
          const observed = observations.get(key);
          const observation =
            observed &&
            observed.node === node &&
            observed.root === root &&
            observed.scope === scope &&
            observed.generation === generation
              ? { revision: observed.revision, visible: observed.visible }
              : undefined;
          return {
            node,
            observation,
            admitted: entry.kind === 'content' || mounted.has(key),
            kind: entry.kind,
            scrollRoot: root.geometry.scroll,
            top:
              root.geometry.scrollTop +
              (root.geometry.top - root.geometry.scrollRectTop + offset * root.geometry.scale) /
                root.geometry.scrollScale,
            height: (height(entry) * root.geometry.scale) / root.geometry.scrollScale,
          };
        }
        offset += height(entry);
      }
      return undefined;
    },
    measuredHeight(key: string) {
      return heights.get(key);
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
    pin(key: string, active: boolean, owner = defaultPinOwner) {
      if (active) {
        const leases = pins.get(key) ?? new Set<object>();
        leases.add(owner);
        pins.set(key, leases);
      } else {
        const leases = pins.get(key);
        leases?.delete(owner);
        if (!leases?.size) pins.delete(key);
      }
      syncPins();
      schedule();
    },
    attach(scope: string, node: HTMLElement, entries: Entry[], notify: Root['notify']) {
      generation++;
      const previous = roots.get(scope);
      if (previous) {
        previous.notify([]);
        removeTargets(previous);
        resize?.unobserve(previous.node);
        previous.node.removeEventListener('scroll', schedule, true);
        invalidate(
          previous.entries
            .filter((entry) => owners.get(entry.key) === scope)
            .map((entry) => entry.key),
        );
        for (const entry of previous.entries)
          if (owners.get(entry.key) === scope) owners.delete(entry.key);
      }
      // Revoke before publishing the attachment, including keys inherited from
      // another scope. New rows wait for the shared frame's admission allowance.
      invalidate(entries.map((entry) => entry.key));
      const displaced = claim(scope, entries);
      roots.set(scope, {
        node,
        entries,
        notify,
        shells: new Set(),
        targets: new Map(),
        order: previous?.order ?? nextRootOrder++,
      });
      ensureObserver();
      resize?.observe(node);
      node.addEventListener('scroll', schedule, { capture: true, passive: true });
      entriesChanged = true;
      refreshScopes([...displaced, scope]);
      schedule();
      return () => {
        const root = roots.get(scope);
        if (root?.node !== node) return;
        generation++;
        invalidate(
          root.entries.filter((entry) => owners.get(entry.key) === scope).map((entry) => entry.key),
        );
        removeTargets(root);
        for (const entry of root.entries)
          if (owners.get(entry.key) === scope) owners.delete(entry.key);
        roots.delete(scope);
        resize?.unobserve(node);
        node.removeEventListener('scroll', schedule, true);
        entriesChanged = true;
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
        generation++;
        root.entries = entries;
        indexTargets(scope, root);
        schedule();
        return;
      }
      generation++;
      const nextKeys = new Set(entries.map((entry) => entry.key));
      const revoked: string[] = [];
      for (const entry of root.entries)
        if (!nextKeys.has(entry.key) && owners.get(entry.key) === scope) {
          revoked.push(entry.key);
          owners.delete(entry.key);
        }
      const previous = new Map(root.entries.map((entry) => [entry.key, entry]));
      for (const entry of entries) {
        const old = previous.get(entry.key);
        if (
          (owners.has(entry.key) && owners.get(entry.key) !== scope) ||
          (old && (old.kind !== entry.kind || old.mountPath !== entry.mountPath))
        )
          revoked.push(entry.key);
      }
      invalidate(revoked);
      const displaced = claim(scope, entries);
      root.entries = entries;
      entriesChanged = true;
      refreshScopes([...displaced, scope]);
      schedule();
    },
    watch(node: HTMLElement, key: string) {
      elements.set(key, node);
      let active = true;
      const current = () => active && !disposed && elements.get(key) === node;
      const focus = () => {
        if (!current()) return;
        focusPins.delete(key);
        focusPins.add(key);
        syncPins();
        schedule();
      };
      const blur = () => {
        if (current() && !node.contains(document.activeElement)) {
          focusPins.delete(key);
          syncPins();
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
          active = false;
          node.removeEventListener('focusin', focus);
          node.removeEventListener('focusout', leave);
          if (elements.get(key) === node) {
            elements.delete(key);
            focusPins.delete(key);
            syncPins();
          }
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
      observations.clear();
      heights.clear();
      widths.clear();
      headers.clear();
      elements.clear();
      owners.clear();
      navigationTargets.clear();
      anchors.clear();
      retained.clear();
      pins.clear();
      focusPins.clear();
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
