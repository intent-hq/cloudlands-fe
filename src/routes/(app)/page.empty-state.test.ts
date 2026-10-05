/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';

import { store } from '$store/renderer/store';
import { setWorkspaceHasLoaded } from '$store/renderer/slices/workspace/workspace-slice';
import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';

import HomePage from './+page.svelte';

beforeEach(() => {
  store.init();
  admitLegacyPrincipal();
  store.dispatch(setWorkspaceHasLoaded(true));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  store.dispose();
});

describe('home empty state', () => {
  it('requests the workspace creation flow only when the primary action is activated', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');
    render(HomePage);
    expect(dispatch).not.toHaveBeenCalledWith(setShowCreateModal(true));

    const emptyState = screen
      .getByRole('heading', { name: m.home_empty_title() })
      .closest('[data-slot="empty-state"]');
    expect(emptyState).not.toBeNull();
    dispatch.mockClear();
    await fireEvent.click(
      within(emptyState as HTMLElement).getByRole('button', { name: m.home_new_workspace() }),
    );

    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'sidebarNav/setShowCreateModal',
      payload: [true],
    });
  });
});
