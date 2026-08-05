/**
 * RepoSelector.svelte Escape handling via the escape-layer stack.
 * The dropdown pushes an escape layer while open, so Escape dismisses it
 * (and only it, when stacked under other overlays — see the NewSpaceModal
 * regression test in modals/__tests__).
 * Also covers the Recent list rendering (owner-qualified repo names) and
 * plain-text search filtering from the GitHub tab (intent-hq/monorepo#859).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

const mockRepos = vi.hoisted(() => ({
  recentRepos: [] as Array<{
    path: string;
    type: 'local' | 'github';
    githubUrl?: string;
    name: string;
    owner?: string;
  }>,
}));

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
      selectWorkspaceInitializerRecentRepos: store.createSelector(() => mockRepos.recentRepos),
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

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

// Stub the heavy nested modals (BE-driven folder picker, remote setup)
vi.mock('$features/onboarding/messages/DirectoryPickerModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));
vi.mock('$lib/components/workspace/initializer/AddRemoteSetupModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import RepoSelector from '../RepoSelector.svelte';
import { warmImport } from '../../../../../test/warm-import';

const DROPDOWN_HEADING = 'What repo should we work on?';

/** Open the dropdown by clicking the select trigger (first button rendered). */
async function openDropdown(container: HTMLElement) {
  const trigger = container.querySelector('button');
  expect(trigger).toBeTruthy();
  await fireEvent.click(trigger!);
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockComponent.svelte'));

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

describe('RepoSelector trigger suffix rendering', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a dimmed (owner/repo) suffix after the repo name when triggerSuffix is set', () => {
    const { container } = render(RepoSelector, {
      props: { value: '/Users/dev/app', triggerSuffix: 'acme/app' },
    });

    const suffix = screen.getByText('(acme/app)');
    expect(suffix).toBeTruthy();
    expect(suffix.className).toContain('text-subtle');
    const trigger = container.querySelector('button');
    expect(trigger!.textContent?.replace(/\s+/g, ' ').trim()).toBe('app (acme/app)');
  });

  it('renders no suffix (and no empty parens) when triggerSuffix is not set', () => {
    const { container } = render(RepoSelector, {
      props: { value: '/Users/dev/app' },
    });

    const trigger = container.querySelector('button');
    expect(trigger!.textContent?.replace(/\s+/g, ' ').trim()).toBe('app');
  });
});

describe('RepoSelector Recent list owner rendering', () => {
  afterEach(() => {
    mockRepos.recentRepos = [];
    cleanup();
  });

  it('shows owner-qualified name when owner is set and plain name otherwise', async () => {
    mockRepos.recentRepos = [
      { path: '/Users/dev/app', type: 'local', name: 'app', owner: 'acme' },
      { path: '/Users/dev/solo', type: 'local', name: 'solo' },
    ];
    const { container } = render(RepoSelector, { props: {} });
    await openDropdown(container);
    await waitFor(() => {
      expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText('acme /')).toBeTruthy();
      expect(screen.getByText('app')).toBeTruthy();
      expect(screen.getByText('solo')).toBeTruthy();
    });

    // The ownerless row must render the name only — no stray owner prefix.
    const soloRow = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('solo'));
    expect(soloRow).toBeTruthy();
    expect(soloRow!.textContent?.replace(/\s+/g, ' ').trim()).toBe('solo');
  });
});

describe('RepoSelector Recent list search filtering (GitHub tab)', () => {
  afterEach(() => {
    mockRepos.recentRepos = [];
    cleanup();
  });

  async function openGitHubTab() {
    mockRepos.recentRepos = [
      {
        path: '/Users/dev/clones/monorepo',
        type: 'github',
        githubUrl: 'https://github.com/intent-hq/monorepo',
        name: 'monorepo',
        owner: 'intent-hq',
      },
      {
        path: '/Users/dev/clones/react',
        type: 'github',
        githubUrl: 'https://github.com/facebook/react',
        name: 'react',
        owner: 'facebook',
      },
    ];
    const { container } = render(RepoSelector, { props: {} });
    await openDropdown(container);
    await waitFor(() => {
      expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy();
    });

    await fireEvent.click(screen.getByText('Clone from GitHub'));
    await waitFor(() => {
      expect(screen.getByText('monorepo')).toBeTruthy();
      expect(screen.getByText('react')).toBeTruthy();
    });

    return screen.getByPlaceholderText('owner/repo');
  }

  it('filters the Recent list by owner when plain text is typed', async () => {
    const input = await openGitHubTab();

    await fireEvent.input(input, { target: { value: 'intent-hq' } });

    await waitFor(() => {
      expect(screen.queryByText('react')).toBeFalsy();
      expect(screen.getByText('monorepo')).toBeTruthy();
    });
  });

  it('filters the Recent list by repo name when plain text is typed', async () => {
    const input = await openGitHubTab();

    await fireEvent.input(input, { target: { value: 'react' } });

    await waitFor(() => {
      expect(screen.queryByText('monorepo')).toBeFalsy();
      expect(screen.getByText('react')).toBeTruthy();
    });
  });

  it('filters the Recent list by owner/repo when a slash-form string is typed', async () => {
    const input = await openGitHubTab();

    await fireEvent.input(input, { target: { value: 'intent-hq/mono' } });

    await waitFor(() => {
      expect(screen.queryByText('react')).toBeFalsy();
      expect(screen.getByText('monorepo')).toBeTruthy();
    });
  });
});
