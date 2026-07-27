/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../RepoSelector.svelte', async () => ({
  default: (await import('./mocks/MockRepoSelector.svelte')).default,
}));

vi.mock('../BranchSelector.svelte', async () => ({
  default: (await import('./mocks/MockBranchSelector.svelte')).default,
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: { get: vi.fn(async () => ({ value: false })) },
  },
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return {
    selectWorkspaceItems: store.createSelector(() => []),
  };
});

import RepoAndBranchPicker from '../RepoAndBranchPicker.svelte';

describe('RepoAndBranchPicker', () => {
  it('renders GitHub metadata repo display when only githubUrl is present', () => {
    render(RepoAndBranchPicker, {
      props: {
        repoType: 'github',
        githubUrl: 'https://github.com/example-org/example-repo',
        repoPath: '',
        presentation: 'metadata',
        field: 'repo',
      },
    });

    expect(screen.getByTestId('repo-selector').textContent).toContain('example-org/example-repo');
    expect(screen.queryByText('Select a repository')).toBeNull();
  });

  it('shows a dimmed owner/repo suffix in the default local-repo flow when detected', () => {
    render(RepoAndBranchPicker, {
      props: {
        repoType: 'local',
        repoPath: '/Users/dev/monorepo',
        branch: 'main',
        detectedGitHubOwner: 'intent-hq',
        detectedGitHubRepo: 'monorepo',
      },
    });

    const repoSelector = screen.getByTestId('repo-selector');
    expect(repoSelector.getAttribute('data-trigger-suffix')).toBe('intent-hq/monorepo');
    expect(repoSelector.textContent).toContain('(intent-hq/monorepo)');
  });

  it('shows no suffix in the local-repo flow when no GitHub remote is detected', () => {
    render(RepoAndBranchPicker, {
      props: {
        repoType: 'local',
        repoPath: '/Users/dev/monorepo',
        branch: 'main',
      },
    });

    const repoSelector = screen.getByTestId('repo-selector');
    expect(repoSelector.getAttribute('data-trigger-suffix')).toBe('');
    expect(repoSelector.textContent?.replace(/\s+/g, ' ').trim()).toBe('/Users/dev/monorepo');
  });

  it('does not pass the suffix to the GitHub clone flow (owner/repo already shown)', () => {
    render(RepoAndBranchPicker, {
      props: {
        repoType: 'github',
        githubUrl: 'https://github.com/intent-hq/monorepo',
        repoPath: 'intent-hq/monorepo',
        branch: 'main',
        detectedGitHubOwner: 'intent-hq',
        detectedGitHubRepo: 'monorepo',
      },
    });

    const repoSelector = screen.getByTestId('repo-selector');
    expect(repoSelector.getAttribute('data-trigger-suffix')).toBe('');
  });

  it('gives the default-presentation repo value the same explicit color as the branch trigger', () => {
    render(RepoAndBranchPicker, {
      props: {
        repoType: 'local',
        repoPath: '/Users/dev/monorepo',
        branch: 'main',
      },
    });

    expect(screen.getByTestId('repo-selector').getAttribute('data-trigger-value-class')).toBe(
      'text-muted-foreground',
    );
  });

  it('keeps the metadata-presentation repo value class untouched', () => {
    render(RepoAndBranchPicker, {
      props: {
        repoType: 'local',
        repoPath: '/Users/dev/monorepo',
        presentation: 'metadata',
        field: 'repo',
      },
    });

    expect(screen.getByTestId('repo-selector').getAttribute('data-trigger-value-class')).toBe(
      'text-foreground font-normal',
    );
  });

  it('renders a tiny metadata branch loader in place of the chevron', () => {
    const { container } = render(RepoAndBranchPicker, {
      props: {
        branch: 'main',
        presentation: 'metadata',
        field: 'branch',
        isLoading: true,
      },
    });

    expect(screen.getByTestId('branch-selector').getAttribute('data-show-trigger-chevron')).toBe(
      'false',
    );
    expect(
      screen.getByTestId('branch-selector').getAttribute('data-trigger-content-class'),
    ).toContain('pr-5');
    expect(container.querySelector('.animate-spin.text-subtle')).toBeTruthy();
  });
});
