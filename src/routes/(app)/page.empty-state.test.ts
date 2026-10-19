/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';

import { store } from '$store/renderer/store';
import { setWorkspaceHasLoaded } from '$store/renderer/slices/workspace/workspace-slice';
import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

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

describe('home tab navigation', () => {
  it('keeps the selected tab across leaving and returning to Home', async () => {
    const homeTab = (name: string) =>
      within(
        screen.getByRole('navigation', { name: m.home_navigation_label(), exact: true }),
      ).getByRole('tab', { name, exact: true });
    const firstVisit = render(HomePage);
    await fireEvent.click(homeTab(m.home_assistant()));
    await waitFor(() => {
      expect(homeTab(m.home_assistant()).getAttribute('aria-selected')).toBe('true');
      expect(store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[CHIEF_WORKSPACE_ID]).toBe(
        'hydrated',
      );
    });

    firstVisit.unmount();
    expect(store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[CHIEF_WORKSPACE_ID]).toBe(
      undefined,
    );

    const secondVisit = render(HomePage);
    await waitFor(() =>
      expect(homeTab(m.home_assistant()).getAttribute('aria-selected')).toBe('true'),
    );
    await fireEvent.click(homeTab(m.home_tab_workspaces()));
    await waitFor(() =>
      expect(homeTab(m.home_tab_workspaces()).getAttribute('aria-selected')).toBe('true'),
    );

    secondVisit.unmount();
    render(HomePage);
    await waitFor(() =>
      expect(homeTab(m.home_tab_workspaces()).getAttribute('aria-selected')).toBe('true'),
    );
  });
});
