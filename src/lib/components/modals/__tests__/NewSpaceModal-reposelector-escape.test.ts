/**
 * Regression test: RepoSelector dropdown open inside NewSpaceModal.
 *
 * Bug (headline of the escape-stack migration): with the repo dropdown open
 * inside the New Workspace dialog, a single Escape press closed BOTH the
 * dropdown and the dialog. With the escape-layer stack, Escape #1 closes only
 * the dropdown (topmost layer) and Escape #2 closes the dialog.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

// Stub the heavy initializer (Redux store, navigation, etc.) — the real app
// renders RepoSelector inside it; here RepoSelector is rendered alongside the
// modal, preserving the layer order (modal first, dropdown on top).
vi.mock('$lib/components/workspace/CompactWorkspaceInitializer.svelte', async () => ({
  default: (await import('./mocks/MockCompactWorkspaceInitializer.svelte')).default,
}));

// ── RepoSelector dependencies ──────────────────────────────────────────────
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: {} });
});

vi.mock(
  '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors',
  async () => {
    const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
    const store = createAppStoreMock({ state: {} });
    return {
      selectWorkspaceInitializerDefaultParentPath: store.createSelector(() => ''),
      selectWorkspaceInitializerRecentRepos: store.createSelector(() => []),
      selectWorkspaceInitializerRemoteSetups: store.createSelector(() => []),
    };
  },
);

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-slice', () => ({
  setWorkspaceInitializerDefaultParentPath: (path: string) => ({
    type: 'workspaceInitializer/setDefaultParentPath',
    payload: path,
  }),
  setWorkspaceInitializerLastSelectedRepo: (repo: unknown) => ({
    type: 'workspaceInitializer/setLastSelectedRepo',
    payload: repo,
  }),
  setWorkspaceInitializerRecentRepos: (repos: unknown) => ({
    type: 'workspaceInitializer/setRecentRepos',
    payload: repos,
  }),
  setWorkspaceInitializerRemoteSetups: (setups: unknown) => ({
    type: 'workspaceInitializer/setRemoteSetups',
    payload: setups,
  }),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  replaceWorkspaceList: (workspaces: unknown) => ({
    type: 'workspace/replaceWorkspaceList',
    payload: workspaces,
  }),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { list: vi.fn(async () => ({ ok: true, data: [] })) },
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return {
    selectWorkspaceItems: store.createSelector(() => []),
  };
});

vi.mock('$store/renderer/slices/feature-codes/feature-codes-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return { selectIsFeatureEnabled: store.createSelector(() => false) };
});

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async () => ({ success: true, data: [] })),
}));

vi.mock('$lib/config/debug', () => ({ debugConfig: { get: () => false } }));
vi.mock('$lib/utils/performance', () => ({
  performanceMonitor: { start: vi.fn(), end: vi.fn() },
}));

vi.mock('$features/onboarding/messages/DirectoryPickerModal.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));
vi.mock('$lib/components/workspace/initializer/AddRemoteSetupModal.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));

import NewSpaceModal from '../NewSpaceModal.svelte';
import RepoSelector from '../../workspace/initializer/RepoSelector.svelte';
import { warmImport } from '../../../../test/warm-import';

const DROPDOWN_HEADING = 'What repo should we work on?';

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockCompactWorkspaceInitializer.svelte'));
warmImport(() => import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'));

describe('NewSpaceModal + RepoSelector dropdown Escape ordering', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape #1 closes only the dropdown, Escape #2 closes the dialog', async () => {
    const modalOnClose = vi.fn();

    // Modal opens first (registers its escape layer first)
    render(NewSpaceModal, { props: { open: true, onClose: modalOnClose } });
    await waitFor(() => {
      expect(screen.getByText('New Workspace')).toBeTruthy();
    });

    // RepoSelector dropdown opens on top (registers its escape layer second)
    const { container } = render(RepoSelector, { props: {} });
    const trigger = container.querySelector('button');
    expect(trigger).toBeTruthy();
    await fireEvent.click(trigger!);
    await waitFor(() => {
      expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy();
    });

    // Escape #1: closes only the dropdown — the dialog stays open
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText(DROPDOWN_HEADING)).toBeFalsy();
    });
    expect(modalOnClose).not.toHaveBeenCalled();
    expect(screen.getByText('New Workspace')).toBeTruthy();

    // Escape #2: closes the dialog
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('New Workspace')).toBeFalsy();
    });
    expect(modalOnClose).toHaveBeenCalledTimes(1);
  });
});
