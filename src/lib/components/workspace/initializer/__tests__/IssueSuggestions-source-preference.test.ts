/**
 * @vitest-environment jsdom
 *
 * Tests for the Add-context picker's last-used-source persistence and dynamic
 * provider ordering: source tabs reorder as auth state resolves, the persisted
 * source opens first on remount, and selecting an item writes the preference.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAST_SOURCE_STORAGE_KEY } from '../context-source-preference';

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
  selectGitHubAuthIsAuthenticated: mocks.selector(false),
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

const linearMocks = vi.hoisted(() => ({
  getAuthState: vi.fn(async () => ({ isAuthenticated: false })),
  fetchMyIssuesPage: vi.fn(async () => ({ issues: [], nextToken: null })),
  searchIssuesPage: vi.fn(async () => ({ issues: [], nextToken: null })),
}));
vi.mock('$features/linear-auth/renderer/linear-auth.client', () => ({
  linearAuthClient: linearMocks,
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

const linearIssue = {
  id: 'lin-1',
  identifier: 'LIN-1',
  title: 'A linear issue',
  url: 'https://linear.app/team/issue/LIN-1',
};

const TAB_LABELS = ['GH Issues', 'GH PRs', 'Linear', 'Sentry'];

function tabOrder(): string[] {
  // Tab buttons render as "<label>" or "<label> <count>"
  return screen
    .getAllByRole('button')
    .map((b) => (b.textContent ?? '').trim().replace(/\s+/g, ' '))
    .map((t) => TAB_LABELS.find((label) => t === label || t.startsWith(`${label} `)))
    .filter((t): t is string => Boolean(t));
}

describe('IssueSuggestions source preference + provider ordering', () => {
  // The global test setup replaces window.localStorage with a non-storing
  // vi.fn mock; back it with an in-memory store so persistence is observable.
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new Map();
    vi.mocked(localStorage.getItem).mockImplementation((key) => storage.get(key) ?? null);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      storage.set(key, String(value));
    });
    linearMocks.getAuthState.mockResolvedValue({ isAuthenticated: false });
    linearMocks.fetchMyIssuesPage.mockResolvedValue({ issues: [], nextToken: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function settle(ms = 200): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it('orders tabs GitHub, Linear, Sentry on a fresh install (nothing connected)', async () => {
    render(IssueSuggestions, { props: { initiallyExpanded: true } });
    await settle();

    expect(tabOrder()).toEqual(['GH Issues', 'GH PRs', 'Linear', 'Sentry']);
    expect(screen.getByPlaceholderText('Search GitHub issues...')).toBeTruthy();
  });

  it('moves a connected provider first once auth resolves, and activates it', async () => {
    linearMocks.getAuthState.mockResolvedValue({ isAuthenticated: true });
    render(IssueSuggestions, { props: { initiallyExpanded: true } });
    await settle();

    expect(tabOrder()).toEqual(['Linear', 'GH Issues', 'GH PRs', 'Sentry']);
    expect(screen.getByPlaceholderText('Search Linear issues...')).toBeTruthy();
  });

  it('persists the source when an item is selected and opens it first on remount', async () => {
    linearMocks.getAuthState.mockResolvedValue({ isAuthenticated: true });
    linearMocks.fetchMyIssuesPage.mockImplementation(async (filter: string) =>
      filter === 'assigned' ? { issues: [linearIssue], nextToken: null } : { issues: [], nextToken: null },
    );

    render(IssueSuggestions, { props: { initiallyExpanded: true, onSelect: vi.fn() } });
    await settle();

    const issueButton = screen.getByText('LIN-1').closest('button');
    expect(issueButton).toBeTruthy();
    await fireEvent.click(issueButton!);

    expect(storage.get(LAST_SOURCE_STORAGE_KEY)).toBe('linear');

    cleanup();
    render(IssueSuggestions, { props: { initiallyExpanded: true } });
    await settle();

    expect(tabOrder()[0]).toBe('Linear');
    expect(screen.getByPlaceholderText('Search Linear issues...')).toBeTruthy();
  });
});
