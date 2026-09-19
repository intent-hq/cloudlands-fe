import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchLinear: vi.fn(),
  searchLinear: vi.fn(),
  fetchSentry: vi.fn(),
  searchSentry: vi.fn(),
  invoke: vi.fn(),
  getStored: vi.fn(),
  setStored: vi.fn(),
}));

vi.mock('$features/linear-auth/renderer/linear-auth.client', () => ({
  linearAuthClient: {
    fetchMyIssuesPage: mocks.fetchLinear,
    searchIssuesPage: mocks.searchLinear,
  },
}));
vi.mock('$features/sentry-auth/renderer/sentry-auth.client', () => ({
  sentryAuthClient: {
    fetchIssuesPage: mocks.fetchSentry,
    searchIssuesPage: mocks.searchSentry,
  },
}));
vi.mock('$shared/generated/ipc-client', () => ({ invoke: mocks.invoke }));
vi.mock('../../../utils/safe-local-storage-saga', () => ({
  getLocalStorageItem: function* (key: string) {
    return mocks.getStored(key);
  },
  setLocalStorageItem: function* (key: string, value: string) {
    mocks.setStored(key, value);
  },
}));

import {
  issueSuggestionRequestKey,
  loadIssueSuggestionsRequested,
  setContextSourcePreference,
} from '../issue-suggestions-slice';
import { issueSuggestionsSaga, LAST_CONTEXT_SOURCE_STORAGE_KEY } from './issue-suggestions-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function harness() {
  const channel = stdChannel();
  const dispatched: Array<{ type: string; payload: unknown }> = [];
  const task = runSaga(
    { channel, dispatch: (action) => dispatched.push(action as never), getState: () => ({}) },
    issueSuggestionsSaga,
  );
  return { channel, dispatched, task };
}

