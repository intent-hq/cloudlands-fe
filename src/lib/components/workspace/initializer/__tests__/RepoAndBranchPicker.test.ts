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

import RepoAndBranchPicker from '../RepoAndBranchPicker.svelte';

describe('RepoAndBranchPicker', () => {
  it('renders GitHub metadata repo display when only githubUrl is present', () => {
    render(RepoAndBranchPicker, {
      props: {
        repoType: 'github',
        githubUrl: 'https://github.com/augmentcode/intent',
        repoPath: '',
        presentation: 'metadata',
        field: 'repo',
      },
    });

    expect(screen.getByTestId('repo-selector').textContent).toContain('augmentcode/intent');
    expect(screen.queryByText('Select a repository')).toBeNull();
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
