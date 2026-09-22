import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';
import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet, hasContext } from 'svelte';

// Mock factories run lazily on first import, so they double as a probe of
// which route layout actually pulls the app-only modules into its graph.
const mocks = vi.hoisted(() => {
  const loaded = { sagas: false, seeders: false, actionKeyHud: false, appStoreLifecycle: false };
  return {
    loaded,
    startRootStoreLifecycle: vi.fn(() => () => {}),
    seededBeforeAppLifecycle: null as boolean | null,
    startAppStoreLifecycle: vi.fn(() => {
      mocks.seededBeforeAppLifecycle = loaded.seeders;
      return () => {};
    }),
  };
});

vi.mock('$store/renderer/root-store-lifecycle', () => ({
  startRootStoreLifecycle: mocks.startRootStoreLifecycle,
}));
vi.mock('$store/renderer/app-store-lifecycle', () => {
  mocks.loaded.appStoreLifecycle = true;
  return { startAppStoreLifecycle: mocks.startAppStoreLifecycle };
});
vi.mock('$store/renderer/sagas', () => {
  mocks.loaded.sagas = true;
  return { startAllAppSagas: () => [] };
});
vi.mock('$store/renderer/seeders', () => {
  mocks.loaded.seeders = true;
  return {};
});
vi.mock('$features/hardware-console/actions/ActionKeyHud.svelte', async () => {
  mocks.loaded.actionKeyHud = true;
  return { default: (await import('./mocks/Marker.svelte')).default };
});
// Native animation behavior is covered in window-blur-animations.ct.spec.ts.
vi.mock('$lib/actions/pause-window-animations', () => ({
  pauseWindowAnimations: () => ({ destroy() {} }),
}));
vi.mock('$features/backend/splash-gate', () => ({
  dismissSplashElement: () => {},
  wireSplashGate: () => () => {},
}));
vi.mock('$lib/utils/history-navigation', () => ({
  attachMouseHistoryNavigation: () => () => {},
  handleHistoryNavigateIpc: () => {},
}));

import { store as appStore } from '$store/renderer/store';
import {
  WORKSPACE_ROUTE_CONTEXT,
  getWorkspaceRouteContext,
} from '$lib/utils/workspace-route-context';
import RootLayout from '../+layout.svelte';

const childrenSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="root-children">content</div>',
}));

// Reads the workspace route context from the component context the root
// layout renders its children in, so a root-owned provider would be observed.
const observedRouteContext: { value?: unknown; keyPresent?: boolean } = {};
const contextProbeSnippet = createRawSnippet(() => ({
  render: () => '<div data-testid="root-children">content</div>',
  setup: () => {
    observedRouteContext.value = getWorkspaceRouteContext();
    observedRouteContext.keyPresent = hasContext(WORKSPACE_ROUTE_CONTEXT);
  },
}));

function useStoreLifecycle() {
  beforeEach(() => {
    appStore.init();
    mocks.startRootStoreLifecycle.mockClear();
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
  });
}

describe('root +layout.svelte sandbox Store lifecycle', () => {
  useStoreLifecycle();

  it('initializes the shared root Store without owning app sagas', () => {
    render(RootLayout, { props: { children: childrenSnippet } });
    const lifecycle = mocks.startRootStoreLifecycle.mock.calls[0]?.[1] as {
      startSagas: (store: typeof appStore) => Array<() => void>;
    };

    expect(lifecycle.startSagas(appStore)).toEqual([]);
    expect(screen.getByTestId('root-children')).toBeTruthy();
  });

  it('keeps app-only saga and action HUD imports out of the root layout graph', () => {
    render(RootLayout, { props: { children: childrenSnippet } });
    expect(mocks.loaded).toEqual({
      sagas: false,
      seeders: false,
      actionKeyHud: false,
      appStoreLifecycle: false,
    });
    expect(mocks.startAppStoreLifecycle).not.toHaveBeenCalled();
  });

  it('does not provide a workspace route context to its children', () => {
    observedRouteContext.value = 'unset';
    observedRouteContext.keyPresent = undefined;
    render(RootLayout, { props: { children: contextProbeSnippet } });

    expect(screen.getByTestId('root-children')).toBeTruthy();
    expect(observedRouteContext.keyPresent).toBe(false);
    expect(observedRouteContext.value).toBeUndefined();
  });
});

// Imported after the root-layout probes so its graph does not pre-load the
// app-only modules those probes assert are absent.
describe('hud +layout.svelte Store lifecycle', () => {
  let HudLayout: Component<{ children: typeof childrenSnippet }>;
  beforeAll(async () => {
    HudLayout = (await import('../hud/+layout.svelte')).default;
  });
  useStoreLifecycle();

  it('seeds the store before starting the app lifecycle, without the action HUD', () => {
    render(HudLayout, { props: { children: childrenSnippet } });

    expect(mocks.startAppStoreLifecycle).toHaveBeenCalledExactlyOnceWith(appStore, undefined);
    expect(mocks.seededBeforeAppLifecycle).toBe(true);
    expect(mocks.loaded.sagas).toBe(false);
    expect(mocks.loaded.actionKeyHud).toBe(false);
  });
});
