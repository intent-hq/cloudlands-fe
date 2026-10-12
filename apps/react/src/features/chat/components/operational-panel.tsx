import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPanel } from '$lib/components/chat/operational-panel-core';

export type OperationalPanel = ReturnType<typeof createPanel>;
export type OperationalPanelLease = { panel: OperationalPanel; release: () => void };
export type OperationalPanelLifetime = { acquire: () => OperationalPanelLease };
export type OperationalPanelProviderProps = {
  getScrollRoot?: () => HTMLElement | undefined;
  children: ReactNode;
};

const OperationalPanelContext = createContext<OperationalPanelLifetime | undefined>(undefined);
const documentFallback = () => undefined;

// Allocating the handle during render creates no panel, observer or scheduled work.
function createLifetime(initialGetScrollRoot: () => HTMLElement | undefined) {
  let getScrollRoot = initialGetScrollRoot;
  let panel: OperationalPanel | undefined;
  let leases = 0;
  const lifetime: OperationalPanelLifetime = {
    acquire() {
      const acquired = (panel ??= createPanel(() => getScrollRoot()));
      leases++;
      let released = false;
      return {
        panel: acquired,
        release() {
          if (released) return;
          released = true;
          if (--leases === 0) {
            panel = undefined;
            acquired.dispose();
          }
        },
      };
    },
  };
  return {
    lifetime,
    setScrollRoot(next: () => HTMLElement | undefined) {
      getScrollRoot = next;
      panel?.refreshGeometry();
    },
  };
}

/** One boundary per panel. Descendant windows share its real canonical owner. */
export function OperationalPanelProvider({
  getScrollRoot = documentFallback,
  children,
}: OperationalPanelProviderProps) {
  const [owner] = useState(() => createLifetime(getScrollRoot));
  // Publish only committed getters, before the shared scheduler reads geometry.
  useLayoutEffect(() => owner.setScrollRoot(getScrollRoot), [owner, getScrollRoot]);
  useLayoutEffect(() => {
    const lease = owner.lifetime.acquire();
    return lease.release;
  }, [owner]);
  return (
    <OperationalPanelContext.Provider value={owner.lifetime}>
      {children}
    </OperationalPanelContext.Provider>
  );
}

/**
 * Unlike the Svelte hook, this returns a lifetime (or undefined), not a panel.
 * Acquire in committed layout/ref setup and release that lease in cleanup.
 * Never retain its panel across cleanup: StrictMode replay may reacquire a new
 * owner after the last release synchronously disposes the previous one.
 * Standalone OperationalWindow installs a document-fallback boundary itself.
 */
export function useOperationalPanel() {
  return useContext(OperationalPanelContext);
}
