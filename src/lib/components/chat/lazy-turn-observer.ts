type VisibilityCallback = (isIntersecting: boolean) => void;

interface ObserverGroup {
  root: HTMLElement | null;
  observer: IntersectionObserver;
  callbacks: Map<Element, VisibilityCallback>;
  order: Map<Element, number>;
  nextOrder: number;
}

const rootedGroups = new WeakMap<HTMLElement, ObserverGroup>();
const activeGroups = new Set<ObserverGroup>();
let viewportGroup: ObserverGroup | null = null;

const LAZY_TURN_PRELOAD_ROOT_MARGIN = '100% 0px';

function createGroup(root: HTMLElement | null): ObserverGroup {
  const callbacks = new Map<Element, VisibilityCallback>();
  const group: ObserverGroup = {
    root,
    callbacks,
    order: new Map(),
    nextOrder: 0,
    observer: new IntersectionObserver(
      (entries) => {
        // A single delivery can carry several chronological entries for the
        // SAME target (layout churn moving a row out and back in between
        // callbacks). Only the final state is current — coalesce to it first,
        // because the enter-first sort below would otherwise replay a stale
        // exit AFTER the final enter and strand an on-screen row as
        // non-intersecting (permanently dehydrated: the placeholder keeps the
        // row's height, so no boundary crossing ever corrects it).
        const latestByTarget = new Map<Element, IntersectionObserverEntry>();
        for (const entry of entries) latestByTarget.set(entry.target, entry);
        const orderedEntries = [...latestByTarget.values()].sort((a, b) => {
          // Entering rows establish the displayport frontier before exits can
          // make an older row eligible for dehydration.
          if (a.isIntersecting !== b.isIntersecting) return a.isIntersecting ? -1 : 1;
          return (
            (group.order.get(a.target) ?? Number.MAX_SAFE_INTEGER) -
            (group.order.get(b.target) ?? Number.MAX_SAFE_INTEGER)
          );
        });
        for (const entry of orderedEntries) callbacks.get(entry.target)?.(entry.isIntersecting);
      },
      // Materialize one viewport before entry so cached-height correction and
      // late content layout settle outside the visible reading area.
      { root, rootMargin: LAZY_TURN_PRELOAD_ROOT_MARGIN, threshold: 0 },
    ),
  };
  activeGroups.add(group);
  if (root) rootedGroups.set(root, group);
  else viewportGroup = group;
  return group;
}

function getGroup(root: HTMLElement | null): ObserverGroup {
  if (!root) return viewportGroup ?? createGroup(null);
  return rootedGroups.get(root) ?? createGroup(root);
}

export function observeLazyTurnVisibility(
  element: Element,
  root: HTMLElement | null,
  callback: VisibilityCallback,
): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback(true);
    return () => {};
  }
  const group = getGroup(root);
  group.callbacks.set(element, callback);
  if (!group.order.has(element)) group.order.set(element, group.nextOrder++);
  group.observer.observe(element);
  return () => {
    group.callbacks.delete(element);
    group.order.delete(element);
    group.observer.unobserve(element);
    if (group.callbacks.size > 0) return;
    group.observer.disconnect();
    activeGroups.delete(group);
    if (group.root) rootedGroups.delete(group.root);
    else if (viewportGroup === group) viewportGroup = null;
  };
}

export function inspectLazyTurnObserverOwnership() {
  let targetCount = 0;
  for (const group of activeGroups) targetCount += group.callbacks.size;
  return { rootCount: activeGroups.size, targetCount };
}
