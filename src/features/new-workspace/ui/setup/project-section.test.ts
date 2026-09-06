import { describe, expect, it } from 'vitest';
import { getProjectSectionVisibility, sourceFromRecentRepo } from './project-section';

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
});
