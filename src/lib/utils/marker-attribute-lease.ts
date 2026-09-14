/**
 * Reference-counted marker attributes for elements shared by many component
 * instances (typically `<body>`). Several dialogs of the same type can be
 * mounted at once — e.g. PullConflictDialog has independent hosts in the
 * onboarding surface and the global create-workspace flow — so a holder must
 * never clear a marker another holder still relies on.
 */
const leases = new WeakMap<Element, Map<string, number>>();

/**
 * Set `attribute` on `target` and hold it until every acquired lease has been
 * released. The returned release is idempotent: calling it twice releases once.
 */
export function acquireMarkerAttribute(target: Element, attribute: string): () => void {
  let counts = leases.get(target);
  if (!counts) {
    counts = new Map();
    leases.set(target, counts);
  }
  counts.set(attribute, (counts.get(attribute) ?? 0) + 1);
  target.setAttribute(attribute, '');

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (counts.get(attribute) ?? 1) - 1;
    if (remaining > 0) {
      counts.set(attribute, remaining);
      return;
    }
    counts.delete(attribute);
    target.removeAttribute(attribute);
  };
}
