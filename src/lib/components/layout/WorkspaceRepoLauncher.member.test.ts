import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
import Harness from './__tests__/WorkspaceRepoLauncherFocusHarness.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('workspace launcher current member authority', () => {
  it('lets a confirmed member create on an empty host without repository connections', async () => {
    render(Harness, { role: 'member', multiplayer: true });
    expect(store.state.workspace.workspaces.ids).toHaveLength(0);
    const dispatch = vi.spyOn(store, 'dispatch');
    await fireEvent.click(screen.getByRole('button', { name: 'New Workspace' }));
    expect(dispatch).toHaveBeenCalledWith(setShowCreateModal(true));
    expect(store.state.principal.snapshot?.principal.isAdministrator).toBe(false);
  });

  it.each([
    ['guest', true],
    ['member', false],
  ] as const)('withholds creation for %s with Multiplayer=%s', (role, multiplayer) => {
    render(Harness, { role, multiplayer });
    expect(screen.queryByRole('button', { name: 'New Workspace' })).toBeNull();
  });

  it.each(['lab-off', 'unknown'] as const)(
    'withdraws member creation after %s without accepting a stale button click',
    async (change) => {
      render(Harness, { role: 'member', multiplayer: true });
      const button = screen.getByRole('button', { name: 'New Workspace' });
      const dispatch = vi.spyOn(store, 'dispatch');
      if (change === 'lab-off') store.dispatch(setLabsMultiplayerEnabled(false));
      else store.dispatch(principalContextChanged(null));
      await fireEvent.click(button);
      expect(dispatch).not.toHaveBeenCalledWith(setShowCreateModal(true));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'New Workspace' })).toBeNull(),
      );
    },
  );

  it('retains ordinary owner creation when Multiplayer is disabled', async () => {
    render(Harness, { role: 'owner', multiplayer: false });
    await fireEvent.click(screen.getByRole('button', { name: 'New Workspace' }));
    expect(store.state.sidebarNav.showCreateModal).toBe(true);
  });
});
