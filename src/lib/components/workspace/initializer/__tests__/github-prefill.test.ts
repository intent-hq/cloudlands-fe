/**
 * @vitest-environment jsdom
 *
 * Wire-contract tests for resolveGitHubPrefillSelection: asserts the exact
 * `git-tracking:get-pull-request` request ({ owner, repo, number }) sent for
 * PR prefills, feeds a contract-shaped mock response back through the mock
 * IPC router, and verifies graceful degradation to a minimal mention when the
 * fetch fails (and that issues never hit the wire).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerMockIpcHandler,
  unregisterMockIpcHandler,
} from '$shared/ipc-mock-router';

vi.mock('$lib/utils/platform-capabilities', () => ({ isElectronPlatform: () => true }));

import { resolveGitHubPrefillSelection } from '../github-prefill';

const CHANNEL = 'git-tracking:get-pull-request';

const prPrefill = {
  owner: 'intent-hq',
  repo: 'monorepo',
  number: 42,
  kind: 'pr' as const,
  url: 'https://github.com/intent-hq/monorepo/pull/42',
};

const issuePrefill = {
  owner: 'intent-hq',
  repo: 'intentd',
  number: 7,
  kind: 'issue' as const,
  url: 'https://github.com/intent-hq/intentd/issues/7',
};

afterEach(() => {
  unregisterMockIpcHandler(CHANNEL);
});

describe('resolveGitHubPrefillSelection', () => {
  it('fetches PR branch info with the exact { owner, repo, number } request and maps the response', async () => {
    const handler = vi.fn(async () => ({
      success: true,
      data: {
        number: 42,
        title: 'feat: add link menu',
        state: 'open',
        url: prPrefill.url,
        sourceBranch: 'feature/link-menu',
        targetBranch: 'main',
      },
    }));
    registerMockIpcHandler(CHANNEL, handler);

    const selection = await resolveGitHubPrefillSelection(prPrefill);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ owner: 'intent-hq', repo: 'monorepo', number: 42 });
    expect(selection).toEqual({
      type: 'github',
      identifier: 'intent-hq/monorepo#42',
      title: 'feat: add link menu',
      url: prPrefill.url,
      metadata: {
        state: 'open',
        sourceBranch: 'feature/link-menu',
        targetBranch: 'main',
        project: 'intent-hq/monorepo',
      },
    });
  });

  it('degrades to a minimal mention when the PR fetch reports failure', async () => {
    registerMockIpcHandler(CHANNEL, async () => ({ success: false, error: 'not found' }));

    const selection = await resolveGitHubPrefillSelection(prPrefill);

    expect(selection).toEqual({
      type: 'github',
      identifier: 'intent-hq/monorepo#42',
      title: '#42',
      url: prPrefill.url,
      metadata: { project: 'intent-hq/monorepo' },
    });
  });

  it('degrades to a minimal mention when the PR fetch throws', async () => {
    registerMockIpcHandler(CHANNEL, async () => {
      throw new Error('daemon unavailable');
    });

    const selection = await resolveGitHubPrefillSelection(prPrefill);

    expect(selection.title).toBe('#42');
    expect(selection.metadata?.sourceBranch).toBeUndefined();
  });

  it('never hits the wire for issue prefills', async () => {
    const handler = vi.fn();
    registerMockIpcHandler(CHANNEL, handler);

    const selection = await resolveGitHubPrefillSelection(issuePrefill);

    expect(handler).not.toHaveBeenCalled();
    expect(selection).toEqual({
      type: 'github',
      identifier: 'intent-hq/intentd#7',
      title: '#7',
      url: issuePrefill.url,
      metadata: { project: 'intent-hq/intentd' },
    });
  });
});
