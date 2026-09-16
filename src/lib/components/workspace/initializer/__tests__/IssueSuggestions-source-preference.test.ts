/**
 * @vitest-environment jsdom
 *
 * Tests for the Add-context picker's last-used-source persistence and dynamic
 * provider ordering: source tabs reorder as auth state resolves, the persisted
 * source opens first on remount, and selecting an item writes the preference.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });
  const selector = <T>(value: T) => Object.assign(() => readable(value), { select: () => value });
  const mutableSelector = <T>(initialValue: T) => {
    let value = initialValue;
    const listeners = new Set<(next: T) => void>();
    return {
      selector: Object.assign(
        () => ({
          subscribe(run: (next: T) => void) {
            run(value);
            listeners.add(run);
            return () => listeners.delete(run);
          },
        }),
        { select: () => value },
      ),
      set(next: T) {
        value = next;
        for (const listener of listeners) listener(next);
      },
    };
  };
  return {
    readable,
    selector,
    dispatch: vi.fn(),
    linearAuthenticated: mutableSelector(false),
    lastUsedSource: mutableSelector<string | null>(null),
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ theme: { name: 'dark' } }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(false),
  selectGitHubAuthIsAuthenticating: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  startGitHubAuth: () => ({ type: 'github-auth/start' }),
}));
vi.mock('$store/renderer/slices/linear-auth/linear-auth-selectors', () => ({
  selectLinearIsAuthenticated: mocks.linearAuthenticated.selector,
  selectLinearIsAuthenticating: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/linear-auth/linear-auth-slice', () => ({
  initializeLinearAuth: () => ({ type: 'linear-auth/initialize' }),
  startLinearAuth: () => ({ type: 'linear-auth/start' }),
}));
vi.mock('$store/renderer/slices/sentry-auth/sentry-auth-selectors', () => ({
  selectSentryIsAuthenticated: mocks.selector(false),
  selectSentryIsConnecting: mocks.selector(false),
  selectSentryError: mocks.selector(null),
}));
vi.mock('$store/renderer/slices/sentry-auth/sentry-auth-slice', () => ({
  connectSentry: () => ({ type: 'sentry-auth/connect' }),
  initializeSentryAuth: () => ({ type: 'sentry-auth/initialize' }),
}));
vi.mock('$store/renderer/slices/issue-suggestions/issue-suggestions-selectors', () => {
  const empty = {
    items: [],
    nextToken: null,
    isFetching: false,
    isLoadingMore: false,
    error: null,
    version: 0,
  };
  return {
    selectLinearAssignedSuggestions: mocks.selector({
      ...empty,
      items: [
        {
          id: 'lin-1',
          identifier: 'LIN-1',
          title: 'A linear issue',
          url: 'https://linear.app/team/issue/LIN-1',
        },
      ],
    }),
    selectLinearCreatedSuggestions: mocks.selector(empty),
    selectLinearSearchSuggestions: mocks.selector(empty),
    selectLastUsedContextSource: mocks.lastUsedSource.selector,
    selectSentrySuggestions: mocks.selector(empty),
    selectGitHubIssueSuggestions: mocks.selector(empty),
    selectGitHubPullRequestSuggestions: mocks.selector(empty),
    selectGitHubRelatedRepos: mocks.selector(empty),
    selectGitHubPullRequestDetail: mocks.selector(empty),
  };
});
const linearMocks = vi.hoisted(() => ({
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
import { warmImport } from '../../../../../test/warm-import';

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

function tabButton(label: string): HTMLButtonElement {
  const button = screen.getAllByRole('button').find((b) => {
    const text = (b.textContent ?? '').trim().replace(/\s+/g, ' ');
    return text === label || text.startsWith(`${label} `);
  });
  if (!button) throw new Error(`Tab button "${label}" not found`);
  return button as HTMLButtonElement;
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockComponent.svelte'));
warmImport(() => import('./mocks/MockTooltipRich.svelte'));

describe('IssueSuggestions source preference + provider ordering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.dispatch.mockClear();
    mocks.linearAuthenticated.set(false);
    mocks.lastUsedSource.set(null);
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
    render(IssueSuggestions, { props: { initiallyExpanded: true } });
    mocks.linearAuthenticated.set(true);
    await settle();

    expect(tabOrder()).toEqual(['Linear', 'GH Issues', 'GH PRs', 'Sentry']);
    expect(screen.getByPlaceholderText('Search Linear issues...')).toBeTruthy();
  });

  it('persists the source when an item is selected and opens it first on remount', async () => {
    mocks.linearAuthenticated.set(true);
    linearMocks.fetchMyIssuesPage.mockImplementation(async (filter: string) =>
      filter === 'assigned'
        ? { issues: [linearIssue], nextToken: null }
        : { issues: [], nextToken: null },
    );

    render(IssueSuggestions, { props: { initiallyExpanded: true, onSelect: vi.fn() } });
    await settle();

    const issueButton = screen.getByText('LIN-1').closest('button');
    expect(issueButton).toBeTruthy();
    await fireEvent.click(issueButton!);

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'issueSuggestions/setContextSourcePreference',
      payload: ['linear'],
    });

    cleanup();
    mocks.lastUsedSource.set('linear');
    render(IssueSuggestions, { props: { initiallyExpanded: true } });
    await settle();

    expect(tabOrder()[0]).toBe('Linear');
    expect(screen.getByPlaceholderText('Search Linear issues...')).toBeTruthy();
  });

  it('linear row trigger wrappers carry width-constraining classes so long titles truncate', async () => {
    mocks.linearAuthenticated.set(true);
    linearMocks.fetchMyIssuesPage.mockImplementation(async (filter: string) =>
      filter === 'assigned'
        ? { issues: [linearIssue], nextToken: null }
        : { issues: [], nextToken: null },
    );

    const { container } = render(IssueSuggestions, { props: { initiallyExpanded: true } });
    await settle();

    expect(screen.getByText('LIN-1')).toBeTruthy();
    const wrappers = container.querySelectorAll('span[data-mock-tooltip-trigger]');
    expect(wrappers.length).toBeGreaterThan(0);
    for (const wrapper of wrappers) {
      expect(wrapper.classList.contains('flex')).toBe(true);
      expect(wrapper.classList.contains('w-full')).toBe(true);
      expect(wrapper.classList.contains('min-w-0')).toBe(true);
      // tailwind-merge must drop the default inline-flex in favor of flex
      expect(wrapper.classList.contains('inline-flex')).toBe(false);
    }
  });

  it('does not persist the source when merely switching tabs', async () => {
    render(IssueSuggestions, { props: { initiallyExpanded: true } });
    await settle();

    await fireEvent.click(tabButton('Linear'));
    await settle();

    expect(screen.getByPlaceholderText('Search Linear issues...')).toBeTruthy();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'issueSuggestions/setContextSourcePreference' }),
    );
  });

  it('initialSource overrides a different persisted value and stays locked through auth resolution', async () => {
    mocks.lastUsedSource.set('linear');
    mocks.linearAuthenticated.set(true);

    render(IssueSuggestions, { props: { initiallyExpanded: true, initialSource: 'sentry' } });
    await settle();

    expect(screen.getByPlaceholderText('Search Sentry issues...')).toBeTruthy();
  });

  it('does not switch panes mid-search when auth resolves', async () => {
    render(IssueSuggestions, { props: { initiallyExpanded: true } });
    setTimeout(() => mocks.linearAuthenticated.set(true), 400);
    await settle(200);

    const input = screen.getByPlaceholderText('Search GitHub issues...');
    await fireEvent.input(input, { target: { value: 'crash' } });
    await settle(600);

    // Auth resolved: Linear moves first in the tab order, but the active pane
    // stays pinned to the in-progress search.
    expect(tabOrder()[0]).toBe('Linear');
    expect(screen.getByPlaceholderText('Search GitHub issues...')).toBeTruthy();
  });
});
