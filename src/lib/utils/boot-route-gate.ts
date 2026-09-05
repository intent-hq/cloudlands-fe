/**
 * Boot-route facts for backend-owned workspace restoration.
 *
 * Fresh windows boot at the workspace bootstrap route ('/workspace/new'),
 * and legacy sessions can still boot at '/'. The connected backend's workspace
 * list and persisted tab identity determine whether an existing workspace is
 * restored or the Untitled creation route remains visible.
 *
 * This module captures ONE immutable fact per full page load: the pathname
 * the page booted on. The `(app)` layout combines it with the setup-prompt
 * slice (`selectBootRouteGateResolved`) to decide, once per page load,
 * whether the boot route should redirect to an existing workspace.
 *
 * Deliberate in-app navigations to /workspace/new (the New Workspace action)
 * are client-side `goto`s that never reload the page, so they are unaffected:
 * the gate decision is made at most once per full page load.
 */

/** Routes a fresh or legacy window can boot on that are subject to the gate. */
const BOOT_GATE_ROUTES = new Set(['/', '/workspace/new']);

let initialPathname: string | null =
  typeof window !== 'undefined' ? window.location.pathname : null;

/** The pathname this page load booted on (null outside a browser). */
export function getBootRoutePathname(): string | null {
  return initialPathname;
}

/** True when this page load booted on a route subject to the setup gate. */
export function isBootRouteLoad(): boolean {
  return initialPathname !== null && BOOT_GATE_ROUTES.has(initialPathname);
}

/** Test-only: pretend the page loaded at `pathname`. */
export function setBootRoutePathnameForTesting(pathname: string | null): void {
  initialPathname = pathname;
}

// ---------------------------------------------------------------------------
// Boot-route decision
// ---------------------------------------------------------------------------

/** Everything the boot-route decision depends on, read by the (app) layout. */
export interface BootRouteDecisionInput {
  /** The pathname this page load booted on (`getBootRoutePathname()`). */
  bootPathname: string | null;
  /** The window's current pathname. */
  currentPathname: string;
  /** Whether this page load's decision was already made. */
  gateResolved: boolean;
  /** Whether the workspace list has loaded (`selectWorkspaceHasLoaded`). */
  workspaceHasLoaded: boolean;
  /** Workspace list (`selectWorkspaceItems`). */
  workspaces: ReadonlyArray<{ id: string; status: string }>;
  /**
   * Whether the persisted tab strip has been (re)hydrated for the ACTIVE
   * backend (`selectWorkspaceTabsHydrated`). Until then `currentTabId` may be
   * stale — the boot `connections:list` can flip the active backend after the
   * initial hydration, and the workspace list can win that race.
   */
  tabsHydrated: boolean;
  /** Persisted current workspace tab id, if any. */
  currentTabId: string | null | undefined;
}

export type BootRouteDecision =
  /** Not a boot-route load, or already decided — nothing to do. */
  | { kind: 'inapplicable' }
  /** Undecided — keep holding (WorkspaceSurface suppresses onboarding). */
  | { kind: 'hold' }
  /**
   * Decision made: mark the gate resolved, optionally open a workspace tab,
   * and navigate to `target` (null = already on the right route).
   */
  | { kind: 'resolve'; target: string | null; openTabWorkspaceId: string | null };

/**
 * Decide where a boot-route page load should land. Pure — the (app) layout
 * feeds it store state and applies the returned decision (dispatch + goto).
 *
 * - Backend has workspaces: land on the persisted tab or first available workspace.
 * - No workspaces: stay on /workspace/new (creation).
 */
export function decideBootRoute(input: BootRouteDecisionInput): BootRouteDecision {
  const {
    bootPathname,
    currentPathname,
    gateResolved,
    workspaceHasLoaded,
    workspaces,
    tabsHydrated,
    currentTabId,
  } = input;
  if (bootPathname === null || !BOOT_GATE_ROUTES.has(bootPathname) || gateResolved) {
    return { kind: 'inapplicable' };
  }
  // Something already navigated away from the boot route (e.g. an explicit
  // initialRoute) — the boot decision no longer applies.
  if (currentPathname !== bootPathname) {
    return { kind: 'resolve', target: null, openTabWorkspaceId: null };
  }
  // Provider/setup probes do not own navigation. The backend workspace list
  // and persisted tab identity are the only boot-route authorities.
  // Wait for the workspace list AND the active backend's persisted tab strip
  // (the workspace-list response can win the race against per-backend tab
  // rehydration, which would land on the first workspace instead of the
  // persisted tab), then land on the persisted tab or the first available
  // workspace; without any workspace, /workspace/new (creation) is the only
  // surface left.
  if (!workspaceHasLoaded || !tabsHydrated) {
    return { kind: 'hold' };
  }
  const available = workspaces.filter(
    (workspace) => workspace.status !== 'Archived' && workspace.status !== 'Deleted',
  );
  const targetWorkspace = available.find((w) => w.id === currentTabId) ?? available[0];
  const target = targetWorkspace ? `/workspace/${targetWorkspace.id}` : '/workspace/new';
  return {
    kind: 'resolve',
    target: currentPathname === target ? null : target,
    openTabWorkspaceId: targetWorkspace?.id ?? null,
  };
}
