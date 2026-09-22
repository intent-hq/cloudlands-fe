/**
 * @vitest-environment jsdom
 *
 * Wire-contract tests for the context picker's debounced server-side search
 * and infinite scroll: asserts the exact `git-tracking:search-github-issues`
 * / `git-tracking:search-pull-requests` requests (query + nextToken inside
 * `options`) and feeds contract-shaped mock responses back through the mock
 * IPC router. Also covers the submodule-aware multi-repo blend: the
 * `git-tracking:list-related-repos` lookup, the `options.repos` passthrough,
 * and the repo-labelled rows rendered from a blended response.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';

const mocks = vi.hoisted(() => {
  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });
  const selector = <T>(value: T) => Object.assign(() => readable(value), { select: () => value });
  return { readable, selector };
});

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(true),
  selectGitHubAuthIsAuthenticating: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/linear-auth/linear-auth-selectors', () => ({
  selectLinearIsAuthenticated: mocks.selector(false),
  selectLinearIsAuthenticating: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/sentry-auth/sentry-auth-selectors', () => ({
  selectSentryIsAuthenticated: mocks.selector(false),
  selectSentryIsConnecting: mocks.selector(false),
  selectSentryError: mocks.selector(null),
}));
vi.mock('$features/linear-auth/renderer/linear-auth.client', () => ({
  linearAuthClient: {
    getAuthState: vi.fn(async () => ({ isAuthenticated: false })),
    fetchMyIssuesPage: vi.fn(async () => ({ issues: [], nextToken: null })),
    searchIssuesPage: vi.fn(async () => ({ issues: [], nextToken: null })),
  },
}));
vi.mock('$features/sentry-auth/renderer/sentry-auth.client', () => ({
  sentryAuthClient: {
    getAuthState: vi.fn(async () => ({ isAuthenticated: false })),
    fetchIssuesPage: vi.fn(async () => ({ issues: [], nextToken: null })),
    searchIssuesPage: vi.fn(async () => ({ issues: [], nextToken: null })),
  },
}));
vi.mock('$features/navigation/link-handler', () => ({ handleLink: vi.fn() }));
vi.mock('$lib/utils/platform-capabilities', () => ({ isElectronPlatform: () => true }));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});
vi.mock('$lib/components/ui/skeleton', async () => ({
  Skeleton: (await import('./mocks/MockComponent.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip', async () => ({
  TooltipRich: (await import('./mocks/MockTooltipRich.svelte')).default,
}));
vi.mock('$lib/components/ui/Header.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import IssueSuggestions from '../IssueSuggestions.svelte';
import { store as appStore } from '$store/renderer/store';
import { issueSuggestionsSaga } from '$store/renderer/slices/issue-suggestions/sagas/issue-suggestions-saga';
import { warmImport } from '../../../../../test/warm-import';

/** Captured IntersectionObserver instances so tests can fire intersections. */
const observers: Array<{
  callback: IntersectionObserverCallback;
  elements: Element[];
  instance: IntersectionObserver;
  disconnected: boolean;
}> = [];

class MockIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {
    observers.push({
      callback,
      elements: [],
      instance: this as unknown as IntersectionObserver,
      disconnected: false,
    });
  }
  observe(el: Element) {
    observers
      .find((o) => o.instance === (this as unknown as IntersectionObserver))
      ?.elements.push(el);
  }
  disconnect() {
    const observer = observers.find(
      (o) => o.instance === (this as unknown as IntersectionObserver),
    );
    if (observer) observer.disconnected = true;
  }
  unobserve(el: Element) {
    const observer = observers.find(
      (o) => o.instance === (this as unknown as IntersectionObserver),
    );
    if (observer) observer.elements = observer.elements.filter((element) => element !== el);
  }
  takeRecords() {
    return [];
  }
}

function intersectSentinel(sentinel: Element): void {
  const observer = [...observers]
    .reverse()
    .find((candidate) => !candidate.disconnected && candidate.elements.includes(sentinel));
  if (!observer) throw new Error('no active IntersectionObserver observes the live sentinel');
  observer.callback(
    [{ isIntersecting: true, target: sentinel } as IntersectionObserverEntry],
    observer.instance,
  );
}

