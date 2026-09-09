/**
 * Boot-route gate facts and decision (regression coverage for the boot-path
 * setup gate: connecting to a backend that already has workspaces must land
 * on a workspace, not onboarding).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  decideBootRoute,
  getBootRoutePathname,
  isBootRouteLoad,
  setBootRoutePathnameForTesting,
  type BootRouteDecisionInput,
} from './boot-route-gate';

const ORIGINAL_PATHNAME = window.location.pathname;

afterEach(() => {
  setBootRoutePathnameForTesting(ORIGINAL_PATHNAME);
});

describe('boot-route-gate', () => {
  it('captures the page-load pathname', () => {
    setBootRoutePathnameForTesting('/workspace/new');
    expect(getBootRoutePathname()).toBe('/workspace/new');
  });

  it('treats /workspace/new (fresh window bootstrap) as a boot-route load', () => {
    setBootRoutePathnameForTesting('/workspace/new');
    expect(isBootRouteLoad()).toBe(true);
  });

  it('treats legacy / as a boot-route load', () => {
    setBootRoutePathnameForTesting('/');
    expect(isBootRouteLoad()).toBe(true);
  });

  it('does not gate a page load that starts on a concrete workspace route', () => {
    setBootRoutePathnameForTesting('/workspace/ws-123');
    expect(isBootRouteLoad()).toBe(false);
  });

  it('does not gate non-workspace routes (e.g. /hud)', () => {
    setBootRoutePathnameForTesting('/hud');
    expect(isBootRouteLoad()).toBe(false);
  });

  it('reports no boot route outside a browser', () => {
    setBootRoutePathnameForTesting(null);
    expect(getBootRoutePathname()).toBeNull();
    expect(isBootRouteLoad()).toBe(false);
  });
});

function input(overrides: Partial<BootRouteDecisionInput> = {}): BootRouteDecisionInput {
  return {
    bootPathname: '/workspace/new',
    currentPathname: '/workspace/new',
    gateResolved: false,
    setupGate: 'pending',
    workspaceHasLoaded: false,
    workspaces: [],
    tabsHydrated: true,
    currentTabId: undefined,
    holdTimedOut: false,
    ...overrides,
  };
}

describe('decideBootRoute', () => {
  it('redirects a /workspace/new boot to an existing workspace (the regression)', () => {
    const decision = decideBootRoute(
      input({
        setupGate: 'none',
        workspaceHasLoaded: true,
        workspaces: [{ id: 'ws-1', status: 'Active' }],
      }),
    );
    expect(decision).toEqual({
      kind: 'resolve',
      target: '/workspace/ws-1',
      openTabWorkspaceId: 'ws-1',
    });
  });

  it('redirects a legacy / boot to an existing workspace', () => {
    const decision = decideBootRoute(
      input({
        bootPathname: '/',
        currentPathname: '/',
        setupGate: 'none',
        workspaceHasLoaded: true,
        workspaces: [{ id: 'ws-1', status: 'Active' }],
      }),
    );
    expect(decision).toEqual({
      kind: 'resolve',
      target: '/workspace/ws-1',
      openTabWorkspaceId: 'ws-1',
    });
  });

  it('prefers the persisted current tab over the first workspace', () => {
    const decision = decideBootRoute(
      input({
        setupGate: 'none',
        workspaceHasLoaded: true,
        workspaces: [
          { id: 'ws-1', status: 'Active' },
          { id: 'ws-2', status: 'Active' },
        ],
        currentTabId: 'ws-2',
      }),
    );
    expect(decision).toEqual({
      kind: 'resolve',
      target: '/workspace/ws-2',
      openTabWorkspaceId: 'ws-2',
    });
  });

  it('skips archived/deleted workspaces when picking the landing workspace', () => {
    const decision = decideBootRoute(
      input({
        setupGate: 'none',
        workspaceHasLoaded: true,
        workspaces: [
          { id: 'ws-archived', status: 'Archived' },
          { id: 'ws-deleted', status: 'Deleted' },
          { id: 'ws-live', status: 'Active' },
        ],
      }),
    );
    expect(decision).toEqual({
      kind: 'resolve',
      target: '/workspace/ws-live',
      openTabWorkspaceId: 'ws-live',
    });
  });

  it('holds while the setup gate is pending', () => {
    expect(decideBootRoute(input({ setupGate: 'pending' }))).toEqual({ kind: 'hold' });
  });

  it("holds until the workspace list loads when the gate is 'none'", () => {
    expect(decideBootRoute(input({ setupGate: 'none', workspaceHasLoaded: false }))).toEqual({
      kind: 'hold',
    });
  });

  it("holds until the active backend's persisted tabs are hydrated (tab-rehydration race)", () => {
    // The boot connections:list can flip the active backend after the initial
    // tab hydration; the workspace list winning that race must not resolve the
    // gate against a stale/empty currentTabId.
    expect(
      decideBootRoute(
        input({
          setupGate: 'none',
          workspaceHasLoaded: true,
          workspaces: [
            { id: 'ws-1', status: 'Active' },
            { id: 'ws-2', status: 'Active' },
          ],
          tabsHydrated: false,
        }),
      ),
    ).toEqual({ kind: 'hold' });
  });

  it('lands on the rehydrated persisted tab once tab hydration settles', () => {
    const decision = decideBootRoute(
      input({
        setupGate: 'none',
        workspaceHasLoaded: true,
        workspaces: [
          { id: 'ws-1', status: 'Active' },
          { id: 'ws-2', status: 'Active' },
        ],
        tabsHydrated: true,
        currentTabId: 'ws-2',
      }),
    );
    expect(decision).toEqual({
      kind: 'resolve',
      target: '/workspace/ws-2',
      openTabWorkspaceId: 'ws-2',
    });
  });

  it('stays on /workspace/new when the active backend needs first-run setup', () => {
    const decision = decideBootRoute(input({ setupGate: 'redirect' }));
    expect(decision).toEqual({ kind: 'resolve', target: null, openTabWorkspaceId: null });
  });

  it('routes a legacy / boot to /workspace/new when first-run setup is needed', () => {
    const decision = decideBootRoute(
      input({ bootPathname: '/', currentPathname: '/', setupGate: 'redirect' }),
    );
    expect(decision).toEqual({
      kind: 'resolve',
      target: '/workspace/new',
      openTabWorkspaceId: null,
    });
  });

  it('stays on /workspace/new (creation) when setup is not needed but no workspaces exist', () => {
    const decision = decideBootRoute(
      input({ setupGate: 'none', workspaceHasLoaded: true, workspaces: [] }),
    );
    expect(decision).toEqual({ kind: 'resolve', target: null, openTabWorkspaceId: null });
  });

  it('is inapplicable for a page load that starts on a concrete workspace route', () => {
    expect(
      decideBootRoute(
        input({
          bootPathname: '/workspace/ws-2',
          currentPathname: '/workspace/ws-2',
          setupGate: 'none',
          workspaceHasLoaded: true,
          workspaces: [{ id: 'ws-1', status: 'Active' }],
        }),
      ),
    ).toEqual({ kind: 'inapplicable' });
  });

  it('is inapplicable once the gate has resolved (fires at most once per page load)', () => {
    expect(
      decideBootRoute(
        input({
          gateResolved: true,
          setupGate: 'none',
          workspaceHasLoaded: true,
          workspaces: [{ id: 'ws-1', status: 'Active' }],
        }),
      ),
    ).toEqual({ kind: 'inapplicable' });
  });

  it('is inapplicable outside a browser (no boot pathname)', () => {
    expect(decideBootRoute(input({ bootPathname: null }))).toEqual({ kind: 'inapplicable' });
  });

  it('resolves without navigating when something already left the boot route (e.g. initialRoute)', () => {
    const decision = decideBootRoute(
      input({ currentPathname: '/workspace/ws-9', setupGate: 'pending' }),
    );
    expect(decision).toEqual({ kind: 'resolve', target: null, openTabWorkspaceId: null });
  });

  describe('bounded hold fallback (holdTimedOut)', () => {
    it("resolves best-effort when 'pending' never settles (nothing loaded → stay on /workspace/new)", () => {
      const decision = decideBootRoute(input({ setupGate: 'pending', holdTimedOut: true }));
      expect(decision).toEqual({ kind: 'resolve', target: null, openTabWorkspaceId: null });
    });

    it("lands on a loaded workspace when 'pending' times out but the list arrived", () => {
      const decision = decideBootRoute(
        input({
          setupGate: 'pending',
          holdTimedOut: true,
          workspaceHasLoaded: true,
          workspaces: [{ id: 'ws-1', status: 'Active' }],
        }),
      );
      expect(decision).toEqual({
        kind: 'resolve',
        target: '/workspace/ws-1',
        openTabWorkspaceId: 'ws-1',
      });
    });

    it("stops waiting for the workspace list / tab hydration once timed out (gate 'none')", () => {
      const decision = decideBootRoute(
        input({
          setupGate: 'none',
          holdTimedOut: true,
          workspaceHasLoaded: false,
          tabsHydrated: false,
        }),
      );
      expect(decision).toEqual({ kind: 'resolve', target: null, openTabWorkspaceId: null });
    });

    it("still honors a settled 'redirect' after the timeout", () => {
      const decision = decideBootRoute(
        input({
          bootPathname: '/',
          currentPathname: '/',
          setupGate: 'redirect',
          holdTimedOut: true,
        }),
      );
      expect(decision).toEqual({
        kind: 'resolve',
        target: '/workspace/new',
        openTabWorkspaceId: null,
      });
    });

    it('does not affect an already-resolved gate', () => {
      expect(decideBootRoute(input({ gateResolved: true, holdTimedOut: true }))).toEqual({
        kind: 'inapplicable',
      });
    });
  });
});
