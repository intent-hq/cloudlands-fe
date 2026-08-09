import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));

import { GITHUB_AUTH_CHANNELS } from '../constants';
import { githubAuthClient } from './github-auth.client';

describe('githubAuthClient repository search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the exact search IPC request and returns the protocol-shaped envelope', async () => {
    const response = {
      success: true,
      data: [{ owner: 'octocat', name: 'hello', default_branch: 'main' }],
    };
    mocks.invoke.mockResolvedValueOnce(response);

    await expect(githubAuthClient.searchRepos('hello')).resolves.toEqual(response);
    expect(mocks.invoke).toHaveBeenCalledWith(GITHUB_AUTH_CHANNELS.SEARCH_REPOS, {
      query: 'hello',
    });
  });
});
