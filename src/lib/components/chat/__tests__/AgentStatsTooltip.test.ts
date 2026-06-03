import { render } from '@testing-library/svelte';
import {
  describe,
  expect,
  it,
} from 'vitest';

import AgentStatsTooltip from '../AgentStatsTooltip.svelte';
import type { AgentSessionStats } from '$store/renderer/slices/session-stats/session-stats-types';

const stats: AgentSessionStats = {
  sessionId: 'sess-1',
  messageCount: 3,
  toolCount: 2,
  creditsUsed: 0.5,
  parentCreditsUsed: null,
  subAgentCreditsUsed: null,
  lastFetchedAt: '2026-04-16T00:00:00.000Z',
};

describe('AgentStatsTooltip', () => {
  it('defaults all-empty props to the pending skeleton', () => {
    const { queryByText, getByLabelText } = render(AgentStatsTooltip, {
      props: { stats: undefined, loading: false, error: undefined },
    });

    expect(getByLabelText('Loading agent stats')).toBeTruthy();
    expect(queryByText('No stats available')).toBeNull();
  });

  it('renders the empty fallback only when explicitly requested', () => {
    const { queryByLabelText, getByText } = render(AgentStatsTooltip, {
      props: { stats: undefined, loading: false, error: undefined, emptyState: 'empty' },
    });

    expect(getByText('No stats available')).toBeTruthy();
    expect(queryByLabelText('Loading agent stats')).toBeNull();
  });

  it('renders a stats-grid-shaped skeleton while loading', () => {
    const { container, queryByText, getByLabelText, getByText } = render(AgentStatsTooltip, {
      props: { stats: undefined, loading: true, error: undefined },
    });

    expect(getByLabelText('Loading agent stats')).toBeTruthy();
    expect(getByText('Messages')).toBeTruthy();
    expect(getByText('Tool calls')).toBeTruthy();
    expect(getByText('Credits used')).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(queryByText('No stats available')).toBeNull();
    expect(queryByText('Loading stats…')).toBeNull();
  });

  it('renders final stats in the same label/value grid', () => {
    const { getByText } = render(AgentStatsTooltip, {
      props: { stats, loading: false, error: undefined },
    });

    expect(getByText('Messages')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('Tool calls')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('Credits used')).toBeTruthy();
    expect(getByText('0.50')).toBeTruthy();
  });
});
