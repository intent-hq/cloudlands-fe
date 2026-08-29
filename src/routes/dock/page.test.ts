import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const disposeAppStore = vi.fn();
  const disposeHud = vi.fn();
  const startupOrder: string[] = [];
  return {
    disposeAppStore,
    disposeHud,
    startupOrder,
    dispatch: vi.fn((action: { type: string }) => startupOrder.push(`dispatch:${action.type}`)),
    startAppStoreLifecycle: vi.fn(() => {
      startupOrder.push('sagas:start');
      return disposeAppStore;
    }),
    startHudSubscription: vi.fn(() => {
      startupOrder.push('hud:start');
      return disposeHud;
    }),
    selectDockWorkspaces: vi.fn(() => ({
      subscribe(listener: (value: unknown[]) => void) {
        listener([]);
        return vi.fn();
      },
    })),
  };
});

vi.mock('$features/hud', () => ({ startHudSubscription: mocks.startHudSubscription }));
vi.mock('$store/renderer/app-store-lifecycle', () => ({
  startAppStoreLifecycle: mocks.startAppStoreLifecycle,
}));
vi.mock('$store/renderer/slices/hud/hud-selectors', () => ({
  selectDockWorkspaces: mocks.selectDockWorkspaces,
}));

import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
import { store as appStore } from '$store/renderer/store';
import Page from './+page.svelte';

beforeEach(() => {
  appStore.init();
  vi.spyOn(appStore, 'dispatch').mockImplementation(mocks.dispatch as typeof appStore.dispatch);
});

afterEach(() => {
  mocks.startupOrder.length = 0;
  vi.restoreAllMocks();
  appStore.dispose();
  vi.clearAllMocks();
});

describe('/dock', () => {
  it('starts data loading before the live HUD subscription and owns both lifecycles', async () => {
    const view = render(Page);
    expect(screen.getByTestId('dock-shell')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'No active spaces' })).toBeTruthy();
    await waitFor(() => expect(mocks.startHudSubscription).toHaveBeenCalledOnce());
    expect(mocks.startAppStoreLifecycle).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledWith(loadWorkspacesRequested());
    expect(mocks.startupOrder).toEqual([
      'sagas:start',
      `dispatch:${loadWorkspacesRequested.type}`,
      'hud:start',
    ]);
    expect(mocks.selectDockWorkspaces).toHaveBeenCalledOnce();

    view.unmount();
    expect(mocks.disposeAppStore).toHaveBeenCalledOnce();
    expect(mocks.disposeHud).toHaveBeenCalledOnce();
  });
});
