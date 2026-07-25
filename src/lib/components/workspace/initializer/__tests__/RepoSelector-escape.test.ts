/**
 * RepoSelector.svelte Escape handling via the escape-layer stack.
 * The dropdown pushes an escape layer while open, so Escape dismisses it
 * (and only it, when stacked under other overlays — see the NewSpaceModal
 * regression test in modals/__tests__).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

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

// Stub the heavy nested modals (BE-driven folder picker, remote setup)
vi.mock('$features/onboarding/messages/DirectoryPickerModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));
vi.mock('$lib/components/workspace/initializer/AddRemoteSetupModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import RepoSelector from '../RepoSelector.svelte';

const DROPDOWN_HEADING = 'What repo should we work on?';

/** Open the dropdown by clicking the select trigger (first button rendered). */
async function openDropdown(container: HTMLElement) {
  const trigger = container.querySelector('button');
  expect(trigger).toBeTruthy();
  await fireEvent.click(trigger!);
}

describe('RepoSelector Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape dismisses the open dropdown', async () => {
    const { container } = render(RepoSelector, { props: {} });
    await openDropdown(container);
    await waitFor(() => {
      expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText(DROPDOWN_HEADING)).toBeFalsy();
    });
  });

  it('Escape is not consumed while the dropdown is closed (no layer registered)', async () => {
    render(RepoSelector, { props: {} });
    expect(screen.queryByText(DROPDOWN_HEADING)).toBeFalsy();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
