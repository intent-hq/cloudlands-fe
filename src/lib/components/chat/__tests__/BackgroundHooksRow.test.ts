/**
 * @vitest-environment jsdom
 *
 * BackgroundHooksRow rendering: "Running Hooks:" label after the bolt icon,
 * pointer-cursor chips, hover-card timing durations (next-run-in, elapsed,
 * expires-in — monorepo#1756), and the "View script" affordances (hover-card
 * link + dropdown item) that open the canonical hook-script panel.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';
import {
  cancelBackgroundHookRequested,
  runBackgroundHookRequested,
} from '$store/renderer/slices/background-hooks/background-hooks-slice';

const { dispatchMock, hooksState, snapshotState, openHookTabMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  hooksState: { hooks: [] as unknown[] },
  snapshotState: { status: 'ready' as 'loading' | 'ready' | 'failed' },
  openHookTabMock: vi.fn(),
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({
    getPanelIds: () => ['agent-panel'],
    getPanel: () => ({
      id: 'agent-panel',
      activeTabId: 'agent-tab',
      tabs: [{ id: 'agent-tab', type: 'agent', agentId: 'agent-1' }],
    }),
    openTabInAdjacentOrSplit: openHookTabMock,
  }),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ theme: { name: 'dark' } }),
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/background-hooks/background-hooks-selectors', () => ({
  selectBackgroundHooks: () => ({
    subscribe: (run: (value: unknown[]) => void) => {
      run(hooksState.hooks);
      return () => {};
    },
  }),
  selectBackgroundHooksSnapshotStatus: () => ({
    subscribe: (run: (value: 'loading' | 'ready' | 'failed') => void) => {
      run(snapshotState.status);
      return () => {};
    },
  }),
}));

import BackgroundHooksRow from '../BackgroundHooksRow.svelte';

function makeHook(overrides: Partial<BackgroundHook> = {}): BackgroundHook {
  return {
    hookId: 'hook-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    name: 'ci-watch',
    code: 'const status = await ws.ci.status();',
    delayMs: 60000,
    state: 'scheduled',
    createdAt: '2026-07-31T10:00:00Z',
    nextRunAt: '2026-07-31T10:06:00Z',
    runCount: 6,
    ...overrides,
  };
}

describe('BackgroundHooksRow', () => {
  beforeEach(() => {
    // Freeze only Date so hover-card durations are deterministic; real
    // timers keep waitFor/bits-ui polling functional.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-31T10:03:00Z'));
    snapshotState.status = 'ready';
    hooksState.hooks = [];
  });

  afterEach(() => {
    cleanup();
    dispatchMock.mockClear();
    openHookTabMock.mockClear();
    vi.useRealTimers();
  });

  it('renders a rounded semantic card with the Phosphor hourglass icon', () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const row = screen.getByTestId('background-hooks-row');
    expect(row).toBeTruthy();
    const summary = screen.getByTestId('background-hook-summary');
    const card = screen.getByTestId('background-hook-card');
    const icon = screen.getByTestId('background-hook-icon').querySelector('svg');
    expect(summary.textContent).toContain('ci-watch');
    expect(card.tagName).toBe('SECTION');
    expect(card.className).toContain('mx-2');
    expect(card.className).toContain('my-2');
    expect(card.className).toContain('rounded-lg');
    expect(card.className).toContain('border');
    expect(card.className).toContain('border-border');
    expect(card.className).toContain('bg-card');
    expect(card.className).toContain('shadow-sm');
    expect(card.getAttribute('aria-labelledby')).toBe('background-hook-title-hook-1');
    expect(document.getElementById('background-hook-title-hook-1')?.className).toContain(
      'font-medium',
    );
    expect(icon?.getAttribute('data-icon')).toBe('hourglass-medium');
    expect(icon?.getAttribute('width')).toBe('16');
    expect(icon?.getAttribute('height')).toBe('16');
  });

  it('renders embedded hooks as full-width flat rows with one shared divider', () => {
    hooksState.hooks = [makeHook(), makeHook({ hookId: 'hook-2', name: 'release-watch' })];
    render(BackgroundHooksRow, {
      props: { workspaceId: 'ws-1', agentId: 'agent-1', embedded: true },
    });

    const row = screen.getByTestId('background-hooks-row');
    expect(row.className).not.toContain('divide-y');
    for (const card of screen.getAllByTestId('background-hook-card')) {
      expect(card.className).toContain('background-hook-card--embedded');
      expect(card.className).toContain('m-0');
      expect(card.className).toContain('w-full');
      expect(card.className).toContain('rounded-none');
      expect(card.className).toContain('bg-transparent');
      expect(card.className).toContain('shadow-none');
      expect(card.className).not.toContain('rounded-lg');
      expect(card.className).not.toContain('border-border');
      expect(card.className).not.toContain('bg-card');
      expect(card.className).not.toContain('shadow-sm');
    }
    for (const title of document.querySelectorAll('[id^="background-hook-title-"]')) {
      expect(title.className).toContain('font-normal');
      expect(title.className).not.toContain('font-medium');
    }
  });

  it('gives hook chips a pointer cursor', () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const chip = screen.getByTestId('background-hook-chip');
    expect(chip.className).toContain('cursor-pointer');
  });

  it('caps the restored disclosure summary so long names ellipsize, not overflow', () => {
    hooksState.hooks = [
      makeHook({ name: 'a-very-long-hook-name-that-would-overflow-a-narrow-row' }),
    ];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const row = screen.getByTestId('background-hooks-row');
    const summary = screen.getByTestId('background-hook-summary');
    const label = summary.querySelector('.truncate') as HTMLElement;
    expect(row.className).toContain('min-w-0');
    expect(row.className).toContain('max-w-full');
    expect(summary.className).toContain('min-w-0');
    expect(summary.className).toContain('max-w-full');
    expect(summary.className).toContain('overflow-hidden');
    expect(label).toBeTruthy();
    expect(label.className).toContain('min-w-0');
    expect(label.className).toContain('flex-1');
  });

  it('renders nothing when the agent has no active hooks', () => {
    hooksState.hooks = [makeHook({ state: 'dispatched' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.queryByTestId('background-hooks-row')).toBeNull();
  });

  it.each([
    ['loading', 'status'],
    ['failed', 'alert'],
  ] as const)('renders its own %s state when the initial list has not settled', (status, role) => {
    snapshotState.status = status;
    hooksState.hooks = [];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const row = screen.getByRole(role);
    expect(row.getAttribute('data-testid')).toBe('background-hooks-snapshot-status');
    expect(row.getAttribute('data-snapshot-status')).toBe(status);
  });

  it('inline details show a "View script" link instead of a raw code preview', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));

    const link = await waitFor(() => screen.getByTestId('background-hook-view-script-link'));
    expect(link.textContent).toContain('View script');
    // Raw code preview is gone from the hover card
    const details = screen.getByTestId('background-hook-details');
    expect(details.classList.contains('hidden')).toBe(false);
    expect(details.querySelector('pre')).toBeNull();
    expect(details.textContent).not.toContain('const status');
  });

  it('inline details show Next run, Interval, Expires, and Runs metrics', async () => {
    hooksState.hooks = [makeHook({ expiresAt: '2026-07-31T11:00:00Z' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const details = screen.getByTestId('background-hook-details');
    expect(details.querySelectorAll('.background-hook-metric')).toHaveLength(4);
    expect(details.textContent).toContain('Next run');
    expect(details.textContent).toContain('3m');
    expect(details.textContent).toContain('Interval');
    expect(details.textContent).toContain('1m');
    expect(details.textContent).toContain('Expires');
    expect(details.textContent).toContain('57m');
    expect(details.textContent).toContain('Runs');
    expect(details.textContent).toContain('6');
  });

  it('cron hooks show the cron expression under a Schedule label', async () => {
    hooksState.hooks = [makeHook({ delayMs: 0, cron: '0 9 * * *' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const details = screen.getByTestId('background-hook-details');
    expect(details.textContent).toContain('Schedule');
    expect(details.textContent).toContain('0 9 * * *');
    expect(details.textContent).not.toContain('Interval');
    expect(details.textContent).not.toContain('NaN');
    expect(details.textContent).not.toContain('undefined');
  });

  it('runAt hooks show a "once at" schedule instead of an interval', async () => {
    hooksState.hooks = [
      makeHook({
        delayMs: 0,
        runAt: '2026-07-31T12:00:00Z',
        nextRunAt: '2026-07-31T12:00:00Z',
      }),
    ];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const details = screen.getByTestId('background-hook-details');
    expect(details.textContent).toContain('Schedule');
    expect(details.textContent).toContain('once at');
    expect(details.textContent).not.toContain('Interval');
    expect(details.textContent).not.toContain('NaN');
    expect(details.textContent).not.toContain('undefined');
  });

  it('falls back to an em dash when delayMs is absent on an unknown schedule kind', async () => {
    hooksState.hooks = [makeHook({ delayMs: undefined })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const details = screen.getByTestId('background-hook-details');
    expect(details.textContent).toContain('Interval —');
    expect(details.textContent).not.toContain('NaN');
  });

  it('shows the singular run-count copy', async () => {
    hooksState.hooks = [makeHook({ runCount: 1 })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    expect(screen.getByTestId('background-hook-details').textContent).toContain('Runs 1');
  });

  it.each([
    ['scheduled', false],
    ['scheduled', true],
    ['running', false],
    ['running', true],
  ] as const)('keeps the %s hourglass static when embedded is %s', (state, embedded) => {
    hooksState.hooks = [makeHook({ state })];
    render(BackgroundHooksRow, {
      props: { workspaceId: 'ws-1', agentId: 'agent-1', embedded },
    });

    const icon = screen.getByTestId('background-hook-icon').querySelector('svg');
    expect(icon?.getAttribute('class')?.trim()).toBe('h-4 w-4');
    expect(icon?.classList.contains('animate-spin')).toBe(false);
    expect(icon?.classList.contains('motion-reduce:animate-none')).toBe(false);
    expect(screen.getByTestId('background-hook-summary').textContent).toContain(
      state === 'running' ? 'Running' : 'Scheduled',
    );
  });

  it('disables Run now while a hook is running', async () => {
    hooksState.hooks = [makeHook({ state: 'running' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    expect(screen.getByTestId('background-hook-run-now-action').hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('shows the last-run failure in the expanded row', async () => {
    hooksState.hooks = [makeHook({ lastError: 'Deployment failed' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const error = screen.getByTestId('background-hook-last-error');
    expect(error.textContent).toContain('Deployment failed');
  });

  it('preserves Run now and Cancel actions in the expanded footer', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });
    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    dispatchMock.mockClear();

    await fireEvent.click(screen.getByTestId('background-hook-run-now-action'));
    await fireEvent.click(screen.getByTestId('background-hook-cancel-action'));

    expect(dispatchMock).toHaveBeenCalledWith(runBackgroundHookRequested('ws-1', 'hook-1'));
    expect(dispatchMock).toHaveBeenCalledWith(cancelBackgroundHookRequested('ws-1', 'hook-1'));
  });

  it('hover card shows the TTL as an expires-in duration when expiresAt is set', async () => {
    hooksState.hooks = [makeHook({ expiresAt: '2026-07-31T11:00:00Z' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const hoverCard = screen.getByTestId('background-hook-details');
    // now 10:03:00Z → expiresAt 11:00:00Z = 57m remaining
    expect(hoverCard.textContent).toContain('Expires 57m');
    expect(hoverCard.textContent).not.toContain('04:00:00 AM');
  });

  it('hover card shows a minutes-and-seconds expires-in duration when not whole minutes', async () => {
    hooksState.hooks = [makeHook({ expiresAt: '2026-07-31T10:12:30Z' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const hoverCard = screen.getByTestId('background-hook-details');
    expect(hoverCard.textContent).toContain('Expires 9m 30s');
  });

  it('omits the TTL line when expiresAt is missing (legacy hook)', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const hoverCard = screen.getByTestId('background-hook-details');
    expect(hoverCard.textContent).toContain('Expires —');
  });

  it('inline details link opens the hook panel from the owning agent panel', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const link = await waitFor(() => screen.getByTestId('background-hook-view-script-link'));
    await fireEvent.click(link);

    expect(screen.queryByTestId('hook-script-modal')).toBeNull();
    expect(openHookTabMock).toHaveBeenCalledOnce();
    expect(openHookTabMock).toHaveBeenCalledWith(
      {
        type: 'hook-script',
        title: 'Hook: ci-watch',
        workspaceId: 'ws-1',
        hookId: 'hook-1',
        closable: true,
      },
      'agent-panel',
    );
  });

  describe('live countdown ticking', () => {
    /** Also fake interval timers so `vi.advanceTimersByTime` drives the 1s tick. */
    function useTickingFakeTimers(nowIso = '2026-07-31T10:03:00Z') {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(new Date(nowIso));
    }

    it('ticks the summary countdown and the Next run / TTL lines every second', async () => {
      useTickingFakeTimers();
      hooksState.hooks = [makeHook({ expiresAt: '2026-07-31T10:12:30Z' })];
      render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

      const summary = screen.getByTestId('background-hook-summary');
      // Lookbehind keeps this from matching "13m"/"23m".
      expect(summary.textContent).toMatch(/(?<![0-9])3m/);
      await fireEvent.click(summary);
      const details = screen.getByTestId('background-hook-details');
      expect(details.textContent).toContain('Next run 3m');
      expect(details.textContent).toContain('Expires 9m 30s');

      vi.advanceTimersByTime(1000);
      await tick();
      expect(summary.textContent).toContain('2m 59s');
      expect(details.textContent).toContain('Next run 2m 59s');
      expect(details.textContent).toContain('Expires 9m 29s');

      vi.advanceTimersByTime(1000);
      await tick();
      expect(summary.textContent).toContain('2m 58s');
      expect(details.textContent).toContain('Next run 2m 58s');
      expect(details.textContent).toContain('Expires 9m 28s');
    });

    it('clamps the countdown at 0s once the target time passes', async () => {
      useTickingFakeTimers();
      hooksState.hooks = [
        makeHook({
          nextRunAt: '2026-07-31T10:03:01Z',
          expiresAt: '2026-07-31T10:03:02Z',
        }),
      ];
      render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

      await fireEvent.click(screen.getByTestId('background-hook-summary'));
      const details = screen.getByTestId('background-hook-details');

      vi.advanceTimersByTime(5000);
      await tick();
      expect(screen.getByTestId('background-hook-summary').textContent).toContain('0s');
      expect(details.textContent).toContain('Next run 0s');
      expect(details.textContent).toContain('Expires 0s');
    });

    it('cleans up the ticking interval on unmount', () => {
      useTickingFakeTimers();
      hooksState.hooks = [makeHook()];
      const { unmount } = render(BackgroundHooksRow, {
        props: { workspaceId: 'ws-1', agentId: 'agent-1' },
      });

      const timersWhileMounted = vi.getTimerCount();
      expect(timersWhileMounted).toBeGreaterThanOrEqual(1);
      unmount();
      expect(vi.getTimerCount()).toBe(timersWhileMounted - 1);
    });
  });

  it('chip dropdown offers "View script" alongside Run now / Cancel and opens the panel', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-chip'));

    const item = await waitFor(() => screen.getByTestId('background-hook-view-script-item'));
    expect(item.textContent).toContain('View script');
    expect(screen.getByText('Run now')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();

    await fireEvent.click(item);
    expect(openHookTabMock).toHaveBeenCalledOnce();
    expect(openHookTabMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hook-script', workspaceId: 'ws-1', hookId: 'hook-1' }),
      'agent-panel',
    );
  });
});
