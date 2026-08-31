/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SentryIssueResult } from '$features/sentry-auth/types';

const sentryState = vi.hoisted(() => ({
  isAuthenticated: false,
  isConnecting: false,
}));

const clientMocks = vi.hoisted(() => ({
  fetchIssues: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock('$features/sentry-auth/renderer/sentry-auth.client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/sentry-auth/renderer/sentry-auth.client')>()),
  sentryAuthClient: clientMocks,
}));

vi.mock('$store/renderer/slices/sentry-auth/sentry-auth-selectors', () => {
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(getter());
      return () => {};
    },
  });
  return {
    selectSentryIsAuthenticated: vi.fn(() => readable(() => sentryState.isAuthenticated)),
    selectSentryIsConnecting: vi.fn(() => readable(() => sentryState.isConnecting)),
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: storeMocks.dispatch,
  });
});

import SentryPicker from '../SentryPicker.svelte';
import { warmImport } from '../../../../../../test/warm-import';

// Protocol-shaped issue per SentryIssueResult (features/sentry-auth/types.ts).
function makeIssue(overrides: Partial<SentryIssueResult> = {}): SentryIssueResult {
  return {
    id: 'issue-1',
    shortId: 'PROJ-1',
    title: 'TypeError: cannot read properties of undefined',
    status: 'unresolved',
    level: 'error',
    count: '12',
    userCount: 4,
    firstSeen: '2026-05-01T00:00:00.000Z',
    lastSeen: '2026-05-05T00:00:00.000Z',
    projectName: 'Cloudlands',
    projectSlug: 'cloudlands',
    url: 'https://sentry.io/issues/issue-1',
    type: 'TypeError',
    value: 'cannot read properties of undefined',
    ...overrides,
  };
}

const baseProps = {
  workspaceId: 'ws-1',
  onSelect: vi.fn(),
  onClose: vi.fn(),
};

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../SentryPicker.svelte'));

beforeEach(() => {
  sentryState.isAuthenticated = false;
  sentryState.isConnecting = false;
  clientMocks.fetchIssues.mockReset();
  clientMocks.fetchIssues.mockResolvedValue([]);
  storeMocks.dispatch.mockClear();
  baseProps.onSelect = vi.fn();
  baseProps.onClose = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SentryPicker direct-client fetch', () => {
  it('shows the connect prompt without fetching when unauthenticated', async () => {
    render(SentryPicker, { props: baseProps });

    expect(screen.getByText('Connect to Sentry to see your issues')).toBeTruthy();
    expect(clientMocks.fetchIssues).not.toHaveBeenCalled();
    expect(storeMocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sentryAuth/initialize' }),
    );
  });

  it('fetches issues through the client once when authenticated and renders them', async () => {
    sentryState.isAuthenticated = true;
    clientMocks.fetchIssues.mockResolvedValue([
      makeIssue(),
      makeIssue({ id: 'issue-2', shortId: 'PROJ-2', title: 'Timeout in worker' }),
    ]);

    render(SentryPicker, { props: baseProps });

    await waitFor(() => expect(screen.getByText('PROJ-1')).toBeTruthy());
    expect(screen.getByText('PROJ-2')).toBeTruthy();
    expect(clientMocks.fetchIssues).toHaveBeenCalledTimes(1);
    expect(clientMocks.fetchIssues).toHaveBeenCalledWith();
  });

  it('renders the empty state when the client resolves no issues', async () => {
    sentryState.isAuthenticated = true;

    render(SentryPicker, { props: baseProps });

    await waitFor(() => expect(screen.getByText('No issues found')).toBeTruthy());
    expect(clientMocks.fetchIssues).toHaveBeenCalledTimes(1);
  });

  it('reports the selected issue with sentry metadata and closes', async () => {
    sentryState.isAuthenticated = true;
    clientMocks.fetchIssues.mockResolvedValue([makeIssue()]);

    render(SentryPicker, { props: baseProps });
    await waitFor(() => expect(screen.getByText('PROJ-1')).toBeTruthy());

    screen.getByText('PROJ-1').closest('button')!.click();

    expect(baseProps.onSelect).toHaveBeenCalledWith({
      type: 'sentry-issue',
      title: 'TypeError: cannot read properties of undefined',
      url: 'https://sentry.io/issues/issue-1',
      identifier: 'PROJ-1',
      metadata: {
        project: 'cloudlands',
        projectName: 'Cloudlands',
        type: 'TypeError',
        value: 'cannot read properties of undefined',
        count: '12',
        userCount: 4,
      },
    });
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });
});
