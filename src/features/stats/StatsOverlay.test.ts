import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { UsageStatsResult } from '$lib/client/app-client';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  data: null as UsageStatsResult | null,
  loading: false,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      sidebarNav: { statsOverlayOpen: true },
      stats: {
        mode: 'month',
        periodKey: '2026-09',
        loading: mocks.loading,
        error: null,
        data: mocks.data,
      },
    }),
    dispatch: mocks.dispatch,
  });
});

import StatsOverlay from './StatsOverlay.svelte';
import { setStatsOverlayOpen } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';

beforeEach(() => {
  mocks.dispatch.mockClear();
  mocks.loading = false;
  mocks.data = {
    totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    runs: 0,
    sessions: 0,
    longestRunMs: 0,
    linesAdded: 0,
    linesDeleted: 0,
    byModel: [],
    byProvider: [],
    byHourOfDay: [],
    byMonth: [],
    availablePeriods: { months: ['2026-08', '2026-09'], years: ['2026'] },
  };
});
afterEach(cleanup);

describe('usage period Select', () => {
  it('keeps period selection available but withholds card export while initial data loads', async () => {
    mocks.data = null;
    mocks.loading = true;
    render(StatsOverlay);
    const trigger = screen.getByRole('combobox', { name: m.stats_overlay_period_ariaLabel() });
    expect(trigger.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain(m.stats_overlay_loading_label());
    expect(
      screen.queryByRole('button', {
        name: m.stats_overlay_exportCard_ariaLabel({ card: 'passport' }),
      }),
    ).toBeNull();

    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    mocks.dispatch.mockClear();
    await fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(setStatsOverlayOpen(false));
  });

  it('selects a period by keyboard and dispatches its exact key', async () => {
    render(StatsOverlay);
    mocks.dispatch.mockClear();
    const trigger = screen.getByRole('combobox', { name: m.stats_overlay_period_ariaLabel() });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.keyDown(trigger, { key: 'End' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'stats/loadUsageStatsRequested',
      payload: ['month', '2026-08', -new Date().getTimezoneOffset()],
    });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it.each(['trigger', 'listbox'] as const)(
    'uses the first Escape from %s for the Select, not the surrounding stats overlay',
    async (focusTarget) => {
      render(StatsOverlay);
      const trigger = screen.getByRole('combobox', { name: m.stats_overlay_period_ariaLabel() });
      trigger.focus();
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      const escapeTarget = focusTarget === 'trigger' ? trigger : screen.getByRole('listbox');
      escapeTarget.focus();
      mocks.dispatch.mockClear();
      await fireEvent.keyDown(escapeTarget, { key: 'Escape' });
      expect(mocks.dispatch).not.toHaveBeenCalledWith(setStatsOverlayOpen(false));
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      await fireEvent.keyDown(trigger, { key: 'Escape' });
      expect(mocks.dispatch).toHaveBeenCalledWith(setStatsOverlayOpen(false));
    },
  );
});