describe('issueSuggestionsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStored.mockReturnValue(null);
  });

  it('loads a protocol-shaped Linear page with the exact filter and cursor', async () => {
    const issue = { id: 'lin-1', identifier: 'ENG-1', title: 'Linear issue' };
    mocks.fetchLinear.mockResolvedValue({ issues: [issue], nextToken: 'linear-next' });
    const run = harness();
    await settle();

    run.channel.put(
      loadIssueSuggestionsRequested('linear-assigned', { nextToken: 'linear-cursor' }, true),
    );
    await settle();

    expect(mocks.fetchLinear).toHaveBeenCalledWith('assigned', {
      nextToken: 'linear-cursor',
    });
    expect(run.dispatched.at(-1)).toEqual({
      type: 'issueSuggestions/loaded',
      payload: ['linear-assigned', [issue], 'linear-next', true],
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('searches Sentry with the exact query and opaque cursor', async () => {
    const issue = {
      id: 'sent-1',
      shortId: 'APP-1',
      title: 'Sentry issue',
      status: 'unresolved',
      level: 'error',
      count: '3',
      userCount: 2,
      firstSeen: '2026-09-01T00:00:00Z',
      lastSeen: '2026-09-02T00:00:00Z',
      projectName: 'App',
      projectSlug: 'app',
    };
    mocks.searchSentry.mockResolvedValue({ issues: [issue], nextToken: null });
    const run = harness();
    await settle();

    run.channel.put(
      loadIssueSuggestionsRequested('sentry', {
        query: 'timeout',
        nextToken: 'sentry-cursor',
      }),
    );
    await settle();

    expect(mocks.searchSentry).toHaveBeenCalledWith('timeout', undefined, {
      nextToken: 'sentry-cursor',
    });
    expect(run.dispatched.at(-1)).toEqual({
      type: 'issueSuggestions/loaded',
      payload: ['sentry', [issue], null, false],
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('sends the exact GitHub issue request and maps the protocol response', async () => {
    mocks.invoke.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'github-1',
          number: 42,
          title: 'GitHub issue',
          htmlUrl: 'https://github.test/acme/app/issues/42',
          state: 'open',
          owner: 'acme',
          repo: 'app',
          author: { login: 'octocat', name: 'Octo Cat' },
          labels: ['bug', 'ui'],
        },
      ],
      nextToken: 'github-next',
    });
    const run = harness();
    await settle();

    run.channel.put(
      loadIssueSuggestionsRequested('github-issues', {
        owner: 'acme',
        repo: 'app',
        query: 'selector',
      }),
    );
    await settle();

    expect(mocks.invoke).toHaveBeenCalledWith('git-tracking:search-github-issues', {
      owner: 'acme',
      repo: 'app',
      options: { state: 'open', per_page: 20, filter: 'all', query: 'selector' },
    });
    expect(run.dispatched.at(-1)).toMatchObject({
      type: 'issueSuggestions/loaded',
      payload: [
        issueSuggestionRequestKey('github-issues', {
          owner: 'acme',
          repo: 'app',
          query: 'selector',
        }),
        [
          {
            id: 'github-1',
            author: 'Octo Cat',
            labels: 'bug, ui',
            url: 'https://github.test/acme/app/issues/42',
          },
        ],
        'github-next',
        false,
      ],
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('loads PR detail through its exact channel and preserves branch fields', async () => {
    mocks.invoke.mockResolvedValue({
      success: true,
      data: {
        number: 7,
        title: 'Selector migration',
        state: 'open',
        url: 'https://github.test/acme/app/pull/7',
        sourceBranch: 'feature/selectors',
        targetBranch: 'main',
      },
    });
    const run = harness();
    await settle();

    run.channel.put(
      loadIssueSuggestionsRequested('github-pr-detail', {
        owner: 'acme',
        repo: 'app',
        number: 7,
      }),
    );
    await settle();

    expect(mocks.invoke).toHaveBeenCalledWith('git-tracking:get-pull-request', {
      owner: 'acme',
      repo: 'app',
      number: 7,
    });
    expect(run.dispatched.at(-1)).toMatchObject({
      type: 'issueSuggestions/loaded',
      payload: [
        issueSuggestionRequestKey('github-pr-detail', { owner: 'acme', repo: 'app', number: 7 }),
        [
          {
            id: 'acme/app#7',
            sourceBranch: 'feature/selectors',
            targetBranch: 'main',
          },
        ],
        null,
        false,
      ],
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels stale work only for the same request key', async () => {
    let resolveFirst!: (value: { issues: unknown[]; nextToken: null }) => void;
    mocks.searchLinear
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({
        issues: [{ id: 'new', identifier: 'ENG-2', title: 'Newest' }],
        nextToken: null,
      });
    const run = harness();
    await settle();

    run.channel.put(loadIssueSuggestionsRequested('linear-search', { query: 'old' }));
    await settle();
    run.channel.put(loadIssueSuggestionsRequested('linear-search', { query: 'new' }));
    await settle();
    resolveFirst({ issues: [{ id: 'old' }], nextToken: null });
    await settle();

    expect(mocks.searchLinear.mock.calls).toEqual([
      ['old', undefined],
      ['new', undefined],
    ]);
    expect(
      run.dispatched.filter((action) => action.type === 'issueSuggestions/loaded'),
    ).toHaveLength(1);
    expect(run.dispatched.at(-1)).toMatchObject({
      payload: ['linear-search', [{ id: 'new' }], null, false],
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('supersedes repository requests when switching away and back', async () => {
    const pending = new Map<string, (value: unknown) => void>();
    mocks.invoke.mockImplementation(
      (_channel: string, params: { repo: string }) =>
        new Promise((resolve) => pending.set(`${params.repo}:${pending.size}`, resolve)),
    );
    const run = harness();
    await settle();

    run.channel.put(
      loadIssueSuggestionsRequested('github-issues', { owner: 'acme', repo: 'alpha' }),
    );
    await settle();
    run.channel.put(
      loadIssueSuggestionsRequested('github-issues', { owner: 'acme', repo: 'beta' }),
    );
    await settle();
    run.channel.put(
      loadIssueSuggestionsRequested('github-issues', { owner: 'acme', repo: 'alpha' }),
    );
    await settle();

    pending.get('alpha:2')?.({ success: true, data: [], nextToken: null });
    pending.get('beta:1')?.({ success: true, data: [{ id: 'stale-beta' }], nextToken: null });
    pending.get('alpha:0')?.({ success: true, data: [{ id: 'stale-alpha' }], nextToken: null });
    await settle();

    const loaded = run.dispatched.filter((action) => action.type === 'issueSuggestions/loaded');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].payload).toEqual([
      issueSuggestionRequestKey('github-issues', { owner: 'acme', repo: 'alpha' }),
      [],
      null,
      false,
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('hydrates and persists the context source through saga-owned storage', async () => {
    mocks.getStored.mockReturnValue('github-prs');
    const run = harness();
    await settle();

    expect(mocks.getStored).toHaveBeenCalledWith(LAST_CONTEXT_SOURCE_STORAGE_KEY);
    expect(run.dispatched[0]).toEqual({
      type: 'issueSuggestions/contextSourcePreferenceHydrated',
      payload: ['github-prs'],
    });

    run.channel.put(setContextSourcePreference('linear'));
    await settle();
    expect(mocks.setStored).toHaveBeenCalledWith(LAST_CONTEXT_SOURCE_STORAGE_KEY, 'linear');
    run.task.cancel();
    await run.task.toPromise();
  });
});
