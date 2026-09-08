import { describe, expect, it } from 'vitest';
import {
  configWith,
  hasModifiedOptions,
  issueSelectionPatch,
  sourceWithBranch,
  sourceWithIsolation,
} from './setup-sections';

describe('setup section draft mappings', () => {
  it('maps branch, isolation, and option values without discarding draft fields', () => {
    const local = {
      kind: 'local' as const,
      path: '/projects/intent',
      isolation: 'worktree' as const,
    };
    expect(sourceWithBranch(local, 'feature/setup')).toEqual({
      ...local,
      branch: 'feature/setup',
    });
    expect(sourceWithIsolation(local, 'in-place')).toEqual({ ...local, isolation: 'in-place' });
    expect(configWith({ setupPanelExpanded: true }, 'model', 'claude-sonnet')).toEqual({
      setupPanelExpanded: true,
      model: 'claude-sonnet',
    });
    expect(configWith({}, 'specialist', null)).toEqual({ specialist: null });
  });

  it('appends issue and PR context while prefilling only an empty intent', () => {
    const issue = issueSelectionPatch({ intentText: '', contextLinks: [] }, '#42 Fix setup', {
      identifier: 'intent-hq/cloudlands-fe#42',
      url: 'https://github.com/intent-hq/cloudlands-fe/issues/42',
    });
    expect(issue).toEqual({
      intentText: '#42 Fix setup',
      contextLinks: [
        {
          kind: 'issue',
          url: 'https://github.com/intent-hq/cloudlands-fe/issues/42',
          owner: 'intent-hq',
          repo: 'cloudlands-fe',
          number: 42,
        },
      ],
    });

    const pullRequest = issueSelectionPatch(
      { intentText: 'Keep my typed request', contextLinks: issue!.contextLinks },
      '#43 Ship setup',
      {
        identifier: 'intent-hq/cloudlands-fe#43',
        url: 'https://github.com/intent-hq/cloudlands-fe/pull/43',
      },
    );
    expect(pullRequest?.intentText).toBe('Keep my typed request');
    expect(pullRequest?.contextLinks.at(-1)?.kind).toBe('pr');
  });

  it('distinguishes initial-agent defaults from explicit option changes', () => {
    const source = {
      kind: 'local' as const,
      path: '/projects/intent',
      isolation: 'worktree' as const,
    };
    const defaults = { specialist: 'orchestrator', provider: 'auggie' };
    expect(hasModifiedOptions(source, { specialist: 'orchestrator' }, defaults)).toBe(false);
    expect(hasModifiedOptions(source, { specialist: 'implementor' }, defaults)).toBe(true);
    expect(hasModifiedOptions(source, { provider: 'auggie' }, defaults)).toBe(false);
    expect(hasModifiedOptions(source, { provider: 'codex' }, defaults)).toBe(true);
    expect(hasModifiedOptions(source, { isTeamMode: false }, defaults)).toBe(false);
    expect(hasModifiedOptions(source, { isTeamMode: true }, defaults)).toBe(true);
    expect(hasModifiedOptions(source, { reasoningEffort: 'high' })).toBe(true);
    expect(hasModifiedOptions({ ...source, isolation: 'in-place' }, {})).toBe(true);
    expect(
      hasModifiedOptions(source, { setupScript: 'echo default' }, { setupScript: 'echo default' }),
    ).toBe(false);
    expect(
      hasModifiedOptions(source, { setupScript: 'echo custom' }, { setupScript: 'echo default' }),
    ).toBe(true);
  });
});
