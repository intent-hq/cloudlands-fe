import { describe, expect, it } from 'vitest';
import {
  cwdBasename,
  gitRootFromSubdirectory,
  isPathWithin,
  matchSessionRepository,
  sessionBaseBranch,
  sessionSearchText,
} from './session-import-match';

describe('isPathWithin', () => {
  it('matches the folder itself and its subfolders only', () => {
    expect(isPathWithin('/Users/sam/app', '/Users/sam/app')).toBe(true);
    expect(isPathWithin('/Users/sam/app/web', '/Users/sam/app/')).toBe(true);
    expect(isPathWithin('/Users/sam/app-2', '/Users/sam/app')).toBe(false);
    expect(isPathWithin('', '/Users/sam/app')).toBe(false);
  });
});

describe('matchSessionRepository', () => {
  const candidates = [
    { path: '/Users/sam/Projects', type: 'local' as const },
    { path: '/Users/sam/Projects/ember', type: 'local' as const },
    { path: 'spullara/ember', type: 'github' as const },
  ];

  it('picks the deepest local repository that contains the cwd', () => {
    expect(matchSessionRepository('/Users/sam/Projects/ember/apps/web', candidates)?.path).toBe(
      '/Users/sam/Projects/ember',
    );
  });

  it('returns null when no local repository contains the cwd', () => {
    expect(matchSessionRepository('/tmp/other', candidates)).toBeNull();
  });
});

describe('sessionBaseBranch', () => {
  const listing = { branches: ['main', 'feature'], remoteBranches: ['origin/openid-sign-in'] };

  it('keeps a branch that exists locally', () => {
    expect(sessionBaseBranch('feature', listing)).toBe('feature');
  });

  it('falls back to the tracked remote branch', () => {
    expect(sessionBaseBranch('openid-sign-in', listing)).toBe('origin/openid-sign-in');
  });

  it('returns null for a missing, detached, or unknown branch', () => {
    expect(sessionBaseBranch('gone', listing)).toBeNull();
    expect(sessionBaseBranch('HEAD', listing)).toBeNull();
    expect(sessionBaseBranch(undefined, listing)).toBeNull();
    expect(sessionBaseBranch('main', null)).toBeNull();
  });
});

describe('sessionSearchText and cwdBasename', () => {
  it('joins every searchable field', () => {
    expect(
      sessionSearchText({
        title: 'Cloudflare account installation',
        cwd: '/Users/sam/ember',
        gitBranch: 'main',
        sessionId: '6eca79e3',
        provider: 'claude-code',
      }),
    ).toBe('Cloudflare account installation /Users/sam/ember main 6eca79e3 claude-code');
  });

  it('returns the last cwd segment', () => {
    expect(cwdBasename('/Users/sam/ember/')).toBe('ember');
    expect(cwdBasename('/')).toBe('/');
  });
});

describe('gitRootFromSubdirectory', () => {
  it('strips the relative path from the cwd', () => {
    expect(gitRootFromSubdirectory('/Users/sam/ember/apps/web', 'apps/web')).toBe(
      '/Users/sam/ember',
    );
    expect(gitRootFromSubdirectory('/Users/sam/ember/apps/web/', '/apps/web/')).toBe(
      '/Users/sam/ember',
    );
  });

  it('returns null when the relative path does not end the cwd', () => {
    expect(gitRootFromSubdirectory('/Users/sam/ember/apps', 'apps/web')).toBeNull();
  });
});
