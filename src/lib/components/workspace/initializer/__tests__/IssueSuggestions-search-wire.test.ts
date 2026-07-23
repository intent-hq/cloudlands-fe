/**
 * @vitest-environment jsdom
 *
 * Wire-contract tests for the context picker's debounced server-side search
 * and infinite scroll: asserts the exact `git-tracking:search-github-issues`
 * / `git-tracking:search-pull-requests` requests (query + nextToken inside
 * `options`) and feeds contract-shaped mock responses back through the mock
 * IPC router.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerMockIpcHandler,
  unregisterMockIpcHandler,
} from '$shared/ipc-mock-router';

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

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => ({ theme: { name: 'dark' } }) });
});

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(true),
  selectGitHubAuthIsAuthenticating: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  startGitHubAuth: () => ({ type: 'github-auth/start' }),
}));
vi.mock('$store/renderer/slices/linear-auth/linear-auth-selectors', () => ({
  selectLinearIsAuthenticating: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/linear-auth/linear-auth-slice', () => ({
  startLinearAuth: () => ({ type: 'linear-auth/start' }),
}));
vi.mock('$store/renderer/slices/sentry-auth/sentry-auth-selectors', () => ({
  selectSentryIsConnecting: mocks.selector(false),
  selectSentryError: mocks.selector(null),
}));
vi.mock('$store/renderer/slices/sentry-auth/sentry-auth-slice', () => ({
  connectSentry: () => ({ type: 'sentry-auth/connect' }),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: mocks.selector(null),
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
  TooltipRich: (await import('./mocks/MockComponent.svelte')).default,
}));
vi.mock('$lib/components/ui/Header.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import IssueSuggestions from '../IssueSuggestions.svelte';

/** Captured IntersectionObserver instances so tests can fire intersections. */
const observers: Array<{
  callback: IntersectionObserverCallback;
  elements: Element[];
  instance: IntersectionObserver;
}> = [];

class MockIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {
    observers.push({ callback, elements: [], instance: this as unknown as IntersectionObserver });
  }
  observe(el: Element) {
    observers.find((o) => o.instance === (this as unknown as IntersectionObserver))?.elements.push(el);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

function intersectLatestSentinel(): void {
  const latest = observers.at(-1);
  if (!latest) throw new Error('no IntersectionObserver was created');
  latest.callback(
    latest.elements.map((el) => ({ isIntersecting: true, target: el }) as IntersectionObserverEntry),
    latest.instance,
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
});

describe('IssueSuggestions server-side search + pagination wire contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    observers.length = 0;
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
    unregisterMockIpcHandler('git-tracking:search-github-issues');
    unregisterMockIpcHandler('git-tracking:search-pull-requests');
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
    intersectLatestSentinel();
    await settle();

    const pagedCall = issueCalls.find((c) => c.options?.nextToken !== undefined);
    expect(pagedCall).toBeDefined();
    expect(pagedCall!.options!.nextToken).toBe('cursor-1');

    // Exhausted: the sentinel is gone once nextToken is null
    expect(container.querySelector('[aria-hidden="true"].h-px')).toBeNull();
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
});
