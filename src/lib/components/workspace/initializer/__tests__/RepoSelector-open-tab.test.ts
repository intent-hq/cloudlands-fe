/**
 * @vitest-environment jsdom
 *
 * Regression: the repo picker dropdown must open on the tab matching the
 * selection restored through the `value` prop. A GitHub pick (owner/repo
 * shorthand or URL) used to be misclassified as local because
 * `selectedRepoType` defaulted to 'local' and the value-prop sync never
 * re-derived it, so the popup wrongly opened on "Copy local repo".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => {
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (v: T) => void) {
      run(getter());
      return () => {};
    },
  });
  const selector = <T>(getter: () => T) => {
    const fn = () => readable(getter);
    return Object.assign(fn, { select: () => getter() });
  };
  return { selector, dispatch: vi.fn() };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  initializeGitHubAuth: () => ({ type: 'githubAuth/initialize' }),
  startGitHubAuth: () => ({ type: 'githubAuth/start' }),
  cancelGitHubAuth: () => ({ type: 'githubAuth/cancel' }),
  clearGitHubAuthError: () => ({ type: 'githubAuth/clearError' }),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(() => false),
  selectGitHubAuthIsAuthenticating: mocks.selector(() => false),
  selectGitHubAuthDeviceFlow: mocks.selector(() => null),
  selectGitHubAuthError: mocks.selector(() => null),
  selectGitHubAuthRequiresDaemonAuth: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-slice', () => ({
  loadGithubRepos: () => ({ type: 'githubRepos/load' }),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-selectors', () => ({
  selectGithubRepos: mocks.selector(() => []),
  selectGithubReposError: mocks.selector(() => null),
  selectGithubReposLoaded: mocks.selector(() => true),
  selectGithubReposLoading: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/github-repo-search/github-repo-search-slice', () => ({
  searchGithubRepos: (query: string) => ({ type: 'githubRepoSearch/search', payload: [query] }),
}));
vi.mock('$store/renderer/slices/github-repo-search/github-repo-search-selectors', () => ({
  selectGithubRepoSearchLastQuery: mocks.selector(() => ''),
  selectGithubRepoSearchLoading: mocks.selector(() => false),
  selectGithubRepoSearchResults: mocks.selector(() => []),
}));

vi.mock(
  '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors',
  () => ({
    selectWorkspaceInitializerDefaultParentPath: mocks.selector(() => ''),
    selectWorkspaceInitializerRecentRepos: mocks.selector(() => []),
    selectWorkspaceInitializerRemoteSetups: mocks.selector(() => []),
  }),
);
vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-slice', () => ({
  setWorkspaceInitializerDefaultParentPath: (path: string) => ({ type: 'wi/parent', payload: path }),
  setWorkspaceInitializerLastSelectedRepo: (repo: unknown) => ({ type: 'wi/last', payload: repo }),
  setWorkspaceInitializerRecentRepos: (repos: unknown) => ({ type: 'wi/recent', payload: repos }),
  setWorkspaceInitializerRemoteSetups: (s: unknown) => ({ type: 'wi/remote', payload: s }),
}));
vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  replaceWorkspaceList: (workspaces: unknown) => ({ type: 'workspace/replace', payload: workspaces }),
}));
vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { list: vi.fn(async () => ({ ok: true, data: [] })) },
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: mocks.selector(() => []),
}));
vi.mock('$store/renderer/slices/feature-codes/feature-codes-selectors', () => ({
  selectIsFeatureEnabled: mocks.selector(() => false),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async () => ({ success: true, data: [] })),
  shell: { open: vi.fn(async () => {}) },
}));
vi.mock('$lib/config/debug', () => ({ debugConfig: { get: () => false } }));
vi.mock('$lib/utils/performance', () => ({
  performanceMonitor: { start: vi.fn(), end: vi.fn() },
}));
vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});
vi.mock('$features/onboarding/messages/DirectoryPickerModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));
vi.mock('$lib/components/workspace/initializer/AddRemoteSetupModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import RepoSelector from '../RepoSelector.svelte';
import { warmImport } from '../../../../../test/warm-import';

const DROPDOWN_HEADING = 'What repo should we work on?';
const ACTIVE_TAB_CLASS = 'bg-background';

warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockComponent.svelte'));

/** Render with the given props and open the dropdown from the trigger. */
async function openDropdown(props: Record<string, unknown> = {}) {
  const rendered = render(RepoSelector, { props });
  const trigger = rendered.container.querySelector('button')!;
  await fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy());
  return rendered;
}

/** The dropdown is portalled to <body>; find a tab button by its label. */
function tabButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === label,
  );
  expect(button, `tab button "${label}"`).toBeTruthy();
  return button!;
}

const githubInput = () =>
  screen.queryByPlaceholderText('owner/repo') as HTMLInputElement | null;

describe('RepoSelector open tab derived from the value prop', () => {
  afterEach(() => {
    cleanup();
    mocks.dispatch.mockReset();
  });

  it('opens on "Pick a repo" with the input prefilled for an owner/repo shorthand value', async () => {
    await openDropdown({ value: 'octo/alpha' });

    expect(tabButton('Pick a repo').className).toContain(ACTIVE_TAB_CLASS);
    expect(tabButton('Copy local repo').className).not.toContain(ACTIVE_TAB_CLASS);
    expect(githubInput()?.value).toBe('octo/alpha');
  });

  it('opens on "Pick a repo" with the input prefilled for a GitHub URL value', async () => {
    await openDropdown({ value: 'https://github.com/octo/alpha' });

    expect(tabButton('Pick a repo').className).toContain(ACTIVE_TAB_CLASS);
    expect(githubInput()?.value).toBe('octo/alpha');
  });

  it('opens on "Copy local repo" for a filesystem path value', async () => {
    await openDropdown({ value: '/Users/dev/my-repo' });

    expect(tabButton('Copy local repo').className).toContain(ACTIVE_TAB_CLASS);
    expect(tabButton('Pick a repo').className).not.toContain(ACTIVE_TAB_CLASS);
    expect(githubInput()).toBeNull();
  });

  it('defaults to "Pick a repo" when nothing is selected', async () => {
    await openDropdown();

    expect(tabButton('Pick a repo').className).toContain(ACTIVE_TAB_CLASS);
    expect(tabButton('Copy local repo').className).not.toContain(ACTIVE_TAB_CLASS);
    expect(githubInput()?.value).toBe('');
  });
});
