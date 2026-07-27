/**
 * @vitest-environment jsdom
 *
 * Regression tests for monorepo#823 — selecting a GitHub repo during
 * onboarding must not reset a user-chosen clone destination.
 *
 * `handleSelectRepo` (and the owner/repo auto-fill in `handleInputChange`)
 * used to call `onClonePathChange(defaultCloneBase)` unconditionally, so a
 * destination the user had already picked (e.g. ~/src) silently reverted to
 * the default (~/Developer). The fix tracks a user-dirty flag: the default
 * base is only auto-filled while the path is untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

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
  const dispatch = vi.fn();
  const repos = [
    { id: 'octo/alpha', owner: 'octo', name: 'alpha' },
    { id: 'octo/beta', owner: 'octo', name: 'beta' },
  ];
  return { readable, selector, dispatch, repos };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

vi.mock('$lib/electron-bridge', () => ({
  shell: { open: vi.fn(() => Promise.resolve()) },
}));

vi.mock('$lib/directory-picker-service', () => ({
  pickDirectory: vi.fn(async ({ openModal }: { openModal: () => void }) => openModal()),
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  initializeGitHubAuth: () => ({ type: 'githubAuth/initialize' }),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(() => true),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-slice', () => ({
  loadGithubRepos: () => ({ type: 'githubRepos/load' }),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-selectors', () => ({
  selectGithubRepos: mocks.selector(() => mocks.repos),
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
vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerDefaultParentPath: mocks.selector(() => '~/Developer'),
}));

vi.mock('../DirectoryPickerModal.svelte', async () => {
  const MockModal = (await import('./mocks/MockDirectoryPickerModal.svelte')).default;
  return { default: MockModal };
});

import GitHubRepoTab from '../GitHubRepoTab.svelte';

const baseProps = () => ({
  githubUrl: '',
  clonePath: '~/Developer',
  onGithubUrlChange: vi.fn(),
  onClonePathChange: vi.fn(),
});

const repoOptions = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="option"]'));

const pickerButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>(
    'button[aria-label="Choose clone destination folder"]',
  )!;

describe('GitHubRepoTab clone destination (#823)', () => {
  afterEach(() => {
    cleanup();
    mocks.dispatch.mockReset();
  });

  it('untouched default: selecting and switching repos keeps filling the default base', async () => {
    const props = baseProps();
    const { container } = render(GitHubRepoTab, { props });

    const options = repoOptions(container);
    expect(options).toHaveLength(2);

    await fireEvent.click(options[0]);
    expect(props.onGithubUrlChange).toHaveBeenCalledWith('https://github.com/octo/alpha');
    expect(props.onClonePathChange).toHaveBeenCalledWith('~/Developer');

    await fireEvent.click(options[1]);
    expect(props.onGithubUrlChange).toHaveBeenCalledWith('https://github.com/octo/beta');
    expect(props.onClonePathChange).toHaveBeenLastCalledWith('~/Developer');
  });

  it('destination picked via the picker survives selecting a repo', async () => {
    const props = baseProps();
    const { container, rerender } = render(GitHubRepoTab, { props });

    await fireEvent.click(pickerButton(container));
    const select = container.querySelector<HTMLButtonElement>('[data-testid="mock-picker-select"]');
    expect(select).toBeTruthy();
    await fireEvent.click(select!);
    expect(props.onClonePathChange).toHaveBeenCalledExactlyOnceWith('/Users/me/src');

    await rerender({ ...props, clonePath: '/Users/me/src' });

    await fireEvent.click(repoOptions(container)[0]);
    expect(props.onGithubUrlChange).toHaveBeenCalledWith('https://github.com/octo/alpha');
    expect(props.onClonePathChange).toHaveBeenCalledExactlyOnceWith('/Users/me/src');
  });

  it('remounting with a user-chosen path (tab switch) still preserves it on repo select', async () => {
    const props = { ...baseProps(), clonePath: '/Users/me/src' };
    const { container } = render(GitHubRepoTab, { props });

    await fireEvent.click(repoOptions(container)[0]);
    expect(props.onGithubUrlChange).toHaveBeenCalledWith('https://github.com/octo/alpha');
    expect(props.onClonePathChange).not.toHaveBeenCalled();
  });

  it('typing owner/repo does not reset a user-chosen destination', async () => {
    const props = { ...baseProps(), clonePath: '/Users/me/src' };
    const { container } = render(GitHubRepoTab, { props });

    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await fireEvent.input(input, { target: { value: 'octo/alpha' } });

    expect(props.onGithubUrlChange).toHaveBeenCalledWith('https://github.com/octo/alpha');
    expect(props.onClonePathChange).not.toHaveBeenCalled();
  });

  it('typing owner/repo with an untouched default still fills the default base', async () => {
    const props = baseProps();
    const { container } = render(GitHubRepoTab, { props });

    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await fireEvent.input(input, { target: { value: 'octo/alpha' } });

    expect(props.onGithubUrlChange).toHaveBeenCalledWith('https://github.com/octo/alpha');
    expect(props.onClonePathChange).toHaveBeenCalledWith('~/Developer');
  });

  // The pre-filled githubUrl narrows the repo list to the matching repo, so
  // widen the filter (type just the owner) before clicking the other repo.
  const widenFilter = async (container: HTMLElement) => {
    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await fireEvent.input(input, { target: { value: 'octo' } });
  };

  it('hydrated full path on the default base counts as untouched: switching repos refills the default', async () => {
    // Persisted selections store the FULL clone path (base + repo name, see
    // ProjectPickerMessage.buildSelection). A default-base full path must not
    // count as user-chosen, or switching repos would nest paths.
    const props = {
      ...baseProps(),
      githubUrl: 'https://github.com/octo/alpha',
      clonePath: '~/Developer/alpha',
    };
    const { container } = render(GitHubRepoTab, { props });
    await widenFilter(container);

    await fireEvent.click(repoOptions(container)[1]);
    expect(props.onGithubUrlChange).toHaveBeenCalledWith('https://github.com/octo/beta');
    expect(props.onClonePathChange).toHaveBeenCalledExactlyOnceWith('~/Developer');
  });

  it('hydrated full path on a user-chosen base swaps back to the base on repo switch', async () => {
    const props = {
      ...baseProps(),
      githubUrl: 'https://github.com/octo/alpha',
      clonePath: '/Users/me/src/alpha',
    };
    const { container } = render(GitHubRepoTab, { props });
    await widenFilter(container);

    await fireEvent.click(repoOptions(container)[1]);
    expect(props.onGithubUrlChange).toHaveBeenCalledWith('https://github.com/octo/beta');
    expect(props.onClonePathChange).toHaveBeenCalledExactlyOnceWith('/Users/me/src');
  });
});