const ghIssue = (id: string, number: number) => ({
  id,
  number,
  title: `Issue ${number}`,
  htmlUrl: `https://github.com/o/r/issues/${number}`,
  state: 'open' as const,
  owner: 'o',
  repo: 'r',
});

const ghPull = (id: string, number: number) => ({
  id,
  number,
  title: `PR ${number}`,
  htmlUrl: `https://github.com/o/r/pull/${number}`,
  state: 'open' as const,
  owner: 'o',
  repo: 'r',
});

/** Bridge-shaped row for a specific repo: repo-scoped `owner/repo#number` id. */
const ghIssueIn = (owner: string, repo: string, number: number, updatedAt?: string) => ({
  id: `${owner}/${repo}#${number}`,
  number,
  title: `Issue ${number}`,
  htmlUrl: `https://github.com/${owner}/${repo}/issues/${number}`,
  state: 'open' as const,
  owner,
  repo,
  ...(updatedAt ? { updatedAt } : {}),
});

const ghPullIn = (owner: string, repo: string, number: number) => ({
  id: `${owner}/${repo}#${number}`,
  number,
  title: `PR ${number}`,
  htmlUrl: `https://github.com/${owner}/${repo}/pull/${number}`,
  state: 'open' as const,
  owner,
  repo,
});

type RepoRef = { owner: string; repo: string };
type SearchPayload = { owner: string; repo: string; options?: { repos?: RepoRef[] } };

