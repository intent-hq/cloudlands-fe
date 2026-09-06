// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { getProjectSectionVisibility, sourceFromRecentRepo } from './project-section';
import ProjectSection from './ProjectSection.svelte';

vi.mock(
  '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-selectors',
  async () => {
    const { readable } = await import('svelte/store');
    return { selectWorkspaceCreationRecentRepos: () => readable([]) };
  },
);
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', async () => {
  const { readable } = await import('svelte/store');
  return { selectGitHubAuthIsAuthenticated: () => readable(false) };
});

describe('project section visibility', () => {
  it('hides unavailable suggestion groups without gating local actions', () => {
    expect(getProjectSectionVisibility(0, false)).toEqual({
      recent: false,
      githubRepos: false,
    });
    expect(getProjectSectionVisibility(2, true)).toEqual({
      recent: true,
      githubRepos: true,
    });
  });

  it('maps recent local and GitHub repositories to durable draft sources', () => {
    expect(
      sourceFromRecentRepo({
        path: '/projects/intent',
        type: 'local',
        name: 'intent',
      }),
    ).toEqual({ kind: 'local', path: '/projects/intent', isolation: 'worktree' });
    expect(
      sourceFromRecentRepo({
        path: 'intent-hq/cloudlands-fe',
        type: 'github',
        githubUrl: 'https://github.com/intent-hq/cloudlands-fe.git',
        name: 'cloudlands-fe',
      }),
    ).toEqual({
      kind: 'github',
      url: 'https://github.com/intent-hq/cloudlands-fe.git',
      owner: 'intent-hq',
      name: 'cloudlands-fe',
    });
  });

  it.each([
    [
      { kind: 'local' as const, path: '/projects/intent', isolation: 'worktree' as const },
      'intent',
      '/projects/intent',
      'local',
    ],
    [
      {
        kind: 'github' as const,
        url: 'https://github.com/intent-hq/cloudlands-fe',
        owner: 'intent-hq',
        name: 'cloudlands-fe',
      },
      'intent-hq/cloudlands-fe',
      'https://github.com/intent-hq/cloudlands-fe',
      'github',
    ],
  ])('displays a selected project and reopens its picker', async (source, name, path, mode) => {
    const onOpenPicker = vi.fn();
    const view = render(ProjectSection, { props: { source, onOpenPicker } });

    expect(view.getByTestId('selected-project')).toBeTruthy();
    expect(view.getByText(name)).toBeTruthy();
    expect(view.getByText(path)).toBeTruthy();
    await fireEvent.click(view.getByRole('button', { name: 'Change' }));

    expect(onOpenPicker).toHaveBeenCalledWith(mode);
  });
});
