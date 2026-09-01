/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
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

import RepoAndBranchPicker from '../RepoAndBranchPicker.svelte';

const metadataSurfaceTokens = [
  'rounded-md',
  'bg-muted/40!',
  'hover:bg-muted/60!',
  'active:bg-muted/70!',
  'data-[state=open]:bg-muted/70!',
  'focus-visible:bg-muted/70!',
  'focus-visible:outline-none!',
  'focus-visible:outline-offset-0!',
  'focus-visible:ring-0!',
  'focus-visible:shadow-none!',
  'disabled:bg-muted/50!',
  'forced-colors:border-[ButtonText]',
  'forced-colors:bg-[ButtonFace]',
];

function expectMetadataPill(element: HTMLElement) {
  const classes = element.className.split(/\s+/);
  expect(classes).toEqual(expect.arrayContaining(metadataSurfaceTokens));
  expect(classes).not.toContain('bg-transparent!');
  expect(classes).not.toContain('focus-visible:ring-1');
}

describe('RepoAndBranchPicker', () => {
  it('uses a textless Toggle beside the remote work-directly label', async () => {
    const onSkipIsolationChange = vi.fn();
    render(RepoAndBranchPicker, {
      props: {
        repoType: 'remote',
        skipIsolation: true,
        remoteSetup: {
          id: 'remote-1',
          name: 'cloud-host',
          host: 'example.test',
          port: 22,
          username: 'dev',
          workspacePath: '/srv/repo',
          branch: 'main',
        },
        onSkipIsolationChange,
      },
    });

    const toggle = screen.getByRole('button', { name: 'Work directly in your folder' });
    expect(toggle.textContent?.trim()).toBe('');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(toggle);
    expect(onSkipIsolationChange).toHaveBeenCalledWith(false);
  });

  it.each([
    {
      kind: 'local',
      props: { repoType: 'local' as const, repoPath: '/Users/dev/monorepo' },
    },
    {
      kind: 'GitHub',
      props: {
        repoType: 'github' as const,
        githubUrl: 'https://github.com/intent-hq/monorepo',
      },
    },
    {
      kind: 'remote',
      props: {
        repoType: 'remote' as const,
        remoteSetup: {
          id: 'remote-1',
          name: 'cloud-host',
          host: 'example.test',
          port: 22,
          username: 'dev',
          workspacePath: '/srv/repo',
          branch: 'main',
        },
      },
    },
    {
      kind: 'new-repo',
      props: { repoType: 'local' as const, repoPath: '/Users/dev/new-repo', isNewRepo: true },
    },
  ])('renders a persistent quiet metadata pill for $kind repositories', ({ props }) => {
    render(RepoAndBranchPicker, {
      props: { ...props, presentation: 'metadata', field: 'repo' },
    });

    expectMetadataPill(screen.getByTestId('repo-selector'));
  });

  it('keeps selected, suggested, loading, open, focus, and disabled branch states on the pill surface', () => {
    const { container } = render(RepoAndBranchPicker, {
      props: {
        repoType: 'local',
        repoPath: '/Users/dev/monorepo',
        branch: 'main',
        suggestedBranch: 'feature/contrast',
        presentation: 'metadata',
        field: 'branch',
        isLoading: true,
      },
    });

    const branch = screen.getByTestId('branch-selector');
    expectMetadataPill(branch);
    expect(branch.className).toContain('w-full');
    expect(branch.className).toContain('min-w-0');
    expect(branch.className).toContain('overflow-hidden');
    expect(branch.getAttribute('data-suggested-branch')).toBe('feature/contrast');
    expect(container.querySelector('.animate-spin.text-subtle')?.className).not.toContain(
      'bg-muted',
    );
  });

  it('applies the pill only to the interactive metadata value', () => {
    const { container } = render(RepoAndBranchPicker, {
      props: {
        repoType: 'local',
        repoPath: '/Users/dev/monorepo',
        presentation: 'metadata',
        field: 'repo',
      },
    });

    const trigger = screen.getByRole('button');
    expectMetadataPill(trigger);
    const filledElements = Array.from(container.querySelectorAll<HTMLElement>('[class]')).filter(
      (element) => element.className.includes('bg-muted/40!'),
    );
    expect(filledElements).toEqual([trigger]);
    expect(container.firstElementChild?.className).not.toContain('bg-');
  });

  it('leaves the default picker presentation unchanged', () => {
    render(RepoAndBranchPicker, {
      props: { repoType: 'local', repoPath: '/Users/dev/monorepo', branch: 'main' },
    });

    for (const trigger of screen.getAllByRole('button')) {
      expect(trigger.className).not.toContain('bg-muted/40!');
      expect(trigger.className).not.toContain('group/metadata-trigger');
    }
  });

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

  it('summarises the GitHub clone flow without claiming a worktree is created', () => {
    const { container } = render(RepoAndBranchPicker, {
      props: {
        repoType: 'github',
        githubUrl: 'https://github.com/intent-hq/monorepo',
        repoPath: 'intent-hq/monorepo',
        branch: 'main',
      },
    });

    const text = container.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Clone');
    expect(text).toContain('and work off');
    expect(text).not.toContain('worktree');
  });

  it('spaces the GitHub clone sentence fragments like the local-repo flow', () => {
    const { container } = render(RepoAndBranchPicker, {
      props: {
        repoType: 'github',
        githubUrl: 'https://github.com/intent-hq/monorepo',
        repoPath: 'intent-hq/monorepo',
        branch: 'main',
      },
    });

    const middle = Array.from(container.querySelectorAll('span')).find((span) =>
      span.textContent?.trim().startsWith('and work off'),
    );
    expect(middle?.className).toContain('mx-1');
    expect(middle?.className).toContain('ml-2');
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
