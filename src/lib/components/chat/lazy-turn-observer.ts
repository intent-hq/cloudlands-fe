type VisibilityCallback = (isIntersecting: boolean) => void;

interface ObserverGroup {
  root: HTMLElement | null;
  observer: IntersectionObserver;
  callbacks: Map<Element, VisibilityCallback>;
}

const rootedGroups = new WeakMap<HTMLElement, ObserverGroup>();
const activeGroups = new Set<ObserverGroup>();
let viewportGroup: ObserverGroup | null = null;

function createGroup(root: HTMLElement | null): ObserverGroup {
  const callbacks = new Map<Element, VisibilityCallback>();
  const group: ObserverGroup = {
    root,
    callbacks,
    observer: new IntersectionObserver(
      (entries) => {
        for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: '50% 0px', threshold: 0 },
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
  group.observer.observe(element);
  return () => {
    group.callbacks.delete(element);
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
