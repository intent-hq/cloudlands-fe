import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const dispose = vi.fn();
  return {
    dispose,
    startHudSubscription: vi.fn(() => dispose),
    selectDockWorkspaces: vi.fn(() => ({
      subscribe(listener: (value: unknown[]) => void) {
        listener([]);
        return vi.fn();
      },
    })),
  };
});

vi.mock('$features/hud', () => ({ startHudSubscription: mocks.startHudSubscription }));
vi.mock('$store/renderer/slices/hud/hud-selectors', () => ({
  selectDockWorkspaces: mocks.selectDockWorkspaces,
}));

import Page from './+page.svelte';

afterEach(() => vi.clearAllMocks());

describe('/dock', () => {
  it('renders selector data and owns the live HUD subscription lifecycle', async () => {
    const view = render(Page);
    expect(screen.getByTestId('dock-shell')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'No active spaces' })).toBeTruthy();
    await waitFor(() => expect(mocks.startHudSubscription).toHaveBeenCalledOnce());
    expect(mocks.selectDockWorkspaces).toHaveBeenCalledOnce();

    view.unmount();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