/** Rendered result rows (`<label>#<number> <title>`), in DOM order. */
function resultRowTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button'))
    .map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter((text) => /#\d+ /.test(text));
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockComponent.svelte'));
warmImport(() => import('./mocks/MockTooltipRich.svelte'));

describe('IssueSuggestions server-side search + pagination wire contract', () => {
  let disposeStore: () => void;
  let stopSaga: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    disposeStore = appStore.init();
    stopSaga = appStore.runSaga(issueSuggestionsSaga);
    observers.length = 0;
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
    stopSaga();
    disposeStore();
    unregisterMockIpcHandler('git-tracking:search-github-issues');
    unregisterMockIpcHandler('git-tracking:search-pull-requests');
    unregisterMockIpcHandler('git-tracking:list-related-repos');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function settle(ms = 200): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it('debounced typing sends a server search with the exact request shape (GH issues)', async () => {
    const issueCalls: unknown[] = [];
    registerMockIpcHandler('git-tracking:search-github-issues', (payload) => {
      issueCalls.push(payload);
      return { success: true, data: [ghIssue('i-1', 1)], nextToken: null };
    });
    registerMockIpcHandler('git-tracking:search-pull-requests', () => ({
      success: true,
      data: [],
      nextToken: null,
    }));

    render(IssueSuggestions, {
      props: {
        repositoryOwner: 'owner-a',
        repositoryName: 'repo-a',
        initiallyExpanded: true,
        initialSource: 'github-issues' as const,
        hideSourceTabs: true,
      },
    });
    await settle();

    expect(issueCalls.length).toBeGreaterThan(0);
    expect(issueCalls[0]).toEqual({
      owner: 'owner-a',
      repo: 'repo-a',
      options: { state: 'open', per_page: 20, filter: 'all' },
    });

    const input = screen.getByPlaceholderText('Search GitHub issues...');
    await fireEvent.input(input, { target: { value: 'flaky websocket' } });

    const before = issueCalls.length;
    await settle(299);
    expect(issueCalls.length).toBe(before);
    await settle(2);

    expect(issueCalls.length).toBe(before + 1);
    expect(issueCalls.at(-1)).toEqual({
      owner: 'owner-a',
      repo: 'repo-a',
      options: { state: 'open', per_page: 20, filter: 'all', query: 'flaky websocket' },
    });
  });

  it('sentinel intersection fetches the next page with the stored nextToken and dedupes', async () => {
    const issueCalls: Array<{ options?: { nextToken?: string } }> = [];
    registerMockIpcHandler('git-tracking:search-github-issues', (payload) => {
      issueCalls.push(payload as (typeof issueCalls)[number]);
      const token = (payload as { options?: { nextToken?: string } }).options?.nextToken;
      return token
        ? { success: true, data: [ghIssue('i-2', 2), ghIssue('i-3', 3)], nextToken: null }
        : { success: true, data: [ghIssue('i-1', 1), ghIssue('i-2', 2)], nextToken: 'cursor-1' };
    });
    registerMockIpcHandler('git-tracking:search-pull-requests', () => ({
      success: true,
      data: [],
      nextToken: null,
    }));

    const { container } = render(IssueSuggestions, {
      props: {
        repositoryOwner: 'owner-b',
        repositoryName: 'repo-b',
        initiallyExpanded: true,
        initialSource: 'github-issues' as const,
        hideSourceTabs: true,
      },
    });
    await settle();

    expect(observers.length).toBeGreaterThan(0);
    const sentinel = container.querySelector('[aria-hidden="true"].h-px');
    expect(sentinel).not.toBeNull();
    intersectSentinel(sentinel!);
    await settle();

    const pagedCall = issueCalls.find((c) => c.options?.nextToken !== undefined);
    expect(pagedCall).toBeDefined();
    expect(pagedCall!.options!.nextToken).toBe('cursor-1');
    // No related repos resolved: the load-more call is primary-only
    expect(pagedCall!.options).not.toHaveProperty('repos');

    // Exhausted: the sentinel is gone once nextToken is null
    expect(container.querySelector('[aria-hidden="true"].h-px')).toBeNull();
  });

  it('row trigger wrappers carry width-constraining classes so long titles truncate', async () => {
    registerMockIpcHandler('git-tracking:search-github-issues', () => ({
      success: true,
      data: [ghIssue('i-1', 1)],
      nextToken: null,
    }));
    registerMockIpcHandler('git-tracking:search-pull-requests', () => ({
      success: true,
      data: [ghPull('p-1', 10)],
      nextToken: null,
    }));

    for (const initialSource of ['github-issues', 'github-prs'] as const) {
      const { container } = render(IssueSuggestions, {
        props: {
          repositoryOwner: 'owner-a',
          repositoryName: 'repo-a',
          initiallyExpanded: true,
          initialSource,
          hideSourceTabs: true,
        },
      });
      await settle();

      const wrappers = container.querySelectorAll('span[data-mock-tooltip-trigger]');
      expect(wrappers.length).toBeGreaterThan(0);
      for (const wrapper of wrappers) {
        expect(wrapper.classList.contains('flex')).toBe(true);
        expect(wrapper.classList.contains('w-full')).toBe(true);
        expect(wrapper.classList.contains('min-w-0')).toBe(true);
        // tailwind-merge must drop the default inline-flex in favor of flex
        expect(wrapper.classList.contains('inline-flex')).toBe(false);
      }
      cleanup();
    }
  });

  it('debounced typing sends a server search with the exact request shape (GH PRs)', async () => {
    const prCalls: unknown[] = [];
    registerMockIpcHandler('git-tracking:search-github-issues', () => ({
      success: true,
      data: [],
      nextToken: null,
    }));
    registerMockIpcHandler('git-tracking:search-pull-requests', (payload) => {
      prCalls.push(payload);
      return { success: true, data: [ghPull('p-1', 10)], nextToken: null };
    });

    render(IssueSuggestions, {
      props: {
        repositoryOwner: 'owner-c',
        repositoryName: 'repo-c',
        initiallyExpanded: true,
        initialSource: 'github-prs' as const,
        hideSourceTabs: true,
      },
    });
    await settle();

    expect(prCalls.length).toBeGreaterThan(0);
    expect(prCalls[0]).toEqual({
      owner: 'owner-c',
      repo: 'repo-c',
      options: { state: 'open', per_page: 50, filter: 'all' },
    });

    const input = screen.getByPlaceholderText('Search pull requests...');
    await fireEvent.input(input, { target: { value: 'dark mode' } });
    await settle(301);

    expect(prCalls.at(-1)).toEqual({
      owner: 'owner-c',
      repo: 'repo-c',
      options: { state: 'open', per_page: 50, filter: 'all', query: 'dark mode' },
    });
  });

  // Related-repo resolution is cached per primary `owner/repo` for the module's
  // lifetime, so each multi-repo test below addresses a distinct primary repo.

  it('resolves related repos once with the exact params, then re-searches with `repos` (primary excluded, capped at 5)', async () => {
    const relatedCalls: unknown[] = [];
    const issueCalls: SearchPayload[] = [];
    registerMockIpcHandler('git-tracking:list-related-repos', (payload) => {
      relatedCalls.push(payload);
      return {
        success: true,
        data: [
          { owner: 'owner-d', repo: 'repo-d', path: 'self' },
          { owner: 'owner-d', repo: 'sub-1', path: 'packages/sub-1' },
          { owner: 'other', repo: 'sub-2', path: 'packages/sub-2' },
          { owner: 'owner-d', repo: 'sub-1', path: 'packages/sub-1-dup' },
          { owner: 'owner-d', repo: 'sub-3', path: 'packages/sub-3' },
          { owner: 'owner-d', repo: 'sub-4', path: 'packages/sub-4' },
          { owner: 'owner-d', repo: 'sub-5', path: 'packages/sub-5' },
          { owner: 'owner-d', repo: 'sub-6', path: 'packages/sub-6' },
        ],
      };
    });
    registerMockIpcHandler('git-tracking:search-github-issues', (payload) => {
      issueCalls.push(payload as SearchPayload);
      return { success: true, data: [ghIssueIn('owner-d', 'repo-d', 1)], nextToken: null };
    });
    registerMockIpcHandler('git-tracking:search-pull-requests', () => ({
      success: true,
      data: [],
      nextToken: null,
    }));

    render(IssueSuggestions, {
      props: {
        repositoryOwner: 'owner-d',
        repositoryName: 'repo-d',
        initiallyExpanded: true,
        initialSource: 'github-issues' as const,
        hideSourceTabs: true,
      },
    });
    await settle();

    expect(relatedCalls).toEqual([{ owner: 'owner-d', repo: 'repo-d' }]);

    // The first listing goes out against the primary repo alone; once the
    // related set resolves the listing refreshes with the extras.
    expect(issueCalls[0].options).not.toHaveProperty('repos');
    const expectedRepos: RepoRef[] = [
      { owner: 'owner-d', repo: 'sub-1' },
      { owner: 'other', repo: 'sub-2' },
      { owner: 'owner-d', repo: 'sub-3' },
      { owner: 'owner-d', repo: 'sub-4' },
      { owner: 'owner-d', repo: 'sub-5' },
    ];
    expect(issueCalls.at(-1)).toEqual({
      owner: 'owner-d',
      repo: 'repo-d',
      options: { state: 'open', per_page: 20, filter: 'all', repos: expectedRepos },
    });

    // A debounced search keeps the repo set on the request
    const input = screen.getByPlaceholderText('Search GitHub issues...');
    await fireEvent.input(input, { target: { value: 'submodule' } });
    await settle(301);
    expect(issueCalls.at(-1)).toEqual({
      owner: 'owner-d',
      repo: 'repo-d',
      options: {
        state: 'open',
        per_page: 20,
        filter: 'all',
        query: 'submodule',
        repos: expectedRepos,
      },
    });
  });

  it('renders a blended issues response in wire order with repo labels and the "+N repos" badge', async () => {
    registerMockIpcHandler('git-tracking:list-related-repos', () => ({
      success: true,
      data: [
        { owner: 'owner-e', repo: 'intentd', path: 'packages/intentd' },
        { owner: 'owner-e', repo: 'cloudlands-fe', path: 'packages/cloudlands-fe' },
      ],
    }));
    registerMockIpcHandler('git-tracking:search-github-issues', (payload) => {
      const blended = (payload as SearchPayload).options?.repos !== undefined;
      return {
        success: true,
        data: blended
          ? [
              ghIssueIn('owner-e', 'intentd', 12, '2026-09-13T10:00:00Z'),
              ghIssueIn('owner-e', 'repo-e', 7, '2026-09-12T10:00:00Z'),
              ghIssueIn('owner-e', 'cloudlands-fe', 3, '2026-09-11T10:00:00Z'),
            ]
          : [ghIssueIn('owner-e', 'repo-e', 7, '2026-09-12T10:00:00Z')],
        nextToken: null,
      };
    });
    registerMockIpcHandler('git-tracking:search-pull-requests', () => ({
      success: true,
      data: [],
      nextToken: null,
    }));

    const { container } = render(IssueSuggestions, {
      props: {
        repositoryOwner: 'owner-e',
        repositoryName: 'repo-e',
        initiallyExpanded: true,
        initialSource: 'github-issues' as const,
        hideSourceTabs: true,
      },
    });
    await settle();

    const rows = resultRowTexts(container);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('intentd#12');
    expect(rows[1]).toContain('repo-e#7');
    expect(rows[2]).toContain('cloudlands-fe#3');

    expect(screen.getAllByText('+2 repos').length).toBeGreaterThan(0);
  });

  it('renders two same-numbered items from different repos as distinct rows', async () => {
    registerMockIpcHandler('git-tracking:list-related-repos', () => ({
      success: true,
      data: [{ owner: 'other-org', repo: 'repo-f', path: 'vendor/repo-f' }],
    }));
    registerMockIpcHandler('git-tracking:search-github-issues', (payload) => {
      const blended = (payload as SearchPayload).options?.repos !== undefined;
      return {
        success: true,
        data: blended
          ? [ghIssueIn('owner-f', 'repo-f', 5), ghIssueIn('other-org', 'repo-f', 5)]
          : [ghIssueIn('owner-f', 'repo-f', 5)],
        nextToken: null,
      };
    });
    registerMockIpcHandler('git-tracking:search-pull-requests', () => ({
      success: true,
      data: [],
      nextToken: null,
    }));

    const { container } = render(IssueSuggestions, {
      props: {
        repositoryOwner: 'owner-f',
        repositoryName: 'repo-f',
        initiallyExpanded: true,
        initialSource: 'github-issues' as const,
        hideSourceTabs: true,
      },
    });
    await settle();

    // Both repos share the short name, so labels fall back to owner/repo
    const rows = resultRowTexts(container);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('owner-f/repo-f#5');
    expect(rows[1]).toContain('other-org/repo-f#5');
  });

  it('single-repo case sends no `repos` and shows no repo labels', async () => {
    const issueCalls: SearchPayload[] = [];
    registerMockIpcHandler('git-tracking:list-related-repos', () => ({
      success: true,
      data: [],
    }));
    registerMockIpcHandler('git-tracking:search-github-issues', (payload) => {
      issueCalls.push(payload as SearchPayload);
      return { success: true, data: [ghIssueIn('owner-g', 'repo-g', 1)], nextToken: null };
    });
    registerMockIpcHandler('git-tracking:search-pull-requests', () => ({
      success: true,
      data: [],
      nextToken: null,
    }));

    const { container } = render(IssueSuggestions, {
      props: {
        repositoryOwner: 'owner-g',
        repositoryName: 'repo-g',
        initiallyExpanded: true,
        initialSource: 'github-issues' as const,
        hideSourceTabs: true,
      },
    });
    await settle();

    expect(issueCalls.length).toBeGreaterThan(0);
    for (const call of issueCalls) {
      expect(call.options).not.toHaveProperty('repos');
    }

    const rows = resultRowTexts(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('#1');
    expect(rows[0]).not.toContain('repo-g');
    expect(screen.queryByText(/\+\d+ repos?/)).toBeNull();
  });

  it('PR searches carry `repos` and PR rows are labelled by repo', async () => {
    const prCalls: SearchPayload[] = [];
    registerMockIpcHandler('git-tracking:list-related-repos', () => ({
      success: true,
      data: [{ owner: 'owner-h', repo: 'intentd', path: 'packages/intentd' }],
    }));
    registerMockIpcHandler('git-tracking:search-github-issues', () => ({
      success: true,
      data: [],
      nextToken: null,
    }));
    registerMockIpcHandler('git-tracking:search-pull-requests', (payload) => {
      prCalls.push(payload as SearchPayload);
      const blended = (payload as SearchPayload).options?.repos !== undefined;
      return {
        success: true,
        data: blended
          ? [ghPullIn('owner-h', 'intentd', 10), ghPullIn('owner-h', 'repo-h', 4)]
          : [ghPullIn('owner-h', 'repo-h', 4)],
        nextToken: null,
      };
    });

    const { container } = render(IssueSuggestions, {
      props: {
        repositoryOwner: 'owner-h',
        repositoryName: 'repo-h',
        initiallyExpanded: true,
        initialSource: 'github-prs' as const,
        hideSourceTabs: true,
      },
    });
    await settle();

    expect(prCalls[0].options).not.toHaveProperty('repos');
    expect(prCalls.at(-1)).toEqual({
      owner: 'owner-h',
      repo: 'repo-h',
      options: {
        state: 'open',
        per_page: 50,
        filter: 'all',
        repos: [{ owner: 'owner-h', repo: 'intentd' }],
      },
    });

    const rows = resultRowTexts(container);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('intentd#10');
    expect(rows[1]).toContain('repo-h#4');
    expect(screen.getAllByText('+1 repo').length).toBeGreaterThan(0);
  });

  it('load-more (nextToken) requests carry the same `repos` as the first page', async () => {
    type PagedPayload = SearchPayload & { options?: { nextToken?: string } };
    const issueCalls: PagedPayload[] = [];
    const prCalls: PagedPayload[] = [];
    const related = [{ owner: 'owner-i', repo: 'sub-i' }];
    registerMockIpcHandler('git-tracking:list-related-repos', () => ({
      success: true,
      data: [{ ...related[0], path: 'packages/sub-i' }],
    }));
    registerMockIpcHandler('git-tracking:search-github-issues', (payload) => {
      const call = payload as PagedPayload;
      issueCalls.push(call);
      return call.options?.nextToken
        ? { success: true, data: [ghIssueIn('owner-i', 'sub-i', 2)], nextToken: null }
        : { success: true, data: [ghIssueIn('owner-i', 'repo-i', 1)], nextToken: 'issues-cursor' };
    });
    registerMockIpcHandler('git-tracking:search-pull-requests', (payload) => {
      const call = payload as PagedPayload;
      prCalls.push(call);
      return call.options?.nextToken
        ? { success: true, data: [ghPullIn('owner-i', 'sub-i', 20)], nextToken: null }
        : { success: true, data: [ghPullIn('owner-i', 'repo-i', 10)], nextToken: 'prs-cursor' };
    });

    render(IssueSuggestions, {
      props: {
        repositoryOwner: 'owner-i',
        repositoryName: 'repo-i',
        initiallyExpanded: true,
        initialSource: 'github-issues' as const,
        hideSourceTabs: true,
      },
    });
    await settle();
    const sentinel = document.querySelector('[aria-hidden="true"].h-px');
    expect(sentinel).not.toBeNull();
    intersectSentinel(sentinel!);
    await settle();

    const pagedIssues = issueCalls.find((c) => c.options?.nextToken !== undefined);
    expect(pagedIssues).toEqual({
      owner: 'owner-i',
      repo: 'repo-i',
      options: {
        state: 'open',
        per_page: 20,
        filter: 'all',
        repos: related,
        nextToken: 'issues-cursor',
      },
    });

    // Same contract on the PRs tab
    cleanup();
    render(IssueSuggestions, {
      props: {
        repositoryOwner: 'owner-i',
        repositoryName: 'repo-i',
        initiallyExpanded: true,
        initialSource: 'github-prs' as const,
        hideSourceTabs: true,
      },
    });
    await settle();
    const prSentinel = document.querySelector('[aria-hidden="true"].h-px');
    expect(prSentinel).not.toBeNull();
    intersectSentinel(prSentinel!);
    await settle();

    const pagedPRs = prCalls.find((c) => c.options?.nextToken !== undefined);
    expect(pagedPRs).toEqual({
      owner: 'owner-i',
      repo: 'repo-i',
      options: {
        state: 'open',
        per_page: 50,
        filter: 'all',
        repos: related,
        nextToken: 'prs-cursor',
      },
    });
  });
});
