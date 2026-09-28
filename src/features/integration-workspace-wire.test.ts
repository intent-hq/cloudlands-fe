/** Production renderer clients and IPC handlers through the Electron JSON serializer. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.unmock('$lib/electron-bridge');
vi.mock('$lib/client/live/backend-transport', async () => {
  const { createElectronIpcBackendTransport } =
    await import('$lib/client/live/electron-ipc-transport');
  const transport = createElectronIpcBackendTransport();
  return {
    backendRequest: transport.request,
    onBackendNotification: () => () => {},
    onBackendReconnected: () => () => {},
  };
});

import { githubAuthClient } from './github-auth/renderer/github-auth.client';
import { linearAuthClient } from './linear-auth/renderer/linear-auth.client';
import { sentryAuthClient } from './sentry-auth/renderer/sentry-auth.client';
import { forgeAuthClient } from './forge-auth/renderer/forge-auth.client';
import { LiveGitClient } from '$lib/client/live/live-git-client';
import { LiveIntegrationsClient } from '$lib/client/live/live-integrations-client';
import { __resetGitHubAuthStatusForTests } from './github-auth/renderer/github-auth-status.client';

const invoke = vi.fn(async (_channel: string, payload: { method: string; params?: unknown }) => ({
  ok: true,
  result:
    payload.method === 'github.getUser'
      ? { user: { login: 'fixture' } }
      : payload.method === 'sourceControl.getUser'
        ? { user: { login: 'fixture' } }
        : {
            ok: true,
            isConfigured: true,
            authenticated: true,
            branches: [],
            repos: [],
            users: [],
            issues: [],
            nextToken: null,
          },
}));

beforeAll(async () => {
  await import('$store/renderer/seeders/integrations-bridge-seeder');
});
afterEach(() => {
  vi.unstubAllGlobals();
  invoke.mockClear();
  __resetGitHubAuthStatusForTests();
});

function bridge() {
  vi.stubGlobal('window', { electronAPI: { invoke, on: () => 'listener', offById: () => {} } });
}
function lastParams(method: string) {
  const call = invoke.mock.calls.filter(([, payload]) => payload.method === method).at(-1);
  expect(call?.[0]).toBe('backend:request');
  return call?.[1].params;
}

describe('integration workspace wire context', () => {
  it.each(['a', 'b'])(
    'serializes origin %s with unchanged provider, repository and cursor selectors',
    async (workspaceId) => {
      bridge();
      await githubAuthClient.searchUsers('same', workspaceId);
      expect(lastParams('github.users.search')).toEqual({ query: 'same', workspaceId });
      await githubAuthClient.getAuthState(workspaceId);
      expect(lastParams('github.authStatus')).toEqual({ workspaceId });
      expect(lastParams('github.getUser')).toEqual({ workspaceId });
      await forgeAuthClient.getStatus('gitlab', 'forge.example', workspaceId);
      expect(lastParams('sourceControl.authStatus')).toEqual({
        provider: 'gitlab',
        host: 'forge.example',
        workspaceId,
      });
      await forgeAuthClient.getUser('gitlab', 'forge.example', workspaceId);
      expect(lastParams('sourceControl.getUser')).toEqual({
        provider: 'gitlab',
        host: 'forge.example',
        workspaceId,
      });
      await linearAuthClient.getAuthState(true, workspaceId);
      expect(lastParams('linear.authStatus')).toEqual({ workspaceId });
      await linearAuthClient.fetchMyIssuesPage('created', {
        limit: 3,
        nextToken: 'same',
        workspaceId,
      });
      expect(lastParams('linear.listIssues')).toEqual({
        filter: 'created',
        limit: 3,
        nextToken: 'same',
        workspaceId,
      });
      await linearAuthClient.searchIssuesPage('query', { nextToken: 'cursor', workspaceId });
      expect(lastParams('linear.searchIssues')).toEqual({
        query: 'query',
        nextToken: 'cursor',
        workspaceId,
      });
      await sentryAuthClient.getAuthState(workspaceId);
      expect(lastParams('sentry.authStatus')).toEqual({ workspaceId });
      await sentryAuthClient.fetchIssuesPage({
        project: 'project',
        status: 'unresolved',
        query: 'query',
        nextToken: 'cursor',
        workspaceId,
      });
      expect(lastParams('sentry.listIssues')).toEqual({
        project: 'project',
        status: 'unresolved',
        query: 'query',
        nextToken: 'cursor',
        workspaceId,
      });
      await sentryAuthClient.searchIssuesPage('query', 'project', { limit: 2, workspaceId });
      expect(lastParams('sentry.searchIssues')).toEqual({
        project: 'project',
        query: 'query',
        limit: 2,
        workspaceId,
      });
      await sentryAuthClient.getIssue('APP-1', workspaceId);
      expect(lastParams('sentry.getIssue')).toEqual({ shortId: 'APP-1', workspaceId });
      await sentryAuthClient.getIssue('123', workspaceId);
      expect(lastParams('sentry.getIssue')).toEqual({ id: '123', workspaceId });
      const git = new LiveGitClient();
      await git.getBranches('/repo', true, workspaceId);
      expect(lastParams('git.getBranches')).toEqual({
        repoPath: '/repo',
        includeRemote: true,
        workspaceId,
      });
      await git.branchStatus('/repo', 'feature', workspaceId);
      expect(lastParams('git.branchStatus')).toEqual({
        repoPath: '/repo',
        branchName: 'feature',
        workspaceId,
      });
      await git.pull('/repo', 'feature', workspaceId);
      expect(lastParams('git.pull')).toEqual({
        repoPath: '/repo',
        branchName: 'feature',
        workspaceId,
      });
      const integrations = new LiveIntegrationsClient();
      await integrations.githubBranches('owner', 'repo', undefined, workspaceId);
      expect(lastParams('github.branches.list')).toEqual({
        owner: 'owner',
        repo: 'repo',
        workspaceId,
      });
      expect(lastParams('github.repos.get')).toEqual({ owner: 'owner', repo: 'repo', workspaceId });
      await integrations.githubBranchesCached('owner', 'repo', workspaceId);
      expect(lastParams('github.branches.listCached')).toEqual({
        owner: 'owner',
        repo: 'repo',
        workspaceId,
      });
      await integrations.githubRepoConfig('owner', 'repo', 'feature', workspaceId);
      expect(lastParams('github.repoConfig.get')).toEqual({
        owner: 'owner',
        repo: 'repo',
        ref: 'feature',
        workspaceId,
      });
    },
  );

  it('leaves onboarding, sign-in probes and repository selection direct when context is omitted', async () => {
    bridge();
    await githubAuthClient.getAuthState();
    expect(lastParams('github.authStatus')).toBeUndefined();
    expect(lastParams('github.getUser')).toBeUndefined();
    await githubAuthClient.listRepos();
    expect(lastParams('github.repos.list')).toBeUndefined();
    await forgeAuthClient.getStatus('gitlab', 'forge.example');
    expect(lastParams('sourceControl.authStatus')).toEqual({
      provider: 'gitlab',
      host: 'forge.example',
    });
    await new LiveGitClient().pull('/repo', 'main');
    expect(lastParams('git.pull')).toEqual({ repoPath: '/repo', branchName: 'main' });
  });
});
