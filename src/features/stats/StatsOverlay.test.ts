import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { UsageStatsResult } from '$lib/client/app-client';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  data: null as UsageStatsResult | null,
  loading: false,
  mode: 'month' as 'month' | '24h',
  exportCardPng: vi.fn<(node: HTMLElement, fileName: string) => Promise<void>>(),
  notifyError: vi.fn(),
}));
vi.mock('./stats-export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stats-export')>()),
  exportCardPng: mocks.exportCardPng,
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.notifyError },
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      sidebarNav: { statsOverlayOpen: true },
      stats: {
        mode: mocks.mode,
        periodKey: mocks.mode === '24h' ? null : '2026-09',
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
  mocks.exportCardPng.mockReset().mockResolvedValue(undefined);
  mocks.notifyError.mockReset();
  mocks.loading = false;
  mocks.mode = 'month';
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

describe('cached tokens toggle', () => {
  beforeEach(() => {
    mocks.data = {
      ...mocks.data!,
      totals: {
        inputTokens: 2_000_000,
        outputTokens: 3_000_000,
        cacheReadTokens: 90_000_000,
        cacheCreationTokens: 5_000_000,
      },
      byModel: [
        {
          model: 'cache-heavy',
          runs: 1,
          inputTokens: 1_000_000,
          outputTokens: 0,
          cacheReadTokens: 90_000_000,
          cacheCreationTokens: 5_000_000,
        },
        {
          model: 'fresh-heavy',
          runs: 1,
          inputTokens: 1_000_000,
          outputTokens: 3_000_000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      ],
    };
  });

  function passport() {
    return document.querySelector<HTMLElement>('[data-stats-card="passport"]')!;
  }

  it('hides cached tokens by default and shows them when toggled on', async () => {
    render(StatsOverlay);
    const toggle = screen.getByRole('button', { name: m.stats_overlay_cachedTokens_label() });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(passport().querySelector('.hero-value')?.textContent).toBe('5M');
    expect(passport().querySelector('.counter-cread')).toBeNull();
    expect(passport().querySelector('.counter-cwrite')).toBeNull();
    expect(passport().querySelector('.stat-clip')?.textContent).toBe('fresh-heavy');

    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(passport().querySelector('.hero-value')?.textContent).toBe('100M');
    expect(passport().querySelector('.counter-cread')?.textContent).toContain('90M');
    expect(passport().querySelector('.counter-cwrite')?.textContent).toContain('5M');
    expect(passport().querySelector('.stat-clip')?.textContent).toBe('cache-heavy');

    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(passport().querySelector('.hero-value')?.textContent).toBe('5M');
  });
});

describe('card PNG export', () => {
  it.each([
    'passport',
    'models',
    'providers',
    'by-hour',
    'by-month',
    'code',
    'tools',
    'team',
    'streak',
  ] as const)('exports the %s card node with its period filename', async (card) => {
    render(StatsOverlay);
    const button = screen.getByRole('button', {
      name: m.stats_overlay_exportCard_ariaLabel({ card }),
    });
    await fireEvent.click(button);
    await waitFor(() => expect(mocks.exportCardPng).toHaveBeenCalledTimes(1));
    const [node, fileName] = mocks.exportCardPng.mock.calls[0];
    expect(node.getAttribute('data-stats-card')).toBe(card);
    expect(fileName).toBe(`intent-${card}-2026-09.png`);
  });

  it('shows the error toast when the export rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.exportCardPng.mockRejectedValue(new Error('render failed'));
    render(StatsOverlay);
    await fireEvent.click(
      screen.getByRole('button', {
        name: m.stats_overlay_exportCard_ariaLabel({ card: 'models' }),
      }),
    );
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(m.stats_overlay_exportFailed_error(), {
        description: 'render failed',
      }),
    );
    consoleError.mockRestore();
  });
});

describe('activity cards', () => {
  const slots = () =>
    Array.from(document.querySelectorAll('[data-stats-card-slot]'), (n) =>
      n.getAttribute('data-stats-card-slot'),
    );

  it('follow the existing cards and hide the streak in 24H', () => {
    render(StatsOverlay);
    expect(slots().slice(-4)).toEqual(['code', 'tools', 'team', 'streak']);
    cleanup();
    mocks.mode = '24h';
    render(StatsOverlay);
    expect(slots()).not.toContain('streak');
    expect(slots()).not.toContain('by-month');
    expect(slots().slice(-3)).toEqual(['code', 'tools', 'team']);
  });

  it('mark an older daemon but keep real line counts', () => {
    mocks.data = { ...mocks.data!, linesAdded: 1_500, linesDeleted: 2_000 };
    render(StatsOverlay);
    const card = (name: string) =>
      document.querySelector<HTMLElement>(`[data-stats-card="${name}"]`)!;
    for (const name of ['tools', 'team', 'streak']) {
      expect(card(name).querySelector('.note')?.textContent).toBe(
        m.stats_activity_needsUpgrade_label(),
      );
    }
    expect(card('code').querySelector('.note')).toBeNull();
    expect(card('code').querySelector('.hero-value')?.textContent).toBe('−500');
    // Metrics the older daemon never sent read as unavailable, not zero.
    for (const name of ['tools', 'streak']) {
      expect(card(name).querySelector('.hero-value')?.textContent).toBe('—');
    }
    for (const name of ['tools', 'team', 'streak']) {
      const values = Array.from(card(name).querySelectorAll('.stat-big'), (n) =>
        n.textContent?.trim(),
      );
      expect(values).toContain('—');
    }
    const toolValues = Array.from(card('tools').querySelectorAll('.stat-big, .stat-small'), (n) =>
      n.textContent?.trim(),
    );
    expect(toolValues.every((v) => v === '—')).toBe(true);
    // Sessions are a real older-daemon field and stay a number.
    expect(card('team').querySelector('.hero-value')?.textContent).toBe('0');
  });

  it('show real zeros for an empty period on a current daemon', () => {
    mocks.data = {
      ...mocks.data!,
      toolCalls: 0,
      toolCallsFailed: 0,
      totalRunMs: 0,
      subAgentSessions: 0,
      byDay: [],
      activityTrackedSince: '2026-01-01',
    };
    render(StatsOverlay);
    for (const name of ['tools', 'team', 'streak']) {
      const card = document.querySelector(`[data-stats-card="${name}"]`)!;
      expect(card.querySelector('.hero-value')?.textContent).toBe('0');
      expect(card.querySelector('.note')).toBeNull();
    }
  });

  it('show tracked-since on tool and team cards for partial periods', () => {
    mocks.data = {
      ...mocks.data!,
      toolCalls: 3,
      toolCallsFailed: 0,
      totalRunMs: 0,
      subAgentSessions: 0,
      byDay: [],
      activityTrackedSince: '2026-09-15',
    };
    render(StatsOverlay);
    for (const name of ['tools', 'team']) {
      const note = document.querySelector(`[data-stats-card="${name}"] .note`)?.textContent ?? '';
      expect(note).toContain('2026');
      expect(note).not.toBe(m.stats_activity_needsUpgrade_label());
    }
    expect(document.querySelector('[data-stats-card="streak"] .note')).toBeNull();
  });
});
