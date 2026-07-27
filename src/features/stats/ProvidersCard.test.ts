/**
 * Mock-BE test for the Providers card (per FE AGENTS.md): asserts the exact
 * `stats.getUsage` request the client emits, feeds back a PROTOCOL.md §5.36
 * shaped response containing `byProvider` (raw provider ids, sorted desc by
 * total tokens), and asserts the card renders it — pretty-printed names,
 * amounts + shares, MOST USED callout — with no client-side healing of the
 * payload. Also covers the empty-period contract (`byProvider: []`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { UsageStatsResult } from '$lib/client/app-client';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: 'sub-1' })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveStatsClient } from '$lib/client/live/live-stats-client';
import ProvidersCard from './ProvidersCard.svelte';

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL.md §5.36 `stats.getUsage` result with the `byProvider` rollup. */
const USAGE_RESULT: UsageStatsResult = {
  totals: { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 },
  runs: 15,
  sessions: 4,
  longestRunMs: 60_000,
  linesAdded: 10,
  linesDeleted: 2,
  byModel: [],
  byProvider: [
    {
      provider: 'claude-code',
      runs: 12,
      inputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    {
      provider: 'codex',
      runs: 2,
      inputTokens: 250,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    {
      provider: 'unknown',
      runs: 1,
      inputTokens: 150,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
  ],
  byHourOfDay: [],
  byMonth: [],
  availablePeriods: { months: ['2026-07'], years: ['2026'] },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProvidersCard (mock BE)', () => {
  it('renders the byProvider rollup fetched via stats.getUsage', async () => {
    mockedRequest.mockResolvedValueOnce(USAGE_RESULT);
    const data = await new LiveStatsClient().getUsage('month', '2026-07', -420);

    expect(mockedRequest).toHaveBeenCalledWith('stats.getUsage', {
      period: 'month',
      key: '2026-07',
      tzOffsetMinutes: -420,
    });
    expect(data.byProvider).toEqual(USAGE_RESULT.byProvider);

    render(ProvidersCard, { props: { data, label: 'JUL 2026' } });

    expect(screen.getByText('PROVIDERS')).toBeTruthy();
    expect(screen.getByText('JUL 2026')).toBeTruthy();
    // Raw wire ids pretty-printed; `unknown` renders as "Unknown".
    const names = Array.from(document.querySelectorAll('.row-name')).map((n) => n.textContent);
    expect(names).toEqual(['Claude Code', 'Codex', 'Unknown']);
    // Shares are fractions of the grand total (600/1000, 250/1000, 150/1000).
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('15%')).toBeTruthy();
    // MOST USED callout carries the top provider's tokens + runs.
    expect(document.querySelector('.callout-provider')?.textContent).toBe('Claude Code');
    expect(document.querySelector('.callout-sub')?.textContent).toContain('600 tokens · 12 runs');
    expect(document.querySelector('[data-stats-card="providers"]')).toBeTruthy();
  });

  it('renders the empty state (no NaN) for an empty-period byProvider', async () => {
    mockedRequest.mockResolvedValueOnce({ ...USAGE_RESULT, byProvider: [] });
    const data = await new LiveStatsClient().getUsage('24h', undefined, 0);

    expect(mockedRequest).toHaveBeenCalledWith('stats.getUsage', {
      period: '24h',
      tzOffsetMinutes: 0,
    });

    const { container } = render(ProvidersCard, { props: { data, label: 'LAST 24H' } });

    expect(screen.getByText('No provider usage in this period')).toBeTruthy();
    expect(document.querySelector('.callout-provider')?.textContent).toBe('—');
    expect(container.textContent).not.toContain('NaN');
  });

  it('renders the same zeroed layout when data has not loaded yet', () => {
    const { container } = render(ProvidersCard, { props: { data: null, label: 'JUL 2026' } });

    expect(screen.getByText('No provider usage in this period')).toBeTruthy();
    expect(container.textContent).not.toContain('NaN');
  });

  it('surfaces (not masks) a loaded payload missing the required byProvider field', () => {
    const malformed = { ...USAGE_RESULT, byProvider: undefined } as unknown as UsageStatsResult;

    expect(() =>
      render(ProvidersCard, { props: { data: malformed, label: 'JUL 2026' } }),
    ).toThrow();
  });
});
