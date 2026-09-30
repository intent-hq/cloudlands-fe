/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import { WorkspaceId } from '$shared/types/branded-ids';
import {
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import Harness from './OneRowTaskSurfaceHarness.svelte';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(() => {
    throw new Error('Task display fixture must not request a backend');
  }),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

const workspaceId = WorkspaceId('workspace-one-row-task');
let disposeBootstrap: () => void;
beforeEach(() => {
  // Match playwright/index.ts: the CT host initializes the real store before mounting.
  disposeBootstrap = store.init();
});
afterEach(() => {
  cleanup();
  disposeBootstrap();
});

it('renders the original ten rows and four assignment controls for its admitted workspace', async () => {
  const { container } = render(Harness);
  await waitFor(() => {
    expect(container.querySelectorAll('[data-task-item-row]')).toHaveLength(10);
    expect(container.querySelectorAll('[data-task-row-assign]')).toHaveLength(4);
  });
  expect(selectWorkspaceById.select(store.state, workspaceId)?.myRole).toBe('owner');
});

it('keeps assignments hidden before caller admission even with the fixture workspace present', async () => {
  const { container } = render(Harness, { admittedOwner: false });
  await waitFor(() => expect(container.querySelectorAll('[data-task-item-row]')).toHaveLength(10));
  expect(selectWorkspaceById.select(store.state, workspaceId)).toBeDefined();
  expect(container.querySelectorAll('[data-task-row-assign]')).toHaveLength(0);
});

it.each(['revoked caller', 'guest caller', 'missing workspace', 'collaborator workspace'] as const)(
  'withdraws assignment controls after %s without changing the task rows',
  async (denial) => {
    const { container } = render(Harness);
    await waitFor(() =>
      expect(container.querySelectorAll('[data-task-row-assign]')).toHaveLength(4),
    );
    if (denial === 'revoked caller') store.dispatch(principalContextChanged(null));
    else if (denial === 'guest caller') admitLegacyPrincipal('guest');
    else if (denial === 'missing workspace') store.dispatch(removeWorkspaceEntity(workspaceId));
    else {
      const row = selectWorkspaceById.select(store.state, workspaceId)!;
      store.dispatch(setWorkspaceEntity({ ...row, myRole: 'collaborator' }));
    }
    await waitFor(() =>
      expect(container.querySelectorAll('[data-task-row-assign]')).toHaveLength(0),
    );
    expect(container.querySelectorAll('[data-task-item-row]')).toHaveLength(10);
  },
);

it('releases only the workspace row it created', async () => {
  const { container, unmount } = render(Harness);
  await waitFor(() => expect(container.querySelectorAll('[data-task-row-assign]')).toHaveLength(4));
  await unmount();
  expect(selectWorkspaceById.select(store.state, workspaceId)).toBeUndefined();
});

it('does not remove a later replacement of its workspace row', async () => {
  const { container, unmount } = render(Harness);
  await waitFor(() => expect(container.querySelectorAll('[data-task-row-assign]')).toHaveLength(4));
  const row = selectWorkspaceById.select(store.state, workspaceId)!;
  store.dispatch(setWorkspaceEntity({ ...row, title: 'Replacement workspace' }));
  await unmount();
  expect(selectWorkspaceById.select(store.state, workspaceId)?.title).toBe('Replacement workspace');
});
